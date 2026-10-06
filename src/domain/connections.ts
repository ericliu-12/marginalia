import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { book, connection, connectionRun, enrichment, libraryEntry, note } from "@/db/schema";
import type { DescriptionGateway } from "./description";
import { embedEnrichment, embedNote, nearestBooks, type Embedder } from "./embeddings";
import { enrichBook, type EnrichmentModel } from "./enrichment";
import { findEntry, isFinished, readFinished, startConnections, type ConnectionQueue } from "./library-entry";

export type ConnectionType = "thematic" | "contrast" | "context";
export type Strength = "strong" | "moderate" | "weak";
// What each Strength counts for when Connections are grouped into Clusters.
export const CLUSTER_WEIGHT: Record<Strength, number> = { strong: 2, moderate: 1, weak: 0.5 };
// Strongest first; ties are broken by similarity.
const STRENGTH_RANK: Record<Strength, number> = { strong: 0, moderate: 1, weak: 2 };

// What the judge sees for one Book. Note ids are short handles for this call only.
export type JudgeNote = { id: string; body: string };
export type JudgeBook = { title: string; authors: string[]; enrichment: string | null; notes: JudgeNote[] };
export type JudgeCandidate = JudgeBook & { id: string };
export type JudgeInput = { book: JudgeBook; candidates: JudgeCandidate[] };

export type JudgedConnection = {
  candidateId: string;
  type: ConnectionType;
  strength: Strength;
  explanation: string;
  quotedNoteIds: string[];
};

export type JudgeResult = { connections: JudgedConnection[]; inputTokens: number; outputTokens: number; costUsd: number };

// Seam to the Sonnet-class model; tests supply a fake. Throws on a failed or malformed answer.
export interface ConnectionJudge {
  readonly model: string;
  readonly promptVersion: string;
  judge(input: JudgeInput): Promise<JudgeResult>;
}

export type ConnectionJob = { userId: string; bookId: string };

export type { ConnectionQueue };

// Starting defaults from the pipeline-tuning prototype.
export const CANDIDATE_COUNT = 12;
export const PER_RUN_CAP = 5;
// Approximate tokens of Notes shown to the judge per Book; the finished Book's own Notes get more room.
const CANDIDATE_NOTES_BUDGET = 600;
const OWN_NOTES_BUDGET = 3000;

const approxTokens = (s: string) => Math.ceil(s.length / 4);

// Notes in the order written, as many as fit the budget.
function withinBudget<T extends { body: string }>(notes: T[], budget: number): T[] {
  let used = 0;
  return notes.filter((n) => {
    used += approxTokens(n.body);
    return used <= budget;
  });
}

const normalise = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const QUOTED = /["“]([^"”]{8,})["”]/g;

export type ConnectionDeps = {
  judge: ConnectionJudge;
  embedder: Embedder;
  // Used to finish the Book's own Enrichment first, when the worker has not got to it yet.
  enrichment: EnrichmentModel;
  descriptions?: DescriptionGateway | null;
  // The queue will not retry after this run, so a failure now is the reader-visible `failed`.
  finalAttempt?: boolean;
};

// Domain seam, run by the worker: find the Connections of a Book among the reader's other Finished
// Books and store them in one transaction. Zero is a valid result. Throws on failure so the queue
// retries; a Book that is no longer in the library, or not Finished, is a no-op.
export async function generateConnections(db: Db, deps: ConnectionDeps, { userId, bookId }: ConnectionJob): Promise<void> {
  const entry = await findEntry(db, userId, bookId);
  if (!entry || !(await isFinished(db, userId, bookId))) return;
  await db.update(libraryEntry).set({ connectionsStatus: "running" }).where(eq(libraryEntry.id, entry.id));
  try {
    await run(db, deps, userId, entry.id, bookId);
  } catch (err) {
    if (deps.finalAttempt) await db.update(libraryEntry).set({ connectionsStatus: "failed" }).where(eq(libraryEntry.id, entry.id));
    throw err;
  }
}

async function run(db: Db, deps: ConnectionDeps, userId: string, entryId: string, bookId: string) {
  const { judge, embedder } = deps;

  // The Book's Enrichment and its Notes' vectors are part of this job when nothing else got there first.
  await enrichBook(db, { model: deps.enrichment, descriptions: deps.descriptions }, bookId);
  await embedEnrichment(db, embedder, bookId);
  const unembedded = await db
    .select({ id: note.id })
    .from(note)
    .where(
      and(
        eq(note.libraryEntryId, entryId),
        or(isNull(note.embedding), isNull(note.embeddingModel), sql`${note.embeddingModel} <> ${embedder.model}`),
      ),
    );
  for (const { id } of unembedded) await embedNote(db, embedder, id);

  // Pairs that already have a Connection (from the other Book's run, or dismissed) are not judged again.
  const existing = await db
    .select({ a: connection.bookAId, b: connection.bookBId })
    .from(connection)
    .where(and(eq(connection.userId, userId), or(eq(connection.bookAId, bookId), eq(connection.bookBId, bookId))));
  const connected = new Set(existing.map((c) => (c.a === bookId ? c.b : c.a)));
  const nearest = (await nearestBooks(db, userId, bookId, embedder.model, CANDIDATE_COUNT + connected.size))
    .filter((n) => !connected.has(n.bookId))
    .slice(0, CANDIDATE_COUNT);

  const finish = (judged: (typeof connection.$inferInsert)[], result?: JudgeResult) =>
    db.transaction(async (tx) => {
      // The reader may have removed this Book, or one it links to, while the job ran: store nothing
      // for a removed Book. The lock holds removal off until this commits; `key share` does not
      // conflict with the status update below, nor with other jobs taking the same lock.
      const others = judged.map((r) => (r.bookAId === bookId ? r.bookBId : r.bookAId));
      // Its own Entry is matched by id: one removed and added again is a different Entry, with its own job.
      const live = await tx
        .select({ id: libraryEntry.id, bookId: libraryEntry.bookId })
        .from(libraryEntry)
        .where(and(eq(libraryEntry.userId, userId), inArray(libraryEntry.bookId, [bookId, ...others])))
        .for("key share");
      if (!live.some((e) => e.id === entryId)) return;
      const inLibrary = new Set(live.map((e) => e.bookId));
      const rows = judged.filter((_, i) => inLibrary.has(others[i]));
      const inserted = rows.length
        ? await tx
            .insert(connection)
            .values(rows)
            .onConflictDoNothing({ target: [connection.userId, connection.bookAId, connection.bookBId] })
            .returning({ id: connection.id })
        : [];
      await tx.insert(connectionRun).values({
        userId,
        libraryEntryId: entryId,
        candidateCount: nearest.length,
        connectionCount: inserted.length,
        ...(result && {
          model: judge.model,
          promptVersion: judge.promptVersion,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          costUsd: result.costUsd,
        }),
      });
      await tx.update(libraryEntry).set({ connectionsStatus: "idle", connectionsGeneratedAt: new Date() }).where(eq(libraryEntry.id, entryId));
    });

  if (nearest.length === 0) return finish([]);

  const bookIds = [bookId, ...nearest.map((n) => n.bookId)];
  const books = await db.select().from(book).where(inArray(book.id, bookIds));
  const enrichments = await db.select().from(enrichment).where(inArray(enrichment.bookId, bookIds));
  const notes = await db
    .select({ id: note.id, body: note.body, bookId: libraryEntry.bookId })
    .from(note)
    .innerJoin(libraryEntry, eq(libraryEntry.id, note.libraryEntryId))
    .where(and(eq(libraryEntry.userId, userId), inArray(libraryEntry.bookId, bookIds)))
    .orderBy(asc(note.createdAt), asc(note.id));

  // Short ids for this call (n1, n2, ...) map back to the real Note.
  const handles = new Map<string, { noteId: string; bookId: string; body: string }>();
  const present = (id: string, budget: number): JudgeNote[] =>
    withinBudget(
      notes.filter((n) => n.bookId === id),
      budget,
    ).map((n) => {
      const handle = `n${handles.size + 1}`;
      handles.set(handle, { noteId: n.id, bookId: id, body: n.body });
      return { id: handle, body: n.body };
    });
  const describe = (id: string, budget: number): JudgeBook => {
    const b = books.find((x) => x.id === id)!;
    const e = enrichments.find((x) => x.bookId === id);
    return {
      title: b.title,
      authors: b.authors,
      // An unrecognised Book's Enrichment is empty: the judge is told it has none.
      enrichment: e?.recognised && e.status === "ready" && e.summary ? `${e.summary} Themes: ${(e.themes ?? []).join("; ")}` : null,
      notes: present(id, budget),
    };
  };
  const own = describe(bookId, OWN_NOTES_BUDGET);
  const candidates = nearest.map((n, i) => ({ id: `C${i + 1}`, ...describe(n.bookId, CANDIDATE_NOTES_BUDGET) }));

  const result = await judge.judge({ book: own, candidates });

  const rows: (typeof connection.$inferInsert & { rank: number })[] = [];
  const seen = new Set<string>();
  for (const c of result.connections) {
    const index = candidates.findIndex((x) => x.id === c.candidateId);
    if (index < 0 || seen.has(c.candidateId)) continue;
    const other = nearest[index];
    const pair = new Set([bookId, other.bookId]);
    const pool = [...handles.values()].filter((h) => pair.has(h.bookId));

    // Every quoted span must be verbatim in a Note of the pair; otherwise the Connection is dropped
    // rather than shown with a misquote.
    const quoted = new Map<string, (typeof pool)[number]>();
    let misquoted = false;
    for (const [, span] of c.explanation.matchAll(QUOTED)) {
      const text = normalise(span);
      if (!text) continue;
      const matches = pool.filter((h) => normalise(h.body).includes(text));
      if (matches.length === 0) misquoted = true;
      for (const m of matches) quoted.set(m.noteId, m);
    }
    if (misquoted) continue;

    // Weak links survive only when they quote Notes from both Books, and stay weak.
    const quotedFrom = (id: string) => [...quoted.values()].some((h) => h.bookId === id);
    if (c.strength === "weak" && !(quotedFrom(bookId) && quotedFrom(other.bookId))) continue;

    seen.add(c.candidateId);
    const [a, b] = bookId < other.bookId ? [bookId, other.bookId] : [other.bookId, bookId];
    rows.push({
      userId,
      bookAId: a,
      bookBId: b,
      type: c.type,
      strength: c.strength,
      similarity: other.similarity,
      similarityModel: embedder.model,
      explanation: c.explanation,
      grounding: quoted.size > 0 ? "notes" : "enrichment",
      quotedNoteIds: [...quoted.keys()],
      model: judge.model,
      promptVersion: judge.promptVersion,
      rank: STRENGTH_RANK[c.strength],
    });
  }
  // Strongest first, ties by similarity; the cap keeps the best.
  const top = rows
    .sort((x, y) => x.rank - y.rank || y.similarity - x.similarity)
    .slice(0, PER_RUN_CAP)
    .map(({ rank: _rank, ...row }) => row);
  await finish(top, result);
}

// One-off backfill: queues Connections for every Finished Book that has none generated yet, oldest
// finish first (unknown dates last, then by when it was completed). Returns how many were queued.
// Jobs for the same Book coalesce, so re-running is safe.
export async function backfillConnections(db: Db, queue: ConnectionQueue, userId: string): Promise<number> {
  const finished = await readFinished(db, userId);
  const entries = await db
    .select({ id: libraryEntry.id, bookId: libraryEntry.bookId, createdAt: libraryEntry.createdAt })
    .from(libraryEntry)
    .where(and(eq(libraryEntry.userId, userId), isNull(libraryEntry.connectionsGeneratedAt)));
  const due = entries
    .flatMap((e) => (finished.has(e.id) ? [{ ...e, ...finished.get(e.id)! }] : []))
    .sort(
      (a, b) =>
        (a.firstFinishedAt ?? Infinity) - (b.firstFinishedAt ?? Infinity) ||
        a.firstCompletedAt - b.firstCompletedAt ||
        a.createdAt.getTime() - b.createdAt.getTime(),
    );
  for (const { bookId } of due) await startConnections(db, queue, userId, bookId);
  return due.length;
}

export type ConnectionCard = {
  otherBookId: string;
  otherTitle: string;
  type: ConnectionType;
  strength: Strength;
  explanation: string;
  grounding: "notes" | "enrichment";
};

export type ConnectionsView = {
  cards: ConnectionCard[];
  status: "idle" | "running" | "failed";
  // Whether Connections have been generated for this Book.
  generated: boolean;
  // A Book that is not Finished takes no part in Connections, so the panel has nothing to say about them.
  finished: boolean;
};

// Domain seam: what the Book panel shows. Strongest first, then most similar. Dismissed ones are hidden.
export async function readConnections(db: Db, userId: string, bookId: string): Promise<ConnectionsView> {
  const entry = await findEntry(db, userId, bookId);
  const rows = await db
    .select()
    .from(connection)
    .where(
      and(
        eq(connection.userId, userId),
        isNull(connection.dismissedAt),
        or(eq(connection.bookAId, bookId), eq(connection.bookBId, bookId)),
      ),
    )
    .orderBy(asc(connection.strength), desc(connection.similarity));
  const otherId = (r: (typeof rows)[number]) => (r.bookAId === bookId ? r.bookBId : r.bookAId);
  const others = rows.length
    ? await db
        .select({ id: book.id, title: book.title, override: libraryEntry.titleOverride })
        .from(book)
        .leftJoin(libraryEntry, and(eq(libraryEntry.bookId, book.id), eq(libraryEntry.userId, userId)))
        .where(inArray(book.id, rows.map(otherId)))
    : [];
  return {
    cards: rows.map((r) => {
      const other = others.find((o) => o.id === otherId(r))!;
      return {
        otherBookId: other.id,
        otherTitle: other.override ?? other.title,
        type: r.type,
        strength: r.strength,
        explanation: r.explanation,
        grounding: r.grounding,
      };
    }),
    status: entry?.connectionsStatus ?? "idle",
    generated: !!entry?.connectionsGeneratedAt,
    finished: !!entry && (await isFinished(db, userId, bookId)),
  };
}

// Domain seam: how many of the reader's Books are queued or running, for the quiet indicator.
export async function countFindingConnections(db: Db, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(libraryEntry)
    .where(and(eq(libraryEntry.userId, userId), eq(libraryEntry.connectionsStatus, "running")));
  return row.n;
}
