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

  describe("English titles and Latin-script authors", () => {
    const kafka = {
      key: "/works/OL2625431W",
      title: "海辺のカフカ",
      author_name: ["村上春樹"],
      author_alternative_name: ["MURAKAMI Haruki", "Murakami Haruki Kenkyūkai", "Haruki Murakami", "Murakami Haruki", "村上春樹", "Kharuki Murakami"],
      language: ["jpn", "eng", "fre"],
      first_publish_year: 2002,
      edition_count: 61,
    };
    const stranger = {
      key: "/works/OL1230613W",
      title: "L’étranger",
      author_name: ["Albert Camus"],
      author_alternative_name: ["CAMUS ALBERT", "Albert 1913-1960 Camus"],
      language: ["fre", "eng"],
      edition_count: 468,
    };
    const englishEdition = (key: string, title: string) => ({ key, editions: { docs: [{ title, language: ["eng"] }] } });

    it("shows a Japanese work by its English edition title and a Latin-script author, keeping the originals", async () => {
      const fetch = stubFetch([kafka], [englishEdition(kafka.key, "Kafka on the Shore")]);
      const [w] = await createOpenLibraryGateway({ ...opts, fetch }).searchWorks("kafka on the shore");
      expect(w).toMatchObject({
        workKey: kafka.key,
        title: "Kafka on the Shore",
        originalTitle: "海辺のカフカ",
        authors: ["Haruki Murakami"],
        originalAuthors: ["村上春樹"],
      });
      expect(w.authorAliases).toEqual(expect.arrayContaining(["Haruki Murakami", "Murakami Haruki"]));
      expect(w.authorAliases).not.toContain("村上春樹");
      const lookup = new URL(String(fetch.mock.calls[1][0]));
      expect(lookup.searchParams.get("q")).toContain(kafka.key);
      expect(lookup.searchParams.get("editions.q")).toBe("language:eng");
    });

    it("shows L'étranger as The Stranger, keeping its Latin-script author", async () => {
      const fetch = stubFetch([stranger], [englishEdition(stranger.key, "The Stranger")]);
      const [w] = await createOpenLibraryGateway({ ...opts, fetch }).searchWorks("the stranger camus");
      expect(w).toMatchObject({ title: "The Stranger", originalTitle: "L’étranger", authors: ["Albert Camus"] });
      expect(w.originalAuthors).toBeUndefined();
    });

    it("keeps the work's title when the English edition title is only a variant of it", async () => {
      const dune = { key: "/works/OL1W", title: "Dune", author_name: ["Frank Herbert"], language: ["eng"] };
      const fetch = stubFetch([dune], [englishEdition(dune.key, "Dune (Dune Chronicles, Book 1)")]);
      const [w] = await createOpenLibraryGateway({ ...opts, fetch }).searchWorks("dune");
      expect(w.title).toBe("Dune");
      expect(w.originalTitle).toBeUndefined();
    });

    it("does not look up English editions for a work with none, and survives the lookup failing", async () => {
      const noEnglish = { ...kafka, key: "/works/OL9W", language: ["jpn"] };
      const fetch = stubFetch([noEnglish]);
      const [w] = await createOpenLibraryGateway({ ...opts, fetch }).searchWorks("x");
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(w.title).toBe("海辺のカフカ");

      const failing = vi.fn().mockResolvedValueOnce(Response.json({ docs: [kafka] })).mockResolvedValueOnce(new Response("no", { status: 503 }));
      const [fallback] = await createOpenLibraryGateway({ ...opts, fetch: failing }).searchWorks("y");
      expect(fallback.title).toBe("海辺のカフカ");
    });
  });
});
