import type Anthropic from "@anthropic-ai/sdk";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { allowedEmail, paidCall, user } from "../src/db/schema";
import { addBook } from "../src/domain/add-book";
import { setReaderBudget } from "../src/domain/allowlist";
import { readEnrichment } from "../src/domain/enrichment";
import { addNote } from "../src/domain/notes";
import { createPipeline, type JobDeps, type Pipeline } from "../src/domain/pipeline";
import {
  chargeTo,
  monthlyBudgetUsd,
  readerBudgetUsd,
  readPause,
  spendLog,
  spentThisMonthUsd,
  type PaidCall,
  type SpendLog,
} from "../src/domain/spend";
import { claudeJudge } from "../src/lib/claude";
import { startWorker } from "../src/lib/jobs";
import { voyageEmbedder } from "../src/lib/voyage";
import { fakeEmbedder, fakeEnricher, fakeJudge, fakeNamer, work } from "./fakes";
import { addReader, useTestDb } from "./harness";

const call = (costUsd: number): PaidCall => ({ provider: "anthropic", model: "m", purpose: "judge", inputTokens: 1, outputTokens: 1, costUsd });
const DAY = 24 * 60 * 60 * 1000;
const recorder = (): SpendLog & { calls: PaidCall[] } => {
  const calls: PaidCall[] = [];
  return { calls, record: async (c) => void calls.push(c) };
};

describe("Spend", () => {
  const ctx = useTestDb();
  beforeEach(async () => {
    await ctx.db.delete(paidCall);
  });

  it("sums this month's paid calls, in UTC, and pauses once they reach the budget until the 1st", async () => {
    const now = new Date(Date.UTC(2026, 9, 20));
    await spendLog(ctx.db).record(call(3));
    await spendLog(ctx.db).record(call(4.5));
    await ctx.db.insert(paidCall).values({ ...call(100), createdAt: new Date(Date.UTC(2026, 8, 30, 23, 59)) });
    expect(await spentThisMonthUsd(ctx.db, now)).toBeCloseTo(7.5);
    expect(await readPause(ctx.db, null, { globalBudgetUsd: null, now })).toBeNull();
    expect(await readPause(ctx.db, null, { globalBudgetUsd: 8, now })).toBeNull();
    await spendLog(ctx.db).record(call(0.5));
    expect(await readPause(ctx.db, null, { globalBudgetUsd: 8, now })).toEqual({ resumesOn: "1 November", firstMonth: false });
    expect(await readPause(ctx.db, null, { globalBudgetUsd: 8, now: new Date(Date.UTC(2026, 11, 31)) })).toBeNull();
  });

  it("gives a Reader their override if set; otherwise $1 for their first 30 days, then READER_MONTHLY_BUDGET_USD ($5)", () => {
    const now = new Date(Date.UTC(2026, 9, 20));
    const joined = (daysAgo: number) => new Date(now.getTime() - daysAgo * DAY);
    expect(readerBudgetUsd({ createdAt: joined(3), overrideUsd: null }, now, {})).toEqual({ usd: 1, firstMonthUntil: joined(-27) });
    expect(readerBudgetUsd({ createdAt: joined(30), overrideUsd: null }, now, {})).toEqual({ usd: 5, firstMonthUntil: null });
    expect(readerBudgetUsd({ createdAt: joined(30), overrideUsd: null }, now, { READER_MONTHLY_BUDGET_USD: "7" })).toEqual({ usd: 7, firstMonthUntil: null });
    expect(readerBudgetUsd({ createdAt: joined(30), overrideUsd: null }, now, { READER_MONTHLY_BUDGET_USD: "none" })).toEqual({ usd: 5, firstMonthUntil: null });
    expect(readerBudgetUsd({ createdAt: joined(3), overrideUsd: 5 }, now, {})).toEqual({ usd: 5, firstMonthUntil: null });
    expect(readerBudgetUsd({ createdAt: joined(90), overrideUsd: 0.5 }, now, {})).toEqual({ usd: 0.5, firstMonthUntil: null });
  });

  it("pauses only the Reader at their budget, says when a first-month limit lifts, and the cap on everyone still pauses all", async () => {
    const now = new Date(Date.UTC(2026, 9, 20));
    const opts = { globalBudgetUsd: 25, now, env: {} };
    const spend = (userId: string, usd: number) => ctx.db.insert(paidCall).values({ ...call(usd), userId, createdAt: now });
    const joining = async (email: string, daysAgo: number) => {
      const r = await addReader(ctx.db, email);
      await ctx.db.update(user).set({ createdAt: new Date(now.getTime() - daysAgo * DAY) }).where(eq(user.id, r.id));
      return r.id;
    };
    // Joined 10 October: their first month outlasts this one, so their limit lifts as the month turns.
    const lateJoiner = await joining("late@marginalia.local", 10);
    // Joined 25 September: their first month ends, and their $5 begins, on 25 October.
    const newcomer = await joining("new@marginalia.local", 25);
    const regular = await joining("regular@marginalia.local", 60);
    const invited = await joining("invited@marginalia.local", 2);
    await ctx.db.insert(allowedEmail).values({ email: "invited@marginalia.local", monthlyBudgetUsd: 5 });

    await spend(newcomer, 0.6);
    expect(await readPause(ctx.db, newcomer, opts)).toBeNull();
    await spend(newcomer, 0.4);
    expect(await readPause(ctx.db, newcomer, opts)).toEqual({ resumesOn: "25 October", firstMonth: true });
    await spend(lateJoiner, 1);
    expect(await readPause(ctx.db, lateJoiner, opts)).toEqual({ resumesOn: "1 November", firstMonth: true });
    await spend(invited, 1);
    expect(await readPause(ctx.db, invited, opts)).toBeNull();
    await spend(regular, 4.9);
    expect(await readPause(ctx.db, regular, opts)).toBeNull();
    await spend(regular, 0.1);
    expect(await readPause(ctx.db, regular, opts)).toEqual({ resumesOn: "1 November", firstMonth: false });
    expect(await readPause(ctx.db, ctx.userId, opts)).toBeNull();
    expect(await readPause(ctx.db, null, opts)).toBeNull();

    await spend(ctx.userId, 18);
    for (const reader of [ctx.userId, newcomer, invited, null]) {
      expect(await readPause(ctx.db, reader, opts)).toEqual({ resumesOn: "1 November", firstMonth: false });
    }
  });

  it("sets a Reader's budget from `pnpm reader-budget`, and clears it back to the usual rule", async () => {
    await ctx.db.insert(paidCall).values({ ...call(2), userId: ctx.userId });
    const opts = { globalBudgetUsd: null, env: {} };
    expect(await readPause(ctx.db, ctx.userId, opts)).toMatchObject({ firstMonth: true });
    expect(await setReaderBudget(ctx.db, " Reader@Marginalia.local", 3)).toBe(true);
    expect(await readPause(ctx.db, ctx.userId, opts)).toBeNull();
    expect(await setReaderBudget(ctx.db, "reader@marginalia.local", 1.5)).toBe(true);
    expect(await readPause(ctx.db, ctx.userId, opts)).toMatchObject({ firstMonth: false });
    expect(await setReaderBudget(ctx.db, "reader@marginalia.local", null)).toBe(true);
    expect(await readPause(ctx.db, ctx.userId, opts)).toMatchObject({ firstMonth: true });
    expect(await setReaderBudget(ctx.db, "stranger@marginalia.local", 3)).toBe(false);
    expect(await ctx.db.select().from(allowedEmail).where(eq(allowedEmail.email, "stranger@marginalia.local"))).toEqual([]);
  });

  it("still counts a call made for a Reader deleted since their job was queued, charged to nobody", async () => {
    const gone = (await addReader(ctx.db, "gone@marginalia.local")).id;
    await ctx.db.delete(user).where(eq(user.id, gone));
    await chargeTo(gone, () => spendLog(ctx.db).record(call(2)));
    expect(await ctx.db.select({ userId: paidCall.userId, costUsd: paidCall.costUsd }).from(paidCall)).toEqual([{ userId: null, costUsd: 2 }]);
  });

  it("charges a paid call to the Reader a job runs for, and a shared Enrichment once, to the Reader who caused it", async () => {
    await spendLog(ctx.db).record(call(1));
    await chargeTo(ctx.userId, () => spendLog(ctx.db).record(call(2)));
    expect(await ctx.db.select({ userId: paidCall.userId, costUsd: paidCall.costUsd }).from(paidCall).orderBy(paidCall.costUsd)).toEqual([
      { userId: null, costUsd: 1 },
      { userId: ctx.userId, costUsd: 2 },
    ]);
    await ctx.db.delete(paidCall);

    const spend = spendLog(ctx.db);
    const deps: JobDeps = {
      model: fakeEnricher(async () => (await spend.record({ ...call(0.01), purpose: "enrichment" }), {})),
      embedder: fakeEmbedder(["quiet"]),
      judge: fakeJudge(),
      descriptions: null,
      namer: fakeNamer(),
    };
    const stoner = work({ workKey: "/works/s1", title: "Stoner", authors: ["John Williams"] });
    const second = (await addReader(ctx.db, "second@marginalia.local")).id;
    const third = (await addReader(ctx.db, "third@marginalia.local")).id;
    const { bookId } = await addBook(ctx.db, ctx.pipeline, ctx.userId, stoner, "want");
    await addBook(ctx.db, ctx.pipeline, second, stoner, "want");
    const n = await addNote(ctx.db, ctx.pipeline, second, bookId, { body: "Quiet." });
    await ctx.jobs.drain(deps);
    await addBook(ctx.db, ctx.pipeline, third, stoner, "want");
    await ctx.jobs.drain(deps);

    expect(await ctx.db.select({ userId: paidCall.userId, purpose: paidCall.purpose }).from(paidCall)).toEqual([
      { userId: ctx.userId, purpose: "enrichment" },
    ]);
    // Its vector is charged to the same Reader; a Note's to its writer.
    expect(ctx.jobs.sent).toContainEqual({ kind: "embed", target: { kind: "enrichment", id: bookId }, userId: ctx.userId });
    expect(ctx.jobs.sent).toContainEqual({ kind: "embed", target: { kind: "note", id: n.id }, userId: second });
  });

  it("reads the budget from MONTHLY_AI_BUDGET_USD, and has none when it is unset or not a positive number", () => {
    expect(monthlyBudgetUsd({ MONTHLY_AI_BUDGET_USD: "8" })).toBe(8);
    expect(monthlyBudgetUsd({})).toBeNull();
    expect(monthlyBudgetUsd({ MONTHLY_AI_BUDGET_USD: "eight" })).toBeNull();
    expect(monthlyBudgetUsd({ MONTHLY_AI_BUDGET_USD: "0" })).toBeNull();
  });

  it("records a Claude call at list price, even when its reply then fails to parse", async () => {
    const spend = recorder();
    const client = {
      messages: { parse: async () => ({ parsed_output: null, stop_reason: "max_tokens", usage: { input_tokens: 2000, output_tokens: 500 } }) },
    } as unknown as Anthropic;
    const judge = claudeJudge(client, spend);
    await expect(judge.judge({ book: { title: "A", authors: [], enrichment: null, notes: [] }, candidates: [] })).rejects.toThrow(/Unparsed/);
    expect(spend.calls).toEqual([
      { provider: "anthropic", model: judge.model, purpose: "judge", inputTokens: 2000, outputTokens: 500, costUsd: (2000 * 2 + 500 * 10) / 1e6 },
    ]);
  });

  it("records a Voyage call from the tokens it reports", async () => {
    const spend = recorder();
    const vec = Array.from({ length: 1024 }, () => 0);
    const reply = async () => new Response(JSON.stringify({ data: [{ index: 0, embedding: vec }], usage: { total_tokens: 1000 } }));
    await voyageEmbedder("k", reply, spend).embed(["a"], "document");
    expect(spend.calls).toEqual([{ provider: "voyage", model: "voyage-4", purpose: "embedding", inputTokens: 1000, outputTokens: 0, costUsd: 0.00006 }]);
  });

  describe("through the queue", () => {
    const model = fakeEnricher();
    let pipeline: Pipeline;
    let stop: () => Promise<void>;

    beforeAll(async () => {
      const worker = await startWorker({
        connectionString: process.env.TEST_DATABASE_URL!,
        db: ctx.db,
        budgetUsd: 2,
        model,
        embedder: fakeEmbedder(["quiet"]),
        judge: fakeJudge(() => ({ connections: [] })),
        descriptions: null,
        namer: fakeNamer(),
        pollingIntervalSeconds: 0.5,
        pausedRecheckSeconds: 1,
      });
      pipeline = createPipeline(ctx.db, worker.queue);
      stop = worker.stop;
    });
    afterAll(() => stop());

    it("holds a job while the month is over budget, without using up its attempts, and runs it once spend is back under", async () => {
      await spendLog(ctx.db).record(call(2.2));
      const entry = await addBook(ctx.db, pipeline, ctx.userId, work({ workKey: "/works/s1", title: "Stoner", authors: ["John Williams"] }), "want");
      // The worker polls every half second; an attempt would have reached the fake model.
      await new Promise((r) => setTimeout(r, 6000));
      expect(model.inputs).toHaveLength(0);
      expect((await readEnrichment(ctx.db, entry.bookId))?.status).toBe("pending");

      await ctx.db.delete(paidCall);
      for (let i = 0; i < 40 && (await readEnrichment(ctx.db, entry.bookId))?.status !== "ready"; i++) await new Promise((r) => setTimeout(r, 250));
      expect((await readEnrichment(ctx.db, entry.bookId))?.status).toBe("ready");
      expect(model.inputs).toHaveLength(1);
    }, 20_000);

    it("drops a held job, rather than sending it again, once its Reader is deleted", async () => {
      await spendLog(ctx.db).record(call(2.2));
      const gone = (await addReader(ctx.db, "gone@marginalia.local")).id;
      const { bookId } = await addBook(ctx.db, pipeline, gone, work({ workKey: "/works/g1", title: "Villette", authors: ["Charlotte Brontë"] }), "want");
      const waiting = async () =>
        (
          await ctx.db.execute<{ n: number }>(
            sql`SELECT count(*)::int AS n FROM pgboss.job WHERE name = 'enrich-book' AND singleton_key = ${`${bookId}:${gone}`} AND state IN ('created', 'retry', 'active')`,
          )
        ).rows[0].n;
      // Long enough for the held job to be put back for later.
      await new Promise((r) => setTimeout(r, 1500));
      expect(await waiting()).toBe(1);

      await ctx.db.delete(user).where(eq(user.id, gone));
      for (let i = 0; i < 40 && (await waiting()) > 0; i++) await new Promise((r) => setTimeout(r, 250));
      expect(await waiting()).toBe(0);
      expect(model.inputs.filter((i) => i.title === "Villette")).toHaveLength(0);
    }, 20_000);

    it("holds only the jobs of a Reader at their own budget; another Reader's run", async () => {
      const other = (await addReader(ctx.db, "other@marginalia.local")).id;
      // A new Reader's first-month budget is $1.
      await ctx.db.insert(paidCall).values({ ...call(1), userId: ctx.userId });
      const held = await addBook(ctx.db, pipeline, ctx.userId, work({ workKey: "/works/h1", title: "Middlemarch", authors: ["George Eliot"] }), "want");
      const runs = await addBook(ctx.db, pipeline, other, work({ workKey: "/works/r1", title: "Persuasion", authors: ["Jane Austen"] }), "want");
      for (let i = 0; i < 40 && (await readEnrichment(ctx.db, runs.bookId))?.status !== "ready"; i++) await new Promise((r) => setTimeout(r, 250));
      expect((await readEnrichment(ctx.db, runs.bookId))?.status).toBe("ready");
      expect((await readEnrichment(ctx.db, held.bookId))?.status).toBe("pending");

      await ctx.db.delete(paidCall);
      for (let i = 0; i < 40 && (await readEnrichment(ctx.db, held.bookId))?.status !== "ready"; i++) await new Promise((r) => setTimeout(r, 250));
      expect((await readEnrichment(ctx.db, held.bookId))?.status).toBe("ready");
    }, 20_000);

    it("doesn't hold a shared Book's Enrichment for another Reader because its first Reader is at their budget", async () => {
      const other = (await addReader(ctx.db, "other@marginalia.local")).id;
      await ctx.db.insert(paidCall).values({ ...call(1), userId: ctx.userId });
      const shared = work({ workKey: "/works/sh1", title: "Emma", authors: ["Jane Austen"] });
      const { bookId } = await addBook(ctx.db, pipeline, ctx.userId, shared, "want");
      // Long enough for the held job to be put back for later.
      await new Promise((r) => setTimeout(r, 1500));
      await addBook(ctx.db, pipeline, other, shared, "want");
      for (let i = 0; i < 40 && (await readEnrichment(ctx.db, bookId))?.status !== "ready"; i++) await new Promise((r) => setTimeout(r, 250));
      expect((await readEnrichment(ctx.db, bookId))?.status).toBe("ready");
    }, 20_000);
  });
});
