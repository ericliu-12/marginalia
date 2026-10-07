import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { book, connection, connectionRun, enrichment, libraryEntry, note } from "@/db/schema";
import { embedEnrichment, nearestBooks, type Embedder } from "./embeddings";
import { displayed } from "./library";
import { byStrength, otherBook, pairOf } from "./connection-pair";
import { completedPasses, findEntry, isFinished, readFinished } from "./library-entry";
import type { JobQueue, Pipeline } from "./pipeline";

export type ConnectionType = "thematic" | "contrast" | "context";
export type Strength = "strong" | "moderate" | "weak";
// What each Strength counts for when Connections are grouped into Clusters.
export const CLUSTER_WEIGHT: Record<Strength, number> = { strong: 2, moderate: 1, weak: 0.5 };
// Strongest first; ties are broken by similarity.
export const STRENGTH_RANK: Record<Strength, number> = { strong: 0, moderate: 1, weak: 2 };

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

// What a Refresh overwrites on a Connection it finds again.
const REFRESHED = Object.fromEntries(
  (["type", "strength", "similarity", "similarityModel", "explanation", "grounding", "quotedNoteIds", "model", "promptVersion"] as const).map(
    (k) => [k, sql.raw(`excluded.${connection[k].name}`)],
  ),
);

const normalise = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const QUOTED = /["“]([^"”]{8,})["”]/g;

export type ConnectionDeps = {
  judge: ConnectionJudge;
  embedder: Embedder;
};

// This module is the only writer of a Library Entry's Connections status:
//   running: a run is queued, waiting on the Book's Enrichment or Note vectors, or under way
//   idle:    nothing is coming (`connectionsGeneratedAt` says whether a run ever succeeded)
//   failed:  the job gave up (see connectionsGaveUp), or could not be queued

// Marks the Book's Connections as queued and queues the job. Outside a Refresh, does nothing for a
// Book whose Connections were already generated; a Refresh does nothing for a Book that is not
// Finished. A queue that errors must not fail the caller: the Book is left `failed` instead, so the
// reader is not left waiting on a job that is not coming.
export async function startConnections(db: Db, queue: JobQueue, userId: string, bookId: string, refresh: boolean): Promise<void> {
  if (refresh && !(await isFinished(db, userId, bookId))) return;
  const [entry] = await db
    .update(libraryEntry)
    .set({ connectionsStatus: "running" })
    .where(
      and(eq(libraryEntry.userId, userId), eq(libraryEntry.bookId, bookId), refresh ? undefined : isNull(libraryEntry.connectionsGeneratedAt)),
    )
    .returning({ id: libraryEntry.id });
  if (!entry) return;
  try {
    await queue.send({ kind: "connections", userId, bookId });
  } catch (err) {
    console.error(err);
    await db.update(libraryEntry).set({ connectionsStatus: "failed" }).where(eq(libraryEntry.id, entry.id));
  }
}

// Something a waiting run needs has settled (the Book's Enrichment, or one of its Notes' vectors):
// queues the job again for every Entry still waiting on the Book, or just `entryId`'s. One that can't
// be queued is left `failed`, not waiting.
export async function resumeConnections(db: Db, queue: JobQueue, bookId: string, entryId?: string): Promise<void> {
  const waiting = await db
    .select({ id: libraryEntry.id, userId: libraryEntry.userId })
    .from(libraryEntry)
    .where(and(eq(libraryEntry.bookId, bookId), entryId ? eq(libraryEntry.id, entryId) : undefined, eq(libraryEntry.connectionsStatus, "running")));
  for (const { id, userId } of waiting) {
    try {
      await queue.send({ kind: "connections", userId, bookId });
    } catch (err) {
      console.error(err);
      await db.update(libraryEntry).set({ connectionsStatus: "failed" }).where(eq(libraryEntry.id, id));
    }
  }
}

// One of the Book's Notes has a vector, or has given up on one.
export async function resumeNoteConnections(db: Db, queue: JobQueue, noteId: string): Promise<void> {
  const [n] = await db
    .select({ entryId: note.libraryEntryId, bookId: libraryEntry.bookId })
    .from(note)
    .innerJoin(libraryEntry, eq(libraryEntry.id, note.libraryEntryId))
    .where(eq(note.id, noteId));
  if (n) await resumeConnections(db, queue, n.bookId, n.entryId);
}

// The Book's Enrichment is ready: Refreshes, once, each reader whose latest run judged the Book
// without it. Only a recognised Enrichment reaches the judge, so an unrecognised one changes nothing.
export async function refreshAfterEnrichment(db: Db, queue: JobQueue, bookId: string): Promise<void> {
  const [e] = await db.select().from(enrichment).where(eq(enrichment.bookId, bookId));
  if (e?.status !== "ready" || !e.recognised) return;
  const latest = await db
    .selectDistinctOn([connectionRun.libraryEntryId], { userId: libraryEntry.userId, withoutEnrichment: connectionRun.withoutEnrichment })
    .from(connectionRun)
    .innerJoin(libraryEntry, eq(libraryEntry.id, connectionRun.libraryEntryId))
    .where(eq(libraryEntry.bookId, bookId))
    .orderBy(connectionRun.libraryEntryId, desc(connectionRun.createdAt));
  for (const r of latest) if (r.withoutEnrichment) await startConnections(db, queue, r.userId, bookId, true);
}

// A run waits until the Book's Enrichment has settled (ready or failed) and each of its Notes has a
// vector or has given up on one.
async function prerequisitesSettled(db: Db, entryId: string, bookId: string) {
  const [e] = await db.select({ status: enrichment.status }).from(enrichment).where(eq(enrichment.bookId, bookId));
  if (!e || e.status === "pending") return false;
  const unsettled = await db
    .select({ id: note.id })
    .from(note)
    .where(and(eq(note.libraryEntryId, entryId), isNull(note.embedding), isNull(note.embedFailedAt)))
    .limit(1);
  return unsettled.length === 0;
}

// Domain seam, run by the worker: find the Connections of a Book among the reader's other Finished
// Books and store them in one transaction. Zero is a valid result. Runs only while the Book is
// `running` (queued by a first finish or a Refresh). Once a run has succeeded, later ones are Refreshes: they update the Connections they find again in place, never delete one, and
// never judge or revive a dismissed one. Waits, still `running`, while the Book's Enrichment or a
// Note's vector is on its way; the Pipeline queues it again when one settles. Throws on failure so
// the queue retries, still `running`; a Book that is no longer in the library, or not Finished, is a no-op.
export async function generateConnections(db: Db, deps: ConnectionDeps, { userId, bookId }: ConnectionJob): Promise<void> {
  const entry = await findEntry(db, userId, bookId);
  // Only a run someone asked for (`running`): a duplicate job left over after one finished does nothing.
  if (!entry || entry.connectionsStatus !== "running" || !(await isFinished(db, userId, bookId))) return;
  if (!(await prerequisitesSettled(db, entry.id, bookId))) return;
  await run(db, deps, userId, entry.id, bookId, entry.connectionsGeneratedAt !== null);
}

// The Book's Connections job will not be attempted again: a run still waiting on it is `failed`, and
// the reader's Refresh tries again.
export async function connectionsGaveUp(db: Db, userId: string, bookId: string): Promise<void> {
  await db
    .update(libraryEntry)
    .set({ connectionsStatus: "failed" })
    .where(and(eq(libraryEntry.userId, userId), eq(libraryEntry.bookId, bookId), eq(libraryEntry.connectionsStatus, "running")));
}

async function run(db: Db, deps: ConnectionDeps, userId: string, entryId: string, bookId: string, refresh: boolean) {
  const { judge, embedder } = deps;

  // The Enrichment's vector is part of this job when the embed job has not got there first.
  await embedEnrichment(db, embedder, bookId);
  const [ownEnrichment] = await db.select({ status: enrichment.status }).from(enrichment).where(eq(enrichment.bookId, bookId));
  const withoutEnrichment = ownEnrichment?.status !== "ready";

  // Dismissed pairs are never judged again; nor, outside a Refresh, are pairs that already have a
  // Connection (from the other Book's run).
  const existing = await db
    .select({ a: connection.bookAId, b: connection.bookBId })
    .from(connection)
    .where(
      and(
        eq(connection.userId, userId),
        or(eq(connection.bookAId, bookId), eq(connection.bookBId, bookId)),
        refresh ? isNotNull(connection.dismissedAt) : undefined,
      ),
    );
  const connected = new Set(existing.map((c) => otherBook(c, bookId)));
  const nearest = (await nearestBooks(db, userId, bookId, embedder.model, CANDIDATE_COUNT + connected.size))
    .filter((n) => !connected.has(n.bookId))
    .slice(0, CANDIDATE_COUNT);

  const finish = (judged: (typeof connection.$inferInsert)[], result?: JudgeResult) =>
    db.transaction(async (tx) => {
      // The reader may have removed this Book, or one it links to, while the job ran: store nothing
      // for a removed Book. The lock holds removal off until this commits; `key share` does not
      // conflict with the status update below, nor with other jobs taking the same lock.
      const others = judged.map((r) => otherBook({ a: r.bookAId, b: r.bookBId }, bookId));
      // Its own Entry is matched by id: one removed and added again is a different Entry, with its own job.
      const live = await tx
        .select({ id: libraryEntry.id, bookId: libraryEntry.bookId })
        .from(libraryEntry)
        .where(and(eq(libraryEntry.userId, userId), inArray(libraryEntry.bookId, [bookId, ...others])))
        .for("key share");
      if (!live.some((e) => e.id === entryId)) return;
      const inLibrary = new Set(live.map((e) => e.bookId));
      const rows = judged.filter((_, i) => inLibrary.has(others[i]));
      const target = [connection.userId, connection.bookAId, connection.bookBId];
      const store = () => {
        const insert = tx.insert(connection).values(rows);
        return refresh
          ? insert.onConflictDoUpdate({ target, set: REFRESHED, setWhere: isNull(connection.dismissedAt) })
          : insert.onConflictDoNothing({ target });
      };
      const inserted = rows.length ? await store().returning({ id: connection.id }) : [];
      await tx.insert(connectionRun).values({
        userId,
        libraryEntryId: entryId,
        candidateCount: nearest.length,
        connectionCount: inserted.length,
        withoutEnrichment,
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
  const books = await db
    .select({ book, entry: libraryEntry })
    .from(book)
    .leftJoin(libraryEntry, and(eq(libraryEntry.bookId, book.id), eq(libraryEntry.userId, userId)))
    .where(inArray(book.id, bookIds));
  const enrichments = await db.select().from(enrichment).where(inArray(enrichment.bookId, bookIds));
  const notes = await db
    .select({ id: note.id, body: note.body, bookId: libraryEntry.bookId })
    .from(note)
    .innerJoin(libraryEntry, eq(libraryEntry.id, note.libraryEntryId))
    // A Note without a vector (its embedding gave up) is left out.
    .where(and(eq(libraryEntry.userId, userId), inArray(libraryEntry.bookId, bookIds), isNotNull(note.embedding)))
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
    const b = books.find((x) => x.book.id === id)!;
    const e = enrichments.find((x) => x.bookId === id);
    return {
      ...displayed(b.book, b.entry),
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
    const { a, b } = pairOf(bookId, other.bookId);
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
export async function backfillConnections(db: Db, pipeline: Pipeline, userId: string): Promise<number> {
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
  for (const { bookId } of due) await pipeline.bookFinished(userId, bookId);
  return due.length;
}

export type ConnectionCard = {
  id: string;
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
  // What Connections can't draw on, its vector having given up, until a Refresh embeds it again: how
  // many of the reader's Notes on the Book, and whether its Enrichment.
  leftOut: { notes: number; enrichment: boolean };
};

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

// The reader's live Connections: not dismissed, and between Finished Books. In pair order, so a
// graph built from them is the same on every run.
export async function readLiveConnections(db: Db | Tx, userId: string) {
  const finished = new Set((await completedPasses(db, userId)).map((p) => p.bookId));
  const rows = await db
    .select({
      id: connection.id,
      a: connection.bookAId,
      b: connection.bookBId,
      type: connection.type,
      strength: connection.strength,
      similarity: connection.similarity,
      explanation: connection.explanation,
    })
    .from(connection)
    .where(and(eq(connection.userId, userId), isNull(connection.dismissedAt)))
    .orderBy(asc(connection.bookAId), asc(connection.bookBId));
  return rows.filter((c) => finished.has(c.a) && finished.has(c.b));
}

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
    .then((rs) => rs.sort(byStrength));
  const otherId = (r: (typeof rows)[number]) => otherBook({ a: r.bookAId, b: r.bookBId }, bookId);
  const others = rows.length
    ? await db
        .select({ book, entry: libraryEntry })
        .from(book)
        .leftJoin(libraryEntry, and(eq(libraryEntry.bookId, book.id), eq(libraryEntry.userId, userId)))
        .where(inArray(book.id, rows.map(otherId)))
    : [];
  return {
    cards: rows.map((r) => {
      const other = others.find((o) => o.book.id === otherId(r))!;
      return {
        id: r.id,
        otherBookId: other.book.id,
        otherTitle: displayed(other.book, other.entry).title,
        type: r.type,
        strength: r.strength,
        explanation: r.explanation,
        grounding: r.grounding,
      };
    }),
    status: entry?.connectionsStatus ?? "idle",
    generated: !!entry?.connectionsGeneratedAt,
    finished: !!entry && (await isFinished(db, userId, bookId)),
    leftOut: await readLeftOut(db, entry?.id, bookId),
  };
}

async function readLeftOut(db: Db, entryId: string | undefined, bookId: string): Promise<ConnectionsView["leftOut"]> {
  if (!entryId) return { notes: 0, enrichment: false };
  const [notes] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(note)
    .where(and(eq(note.libraryEntryId, entryId), isNotNull(note.embedFailedAt)));
  const [e] = await db.select({ embedFailedAt: enrichment.embedFailedAt }).from(enrichment).where(eq(enrichment.bookId, bookId));
  return { notes: notes.n, enrichment: !!e?.embedFailedAt };
}

// Domain seam: how many of the reader's Books are queued or running, for the quiet indicator.
export async function countFindingConnections(db: Db, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(libraryEntry)
    .where(and(eq(libraryEntry.userId, userId), eq(libraryEntry.connectionsStatus, "running")));
  return row.n;
}

export type ConnectionDetail = {
  id: string;
  a: { bookId: string; title: string };
  b: { bookId: string; title: string };
  type: ConnectionType;
  strength: Strength;
  explanation: string;
  grounding: "notes" | "enrichment";
};

// Domain seam: one Connection, as the graph shows it when the reader chooses it; its Books titled as the
// reader titles them. Null for a dismissed Connection, or one that is not the reader's.
export async function readConnection(db: Db, userId: string, connectionId: string): Promise<ConnectionDetail | null> {
  const [c] = await db
    .select()
    .from(connection)
    .where(and(eq(connection.id, connectionId), eq(connection.userId, userId), isNull(connection.dismissedAt)));
  if (!c) return null;
  const books = await db
    .select({ book, entry: libraryEntry })
    .from(book)
    .leftJoin(libraryEntry, and(eq(libraryEntry.bookId, book.id), eq(libraryEntry.userId, userId)))
    .where(inArray(book.id, [c.bookAId, c.bookBId]));
  const side = (id: string) => {
    const b = books.find((x) => x.book.id === id)!;
    return { bookId: id, title: displayed(b.book, b.entry).title };
  };
  return { id: c.id, a: side(c.bookAId), b: side(c.bookBId), type: c.type, strength: c.strength, explanation: c.explanation, grounding: c.grounding };
}

// Domain seam: the reader dismisses a Connection. It leaves the graph and the Book panel, is never
// judged or revived again, and the reader's Clusters are recomputed. A Connection already dismissed,
// or not the reader's, is left alone.
export async function dismissConnection(db: Db, pipeline: Pipeline, userId: string, connectionId: string): Promise<void> {
  const dismissed = await db
    .update(connection)
    .set({ dismissedAt: new Date() })
    .where(and(eq(connection.id, connectionId), eq(connection.userId, userId), isNull(connection.dismissedAt)))
    .returning({ id: connection.id });
  if (dismissed.length) await pipeline.connectionsChanged(userId);
}
