import { and, eq, isNotNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { book, libraryEntry, readThrough } from "@/db/schema";
import type { Status } from "./search";

export type LibraryItem = {
  bookId: string;
  title: string;
  authors: string[];
  coverUrl: string | null;
  status: Status;
  // Has a completed Read-through, whatever the current Status.
  finished: boolean;
  // Finished and currently being read again.
  reReading: boolean;
};

const STATUS_ORDER: Status[] = ["reading", "want", "read"];

// Domain seam: the reader's library, titles and authors as they have overridden them.
// Ordered Reading, Want to read, then Read; Read by most recently finished, the rest newest first.
export async function readLibrary(db: Db, userId: string): Promise<LibraryItem[]> {
  const rows = await db
    .select({ entry: libraryEntry, book })
    .from(libraryEntry)
    .innerJoin(book, eq(book.id, libraryEntry.bookId))
    .where(eq(libraryEntry.userId, userId));

  const passes = await db
    .select({ entryId: readThrough.libraryEntryId, finishedAt: readThrough.finishedAt, completedAt: readThrough.completedAt })
    .from(readThrough)
    .where(and(eq(readThrough.userId, userId), isNotNull(readThrough.completedAt)));
  // Finish dates may be unknown; those Books sort after dated ones, newest completion first.
  const lastFinished = new Map<string, number>();
  const lastCompleted = new Map<string, number>();
  for (const p of passes) {
    const entryId = p.entryId;
    lastCompleted.set(entryId, Math.max(p.completedAt!.getTime(), lastCompleted.get(entryId) ?? 0));
    if (p.finishedAt) lastFinished.set(entryId, Math.max(p.finishedAt.getTime(), lastFinished.get(entryId) ?? 0));
  }
  const recency = (e: typeof libraryEntry.$inferSelect) =>
    e.status === "read" ? (lastFinished.get(e.id) ?? 0) : e.createdAt.getTime();

  return rows
    .sort(
      (a, b) =>
        STATUS_ORDER.indexOf(a.entry.status) - STATUS_ORDER.indexOf(b.entry.status) ||
        recency(b.entry) - recency(a.entry) ||
        (lastCompleted.get(b.entry.id) ?? 0) - (lastCompleted.get(a.entry.id) ?? 0),
    )
    .map(({ entry, book: b }) => {
      const finished = lastCompleted.has(entry.id);
      return {
        bookId: b.id,
        title: entry.titleOverride ?? b.title,
        authors: entry.authorOverride ? [entry.authorOverride] : b.authors,
        coverUrl: b.coverUrl,
        status: entry.status,
        finished,
        reReading: entry.status === "reading" && finished,
      };
    });
}
