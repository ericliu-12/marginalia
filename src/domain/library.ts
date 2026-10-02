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
  const lastFinished = new Map<string, number>();
  for (const p of passes) {
    const at = (p.finishedAt ?? p.completedAt!).getTime();
    lastFinished.set(p.entryId, Math.max(at, lastFinished.get(p.entryId) ?? 0));
  }
  const recency = (e: typeof libraryEntry.$inferSelect) =>
    e.status === "read" ? (lastFinished.get(e.id) ?? 0) : e.createdAt.getTime();

  return rows
    .sort(
      (a, b) =>
        STATUS_ORDER.indexOf(a.entry.status) - STATUS_ORDER.indexOf(b.entry.status) ||
        recency(b.entry) - recency(a.entry),
    )
    .map(({ entry, book: b }) => ({
      bookId: b.id,
      title: entry.titleOverride ?? b.title,
      authors: entry.authorOverride ? [entry.authorOverride] : b.authors,
      coverUrl: b.coverUrl,
      status: entry.status,
    }));
}
