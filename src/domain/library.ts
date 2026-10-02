import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { book, libraryEntry } from "@/db/schema";
import { isReReading, readFinished } from "./library-entry";
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

  const finished = await readFinished(db, userId);
  // Finish dates may be unknown; those Books sort after dated ones, newest completion first.
  const recency = (e: typeof libraryEntry.$inferSelect) =>
    e.status === "read" ? (finished.get(e.id)?.lastFinishedAt ?? 0) : e.createdAt.getTime();

  return rows
    .sort(
      (a, b) =>
        STATUS_ORDER.indexOf(a.entry.status) - STATUS_ORDER.indexOf(b.entry.status) ||
        recency(b.entry) - recency(a.entry) ||
        (finished.get(b.entry.id)?.lastCompletedAt ?? 0) - (finished.get(a.entry.id)?.lastCompletedAt ?? 0),
    )
    .map(({ entry, book: b }) => {
      const summary = finished.get(entry.id);
      return {
        bookId: b.id,
        title: entry.titleOverride ?? b.title,
        authors: entry.authorOverride ? [entry.authorOverride] : b.authors,
        coverUrl: b.coverUrl,
        status: entry.status,
        finished: summary !== undefined,
        reReading: isReReading(entry.status, summary),
      };
    });
}
