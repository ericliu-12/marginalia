import { and, eq, isNotNull, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { startConnections, type ConnectionQueue } from "./connections";
import { libraryEntry, readThrough } from "@/db/schema";
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
export async function changeStatus(db: Db, userId: string, bookId: string, status: Status, queue?: ConnectionQueue | null) {
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
  if (result.firstCompletion) await startConnections(db, queue, userId, bookId);
  return result;
}

export type FinishedSummary = { lastCompletedAt: number; lastFinishedAt: number | null };

// Finished Books among the reader's Entries, keyed by Entry id: those with a completed Read-through,
// whatever the current Status. Finish dates may be unknown (null).
export async function readFinished(db: Db, userId: string) {
  const passes = await db
    .select({ entryId: readThrough.libraryEntryId, finishedAt: readThrough.finishedAt, completedAt: readThrough.completedAt })
    .from(readThrough)
    .where(and(eq(readThrough.userId, userId), isNotNull(readThrough.completedAt)));
  const finished = new Map<string, FinishedSummary>();
  for (const p of passes) {
    const prev = finished.get(p.entryId);
    const finishedAt = p.finishedAt?.getTime() ?? null;
    finished.set(p.entryId, {
      lastCompletedAt: Math.max(p.completedAt!.getTime(), prev?.lastCompletedAt ?? 0),
      lastFinishedAt: finishedAt === null ? (prev?.lastFinishedAt ?? null) : Math.max(finishedAt, prev?.lastFinishedAt ?? 0),
    });
  }
  return finished;
}

// A Finished Book that is currently being read again.
export const isReReading = (status: Status, finished: FinishedSummary | undefined) =>
  status === "reading" && finished !== undefined;
