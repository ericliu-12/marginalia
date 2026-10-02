import { describe, expect, it, vi } from "vitest";
import { createOpenLibraryGateway } from "../src/lib/open-library";

const doc = (key: string) => ({
  key,
  title: "Stoner",
  author_name: ["John Williams"],
  first_publish_year: 1965,
  edition_count: 49,
  cover_i: 5,
  subject: ["College teachers"],
});

function stubFetch(...bodies: unknown[]) {
  const fn = vi.fn();
  for (const docs of bodies) fn.mockResolvedValueOnce(Response.json({ docs }));
  return fn;
}

describe("Open Library gateway", () => {
  const opts = { userAgent: "Marginalia/0.1 (me@example.com)" };

  it("maps docs to works and sends the User-Agent", async () => {
    const fetch = stubFetch([doc("/works/OL1W")]);
    const gw = createOpenLibraryGateway({ ...opts, fetch });
    expect(await gw.searchWorks("stoner")).toEqual([
      { workKey: "/works/OL1W", title: "Stoner", authors: ["John Williams"], firstPublishedYear: 1965, editionCount: 49, coverId: 5, subjects: ["College teachers"] },
    ]);
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toContain("q=stoner");
    expect(init.headers["User-Agent"]).toBe(opts.userAgent);
  });

  it("tolerates thin docs", async () => {
    const fetch = stubFetch([{ key: "/works/OL2W", title: "Thin" }]);
    const [w] = await createOpenLibraryGateway({ ...opts, fetch }).searchWorks("thin");
    expect(w).toMatchObject({ authors: [], firstPublishedYear: null, editionCount: 0, coverId: null, subjects: [] });
  });

  it("falls back to a structured title query when free text finds nothing", async () => {
    const fetch = stubFetch([], [doc("/works/OL3W")]);
    const works = await createOpenLibraryGateway({ ...opts, fetch }).searchWorks("wind-up bird chronicle");
    expect(works).toHaveLength(1);
    expect(String(fetch.mock.calls[1][0])).toContain("title=wind-up+bird+chronicle");
  });

  it("caches a query briefly", async () => {
    let now = 0;
    const fetch = stubFetch([doc("/works/OL1W")], [doc("/works/OL1W")]);
    const gw = createOpenLibraryGateway({ ...opts, fetch, ttlMs: 1000, now: () => now });
    await gw.searchWorks("Stoner");
    await gw.searchWorks(" stoner ");
    expect(fetch).toHaveBeenCalledTimes(1);
    now = 2000;
    await gw.searchWorks("stoner");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("throws on a non-OK response", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("no", { status: 503 }));
    await expect(createOpenLibraryGateway({ ...opts, fetch }).searchWorks("x")).rejects.toThrow("503");
  });
});
