import type { DescriptionGateway, GoogleBooksVolume } from "@/domain/description";

type Options = { apiKey: string; userAgent: string; fetch?: typeof fetch; sleep?: (ms: number) => Promise<void> };

const PAGE_SIZE = 20;
const PAGES = 2;

export function createDescriptionGateway({
  apiKey,
  userAgent,
  fetch: doFetch = fetch,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}: Options): DescriptionGateway {
  async function page(q: string, startIndex: number): Promise<GoogleBooksVolume[]> {
    const url = `https://www.googleapis.com/books/v1/volumes?${new URLSearchParams({
      q,
      maxResults: String(PAGE_SIZE),
      startIndex: String(startIndex),
      key: apiKey,
    })}`;
    let res: Response;
    for (let attempt = 1; ; attempt++) {
      res = await doFetch(url);
      if (res.ok || attempt >= 5 || ![429, 503].includes(res.status)) break;
      await sleep(2000 * attempt);
    }
    if (!res.ok) throw new Error(`Google Books failed: ${res.status}`);
    return ((await res.json()) as { items?: GoogleBooksVolume[] }).items ?? [];
  }

  return {
    async googleBooksVolumes(q) {
      const items: GoogleBooksVolume[] = [];
      for (let i = 0; i < PAGES; i++) {
        const got = await page(q, i * PAGE_SIZE);
        items.push(...got);
        if (got.length < PAGE_SIZE) break;
      }
      return items;
    },

    async openLibraryDescription(workKey) {
      const res = await doFetch(`https://openlibrary.org${workKey}.json`, { headers: { "User-Agent": userAgent } });
      if (!res.ok) throw new Error(`Open Library work failed: ${res.status}`);
      const { description } = (await res.json()) as { description?: string | { value?: string } };
      return (typeof description === "string" ? description : description?.value) ?? "";
    },
  };
}
