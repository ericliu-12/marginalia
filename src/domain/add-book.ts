import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { book, libraryEntry } from "@/db/schema";
import { findDescription, type BookDescription, type DescriptionGateway } from "./description";
import { applyStatus } from "./status";
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

// The whole add-time lookup gets this long; a person is waiting on the add.
export const DESCRIPTION_TIMEOUT_MS = 3000;

// A Book's description is fetched once, when the shared Book is first created. A failed, slow or
// missing lookup never blocks adding: the Book is added without one.
async function describeNewBook(db: Db, work: OpenLibraryWork, gateway?: DescriptionGateway | null) {
  const none: BookDescription = { description: "", googleBooksVolumeId: null };
  if (!gateway) return none;
  const [existing] = await db.select({ id: book.id }).from(book).where(eq(book.openLibraryWorkKey, work.workKey));
  if (existing) return none;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<BookDescription>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(none);
    }, DESCRIPTION_TIMEOUT_MS);
  });
  try {
    return await Promise.race([findDescription(gateway, work, controller.signal), timedOut]);
  } catch (err) {
    console.error(err);
    return none;
  } finally {
    clearTimeout(timer);
  }
}

// Domain seam: add a Book to the reader's library with a Status. One Library Entry per Book,
// identified by Open Library work key.
export async function addBook(
  db: Db,
  userId: string,
  work: OpenLibraryWork,
  status: Status,
  descriptions?: DescriptionGateway | null,
) {
  const found = await describeNewBook(db, work, descriptions);
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
          description: found.description || null,
          googleBooksVolumeId: found.googleBooksVolumeId,
        })
        .onConflictDoNothing({ target: book.openLibraryWorkKey });
      const [row] = await tx.select({ id: book.id }).from(book).where(eq(book.openLibraryWorkKey, work.workKey));

      // Enter as "want" (no Read-throughs), then apply the real Status through the shared transition.
      const [entry] = await tx.insert(libraryEntry).values({ userId, bookId: row.id, status: "want" }).returning();
      await applyStatus(tx, entry, status);
      return { ...entry, status };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicateBookError(work.workKey);
    throw err;
  }
}
