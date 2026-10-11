import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { book, libraryEntry, statusEnum } from "@/db/schema";
import { authorsMatch, normName } from "./enrichment";
import { lookalikeCheck, type Lookalike } from "./lookalike";

export type Status = (typeof statusEnum.enumValues)[number];

// A work as Open Library describes it; the shape the search gateway returns.
export type OpenLibraryWork = {
  workKey: string;
  // Shown and used for every lookup: the English edition title, and Latin-script authors, when
  // the work has English editions.
  title: string;
  authors: string[];
  // Set only when the above replaced what Open Library holds for the work.
  originalTitle?: string;
  originalAuthors?: string[];
  // Latin-script alternate names for the authors, for tolerant author cross-checks.
  authorAliases?: string[];
  firstPublishedYear: number | null;
  editionCount: number;
  // Readers who have logged the work (want to read, reading, read): the popularity signal.
  readinglogCount: number;
  coverId: number | null;
  subjects: string[];
};

// Seam to Open Library; tests supply a fake.
export interface BookSearchGateway {
  searchWorks(query: string): Promise<OpenLibraryWork[]>;
  // One work by its key, as search describes it; null when Open Library has no such work.
  findWork(workKey: string): Promise<OpenLibraryWork | null>;
}

export type SearchResult = OpenLibraryWork & {
  coverUrl: string | null;
  // The reader's Status for this work if it is already in their library.
  libraryStatus: Status | null;
  // That Book, to open it from the result; null with `libraryStatus`.
  libraryBookId: string | null;
  // Another Book in the reader's library this work looks like; advisory, and null when it is in the library itself.
  lookalike: Lookalike | null;
};

export function coverUrlFor(coverId: number | null) {
  return coverId ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg?default=false` : null;
}

// Also omnibus editions: a title joining works with " / ", or a generic collection title.
const DEMOTED_TITLE =
  /study guide|summary of|analysis of|sparknotes|cliffsnotes|workbook|box(ed)? set|boxset|\b(complete|collected) (trilogy|collection|series|works)\b|omnibus|screenplay|graphic novel| \/ |^(the )?(novels|selected works|œuvres|oeuvres)\b/i;
const DEMOTED_SUBJECT = /adaptation|study guide|graphic novel|screenplay|criticism and interpretation|box set/i;

const lower = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// A book about an author or their work, by someone else: its title names an author who appears in
// the results but is not one of its own authors, either as a possessive ("Kazuo Ishiguro's the
// Remains of the Day", "Camus' The Stranger") or, when the query names that author, in any form.
// Judged against the authors in the results, so "Bridget Jones's Diary" is not mistaken for one.
function isAboutAnotherAuthor(w: OpenLibraryWork, knownAuthors: string[], namedAuthors: Set<string>) {
  const title = lower(w.title);
  const titleWords = normName(w.title);
  return knownAuthors.some((author) => {
    const surname = normName(author).at(-1);
    if (!surname || surname.length < 3 || authorsMatch(author, w.authors)) return false;
    return new RegExp(`\\b${surname}['\u2019]`).test(title) || (namedAuthors.has(author) && titleWords.includes(surname));
  });
}

// Demoted works (adaptations, study guides, box sets, omnibus editions, books about an author) go
// last. Within each group the title decides first: an exact match for the query, then a title
// holding every query word. Within a title tier, works by an author the query names lead, then the
// more popular: more readers who logged it, then more editions, then earliest first-publish year.
export function rankWorks(works: OpenLibraryWork[], query = ""): OpenLibraryWork[] {
  const knownAuthors = [...new Set(works.flatMap((w) => w.authors))];
  const queryWords = normName(query);
  // A leading article does not make a title a different one ("The Remains of the Day").
  const wordsOf = (s: string) => lower(s).split(/[^a-z0-9]+/).filter(Boolean).filter((w, i) => i > 0 || !/^(the|a|an)$/.test(w));
  const fullQuery = wordsOf(query);
  const titlesOf = (w: OpenLibraryWork) => [w.title, w.originalTitle].filter((t): t is string => !!t).map(wordsOf);
  const titledAsQuery = (w: OpenLibraryWork) => fullQuery.length > 0 && titlesOf(w).some((t) => t.join(" ") === fullQuery.join(" "));

  // The authors the query names by surname. A surname that is only a word of a title the whole
  // query names ("house of leaves", not by Silas House) does not, unless the query is just their name.
  const namedAuthors = new Set(
    knownAuthors.filter((a) => {
      const names = normName(a);
      const surname = names.at(-1);
      if (!surname || surname.length < 3 || !queryWords.includes(surname)) return false;
      return queryWords.every((x) => names.includes(x)) || !works.some((w) => titledAsQuery(w) && !w.authors.includes(a));
    }),
  );
  const byQueriedAuthor = (w: OpenLibraryWork) => w.authors.some((a) => namedAuthors.has(a));
  // Subjects are noisy on the original itself (Open Library tags L'Étranger "Criticism and
  // interpretation"), so a work by an author the query names, or titled as the query is, is judged
  // by its title only.
  const isDemoted = (w: OpenLibraryWork) =>
    DEMOTED_TITLE.test(w.title) ||
    (!!w.originalTitle && DEMOTED_TITLE.test(w.originalTitle)) ||
    (!byQueriedAuthor(w) && !titledAsQuery(w) && w.subjects.some((s) => DEMOTED_SUBJECT.test(s))) ||
    isAboutAnotherAuthor(w, knownAuthors, namedAuthors);
  const demoted = new Map(works.map((w) => [w, isDemoted(w)]));

  // Title match: 0 when a title (English or original) is the query, 1 when it contains every query
  // word, else 2. When the query names an author, the title is also matched with their name left out.
  const queriedAuthorWords = new Set([...namedAuthors].flatMap(normName));
  const queries = [fullQuery, fullQuery.filter((x) => !queriedAuthorWords.has(x))].filter((q) => q.length > 0);
  const titleTier = (w: OpenLibraryWork) => {
    const titles = titlesOf(w);
    if (queries.some((q) => titles.some((t) => t.join(" ") === q.join(" ")))) return 0;
    return queries.some((q) => titles.some((t) => q.every((x) => t.includes(x)))) ? 1 : 2;
  };
  const tier = new Map(works.map((w) => [w, titleTier(w)]));

  return [...works].sort(
    (a, b) =>
      Number(demoted.get(a)) - Number(demoted.get(b)) ||
      tier.get(a)! - tier.get(b)! ||
      Number(!byQueriedAuthor(a)) - Number(!byQueriedAuthor(b)) ||
      b.readinglogCount - a.readinglogCount ||
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

  const ranked = rankWorks(await gateway.searchWorks(q), q);
  if (ranked.length === 0) return [];

  const owned = await db
    .select({ workKey: book.openLibraryWorkKey, status: libraryEntry.status, bookId: book.id })
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
  const ownedByKey = new Map(owned.map((o) => [o.workKey, o]));
  const lookalike = await lookalikeCheck(db, userId);

  return ranked.map((w) => {
    const entry = ownedByKey.get(w.workKey);
    const libraryStatus = entry?.status ?? null;
    return {
      ...w,
      coverUrl: coverUrlFor(w.coverId),
      libraryStatus,
      libraryBookId: entry?.bookId ?? null,
      lookalike: libraryStatus ? null : lookalike({ title: w.title, author: w.authors[0] ?? "" }),
    };
  });
}
