import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, notExists, or, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { book, connection, connectionRun, enrichment, libraryEntry, note } from "@/db/schema";
import { embedEnrichment, nearestBooks, type Embedder } from "./embeddings";
import { isRecognised } from "./enrichment";
import { displayed } from "./library";
import { byStrength, otherBook, pairOf } from "./connection-pair";
import { acceptJudged, judgeRound } from "./judge-round";
import { completedPasses, findEntry, isFinished, NotInLibraryError, readFinished } from "./library-entry";
import type { Pipeline } from "./pipeline";

export type ConnectionType = "thematic" | "contrast" | "context";
export type Strength = "strong" | "moderate" | "weak";
// Who made a Connection: the judge, or the reader by hand (a Manual Connection).
export type MadeBy = "judge" | "reader";
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

// Starting default from the pipeline-tuning prototype.
export const CANDIDATE_COUNT = 12;

// What a Refresh overwrites on a Connection it finds again.
const REFRESHED = Object.fromEntries(
  (["type", "strength", "similarity", "similarityModel", "explanation", "grounding", "quotedNoteIds", "model", "promptVersion"] as const).map(
    (k) => [k, sql.raw(`excluded.${connection[k].name}`)],
  ),
);

export type ConnectionDeps = {
  judge: ConnectionJudge;
  embedder: Embedder;
};

// This module is the only writer of a Library Entry's Connections status:
//   running: a run is queued, waiting on the Book's Enrichment or Note vectors, or under way
//   idle:    nothing is coming (`connectionsGeneratedAt` says whether a run ever succeeded)
//   failed:  the job gave up (see connectionsGaveUp), or could not be queued

// A Reader's Book whose Connections job is due: the Pipeline queues it, or, when it can't, calls
// connectionsNotQueued so the reader is not left waiting on a job that is not coming.
export type ConnectionsDue = { entryId: string; userId: string; bookId: string };

// Marks the Book's Connections as queued and returns the job due. Outside a Refresh, does nothing for a
// Book whose Connections were already generated; a Refresh does nothing for a Book that is not
// Finished.
export async function startConnections(db: Db, userId: string, bookId: string, refresh: boolean): Promise<ConnectionsDue[]> {
  if (refresh && !(await isFinished(db, userId, bookId))) return [];
  const [entry] = await db
    .update(libraryEntry)
    .set({ connectionsStatus: "running" })
    .where(
      and(eq(libraryEntry.userId, userId), eq(libraryEntry.bookId, bookId), refresh ? undefined : isNull(libraryEntry.connectionsGeneratedAt)),
    )
    .returning({ id: libraryEntry.id });
  return entry ? [{ entryId: entry.id, userId, bookId }] : [];
}

// The Connections job could not be queued: the Book is left `failed`, not waiting.
export async function connectionsNotQueued(db: Db, entryId: string): Promise<void> {
  await db.update(libraryEntry).set({ connectionsStatus: "failed" }).where(eq(libraryEntry.id, entryId));
}

// Something a waiting run needs has settled (the Book's Enrichment, or one of its Notes' vectors): the
// job is due again for every Entry still waiting on the Book, or just `entryId`'s.
export async function resumeConnections(db: Db, bookId: string, entryId?: string): Promise<ConnectionsDue[]> {
  const waiting = await db
    .select({ entryId: libraryEntry.id, userId: libraryEntry.userId })
    .from(libraryEntry)
    .where(and(eq(libraryEntry.bookId, bookId), entryId ? eq(libraryEntry.id, entryId) : undefined, eq(libraryEntry.connectionsStatus, "running")));
  return waiting.map((w) => ({ ...w, bookId }));
}

// One of the Book's Notes has a vector, or has given up on one.
export async function resumeNoteConnections(db: Db, noteId: string): Promise<ConnectionsDue[]> {
  const [n] = await db
    .select({ entryId: note.libraryEntryId, bookId: libraryEntry.bookId })
    .from(note)
    .innerJoin(libraryEntry, eq(libraryEntry.id, note.libraryEntryId))
    .where(eq(note.id, noteId));
  return n ? resumeConnections(db, n.bookId, n.entryId) : [];
}

// The Book's Enrichment is ready: Refreshes, once, each reader whose latest run judged the Book
// without it. Only a recognised Enrichment reaches the judge; an unrecognised one is handled by
// notesOnlyBreaches.
export async function refreshAfterEnrichment(db: Db, bookId: string): Promise<ConnectionsDue[]> {
  const [e] = await db.select().from(enrichment).where(eq(enrichment.bookId, bookId));
  if (!isRecognised(e)) return [];
  const latest = await db
    .selectDistinctOn([connectionRun.libraryEntryId], { userId: libraryEntry.userId, withoutEnrichment: connectionRun.withoutEnrichment })
    .from(connectionRun)
    .innerJoin(libraryEntry, eq(libraryEntry.id, connectionRun.libraryEntryId))
    .where(eq(libraryEntry.bookId, bookId))
    .orderBy(connectionRun.libraryEntryId, desc(connectionRun.createdAt));
  const due: ConnectionsDue[] = [];
  for (const r of latest) if (r.withoutEnrichment) due.push(...(await startConnections(db, r.userId, bookId, true)));
  return due;
}

// The judge's Connections of the Book, dismissed ones too, that quote none of their reader's Notes on
// it. A Manual Connection is the reader's own word, so it never counts.
function quotingNoNotes(db: Db, bookId: string) {
  const ownNotes = db
    .select({ id: note.id })
    .from(note)
    .innerJoin(libraryEntry, eq(libraryEntry.id, note.libraryEntryId))
    .where(and(eq(libraryEntry.userId, connection.userId), eq(libraryEntry.bookId, bookId), sql`${note.id} = any(${connection.quotedNoteIds})`));
  return and(eq(connection.madeBy, "judge"), or(eq(connection.bookAId, bookId), eq(connection.bookBId, bookId)), notExists(ownNotes));
}

// The Book's Enrichment came back unrecognised, so it connects through its Notes only: the Readers
// with a Connection of it that breaks that rule (see dropNotesOnlyBreaches). None for any other Enrichment.
export async function notesOnlyBreaches(db: Db, bookId: string): Promise<string[]> {
  const [e] = await db.select({ status: enrichment.status, recognised: enrichment.recognised }).from(enrichment).where(eq(enrichment.bookId, bookId));
  if (e?.status !== "ready" || e.recognised) return [];
  const rows = await db.selectDistinct({ userId: connection.userId }).from(connection).where(quotingNoNotes(db, bookId));
  return rows.map((r) => r.userId);
}

// Deletes the reader's Connections of the Book that quote none of their Notes on it, without judging
// anything again. A later recognised Enrichment Refreshes as usual.
export async function dropNotesOnlyBreaches(db: Db, userId: string, bookId: string): Promise<void> {
  await db.delete(connection).where(and(eq(connection.userId, userId), quotingNoNotes(db, bookId)));
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

  // Dismissed pairs and the reader's own (Manual Connections) are never judged; nor, outside a Refresh,
  // are pairs that already have a Connection (from the other Book's run).
  const existing = await db
    .select({ a: connection.bookAId, b: connection.bookBId })
    .from(connection)
    .where(
      and(
        eq(connection.userId, userId),
        or(eq(connection.bookAId, bookId), eq(connection.bookBId, bookId)),
        refresh ? or(isNotNull(connection.dismissedAt), eq(connection.madeBy, "reader")) : undefined,
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
          ? // A Manual Connection made while the job ran is left as the reader made it.
            insert.onConflictDoUpdate({ target, set: REFRESHED, setWhere: and(isNull(connection.dismissedAt), eq(connection.madeBy, "judge")) })
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
  // An unrecognised Book connects through its Notes only: its last Enrichment run said so, even while
  // it is being enriched again.
  const notesOnly = new Set(enrichments.filter((e) => e.model !== null && !e.recognised).map((e) => e.bookId));
  const notes = await db
    .select({ id: note.id, body: note.body, bookId: libraryEntry.bookId })
    .from(note)
    .innerJoin(libraryEntry, eq(libraryEntry.id, note.libraryEntryId))
    // A Note without a vector (its embedding gave up) is left out.
    .where(and(eq(libraryEntry.userId, userId), inArray(libraryEntry.bookId, bookIds), isNotNull(note.embedding)))
    .orderBy(asc(note.createdAt), asc(note.id));

  const round = judgeRound(
    bookId,
    nearest,
    books.map((b) => {
      const e = enrichments.find((x) => x.bookId === b.book.id);
      return { id: b.book.id, ...displayed(b.book, b.entry), enrichment: isRecognised(e) ? e : null };
    }),
    notes,
  );
  const result = await judge.judge(round.input);
  const top = acceptJudged(round, result.connections, notesOnly).map(({ otherBookId, ...c }) => {
    const { a, b } = pairOf(bookId, otherBookId);
    return { userId, bookAId: a, bookBId: b, ...c, similarityModel: embedder.model, model: judge.model, promptVersion: judge.promptVersion };
  });
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
  // Null for a Manual Connection the reader left untyped.
  type: ConnectionType | null;
  strength: Strength;
  explanation: string;
  // Null for a Manual Connection.
  grounding: "notes" | "enrichment" | null;
  madeBy: MadeBy;
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
  // Whether these are the reader's first Connections: they have some, and every one is this Book's.
  first: boolean;
  // Whether the reader can connect this Book by hand: it is Finished, and so is another of theirs.
  canConnect: boolean;
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
      madeBy: connection.madeBy,
      createdAt: connection.createdAt,
    })
    .from(connection)
    .where(and(eq(connection.userId, userId), isNull(connection.dismissedAt)))
    .orderBy(asc(connection.bookAId), asc(connection.bookBId));
  return rows.filter((c) => finished.has(c.a) && finished.has(c.b));
}

// Domain seam: what the Book panel shows. Manual Connections first, newest first; then strongest first,
// then most similar. Dismissed ones are hidden.
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
  const elsewhere = rows.length
    ? await db
        .select({ id: connection.id })
        .from(connection)
        .where(and(eq(connection.userId, userId), isNull(connection.dismissedAt), ne(connection.bookAId, bookId), ne(connection.bookBId, bookId)))
        .limit(1)
    : [];
  const finishedIds = new Set((await completedPasses(db, userId)).map((p) => p.bookId));
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
        madeBy: r.madeBy,
      };
    }),
    status: entry?.connectionsStatus ?? "idle",
    generated: !!entry?.connectionsGeneratedAt,
    finished: !!entry && finishedIds.has(bookId),
    leftOut: await readLeftOut(db, entry?.id, bookId),
    first: rows.length > 0 && elsewhere.length === 0,
    canConnect: !!entry && finishedIds.has(bookId) && finishedIds.size > 1,
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
  type: ConnectionType | null;
  strength: Strength;
  explanation: string;
  grounding: "notes" | "enrichment" | null;
  madeBy: MadeBy;
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
  return { id: c.id, a: side(c.bookAId), b: side(c.bookBId), type: c.type, strength: c.strength, explanation: c.explanation, grounding: c.grounding, madeBy: c.madeBy };
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

// A Manual Connection's reason is one line of at most this many characters.
export const REASON_MAX = 200;

export class InvalidConnectionError extends Error {}

export class AlreadyConnectedError extends Error {
  constructor() {
    super("The reader has already connected these Books");
  }
}

export type ManualConnectionInput = { bookId: string; otherBookId: string; type?: ConnectionType | null; reason: string };

// The reason as stored: on one line, trimmed.
function cleanReason(reason: string) {
  const line = reason.replace(/\s*[\r\n]+\s*/g, " ").trim();
  if (!line) throw new InvalidConnectionError("A Manual Connection needs a reason");
  if ([...line].length > REASON_MAX) throw new InvalidConnectionError(`A reason is at most ${REASON_MAX} characters`);
  return line;
}

// Domain seam: the reader connects two of their own Finished Books by hand, with a reason and an
// optional Connection Type. It is strong, and the judge never judges, changes or deletes it. It
// replaces the judge's Connection of the pair, live or dismissed, and a Manual Connection the reader
// deleted; a pair that has a live one already is refused. The reader's Clusters are recomputed; no
// paid call is made.
export async function createManualConnection(db: Db, pipeline: Pipeline, userId: string, input: ManualConnectionInput): Promise<{ id: string }> {
  const explanation = cleanReason(input.reason);
  const { bookId, otherBookId } = input;
  if (bookId === otherBookId) throw new InvalidConnectionError("A Book can't be connected to itself");
  const { a, b } = pairOf(bookId, otherBookId);
  const created = await db.transaction(async (tx) => {
    // Held against removal until this commits, as a judge run holds them.
    const entries = await tx
      .select({ bookId: libraryEntry.bookId })
      .from(libraryEntry)
      .where(and(eq(libraryEntry.userId, userId), inArray(libraryEntry.bookId, [a, b])))
      .for("key share");
    for (const id of [a, b]) if (!entries.some((e) => e.bookId === id)) throw new NotInLibraryError(id);
    for (const id of [a, b]) if (!(await isFinished(tx, userId, id))) throw new InvalidConnectionError("Only Finished Books can be connected");
    const made = {
      madeBy: "reader" as const,
      type: input.type ?? null,
      strength: "strong" as const,
      explanation,
      similarity: null,
      similarityModel: null,
      grounding: null,
      quotedNoteIds: [],
      model: null,
      promptVersion: null,
      dismissedAt: null,
      // Replacing a row makes it new, so it is ordered as just made.
      createdAt: new Date(),
    };
    const [row] = await tx
      .insert(connection)
      .values({ userId, bookAId: a, bookBId: b, ...made })
      .onConflictDoUpdate({
        target: [connection.userId, connection.bookAId, connection.bookBId],
        set: made,
        setWhere: or(eq(connection.madeBy, "judge"), isNotNull(connection.dismissedAt)),
      })
      .returning({ id: connection.id });
    if (!row) throw new AlreadyConnectedError();
    return row;
  });
  await pipeline.connectionsChanged(userId);
  return created;
}

export type ConnectCandidate = {
  bookId: string;
  title: string;
  authors: string[];
  // The judge's live Connection of the pair, which connecting it by hand replaces.
  replaces: { type: ConnectionType; strength: Strength; explanation: string } | null;
};

// Domain seam: the Books the reader may connect this one with by hand: their other Finished Books, less
// those they have connected it with already, titled as they title them, most recently finished first
// (as "iii. read" orders them).
export async function readConnectCandidates(db: Db, userId: string, bookId: string): Promise<ConnectCandidate[]> {
  const passes = await readFinished(db, userId);
  const finished = new Set((await completedPasses(db, userId)).map((p) => p.bookId));
  if (!finished.has(bookId)) return [];
  finished.delete(bookId);
  const pairs = await db
    .select()
    .from(connection)
    .where(and(eq(connection.userId, userId), isNull(connection.dismissedAt), or(eq(connection.bookAId, bookId), eq(connection.bookBId, bookId))));
  const theirs = new Map(pairs.map((c) => [otherBook({ a: c.bookAId, b: c.bookBId }, bookId), c]));
  if (finished.size === 0) return [];
  const books = await db
    .select({ book, entry: libraryEntry })
    .from(book)
    .innerJoin(libraryEntry, and(eq(libraryEntry.bookId, book.id), eq(libraryEntry.userId, userId)))
    .where(inArray(book.id, [...finished]));
  const recency = (entryId: string) => {
    const f = passes.get(entryId);
    return [f?.lastFinishedAt ?? 0, f?.lastCompletedAt ?? 0];
  };
  return books
    .filter(({ book: b }) => theirs.get(b.id)?.madeBy !== "reader")
    .sort((x, y) => {
      const [rx, ry] = [recency(x.entry.id), recency(y.entry.id)];
      return ry[0] - rx[0] || ry[1] - rx[1];
    })
    .map(({ book: b, entry }) => {
      const judged = theirs.get(b.id);
      return {
        bookId: b.id,
        ...displayed(b, entry),
        replaces: judged?.type ? { type: judged.type, strength: judged.strength, explanation: judged.explanation } : null,
      };
    });
}
