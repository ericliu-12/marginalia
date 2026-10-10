import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { addBook } from "../src/domain/add-book";
import { addNote } from "../src/domain/notes";
import { jobGaveUp, runJob, type Job, type JobDeps } from "../src/domain/pipeline";
import { enrichment, user } from "../src/db/schema";
import { memoryQueue } from "../src/lib/memory-queue";
import { fakeEmbedder, fakeEnricher, fakeJudge, fakeNamer, work } from "./fakes";
import { addReader, useTestDb } from "./harness";

// A job names the Reader who caused it. Once that Reader is deleted, the job does nothing: no model
// call, no row written, no job sent after it.
describe("A job whose Reader is gone", () => {
  const ctx = useTestDb();
  const fakes = () => ({ model: fakeEnricher(), judge: fakeJudge(), embedder: fakeEmbedder(["quiet"]), descriptions: null, namer: fakeNamer() });
  let deps: ReturnType<typeof fakes>;
  let gone: string;
  let bookId: string;
  let noteId: string;

  // Every row of every table, as text.
  const snapshot = async () => {
    const { rows } = await ctx.db.execute<{ name: string }>(sql`SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`);
    return Object.fromEntries(
      await Promise.all(
        rows.map(async ({ name }) => [name, (await ctx.db.execute(sql`SELECT * FROM ${sql.identifier(name)}`)).rows.map((r) => JSON.stringify(r)).sort()]),
      ),
    );
  };

  // The gone Reader finished Stoner, which another Reader also has (so the Book outlives them), and
  // wrote a Note on it. Its Enrichment is pending, and once ready has no vector yet.
  beforeEach(async () => {
    deps = fakes();
    gone = (await addReader(ctx.db, "gone@example.com")).id;
    const stoner = work({ workKey: "/works/stoner", title: "Stoner", authors: ["John Williams"] });
    ({ bookId } = await addBook(ctx.db, ctx.pipeline, gone, stoner, "read"));
    await addBook(ctx.db, ctx.pipeline, ctx.userId, stoner, "want");
    noteId = (await addNote(ctx.db, ctx.pipeline, gone, bookId, { body: "Quiet." })).id;
    await ctx.db.update(enrichment).set({ status: "pending", recognised: true, summary: "A quiet life.", themes: ["quiet"] }).where(eq(enrichment.bookId, bookId));
    await ctx.db.delete(user).where(eq(user.id, gone));
  });

  const jobs = (): Job[] => [
    { kind: "enrich", bookId, userId: gone },
    { kind: "embed", target: { kind: "enrichment", id: bookId }, userId: gone },
    { kind: "embed", target: { kind: "note", id: noteId }, userId: gone },
    { kind: "connections", userId: gone, bookId },
    { kind: "graph", userId: gone },
  ];
  const kinds = ["enrich", "embed enrichment", "embed note", "connections", "graph"].map((name, i) => ({ name, i }));
  // An Enrichment is embedded only once it is ready; pending, its gave-up handler would fail it.
  const prepare = async (i: number) => {
    if (i === 1) await ctx.db.update(enrichment).set({ status: "ready" }).where(eq(enrichment.bookId, bookId));
  };

  it.each(kinds)("runs a $name job without error, writing and paying for nothing", async ({ i }) => {
    await prepare(i);
    const before = await snapshot();
    const queue = memoryQueue(ctx.db);
    await runJob(ctx.db, deps as JobDeps, queue, jobs()[i]);
    expect(await snapshot()).toEqual(before);
    expect(queue.sent).toEqual([]);
    expect([deps.model.inputs, deps.embedder.calls, deps.judge.inputs, deps.namer.inputs]).toEqual([[], [], [], []]);
  });

  it.each(kinds)("gives up on a $name job without error, writing nothing", async ({ i }) => {
    await prepare(i);
    const before = await snapshot();
    const queue = memoryQueue(ctx.db);
    await jobGaveUp(ctx.db, queue, jobs()[i]);
    expect(await snapshot()).toEqual(before);
    expect(queue.sent).toEqual([]);
  });

  it("still runs a job that names no Reader", async () => {
    await runJob(ctx.db, deps as JobDeps, memoryQueue(ctx.db), { kind: "enrich", bookId });
    expect(deps.model.inputs).toHaveLength(1);
    expect((await ctx.db.select().from(enrichment).where(eq(enrichment.bookId, bookId)))[0].status).toBe("ready");
  });
});
