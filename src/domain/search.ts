import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { book, libraryEntry, statusEnum } from "@/db/schema";

export type Status = (typeof statusEnum.enumValues)[number];

// A work as Open Library describes it; the shape the search gateway returns.
export type OpenLibraryWork = {
  workKey: string;
  title: string;
  authors: string[];
  firstPublishedYear: number | null;
  editionCount: number;
  coverId: number | null;
  subjects: string[];
};

// Seam to Open Library; tests supply a fake.
export interface BookSearchGateway {
  searchWorks(query: string): Promise<OpenLibraryWork[]>;
}

export type SearchResult = OpenLibraryWork & {
  coverUrl: string | null;
  // The reader's Status for this work if it is already in their library.
  libraryStatus: Status | null;
};

export function coverUrlFor(coverId: number | null) {
  return coverId ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg` : null;
}

const DEMOTED_TITLE =
  /study guide|summary of|analysis of|sparknotes|cliffsnotes|workbook|box(ed)? set|boxset|\b(complete|collected) (trilogy|collection|series|works)\b|omnibus|screenplay|graphic novel/i;
const DEMOTED_SUBJECT = /adaptation|study guide|graphic novel|screenplay|criticism and interpretation|box set/i;

function isDemoted(w: OpenLibraryWork) {
  return DEMOTED_TITLE.test(w.title) || w.subjects.some((s) => DEMOTED_SUBJECT.test(s));
}

// Originals lead (more editions first, earliest first-publish year as tiebreak);
// adaptations, study guides and box sets follow, in the same order.
export function rankWorks(works: OpenLibraryWork[]): OpenLibraryWork[] {
  return [...works].sort(
    (a, b) =>
      Number(isDemoted(a)) - Number(isDemoted(b)) ||
      b.editionCount - a.editionCount ||
      (a.firstPublishedYear ?? Infinity) - (b.firstPublishedYear ?? Infinity),
  );
}

// Domain seam: ranked Open Library results, annotated with the reader's library.
export async function searchBooks(
  db: Db,
  userId: string,
  gateway: BookSearchGateway,
  query: string,
): Promise<SearchResult[]> {
  const q = query.trim();
  if (!q) return [];

  const ranked = rankWorks(await gateway.searchWorks(q));
  if (ranked.length === 0) return [];

  const owned = await db
    .select({ workKey: book.openLibraryWorkKey, status: libraryEntry.status })
    .from(libraryEntry)
    .innerJoin(book, eq(book.id, libraryEntry.bookId))
    .where(
      and(
        eq(libraryEntry.userId, userId),
        inArray(
          book.openLibraryWorkKey,
          ranked.map((w) => w.workKey),
        ),
      ),
    );
  const statusByKey = new Map(owned.map((o) => [o.workKey, o.status]));

  return ranked.map((w) => ({
    ...w,
    coverUrl: coverUrlFor(w.coverId),
    libraryStatus: statusByKey.get(w.workKey) ?? null,
  }));
}
