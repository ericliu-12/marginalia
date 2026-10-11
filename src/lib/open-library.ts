import type { BookSearchGateway, OpenLibraryWork } from "@/domain/search";

type Doc = {
  key: string;
  title: string;
  author_name?: string[];
  first_publish_year?: number;
  edition_count?: number;
  readinglog_count?: number;
  cover_i?: number;
  subject?: string[];
  author_alternative_name?: string[];
  language?: string[];
};

const FIELDS = "key,title,author_name,author_alternative_name,language,first_publish_year,edition_count,readinglog_count,cover_i,subject";

// Open Library holds a work under the language of its first edition and its author under the
// original script ("海辺のカフカ" by "村上春樹"). Readers, Google Books and the model all want the
// English title and a Latin-script author, which Open Library has as edition titles and alternate names.
const NON_LATIN = /[^\p{Script=Latin}\p{Script=Common}\p{M}]/u;
const isLatin = (s: string) => !NON_LATIN.test(s);
const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const properWord = /^\p{Lu}\p{Ll}[\p{L}'’.-]*$/u;

// Alternate names that look like a person's name written in Latin script: no digits (dates), commas
// or slashes (catalogue forms) and not an all-caps variant.
const plainLatinNames = (names: string[]) =>
  names.filter((n) => isLatin(n) && !/[\d,/]/.test(n) && n.trim().split(/\s+/).length >= 2);

// The first properly-cased two-word name, preferring plain ASCII ("Haruki Murakami") over a
// society or accented variant ("Murakami Haruki Kenkyūkai").
function pickLatinAuthor(names: string[]): string | null {
  const proper = plainLatinNames(names).filter((n) => n.trim().split(/\s+/).every((w) => properWord.test(w)));
  const rank = (n: string) => Number(!/^[\x00-\x7f]*$/.test(n)) * 2 + Number(n.trim().split(/\s+/).length > 2);
  return [...proper].sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

// The English edition's title replaces the work's, unless it is just a variant of it
// ("Dune (Dune Chronicles, Book 1)").
function preferEnglishTitle(title: string, edition: string | undefined) {
  if (!edition) return title;
  const a = fold(title);
  const b = fold(edition);
  return a && b && (a.includes(b) || b.includes(a)) ? title : edition;
}

// Only a key of this shape reaches Open Library's query.
const WORK_KEY = /^\/works\/OL\d+W$/;

type Options = {
  userAgent: string;
  fetch?: typeof fetch;
  ttlMs?: number;
  now?: () => number;
};

// Open Library: 1 req/s anonymous, 3 with a User-Agent carrying contact details.
export function createOpenLibraryGateway({
  userAgent,
  fetch: doFetch = fetch,
  ttlMs = 60_000,
  now = Date.now,
}: Options): BookSearchGateway {
  const cache = new Map<string, { at: number; works: OpenLibraryWork[] }>();

  async function query(params: Record<string, string>): Promise<OpenLibraryWork[]> {
    const url = `https://openlibrary.org/search.json?${new URLSearchParams({ ...params, fields: FIELDS, limit: "20" })}`;
    const res = await doFetch(url, { headers: { "User-Agent": userAgent } });
    if (!res.ok) throw new Error(`Open Library search failed: ${res.status}`);
    const { docs } = (await res.json()) as { docs: Doc[] };
    const english = await englishEditionTitles(docs.filter((d) => d.language?.includes("eng")).map((d) => d.key));
    return docs.map((d) => {
      const title = preferEnglishTitle(d.title, english.get(d.key));
      const authors = d.author_name ?? [];
      const aliases = [...new Map(plainLatinNames(d.author_alternative_name ?? []).map((n) => [n.toLowerCase(), n])).values()].slice(0, 10);
      // Only a lone non-Latin author can be matched to an alternate name; the names are not paired up.
      const latin = authors.filter((a) => !isLatin(a)).length === 1 ? pickLatinAuthor(d.author_alternative_name ?? []) : null;
      return {
        workKey: d.key,
        title,
        ...(title !== d.title && { originalTitle: d.title }),
        authors: latin ? authors.map((a) => (isLatin(a) ? a : latin)) : authors,
        ...(latin && { originalAuthors: authors }),
        ...(aliases.length > 0 && { authorAliases: aliases }),
        firstPublishedYear: d.first_publish_year ?? null,
        editionCount: d.edition_count ?? 0,
        readinglogCount: d.readinglog_count ?? 0,
        coverId: d.cover_i ?? null,
        subjects: d.subject ?? [],
      };
    });
  }

  // One extra request for all the works that have English editions. Failing leaves Open Library's
  // own titles, which is a worse display, not a failed search.
  async function englishEditionTitles(keys: string[]): Promise<Map<string, string>> {
    if (keys.length === 0) return new Map();
    try {
      const params = new URLSearchParams({
        q: `key:(${keys.join(" OR ")})`,
        fields: "key,editions,editions.title,editions.language",
        "editions.q": "language:eng",
        limit: String(keys.length),
      });
      const res = await doFetch(`https://openlibrary.org/search.json?${params}`, { headers: { "User-Agent": userAgent } });
      if (!res.ok) throw new Error(`Open Library edition lookup failed: ${res.status}`);
      const { docs } = (await res.json()) as { docs: { key: string; editions?: { docs?: { title?: string; language?: string[] }[] } }[] };
      const titles = new Map<string, string>();
      for (const d of docs) {
        const edition = d.editions?.docs?.find((e) => e.title && e.language?.includes("eng"));
        if (edition?.title) titles.set(d.key, edition.title);
      }
      return titles;
    } catch (err) {
      console.error(err);
      return new Map();
    }
  }

  return {
    // A work just shown in search is usually still in the cache, so adding it costs no request.
    async findWork(workKey) {
      if (!WORK_KEY.test(workKey)) return null;
      for (const { at, works } of cache.values()) {
        const hit = now() - at < ttlMs && works.find((w) => w.workKey === workKey);
        if (hit) return hit;
      }
      return (await query({ q: `key:${workKey}` })).find((w) => w.workKey === workKey) ?? null;
    },
    async searchWorks(q) {
      const key = q.trim().toLowerCase();
      const hit = cache.get(key);
      if (hit && now() - hit.at < ttlMs) return hit.works;

      // Translated titles can miss free text; retry as a structured title query.
      let works = await query({ q: key });
      if (works.length === 0) works = await query({ title: key });

      cache.set(key, { at: now(), works });
      return works;
    },
  };
}
