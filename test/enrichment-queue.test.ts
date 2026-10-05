import { eq, sql } from "drizzle-orm";
import { connection, enrichment, libraryEntry, note } from "../src/db/schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addBook } from "../src/domain/add-book";
import type { EmbeddingQueue } from "../src/domain/embeddings";
import { readEnrichment, tryAgain, type EnrichmentQueue } from "../src/domain/enrichment";
import { startWorker } from "../src/lib/jobs";
import { backfillConnections, type ConnectionQueue } from "../src/domain/connections";
import { changeStatus } from "../src/domain/library-entry";
import { addNote } from "../src/domain/notes";
import { fakeEmbedder, fakeEnricher, fakeJudge, work } from "./fakes";
import { useTestDb } from "./harness";

// The real pg-boss queue, running in-process against the test database, with Claude faked.
describe("Enrichment through the queue", () => {
  const ctx = useTestDb();
  const model = fakeEnricher();
  const embedder = fakeEmbedder(["quiet"]);
  const judge = fakeJudge((input) => ({
    connections: input.candidates.map((c) => ({ candidateId: c.id, type: "thematic", strength: "strong", explanation: "Both are quiet.", quotedNoteIds: [] })),
  }));
  let queue: EnrichmentQueue & EmbeddingQueue & ConnectionQueue;
  let stop: () => Promise<void>;

  beforeAll(async () => {
    const worker = await startWorker({
      connectionString: process.env.TEST_DATABASE_URL!,
      db: ctx.db,
      model,
      embedder,
      judge,
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

  it("retries embed jobs on a slow, backing-off schedule so a Voyage 429 can clear", async () => {
    const { rows } = await ctx.db.execute<{ retry_limit: number; retry_delay: number; retry_backoff: boolean }>(
      sql`SELECT retry_limit, retry_delay, retry_backoff FROM pgboss.queue WHERE name = 'embed'`,
    );
    expect(rows[0]).toEqual({ retry_limit: 5, retry_delay: 20, retry_backoff: true });
  });

  it("finds Connections for a Book when it is first finished, once, one job at a time", async () => {
    const add = (key: string, status: "read" | "reading") =>
      addBook(ctx.db, ctx.userId, work({ workKey: `/works/${key}`, title: key, authors: ["A"] }), status, null, queue);
    const first = await add("c1", "read");
    await add("c2", "read");
    const third = await add("c3", "reading");
    const generated = async (bookId: string) =>
      (await ctx.db.select().from(libraryEntry).where(eq(libraryEntry.bookId, bookId)))[0].connectionsGeneratedAt;
    await until(async () => (await generated(first.bookId)) !== null);

    await changeStatus(ctx.db, ctx.userId, third.bookId, "read", queue);
    await until(async () => (await generated(third.bookId)) !== null);
    expect(await ctx.db.select().from(connection)).not.toHaveLength(0);
    const calls = judge.inputs.length;

    // Finishing again, or a backfill with everything generated, judges nothing more.
    await changeStatus(ctx.db, ctx.userId, third.bookId, "reading", queue);
    await changeStatus(ctx.db, ctx.userId, third.bookId, "read", queue);
    expect(await backfillConnections(ctx.db, queue, ctx.userId)).toBe(0);
    await new Promise((r) => setTimeout(r, 1500));
    expect(judge.inputs).toHaveLength(calls);
  });
});
