import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { addBook } from "../src/domain/add-book";
import { readEnrichment, tryAgain } from "../src/domain/enrichment";
import { addNote } from "../src/domain/notes";
import { jobGaveUp, runJob, type Job, type JobDeps } from "../src/domain/pipeline";
import { spendLog } from "../src/domain/spend";
import { enrichment, paidCall, user } from "../src/db/schema";
import { memoryQueue } from "../src/lib/memory-queue";
import { fakeEmbedder, fakeEnricher, fakeJudge, fakeNamer, work } from "./fakes";
import { addReader, useTestDb } from "./harness";

// A job names the Reader who caused it. Once that Reader is deleted, the job does nothing: no model
// call, no row written, no job sent after it; except that an Enrichment another Reader still waits on
// is queued again with no payer.
describe("A job whose Reader is gone", () => {
  const ctx = useTestDb();
  const fakes = () => ({ model: fakeEnricher(), judge: fakeJudge(), embedder: fakeEmbedder(["quiet"]), descriptions: null, namer: fakeNamer() }) satisfies JobDeps;
  let deps: ReturnType<typeof fakes>;
  let gone: string;
  let bookId: string;
  let noteId: string;
  const stoner = work({ workKey: "/works/stoner", title: "Stoner", authors: ["John Williams"] });

  // Every row of every table, as text.
  const snapshot = async () => {
    const { rows } = await ctx.db.execute<{ name: string }>(sql`SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`);
    return Object.fromEntries(
      await Promise.all(
        rows.map(async ({ name }) => [name, (await ctx.db.execute(sql`SELECT * FROM ${sql.identifier(name)}`)).rows.map((r) => JSON.stringify(r)).sort()]),
      ),
    );
  };
  const deleteReader = (id: string) => ctx.db.delete(user).where(eq(user.id, id));

  // The gone Reader finished Stoner, which another Reader also has (so the Book outlives them), and
  // wrote a Note on it. Its Enrichment is pending.
  beforeEach(async () => {
    deps = fakes();
    gone = (await addReader(ctx.db, "gone@example.com")).id;
    ({ bookId } = await addBook(ctx.db, ctx.pipeline, gone, stoner, "read"));
    await addBook(ctx.db, ctx.pipeline, ctx.userId, stoner, "want");
    noteId = (await addNote(ctx.db, ctx.pipeline, gone, bookId, { body: "Quiet." })).id;
    await ctx.db.update(enrichment).set({ status: "pending", recognised: true, summary: "A quiet life.", themes: ["quiet"] }).where(eq(enrichment.bookId, bookId));
  });

  // Each job kind, and what is still sent once its Reader is gone. The Enrichment of the Book the other
  // Reader has is queued again with no payer.
  const cases: { name: string; job: () => Job; sent?: () => Job[]; prepare?: () => Promise<unknown> }[] = [
    { name: "enrich", job: () => ({ kind: "enrich", bookId, userId: gone }), sent: () => [{ kind: "enrich", bookId }] },
    {
      name: "embed enrichment",
      job: () => ({ kind: "embed", target: { kind: "enrichment", id: bookId }, userId: gone }),
      // Embedded only once it is ready; pending, its gave-up handler would fail it.
      prepare: () => ctx.db.update(enrichment).set({ status: "ready" }).where(eq(enrichment.bookId, bookId)),
    },
    { name: "embed note", job: () => ({ kind: "embed", target: { kind: "note", id: noteId }, userId: gone }) },
    { name: "connections", job: () => ({ kind: "connections", userId: gone, bookId }) },
    { name: "graph", job: () => ({ kind: "graph", userId: gone }) },
  ];

  it.each(cases)("runs a $name job without error, writing and paying for nothing", async ({ job, sent = () => [], prepare }) => {
    await prepare?.();
    await deleteReader(gone);
    const before = await snapshot();
    const queue = memoryQueue(ctx.db);
    await runJob(ctx.db, deps, queue, job());
    expect(await snapshot()).toEqual(before);
    expect(queue.sent).toEqual(sent());
    expect([deps.model.inputs, deps.embedder.calls, deps.judge.inputs, deps.namer.inputs]).toEqual([[], [], [], []]);
  });

  it.each(cases)("gives up on a $name job without error, writing nothing", async ({ job, sent = () => [], prepare }) => {
    await prepare?.();
    await deleteReader(gone);
    const before = await snapshot();
    const queue = memoryQueue(ctx.db);
    await jobGaveUp(ctx.db, queue, job());
    expect(await snapshot()).toEqual(before);
    expect(queue.sent).toEqual(sent());
  });

  it("drops an Enrichment no remaining Reader has", async () => {
    const { bookId: own } = await addBook(ctx.db, ctx.pipeline, gone, work({ workKey: "/works/villette", title: "Villette", authors: ["Charlotte Brontë"] }), "want");
    await deleteReader(gone);
    const queue = memoryQueue(ctx.db);
    await runJob(ctx.db, deps, queue, { kind: "enrich", bookId: own, userId: gone });
    await jobGaveUp(ctx.db, queue, { kind: "enrich", bookId: own, userId: gone });
    expect(queue.sent).toEqual([]);
    expect(await readEnrichment(ctx.db, own)).toMatchObject({ status: "pending" });
  });

  it("finishes a shared Book's Enrichment, charged to nobody, when the Reader who pressed Try again is deleted before it runs", async () => {
    // Every Enrichment call is paid for, as the real model reports it.
    const model = fakeEnricher(async () => {
      await spendLog(ctx.db).record({ provider: "anthropic", model: "fake-haiku", purpose: "enrichment", inputTokens: 300, outputTokens: 100, costUsd: 0.0008 });
      return {};
    });
    await ctx.jobs.drain({ ...deps, model });
    await ctx.db.delete(paidCall);
    expect(await readEnrichment(ctx.db, bookId)).toMatchObject({ status: "ready" });

    await tryAgain(ctx.db, ctx.pipeline, gone, bookId);
    await deleteReader(gone);
    await ctx.jobs.drain({ ...deps, model });

    expect(await readEnrichment(ctx.db, bookId)).toMatchObject({ status: "ready" });
    expect(await ctx.db.select({ userId: paidCall.userId, purpose: paidCall.purpose }).from(paidCall)).toEqual([{ userId: null, purpose: "enrichment" }]);
  });

  it("still runs a job that names no Reader", async () => {
    await runJob(ctx.db, deps, memoryQueue(ctx.db), { kind: "enrich", bookId });
    expect(deps.model.inputs).toHaveLength(1);
    expect((await ctx.db.select().from(enrichment).where(eq(enrichment.bookId, bookId)))[0].status).toBe("ready");
  });
});
