import { desc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { book, libraryEntry, statusEnum } from "@/db/schema";

export type LibraryItem = {
  bookId: string;
  title: string;
  authors: string[];
  coverUrl: string | null;
  status: (typeof statusEnum.enumValues)[number];
};

// Domain seam: the reader's library, titles and authors as they have overridden them.
export async function readLibrary(db: Db, userId: string): Promise<LibraryItem[]> {
  const rows = await db
    .select({ entry: libraryEntry, book })
    .from(libraryEntry)
    .innerJoin(book, eq(book.id, libraryEntry.bookId))
    .where(eq(libraryEntry.userId, userId))
    .orderBy(desc(libraryEntry.createdAt));

  return rows.map(({ entry, book: b }) => ({
    bookId: b.id,
    title: entry.titleOverride ?? b.title,
    authors: entry.authorOverride ? [entry.authorOverride] : b.authors,
    coverUrl: b.coverUrl,
    status: entry.status,
  }));
}
