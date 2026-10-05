import { eq } from "drizzle-orm";
import { enrichment, note } from "../src/db/schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addBook } from "../src/domain/add-book";
import type { EmbeddingQueue } from "../src/domain/embeddings";
import { readEnrichment, tryAgain, type EnrichmentQueue } from "../src/domain/enrichment";
import { startWorker } from "../src/lib/jobs";
import { addNote } from "../src/domain/notes";
import { fakeEmbedder, fakeEnricher, work } from "./fakes";
import { useTestDb } from "./harness";

// The real pg-boss queue, running in-process against the test database, with Claude faked.
describe("Enrichment through the queue", () => {
  const ctx = useTestDb();
  const model = fakeEnricher();
  const embedder = fakeEmbedder(["quiet"]);
  let queue: EnrichmentQueue & EmbeddingQueue;
  let stop: () => Promise<void>;

  beforeAll(async () => {
    const worker = await startWorker({
      connectionString: process.env.TEST_DATABASE_URL!,
      db: ctx.db,
      model,
      embedder,
      descriptions: null,
      pollingIntervalSeconds: 0.5,
    });
    queue = worker.queue;
    stop = worker.stop;
  });
  afterAll(() => stop());

  async function until<T>(read: () => Promise<T | null | false>): Promise<T> {
    for (let i = 0; i < 60; i++) {
      const v = await read();
      if (v) return v;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error("timed out waiting for the queue");
  }

  it("enriches a Book once it is added, and again only on 'Try again'", async () => {
    const entry = await addBook(ctx.db, ctx.userId, work({ workKey: "/works/q1", title: "Stoner", authors: ["John Williams"] }), "want", null, queue);
    await until(async () => (await readEnrichment(ctx.db, entry.bookId))?.status === "ready");
    expect(model.inputs.filter((i) => i.title === "Stoner")).toHaveLength(1);

    await tryAgain(ctx.db, queue, entry.bookId);
    await until(async () => model.inputs.filter((i) => i.title === "Stoner").length === 2);
    await until(async () => (await readEnrichment(ctx.db, entry.bookId))?.status === "ready");
  });

  it("a duplicate add of the same Book does not enrich it twice", async () => {
    const w = work({ workKey: "/works/q2", title: "Dubliners", authors: ["James Joyce"] });
    const entry = await addBook(ctx.db, ctx.userId, w, "want", null, queue);
    await until(async () => (await readEnrichment(ctx.db, entry.bookId))?.status === "ready");
    await queue.enqueueEnrichment(entry.bookId);
    await queue.enqueueEnrichment(entry.bookId);
    await new Promise((r) => setTimeout(r, 2000));
    expect(model.inputs.filter((i) => i.title === "Dubliners")).toHaveLength(1);
  });

  it("embeds a recognised Enrichment once it is ready, and a Note when it is saved", async () => {
    const entry = await addBook(ctx.db, ctx.userId, work({ workKey: "/works/q3", title: "Quiet Book", authors: ["A"] }), "reading", null, queue);
    const embedded = async () => (await ctx.db.select().from(enrichment).where(eq(enrichment.bookId, entry.bookId)))[0]?.embeddingModel;
    await until(async () => (await embedded()) === "fake-voyage");

    const n = await addNote(ctx.db, ctx.userId, entry.bookId, { body: "Very quiet." }, queue);
    await until(async () => (await ctx.db.select().from(note).where(eq(note.id, n.id)))[0].embeddingModel === "fake-voyage");
  });
});
