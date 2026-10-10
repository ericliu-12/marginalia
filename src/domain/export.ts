import { asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { book, connection, libraryEntry, note, readThrough } from "@/db/schema";

// The account page's export (#67): everything the Reader wrote or chose, as one JSON file. Books are
// named by what identifies them (no covers, descriptions or Enrichment), with their id so Connections
// point to them unambiguously; a Manual Book's description is in, since the Reader wrote it. Dates are
// ISO strings. Dismissed Connections are kept, marked with when.

type ExportBook = { id: string; title: string; authors: string[]; firstPublishedYear: number | null; openLibraryWorkKey: string | null };

export type ReaderExport = {
  formatVersion: 1;
  exportedAt: string;
  libraryEntries: {
    book: ExportBook;
    status: "want" | "reading" | "read";
    titleOverride: string | null;
    authorOverride: string | null;
    addedAt: string;
    readThroughs: { startedAt: string | null; finishedAt: string | null; completed: boolean }[];
    notes: { text: string; quote: string | null; page: number | null; createdAt: string; updatedAt: string }[];
  }[];
  manualBooks: { id: string; title: string; authors: string[]; firstPublishedYear: number | null; description: string | null }[];
  connections: {
    bookA: ExportBook;
    bookB: ExportBook;
    type: "thematic" | "contrast" | "context";
    strength: "strong" | "moderate" | "weak";
    explanation: string;
    createdAt: string;
    dismissedAt: string | null;
  }[];
};

const bookColumns = {
  id: book.id,
  title: book.title,
  authors: book.authors,
  firstPublishedYear: book.firstPublishedYear,
  openLibraryWorkKey: book.openLibraryWorkKey,
};

const iso = (d: Date | null) => d?.toISOString() ?? null;

export async function exportReaderData(db: Db, userId: string, now = new Date()): Promise<ReaderExport> {
  const [entries, passes, notes, manualBooks, connections] = await Promise.all([
    db
      .select({ entry: libraryEntry, book: bookColumns })
      .from(libraryEntry)
      .innerJoin(book, eq(book.id, libraryEntry.bookId))
      .where(eq(libraryEntry.userId, userId))
      .orderBy(asc(libraryEntry.createdAt), asc(libraryEntry.id)),
    db.select().from(readThrough).where(eq(readThrough.userId, userId)).orderBy(asc(readThrough.createdAt), asc(readThrough.id)),
    db.select().from(note).where(eq(note.userId, userId)).orderBy(asc(note.createdAt), asc(note.id)),
    db
      .select({ ...bookColumns, description: book.description })
      .from(book)
      .where(eq(book.createdByUserId, userId))
      .orderBy(asc(book.createdAt), asc(book.id)),
    db.select().from(connection).where(eq(connection.userId, userId)).orderBy(asc(connection.createdAt), asc(connection.id)),
  ]);
  const connected = [...new Set(connections.flatMap((c) => [c.bookAId, c.bookBId]))];
  const books = new Map(
    (connected.length ? await db.select(bookColumns).from(book).where(inArray(book.id, connected)) : []).map((b) => [b.id, b]),
  );

  return {
    formatVersion: 1,
    exportedAt: now.toISOString(),
    libraryEntries: entries.map(({ entry, book }) => ({
      book,
      status: entry.status,
      titleOverride: entry.titleOverride,
      authorOverride: entry.authorOverride,
      addedAt: entry.createdAt.toISOString(),
      readThroughs: passes
        .filter((p) => p.libraryEntryId === entry.id)
        .map((p) => ({ startedAt: iso(p.startedAt), finishedAt: iso(p.finishedAt), completed: p.completedAt !== null })),
      notes: notes
        .filter((n) => n.libraryEntryId === entry.id)
        .map((n) => ({ text: n.body, quote: n.quote, page: n.page, createdAt: n.createdAt.toISOString(), updatedAt: n.updatedAt.toISOString() })),
    })),
    manualBooks: manualBooks.map(({ openLibraryWorkKey: _, ...b }) => b),
    connections: connections.map((c) => ({
      bookA: books.get(c.bookAId)!,
      bookB: books.get(c.bookBId)!,
      type: c.type,
      strength: c.strength,
      explanation: c.explanation,
      createdAt: c.createdAt.toISOString(),
      dismissedAt: iso(c.dismissedAt),
    })),
  };
}
