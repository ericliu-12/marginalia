import { and, asc, eq, isNotNull, isNull, or } from "drizzle-orm";
import type { Db } from "@/db/client";
import { connection, libraryEntry, readThrough } from "@/db/schema";
import { leaveClusters } from "./clusters";
import type { Pipeline } from "./pipeline";
import type { Status } from "./search";

export class NotInLibraryError extends Error {
  constructor(public bookId: string) {
    super(`Book ${bookId} is not in the library`);
  }
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Entry = typeof libraryEntry.$inferSelect;

// Records the Read-throughs a move to `status` implies.
//   -> reading: open a Read-through (start date) unless one is already open
//   -> read:    close the open one, or record a closed one with unknown dates
//   -> want:    drop any open one; completed Read-throughs stay, so the Book stays Finished
// `firstCompletion` is true only when this completes the Book's first Read-through.
async function recordReadThroughs(tx: Tx, entry: Entry, status: Status) {
  const userId = entry.userId;
  const [open] = await tx
    .select()
    .from(readThrough)
    .where(and(eq(readThrough.libraryEntryId, entry.id), isNull(readThrough.completedAt)));
  const now = new Date();
  let firstCompletion = false;

  if (status === "reading") {
    if (!open) await tx.insert(readThrough).values({ libraryEntryId: entry.id, userId, startedAt: now });
  } else if (status === "read") {
    const completed = await tx
      .select({ id: readThrough.id })
      .from(readThrough)
      .where(and(eq(readThrough.libraryEntryId, entry.id), isNotNull(readThrough.completedAt)));
    firstCompletion = completed.length === 0;
    if (open) {
      await tx.update(readThrough).set({ finishedAt: now, completedAt: now }).where(eq(readThrough.id, open.id));
    } else {
      await tx.insert(readThrough).values({ libraryEntryId: entry.id, userId, completedAt: now });
    }
  } else if (open) {
    await tx.delete(readThrough).where(eq(readThrough.id, open.id));
  }
  return { firstCompletion };
}

// The reader's Library Entry for a Book, or undefined when the Book isn't in their library.
export async function findEntry(db: Db | Tx, userId: string, bookId: string) {
  const [entry] = await db
    .select()
    .from(libraryEntry)
    .where(and(eq(libraryEntry.userId, userId), eq(libraryEntry.bookId, bookId)));
  return entry;
}

// Domain seam: puts a Book in the reader's library directly at `status`, inside the caller's
// transaction. Entering as read is a first completion, so a backfill add reports it like a Status change.
export async function enterLibrary(tx: Tx, userId: string, bookId: string, status: Status) {
  const [entry] = await tx.insert(libraryEntry).values({ userId, bookId, status }).returning();
  const { firstCompletion } = await recordReadThroughs(tx, entry, status);
  return { entry, firstCompletion };
}

// Domain seam: the one place a Status changes for a Book already in the library.
// Idempotent, except that read -> read is a no-op (it must not record a second pass). The first
// completed Read-through queues the Book's Connections; later ones do nothing.
export async function changeStatus(db: Db, pipeline: Pipeline, userId: string, bookId: string, status: Status) {
  const result = await db.transaction(async (tx) => {
    const [entry] = await tx
      .select()
      .from(libraryEntry)
      .where(and(eq(libraryEntry.userId, userId), eq(libraryEntry.bookId, bookId)))
      .for("update");
    if (!entry) throw new NotInLibraryError(bookId);
    if (entry.status === "read" && status === "read") return { firstCompletion: false };
    const { firstCompletion } = await recordReadThroughs(tx, entry, status);
    if (entry.status !== status) await tx.update(libraryEntry).set({ status }).where(eq(libraryEntry.id, entry.id));
    return { firstCompletion };
  });
  if (result.firstCompletion) await pipeline.bookFinished(userId, bookId);
  return result;
}

// Domain seam: takes a Book out of the reader's library. Notes, Read-throughs and Connections runs go
// with the Library Entry; the reader's Connections involving the Book are deleted here, since the Book
// is shared and never cascades. The Book leaves its Clusters at once (so it never counts toward a
// rename) and the Clusters are recomputed; its Connections job, waiting or running, is cancelled. The
// Book and its Enrichment stay, so adding it again is cheap.
// Idempotent: a Book not in the library is left alone without error.
export async function removeFromLibrary(db: Db, pipeline: Pipeline, userId: string, bookId: string): Promise<void> {
  const removed = await db.transaction(async (tx) => {
    // Locked first, so a Connections job finishing now either lands before this (and its Connections
    // are deleted below) or sees the Entry gone and stores nothing.
    const [entry] = await tx
      .select({ id: libraryEntry.id })
      .from(libraryEntry)
      .where(and(eq(libraryEntry.userId, userId), eq(libraryEntry.bookId, bookId)))
      .for("update");
    if (!entry) return false;
    await tx
      .delete(connection)
      .where(and(eq(connection.userId, userId), or(eq(connection.bookAId, bookId), eq(connection.bookBId, bookId))));
    await leaveClusters(tx, userId, bookId);
    await tx.delete(libraryEntry).where(eq(libraryEntry.id, entry.id));
    return true;
  });
  if (removed) await pipeline.entryRemoved(userId, bookId);
}

// The one definition of Finished: the reader's completed Read-throughs (`completed_at` set), whatever
// the Library Entry's current Status, optionally for one Book. Everything that asks whether a Book is
// Finished goes through this.
export function completedPasses(db: Db | Tx, userId: string, bookId?: string) {
  return db
    .select({
      entryId: readThrough.libraryEntryId,
      bookId: libraryEntry.bookId,
      finishedAt: readThrough.finishedAt,
      completedAt: readThrough.completedAt,
    })
    .from(readThrough)
    .innerJoin(libraryEntry, eq(libraryEntry.id, readThrough.libraryEntryId))
    .where(and(eq(libraryEntry.userId, userId), isNotNull(readThrough.completedAt), bookId ? eq(libraryEntry.bookId, bookId) : undefined));
}

export async function isFinished(db: Db | Tx, userId: string, bookId: string) {
  return (await completedPasses(db, userId, bookId).limit(1)).length > 0;
}

export type FinishedSummary = {
  lastCompletedAt: number;
  lastFinishedAt: number | null;
  firstCompletedAt: number;
  // Of the passes with a known finish date; null when none has one.
  firstFinishedAt: number | null;
};

// Finished Books among the reader's Entries, keyed by Entry id: those with a completed Read-through,
// whatever the current Status. Finish dates may be unknown (null).
export async function readFinished(db: Db, userId: string) {
  const passes = await completedPasses(db, userId);
  const finished = new Map<string, FinishedSummary>();
  for (const p of passes) {
    const prev = finished.get(p.entryId);
    const completedAt = p.completedAt!.getTime();
    const finishedAt = p.finishedAt?.getTime() ?? null;
    finished.set(p.entryId, {
      lastCompletedAt: Math.max(completedAt, prev?.lastCompletedAt ?? 0),
      lastFinishedAt: finishedAt === null ? (prev?.lastFinishedAt ?? null) : Math.max(finishedAt, prev?.lastFinishedAt ?? 0),
      firstCompletedAt: Math.min(completedAt, prev?.firstCompletedAt ?? Infinity),
      firstFinishedAt:
        finishedAt === null ? (prev?.firstFinishedAt ?? null) : Math.min(finishedAt, prev?.firstFinishedAt ?? Infinity),
    });
  }
  return finished;
}

// A Finished Book that is currently being read again.
export const isReReading = (status: Status, finished: FinishedSummary | undefined) =>
  status === "reading" && finished !== undefined;
