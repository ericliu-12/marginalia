import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { addBook } from "../src/domain/add-book";
import { authorsMatch, enrichBook, readEnrichment, tryAgain, type EnrichmentQueue } from "../src/domain/enrichment";
import { book, enrichment } from "../src/db/schema";
import { fakeDescriptions, fakeEnricher, prose, volume, work } from "./fakes";
import { useTestDb } from "./harness";

const noQueue: EnrichmentQueue = { async enqueueEnrichment() {} };

describe("Enrichment", () => {
  const ctx = useTestDb();
  const stoner = work({ workKey: "/works/stoner", title: "Stoner", authors: ["John Williams"], firstPublishedYear: 1965 });

  async function addStoner(description?: string) {
    const gw = description ? fakeDescriptions({ volumes: [volume("gb1", { description })] }) : null;
    await addBook(ctx.db, ctx.userId, stoner, "want", gw, noQueue);
    const [row] = await ctx.db.select().from(book).where(eq(book.openLibraryWorkKey, stoner.workKey));
    return row;
  }
  const rowFor = async (bookId: string) =>
    (await ctx.db.select().from(enrichment).where(eq(enrichment.bookId, bookId)))[0];

  it("stores summary and themes from the description, once per Book", async () => {
    const b = await addStoner(prose(700));
    const model = fakeEnricher();
    await enrichBook(ctx.db, { model }, b.id);
    expect(model.inputs).toEqual([{ title: "Stoner", authors: ["John Williams"], description: prose(700), subjects: [] }]);
    expect(await readEnrichment(ctx.db, b.id)).toEqual({
      status: "ready",
      recognised: true,
      summary: "A quiet novel about a life.",
      themes: ["work", "solitude"],
    });
  });

  it("does not re-run when nothing about the Book changed", async () => {
    const b = await addStoner(prose(700));
    const model = fakeEnricher();
    await enrichBook(ctx.db, { model }, b.id);
    await enrichBook(ctx.db, { model }, b.id);
    expect(model.inputs).toHaveLength(1);
  });

  it("re-runs when the description changes", async () => {
    const b = await addStoner(prose(700));
    const model = fakeEnricher();
    await enrichBook(ctx.db, { model }, b.id);
    await ctx.db.update(book).set({ description: prose(900) }).where(eq(book.id, b.id));
    await enrichBook(ctx.db, { model }, b.id);
    expect(model.inputs).toHaveLength(2);
  });

  it("re-runs when the author or year metadata changes", async () => {
    const b = await addStoner(prose(700));
    const model = fakeEnricher();
    await enrichBook(ctx.db, { model }, b.id);
    await ctx.db.update(book).set({ firstPublishedYear: 1966 }).where(eq(book.id, b.id));
    await enrichBook(ctx.db, { model }, b.id);
    await ctx.db.update(book).set({ authors: ["J. Williams"] }).where(eq(book.id, b.id));
    await enrichBook(ctx.db, { model }, b.id);
    expect(model.inputs).toHaveLength(3);
  });

  it("'Try again' re-runs even when nothing changed, by queueing a job", async () => {
    const b = await addStoner(prose(700));
    const model = fakeEnricher();
    await enrichBook(ctx.db, { model }, b.id);
    const queued: string[] = [];
    await tryAgain(ctx.db, { async enqueueEnrichment(id) { queued.push(id); } }, b.id);
    expect(queued).toEqual([b.id]);
    expect(await readEnrichment(ctx.db, b.id)).toMatchObject({ status: "pending" });
    await enrichBook(ctx.db, { model }, b.id);
    expect(model.inputs).toHaveLength(2);
  });

  it("a 'Try again' that lands while a run is in flight is not lost", async () => {
    const b = await addStoner(prose(700));
    await enrichBook(ctx.db, { model: fakeEnricher() }, b.id);
    await ctx.db.update(book).set({ description: prose(900) }).where(eq(book.id, b.id));
    const slow = fakeEnricher(async () => {
      await tryAgain(ctx.db, noQueue, b.id);
      return {};
    });
    await enrichBook(ctx.db, { model: slow }, b.id);
    const next = fakeEnricher();
    await enrichBook(ctx.db, { model: next }, b.id);
    expect(next.inputs).toHaveLength(1);
  });

  it("'Try again' reads as failed, not pending, when the job could not be queued", async () => {
    const b = await addStoner(prose(700));
    await enrichBook(ctx.db, { model: fakeEnricher() }, b.id);
    const down: EnrichmentQueue = { enqueueEnrichment: () => Promise.reject(new Error("queue down")) };
    await expect(tryAgain(ctx.db, down, b.id)).rejects.toThrow("queue down");
    expect(await readEnrichment(ctx.db, b.id)).toMatchObject({ status: "failed" });
  });

  it("runs conservatively with no description, and a missing description does not force unrecognised", async () => {
    const b = await addStoner();
    const model = fakeEnricher();
    await enrichBook(ctx.db, { model }, b.id);
    expect(model.inputs[0].description).toBe("");
    expect(await readEnrichment(ctx.db, b.id)).toMatchObject({ status: "ready", recognised: true });
  });

  it("an unrecognised Book keeps no summary or themes", async () => {
    const b = await addStoner();
    await enrichBook(ctx.db, { model: fakeEnricher({ recognised: false, summary: "invented", themes: ["x"] }) }, b.id);
    expect(await readEnrichment(ctx.db, b.id)).toEqual({ status: "ready", recognised: false, summary: null, themes: null });
  });

  describe("author cross-check", () => {
    it("a different author forces recognised = false", async () => {
      const b = await addStoner(prose(700));
      await enrichBook(ctx.db, { model: fakeEnricher({ author: "Wallace Stegner" }) }, b.id);
      expect(await readEnrichment(ctx.db, b.id)).toMatchObject({ recognised: false, summary: null, themes: null });
      expect((await rowFor(b.id)).believedAuthor).toBe("Wallace Stegner");
    });

    it("spelling variants match", async () => {
      expect(authorsMatch("Fyodor Dostoyevsky", ["Fyodor Dostoevsky"])).toBe(true);
      expect(authorsMatch("Gabriel García Márquez", ["Gabriel Garcia Marquez"])).toBe(true);
      expect(authorsMatch("J.R.R. Tolkien", ["John Ronald Reuel Tolkien"])).toBe(true);
      expect(authorsMatch("Leo Tolstoy", ["Fyodor Dostoevsky"])).toBe(false);
      expect(authorsMatch("Anne Brontë", ["Charlotte Brontë"])).toBe(true); // surname-only by design
    });

    it("any of several authors matches; a missing author on either side is skipped", async () => {
      expect(authorsMatch("Neil Gaiman", ["Terry Pratchett", "Neil Gaiman"])).toBe(true);
      expect(authorsMatch(null, ["Anyone"])).toBe(true);
      expect(authorsMatch("Anyone", [])).toBe(true);
    });

    it("a year mismatch is stored but never forces unrecognised", async () => {
      const b = await addStoner(prose(700));
      await enrichBook(ctx.db, { model: fakeEnricher({ firstPublishedYear: 1990 }) }, b.id);
      expect(await readEnrichment(ctx.db, b.id)).toMatchObject({ recognised: true });
      expect((await rowFor(b.id)).believedFirstPublishedYear).toBe(1990);
    });
  });

  it("records model, prompt version, tokens and cost", async () => {
    const b = await addStoner(prose(700));
    await enrichBook(ctx.db, { model: fakeEnricher() }, b.id);
    expect(await rowFor(b.id)).toMatchObject({
      model: "fake-haiku",
      promptVersion: "test-1",
      inputTokens: 300,
      outputTokens: 100,
      costUsd: 0.0008,
    });
  });

  describe("a Book added without a description", () => {
    it("has it fetched before enriching, storing the description and Google Books volume id", async () => {
      const b = await addStoner();
      const descriptions = fakeDescriptions({ volumes: [volume("gb9", { description: prose(800) })] });
      const model = fakeEnricher();
      await enrichBook(ctx.db, { model, descriptions }, b.id);
      expect(model.inputs[0].description).toBe(prose(800));
      const [row] = await ctx.db.select().from(book).where(eq(book.id, b.id));
      expect(row).toMatchObject({ description: prose(800), googleBooksVolumeId: "gb9" });
    });

    it("is enriched conservatively when the lookup finds nothing, and the lookup is not repeated on later runs", async () => {
      const b = await addStoner();
      const descriptions = fakeDescriptions({});
      const model = fakeEnricher();
      await enrichBook(ctx.db, { model, descriptions }, b.id);
      await enrichBook(ctx.db, { model, descriptions }, b.id);
      expect(model.inputs).toHaveLength(1);
      expect(model.inputs[0].description).toBe("");
      expect(descriptions.queries).toHaveLength(1);
    });
  });

  describe("failure", () => {
    const boom = () => Promise.reject(new Error("overloaded")) as Promise<never>;

    it("rethrows so the queue retries; the Book reads as pending until the last attempt", async () => {
      const b = await addStoner();
      await expect(enrichBook(ctx.db, { model: fakeEnricher(boom) }, b.id)).rejects.toThrow("overloaded");
      expect(await readEnrichment(ctx.db, b.id)).toMatchObject({ status: "pending" });
      expect((await rowFor(b.id)).lastError).toBe("overloaded");

      await expect(enrichBook(ctx.db, { model: fakeEnricher(boom), finalAttempt: true }, b.id)).rejects.toThrow();
      expect(await readEnrichment(ctx.db, b.id)).toMatchObject({ status: "failed" });
      expect((await rowFor(b.id)).attempts).toBe(2);
    });

    it("recovers on a later run", async () => {
      const b = await addStoner();
      await expect(enrichBook(ctx.db, { model: fakeEnricher(boom), finalAttempt: true }, b.id)).rejects.toThrow();
      await enrichBook(ctx.db, { model: fakeEnricher() }, b.id);
      expect(await readEnrichment(ctx.db, b.id)).toMatchObject({ status: "ready", recognised: true });
    });
  });

  it("no-ops for a Book that is gone", async () => {
    const model = fakeEnricher();
    await enrichBook(ctx.db, { model }, "00000000-0000-0000-0000-000000000000");
    expect(model.inputs).toHaveLength(0);
  });

  it("cross-checks the believed author against the Book's alternate author names too", async () => {
    const murakami = work({
      workKey: "/works/OL2625431W",
      title: "Kafka on the Shore",
      originalTitle: "海辺のカフカ",
      authors: ["Haruki Murakami"],
      originalAuthors: ["村上春樹"],
      authorAliases: ["Haruki Murakami", "Murakami Haruki", "Kharuki Murakami"],
    });
    const [a, b] = await Promise.all(
      ["/works/m1", "/works/m2"].map(async (workKey) => {
        await addBook(ctx.db, ctx.userId, { ...murakami, workKey }, "want", null, noQueue);
        return (await ctx.db.select().from(book).where(eq(book.openLibraryWorkKey, workKey)))[0];
      }),
    );
    // Family-name-first, as Japanese names are often romanised, is not a different author.
    await enrichBook(ctx.db, { model: fakeEnricher({ author: "Murakami Haruki" }) }, a.id);
    expect((await readEnrichment(ctx.db, a.id))?.recognised).toBe(true);
    await enrichBook(ctx.db, { model: fakeEnricher({ author: "Stephen King" }) }, b.id);
    expect((await readEnrichment(ctx.db, b.id))?.recognised).toBe(false);
  });
});
