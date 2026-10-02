import type { BookSearchGateway, OpenLibraryWork } from "@/domain/search";

type Doc = {
  key: string;
  title: string;
  author_name?: string[];
  first_publish_year?: number;
  edition_count?: number;
  cover_i?: number;
  subject?: string[];
};

const FIELDS = "key,title,author_name,first_publish_year,edition_count,cover_i,subject";

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
    return docs.map((d) => ({
      workKey: d.key,
      title: d.title,
      authors: d.author_name ?? [],
      firstPublishedYear: d.first_publish_year ?? null,
      editionCount: d.edition_count ?? 0,
      coverId: d.cover_i ?? null,
      subjects: d.subject ?? [],
    }));
  }

  return {
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
