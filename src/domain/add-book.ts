import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { book, libraryEntry, readThrough } from "@/db/schema";
import { coverUrlFor, type OpenLibraryWork, type Status } from "./search";

export class DuplicateBookError extends Error {
  constructor(public workKey: string) {
    super(`Book ${workKey} is already in the library`);
  }
}

// Open Library subjects are noisy: drop call numbers, award/NYT tags and FAST/URI strings.
const NOISY_SUBJECT = /^(award|nyt):|\(uri\)|fast \(OCoLC\)|^[A-Za-z]{1,3}\d{2,4}\.[a-z0-9 .]+$/i;
export function filterSubjects(subjects: string[]) {
  return subjects.filter((s) => !NOISY_SUBJECT.test(s.trim()));
}

function isUniqueViolation(err: unknown) {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

// Domain seam: add a Book to the reader's library with a Status. One Library Entry per Book,
// identified by Open Library work key.
export async function addBook(db: Db, userId: string, work: OpenLibraryWork, status: Status) {
  try {
    return await db.transaction(async (tx) => {
      await tx
        .insert(book)
        .values({
          title: work.title,
          authors: work.authors,
          firstPublishedYear: work.firstPublishedYear,
          coverUrl: coverUrlFor(work.coverId),
          openLibraryWorkKey: work.workKey,
          snapshot: { subjects: filterSubjects(work.subjects) },
        })
        .onConflictDoNothing({ target: book.openLibraryWorkKey });
      const [row] = await tx.select({ id: book.id }).from(book).where(eq(book.openLibraryWorkKey, work.workKey));

      const [entry] = await tx.insert(libraryEntry).values({ userId, bookId: row.id, status }).returning();
      if (status === "read") {
        await tx.insert(readThrough).values({ libraryEntryId: entry.id, userId, completedAt: new Date() });
      } else if (status === "reading") {
        await tx.insert(readThrough).values({ libraryEntryId: entry.id, userId, startedAt: new Date() });
      }
      return entry;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicateBookError(work.workKey);
    throw err;
  }
}
