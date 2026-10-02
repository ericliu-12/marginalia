import type { DescriptionGateway, GoogleBooksVolume, LookupOptions, RetryBudget } from "@/domain/description";

type Options = {
  apiKey: string;
  userAgent: string;
  fetch?: typeof fetch;
  // Rejects when `signal` aborts, so a lookup's cap can cut a retry sleep short.
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

// Used when a lookup names no retry budget.
const DEFAULT_RETRY: RetryBudget = { maxAttempts: 5, retryDelayMs: 2000 };

const abortableSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal!.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });

const PAGE_SIZE = 20;
const PAGES = 2;

export function createDescriptionGateway({
  apiKey,
  userAgent,
  fetch: doFetch = fetch,
  sleep = abortableSleep,
}: Options): DescriptionGateway {
  async function page(
    q: string,
    startIndex: number,
    { signal, retry: { maxAttempts, retryDelayMs } = DEFAULT_RETRY }: LookupOptions,
  ): Promise<GoogleBooksVolume[]> {
    const url = `https://www.googleapis.com/books/v1/volumes?${new URLSearchParams({
      q,
      maxResults: String(PAGE_SIZE),
      startIndex: String(startIndex),
      key: apiKey,
    })}`;
    let res: Response;
    for (let attempt = 1; ; attempt++) {
      res = await doFetch(url, { signal });
      if (res.ok || attempt >= maxAttempts || ![429, 503].includes(res.status)) break;
      await sleep(retryDelayMs * attempt, signal);
    }
    if (!res.ok) throw new Error(`Google Books failed: ${res.status}`);
    return ((await res.json()) as { items?: GoogleBooksVolume[] }).items ?? [];
  }

  return {
    async googleBooksVolumes(q, options = {}) {
      const items: GoogleBooksVolume[] = [];
      for (let i = 0; i < PAGES; i++) {
        const got = await page(q, i * PAGE_SIZE, options);
        items.push(...got);
        if (got.length < PAGE_SIZE) break;
      }
      return items;
    },

    async openLibraryDescription(workKey, { signal } = {}) {
      const res = await doFetch(`https://openlibrary.org${workKey}.json`, { headers: { "User-Agent": userAgent }, signal });
      if (!res.ok) throw new Error(`Open Library work failed: ${res.status}`);
      const { description } = (await res.json()) as { description?: string | { value?: string } };
      return (typeof description === "string" ? description : description?.value) ?? "";
    },
  };
}
