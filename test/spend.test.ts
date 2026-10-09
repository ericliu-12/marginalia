import type Anthropic from "@anthropic-ai/sdk";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { paidCall } from "../src/db/schema";
import { addBook } from "../src/domain/add-book";
import { readEnrichment } from "../src/domain/enrichment";
import { createPipeline, type Pipeline } from "../src/domain/pipeline";
import { monthlyBudgetUsd, readPause, spendLog, spentThisMonthUsd, type PaidCall, type SpendLog } from "../src/domain/spend";
import { claudeJudge } from "../src/lib/claude";
import { startWorker } from "../src/lib/jobs";
import { voyageEmbedder } from "../src/lib/voyage";
import { fakeEmbedder, fakeEnricher, fakeJudge, fakeNamer, work } from "./fakes";
import { useTestDb } from "./harness";

const call = (costUsd: number): PaidCall => ({ provider: "anthropic", model: "m", purpose: "judge", inputTokens: 1, outputTokens: 1, costUsd });
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
    expect(await readPause(ctx.db, null, now)).toBeNull();
    expect(await readPause(ctx.db, 8, now)).toBeNull();
    await spendLog(ctx.db).record(call(0.5));
    expect(await readPause(ctx.db, 8, now)).toEqual({ resumesOn: "1 November" });
    expect(await readPause(ctx.db, 8, new Date(Date.UTC(2026, 11, 31)))).toBeNull();
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
        budgetUsd: 1,
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
      await spendLog(ctx.db).record(call(1.2));
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
  });
});
