// Add-time description sourcing. Ported from prototype/pipeline-tuning (commit b87d50b, 01-enrich.mjs);
// the rules are recorded on #16.

export type GoogleBooksVolume = {
  id: string;
  volumeInfo?: {
    title?: string;
    subtitle?: string;
    authors?: string[];
    categories?: string[];
    language?: string;
    description?: string;
  };
};

// Attempts per Google Books page when it answers 429/503; attempt n sleeps n times the delay after failing.
export type RetryBudget = { maxAttempts: number; retryDelayMs: number };

export type LookupOptions = {
  // Aborting cuts a request or a retry sleep short.
  signal?: AbortSignal;
  // Retries for rate-limited and unavailable answers; the adapter picks its own default when absent.
  retry?: RetryBudget;
};

// Seam to Google Books and Open Library descriptions; tests supply a fake.
export interface DescriptionGateway {
  // Up to 40 results (two pages of 20) for a plain `title author` query.
  googleBooksVolumes(query: string, options?: LookupOptions): Promise<GoogleBooksVolume[]>;
  // One volume by id: how Enrichment gets a Google Books description, which is never stored.
  googleBooksVolume(id: string, options?: LookupOptions): Promise<GoogleBooksVolume>;
  // The Open Library work description, or "" when it has none.
  openLibraryDescription(workKey: string, options?: LookupOptions): Promise<string>;
}

// How hard a lookup tries. `timeoutMs: null` means no cap on the whole lookup.
export type DescriptionBudget = { timeoutMs: number | null; retry: RetryBudget };

// Adding a Book: a person is waiting, so the whole lookup gets ~3s and one quick retry for a
// transient 503. Both numbers live here so the retry always fits inside the cap.
export const ADD_TIME_BUDGET: DescriptionBudget = { timeoutMs: 3000, retry: { maxAttempts: 2, retryDelayMs: 300 } };

// The Enrichment worker: nobody is waiting, so full retries with backoff and no cap.
export const BACKGROUND_BUDGET: DescriptionBudget = { timeoutMs: null, retry: { maxAttempts: 5, retryDelayMs: 2000 } };

// `volumeAuthors` are the authors of the Google Books volume that matched the Book, even when Open
// Library's description was the one used; absent when no volume matched.
export type BookDescription = { description: string; googleBooksVolumeId: string | null; volumeAuthors?: string[] };

// A Google Books description below this is too thin to ground Enrichment, so Open Library's is
// preferred when it is longer.
export const THIN_DESCRIPTION_CHARS = 500;

const BAD_TITLE =
  /study guide|summary|sparknotes|cliffs|analysis|graphic novel|workbook|companion|box set|four volumes|omnibus|collection|critical|essays|notes on/i;
const BAD_CATEGORY = /study aids|comics|graphic novels|literary criticism|language arts/i;
const ENGLISH = /\b(the|and|of|is|her|his|with|that|was|as|he|she)\b/gi;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
// A line break or block tag separates words; an inline one (`<i>The New Yorker</i>`) does not.
const stripHtml = (s: string) =>
  s
    .replace(/<\/?(br|p|div|li|ul|ol|h[1-6]|blockquote)\b[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
const looksEnglish = (t: string) => (t.match(ENGLISH) ?? []).length >= t.split(" ").length / 15;

// Title and primary-author match, English only, no study guides/adaptations/criticism/box sets;
// the longest matching description wins.
export function pickGoogleBooksDescription(
  volumes: GoogleBooksVolume[],
  title: string,
  author: string,
): { id: string; description: string; authors: string[] } | null {
  const wantTitle = norm(title);
  const lastName = norm(author).split(" ").at(-1) ?? "";

  const good = volumes
    .map((it) => {
      const v = it.volumeInfo ?? {};
      const gotTitle = norm(v.title ?? "");
      const description = stripHtml(v.description ?? "");
      const titleOk =
        gotTitle.startsWith(wantTitle.slice(0, 18)) ||
        wantTitle.startsWith(gotTitle.slice(0, 18)) ||
        gotTitle.includes(wantTitle);
      const authorOk = !!lastName && (v.authors ?? []).some((a) => norm(a).includes(lastName));
      const bad =
        BAD_TITLE.test(`${v.title ?? ""} ${v.subtitle ?? ""}`) || BAD_CATEGORY.test((v.categories ?? []).join(" "));
      // Both checks: bilingual-titled volumes can carry a Spanish description.
      const english = v.language === "en" && looksEnglish(description);
      return { id: it.id, description, authors: v.authors ?? [], ok: titleOk && authorOk && !bad && english && description.length > 0 };
    })
    .filter((c) => c.ok)
    .sort((a, b) => b.description.length - a.description.length);

  return good[0] ?? null;
}

// Google's description of the volume, fetched for one Enrichment run and then discarded: Google's
// terms forbid keeping copies of it (#44). "" when the fetch failed or the volume has none.
export async function googleBooksDescription(gateway: DescriptionGateway, volumeId: string): Promise<string> {
  try {
    const v = await gateway.googleBooksVolume(volumeId, { retry: BACKGROUND_BUDGET.retry });
    return stripHtml(v.volumeInfo?.description ?? "");
  } catch (err) {
    console.error(err);
    return "";
  }
}

const volumeAuthors = (picked: { authors: string[] } | null) => (picked ? { volumeAuthors: picked.authors } : {});

// Google Books description, with the Open Library one when Google's is missing or thin and
// Open Library's is longer. The Google Books volume id is returned only when Google's description
// is the one used: it backs the link Google requires wherever its description is shown.
async function findDescription(
  gateway: DescriptionGateway,
  book: { title: string; authors: string[]; workKey: string },
  options: LookupOptions,
): Promise<BookDescription> {
  const author = book.authors[0] ?? "";
  // An abort is the budget running out, not a source failing; don't log it.
  const failed = (err: unknown) => {
    if (!options.signal?.aborted) console.error(err);
  };
  // Each source failing independently must not lose what the other found.
  const picked = await gateway
    .googleBooksVolumes(`${book.title} ${author}`.trim(), options)
    .then((volumes) => pickGoogleBooksDescription(volumes, book.title, author))
    .catch((err) => {
      failed(err);
      return null;
    });

  let description = picked?.description ?? "";
  if (description.length < THIN_DESCRIPTION_CHARS) {
    const ol = await gateway
      .openLibraryDescription(book.workKey, options)
      .then((d) => d.trim())
      .catch((err) => {
        failed(err);
        return "";
      });
    if (ol.length > description.length) return { description: ol, googleBooksVolumeId: null, ...volumeAuthors(picked) };
  }
  return { description, googleBooksVolumeId: description ? (picked?.id ?? null) : null, ...volumeAuthors(picked) };
}

// Domain seam: a Book's description under a budget. Never throws: a failed, slow or missing lookup
// yields an empty description, and the caller carries on without one.
export async function describeBook(
  gateway: DescriptionGateway,
  book: { title: string; authors: string[]; workKey: string },
  budget: DescriptionBudget,
): Promise<BookDescription> {
  const none: BookDescription = { description: "", googleBooksVolumeId: null };
  const controller = new AbortController();
  const lookup = findDescription(gateway, book, { signal: controller.signal, retry: budget.retry });
  if (budget.timeoutMs === null) return lookup.catch(() => none);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<BookDescription>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(none);
    }, budget.timeoutMs!);
  });
  try {
    return await Promise.race([lookup, timedOut]);
  } catch (err) {
    console.error(err);
    return none;
  } finally {
    clearTimeout(timer);
  }
}
