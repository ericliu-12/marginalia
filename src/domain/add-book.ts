import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { book } from "@/db/schema";
import { ADD_TIME_BUDGET, describeBook, type DescriptionGateway } from "./description";
import { namesMatch } from "./enrichment";
import { enterLibrary } from "./library-entry";
import type { Pipeline } from "./pipeline";
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

// Open Library lists every contributor to a work as an author, translators included. The Google
// Books volume found for the description names the real ones, so keep the authors that match one of
// them. With no matching volume (none found, timed out, no key) only the first-listed author is kept:
// a co-author can be lost this way, which the Book's author override (#25) puts right.
export function bookAuthors(listed: string[], volumeAuthors: string[] = []): string[] {
  const matched = listed.filter((a) => volumeAuthors.some((v) => namesMatch(a, v)));
  return matched.length > 0 ? matched : listed.slice(0, 1);
}

// Domain seam: add a Book to the reader's library with a Status. One Library Entry per Book,
// identified by Open Library work key.
export async function addBook(
  db: Db,
  pipeline: Pipeline,
  userId: string,
  work: OpenLibraryWork,
  status: Status,
  descriptions?: DescriptionGateway | null,
) {
  // A description is fetched once, when the shared Book is first created; a failed or missing lookup
  // never blocks the add. Two requests adding the same new Book can both look it up, and the loser's
  // result is discarded by the insert: one wasted lookup, not worth holding a transaction over.
  const [existing] = await db.select({ id: book.id }).from(book).where(eq(book.openLibraryWorkKey, work.workKey));
  const found =
    existing || !descriptions
      ? { description: "", googleBooksVolumeId: null, volumeAuthors: undefined }
      : await describeBook(descriptions, work, ADD_TIME_BUDGET);
  let result;
  try {
    result = await db.transaction(async (tx) => {
      await tx
        .insert(book)
        .values({
          title: work.title,
          originalTitle: work.originalTitle ?? null,
          authors: bookAuthors(work.authors, found.volumeAuthors),
          firstPublishedYear: work.firstPublishedYear,
          coverUrl: coverUrlFor(work.coverId),
          openLibraryWorkKey: work.workKey,
          snapshot: {
            subjects: filterSubjects(work.subjects),
            ...(work.originalAuthors && { originalAuthors: work.originalAuthors }),
            ...(work.authorAliases && { authorAliases: work.authorAliases }),
          },
          description: found.description || null,
          googleBooksVolumeId: found.googleBooksVolumeId,
        })
        .onConflictDoNothing({ target: book.openLibraryWorkKey });
      const [row] = await tx.select({ id: book.id }).from(book).where(eq(book.openLibraryWorkKey, work.workKey));

      const { entry, firstCompletion } = await enterLibrary(tx, userId, row.id, status);
      return { ...entry, firstCompletion };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicateBookError(work.workKey);
    throw err;
  }
  await pipeline.bookAdded(result.bookId);
  // Adding a Book directly as read is its first completion, so a backfill add finds Connections too.
  if (result.firstCompletion) await pipeline.bookFinished(userId, result.bookId);
  return result;
}
