import { eq, sql } from "drizzle-orm";
import { connection, enrichment, libraryEntry, note } from "../src/db/schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addBook } from "../src/domain/add-book";
import { readEnrichment, tryAgain } from "../src/domain/enrichment";
import { PgBoss } from "pg-boss";
import { createPipeline, RETRIES, type JobQueue, type Pipeline } from "../src/domain/pipeline";
import type { JudgeInput } from "../src/domain/connections";
import { startWorker } from "../src/lib/jobs";
import { backfillConnections } from "../src/domain/connections";
import { changeStatus, removeFromLibrary } from "../src/domain/library-entry";
import { addNote } from "../src/domain/notes";
import { fakeEmbedder, fakeEnricher, fakeJudge, fakeNamer, work } from "./fakes";
import { useTestDb } from "./harness";

// The pg-boss adapter: the real queue, running in-process against the test database, with Claude
// faked. The Pipeline's own rules are tested over the in-memory queue; this checks pg-boss runs them.
describe("Enrichment through the queue", () => {
  const ctx = useTestDb();
  const model = fakeEnricher();
  const embedder = fakeEmbedder(["quiet"]);
  const judge = fakeJudge((input) => ({
    connections: input.candidates.map((c) => ({ candidateId: c.id, type: "thematic", strength: "strong", explanation: "Both are quiet.", quotedNoteIds: [] })),
  }));
  // What the next judge call does first; a test sets it to act mid-run.
  let beforeJudging: ((input: JudgeInput) => Promise<void>) | undefined;
  let queue: JobQueue;
  let pipeline: Pipeline;
  let bulkPipeline: Pipeline;
  let stop: () => Promise<void>;

  beforeAll(async () => {
    const worker = await startWorker({
      connectionString: process.env.TEST_DATABASE_URL!,
      db: ctx.db,
      model,
      embedder,
      judge: { ...judge, judge: async (input) => (await beforeJudging?.(input), judge.judge(input)) },
      descriptions: null,
      namer: fakeNamer(),
      pollingIntervalSeconds: 0.5,
    });
    queue = worker.queue;
    pipeline = createPipeline(ctx.db, queue);
    bulkPipeline = createPipeline(ctx.db, worker.bulkQueue);
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
    const entry = await addBook(ctx.db, pipeline, ctx.userId, work({ workKey: "/works/q1", title: "Stoner", authors: ["John Williams"] }), "want");
    await until(async () => (await readEnrichment(ctx.db, entry.bookId))?.status === "ready");
    expect(model.inputs.filter((i) => i.title === "Stoner")).toHaveLength(1);

    await tryAgain(ctx.db, pipeline, ctx.userId, entry.bookId);
    await until(async () => model.inputs.filter((i) => i.title === "Stoner").length === 2);
    await until(async () => (await readEnrichment(ctx.db, entry.bookId))?.status === "ready");
  });

  it("a duplicate add of the same Book does not enrich it twice", async () => {
    const w = work({ workKey: "/works/q2", title: "Dubliners", authors: ["James Joyce"] });
    const entry = await addBook(ctx.db, pipeline, ctx.userId, w, "want");
    await until(async () => (await readEnrichment(ctx.db, entry.bookId))?.status === "ready");
    await queue.send({ kind: "enrich", bookId: entry.bookId });
    await queue.send({ kind: "enrich", bookId: entry.bookId });
    await new Promise((r) => setTimeout(r, 2000));
    expect(model.inputs.filter((i) => i.title === "Dubliners")).toHaveLength(1);
  });

  it("embeds a recognised Enrichment once it is ready, and a Note when it is saved", async () => {
    const entry = await addBook(ctx.db, pipeline, ctx.userId, work({ workKey: "/works/q3", title: "Quiet Book", authors: ["A"] }), "reading");
    const embedded = async () => (await ctx.db.select().from(enrichment).where(eq(enrichment.bookId, entry.bookId)))[0]?.embeddingModel;
    await until(async () => (await embedded()) === "fake-voyage");

    const n = await addNote(ctx.db, pipeline, ctx.userId, entry.bookId, { body: "Very quiet." });
    await until(async () => (await ctx.db.select().from(note).where(eq(note.id, n.id)))[0].embeddingModel === "fake-voyage");
  });

  it("retries embed jobs on a slow, backing-off schedule so a Voyage 429 can clear", async () => {
    const { rows } = await ctx.db.execute<{ retry_limit: number; retry_delay: number; retry_backoff: boolean }>(
      sql`SELECT retry_limit, retry_delay, retry_backoff FROM pgboss.queue WHERE name = 'embed'`,
    );
    expect(rows[0]).toEqual({ retry_limit: RETRIES.embed, retry_delay: 20, retry_backoff: true });
  });

  it("finds Connections for a Book when it is first finished, once, one job at a time", async () => {
    const add = (key: string, status: "read" | "reading") =>
      addBook(ctx.db, pipeline, ctx.userId, work({ workKey: `/works/${key}`, title: key, authors: ["A"] }), status);
    const first = await add("c1", "read");
    await add("c2", "read");
    const third = await add("c3", "reading");
    const generated = async (bookId: string) =>
      (await ctx.db.select().from(libraryEntry).where(eq(libraryEntry.bookId, bookId)))[0].connectionsGeneratedAt;
    await until(async () => (await generated(first.bookId)) !== null);

    await changeStatus(ctx.db, pipeline, ctx.userId, third.bookId, "read");
    await until(async () => (await generated(third.bookId)) !== null);
    expect(await ctx.db.select().from(connection)).not.toHaveLength(0);
    const calls = judge.inputs.length;

    // Finishing again, or a backfill with everything generated, judges nothing more.
    await changeStatus(ctx.db, pipeline, ctx.userId, third.bookId, "reading");
    await changeStatus(ctx.db, pipeline, ctx.userId, third.bookId, "read");
    expect(await backfillConnections(ctx.db, pipeline, ctx.userId)).toBe(0);
    await new Promise((r) => setTimeout(r, 1500));
    expect(judge.inputs).toHaveLength(calls);
  });

  it("expires a job whose worker stops checking in, and settles a job it gave up on", async () => {
    const { rows } = await ctx.db.execute<{ name: string; dead_letter: string; heartbeat_seconds: number }>(
      sql`SELECT name, dead_letter, heartbeat_seconds FROM pgboss.queue WHERE name IN ('enrich-book', 'embed', 'connections', 'layout') ORDER BY name`,
    );
    expect(rows).toEqual(
      ["connections", "embed", "enrich-book", "layout"].map((name) => ({ name, dead_letter: `${name}-gave-up`, heartbeat_seconds: 30 })),
    );

    const { bookId } = await addBook(ctx.db, pipeline, ctx.userId, work({ workKey: "/works/g1", title: "g1", authors: ["A"] }), "want");
    await ctx.db.update(libraryEntry).set({ connectionsStatus: "running" }).where(eq(libraryEntry.bookId, bookId));
    const boss = new PgBoss(process.env.TEST_DATABASE_URL!);
    await boss.start();
    try {
      await boss.send("connections-gave-up", { userId: ctx.userId, bookId });
    } finally {
      await boss.stop({ graceful: false });
    }
    await until(async () => (await ctx.db.select().from(libraryEntry).where(eq(libraryEntry.bookId, bookId)))[0].connectionsStatus === "failed");
  });

  it("cancels a removed Book's running Connections job, so its failure is not retried", async () => {
    await addBook(ctx.db, pipeline, ctx.userId, work({ workKey: "/works/r1", title: "r1", authors: ["A"] }), "read");
    await until(async () => (await ctx.db.select().from(libraryEntry))[0].connectionsGeneratedAt !== null);
    const { bookId } = await addBook(ctx.db, pipeline, ctx.userId, work({ workKey: "/works/r2", title: "r2", authors: ["A"] }), "read");
    let removed = false;
    beforeJudging = async () => {
      beforeJudging = undefined;
      await removeFromLibrary(ctx.db, pipeline, ctx.userId, bookId);
      removed = true;
      throw new Error("overloaded");
    };
    await until(async () => removed);
    // The Book's Connections jobs: the one that was judging, and any queued behind it.
    const states = async () =>
      (
        await ctx.db.execute<{ state: string }>(
          sql`SELECT state FROM pgboss.job WHERE name = 'connections' AND singleton_key = ${`${ctx.userId}:${bookId}`}`,
        )
      ).rows.map((r) => r.state);
    await until(async () => (await states()).includes("cancelled"));
    await new Promise((r) => setTimeout(r, 1000));
    expect((await states()).filter((s) => s !== "completed" && s !== "cancelled")).toEqual([]);
  });

  // Three Books (`${prefix}3` to `${prefix}5`) a Reader has read, with one Finished Book to connect them to, and
  // the serial Connections queue held on a fourth while the test queues work behind it. `release` lets
  // it go; `judged` is the order the three are judged in once each has its Connections.
  async function heldConnectionsQueue(prefix: string) {
    const add = (n: number, status: "read" | "reading") =>
      addBook(ctx.db, pipeline, ctx.userId, work({ workKey: `/works/${prefix}${n}`, title: `${prefix}${n}`, authors: ["A"] }), status);
    const generated = async (bookId: string) =>
      (await ctx.db.select().from(libraryEntry).where(eq(libraryEntry.bookId, bookId)))[0].connectionsGeneratedAt;
    const ready = async (bookId: string) =>
      (await ctx.db.select().from(enrichment).where(eq(enrichment.bookId, bookId)))[0]?.embeddingModel === "fake-voyage";
    const first = await add(1, "read");
    await until(async () => (await generated(first.bookId)) !== null);
    const [blocker, ...books] = await Promise.all([2, 3, 4, 5].map((n) => add(n, "reading")));
    for (const { bookId } of [blocker, ...books]) await until(() => ready(bookId));

    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let holding = false;
    beforeJudging = async () => {
      beforeJudging = undefined;
      holding = true;
      await held;
    };
    await changeStatus(ctx.db, pipeline, ctx.userId, blocker.bookId, "read");
    await until(async () => holding);
    return {
      bookIds: books.map((b) => b.bookId),
      release,
      async judged() {
        for (const { bookId } of books) await until(async () => (await generated(bookId)) !== null);
        const titles = [3, 4, 5].map((n) => `${prefix}${n}`);
        return judge.inputs.map((i) => i.book.title).filter((t) => titles.includes(t));
      },
    };
  }
  // Read with nothing listening, so the backfill picks them up.
  const silent = () => createPipeline(ctx.db, { send: async () => {}, cancel: async () => {} });

  it("runs a Reader's direct action ahead of a backfill queued before it", async () => {
    const { bookIds: [bulkA, bulkB, direct], release, judged } = await heldConnectionsQueue("p");
    for (const bookId of [bulkA, bulkB]) await changeStatus(ctx.db, silent(), ctx.userId, bookId, "read");
    await backfillConnections(ctx.db, bulkPipeline, ctx.userId);
    await changeStatus(ctx.db, pipeline, ctx.userId, direct, "read");
    release();
    expect((await judged())[0]).toBe("p5");
  }, 20_000);

  it("a Refresh on a Book the backfill already queued runs ahead of the rest of the backfill", async () => {
    const { bookIds, release, judged } = await heldConnectionsQueue("f");
    for (const bookId of bookIds) await changeStatus(ctx.db, silent(), ctx.userId, bookId, "read");
    await backfillConnections(ctx.db, bulkPipeline, ctx.userId);
    await pipeline.refreshRequested(ctx.userId, bookIds[2]);
    release();
    expect((await judged())[0]).toBe("f5");
  }, 20_000);
});
