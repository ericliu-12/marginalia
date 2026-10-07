import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { book, libraryEntry } from "@/db/schema";
import { namesMatch } from "./enrichment";
import { displayed } from "./library";
import type { Status } from "./search";

// A Book in the reader's library that a Book about to be added looks like.
export type Lookalike = { bookId: string; title: string; status: Status };

type Candidate = { title: string; author: string };

// A title as compared for lookalikes: case, accents, punctuation, a leading article and a subtitle
// after a colon don't make it a different title.
export function normTitle(title: string) {
  return title
    .split(":")[0]
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^(the|a|an) /, "");
}

// Domain seam: the reader's library as a lookalike check. A Book looks like one already there when
// its normalised title and primary author match the entry's shared values or the reader's overrides.
// Advisory only: nothing here stops an add. A missing author on either side is skipped.
export async function lookalikeCheck(db: Db, userId: string) {
  const rows = await db
    .select({ entry: libraryEntry, book })
    .from(libraryEntry)
    .innerJoin(book, eq(book.id, libraryEntry.bookId))
    .where(eq(libraryEntry.userId, userId));
  const entries = rows.map(({ entry, book: b }) => ({
    lookalike: { bookId: b.id, title: displayed(b, entry).title, status: entry.status },
    titles: new Set([b.title, b.originalTitle, entry.titleOverride].filter((t): t is string => !!t).map(normTitle)),
    authors: [b.authors[0], entry.authorOverride].filter((a): a is string => !!a),
  }));

  return (c: Candidate, exceptBookId?: string): Lookalike | null => {
    const title = normTitle(c.title);
    const hit = entries.find(
      (e) =>
        e.lookalike.bookId !== exceptBookId &&
        e.titles.has(title) &&
        (!c.author.trim() || e.authors.length === 0 || e.authors.some((a) => namesMatch(a, c.author))),
    );
    return hit?.lookalike ?? null;
  };
}

export async function findLookalike(db: Db, userId: string, c: Candidate) {
  return (await lookalikeCheck(db, userId))(c);
}
