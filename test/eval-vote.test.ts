import { describe, expect, it } from "vitest";
import { cappedSpend, evalOptions, majority, tally } from "../scripts/eval/vote";

const call = (costUsd: number) => ({ provider: "anthropic" as const, model: "m", purpose: "judge" as const, inputTokens: 1, outputTokens: 1, costUsd });

describe("eval majority vote", () => {
  it("counts how many runs flagged each pair", () => {
    expect(tally([["a", "b"], ["a"], []])).toEqual(new Map([["a", 2], ["b", 1]]));
  });

  it("needs more than half the runs to agree", () => {
    expect(majority(2, 3)).toBe(true);
    expect(majority(1, 3)).toBe(false);
    expect(majority(1, 2)).toBe(false);
    expect(majority(1, 1)).toBe(true);
  });
});

describe("eval options", () => {
  it("defaults to 3 runs and a $1.50 cap", () => {
    expect(evalOptions([])).toEqual({ runs: 3, capUsd: 1.5 });
  });

  it("reads --runs and --cap, also after pnpm's --", () => {
    expect(evalOptions(["--", "--runs", "5", "--cap", "2.5"])).toEqual({ runs: 5, capUsd: 2.5 });
  });

  it("rejects a non-positive or fractional run count and a non-positive cap", () => {
    expect(() => evalOptions(["--runs", "0"])).toThrow(/--runs/);
    expect(() => evalOptions(["--runs", "2.5"])).toThrow(/--runs/);
    expect(() => evalOptions(["--cap", "-1"])).toThrow(/--cap/);
  });
});

describe("eval cost cap", () => {
  it("passes each call on and stays under the cap until spend reaches it", async () => {
    const seen: number[] = [];
    const spend = cappedSpend(1, { async record(c) { seen.push(c.costUsd); } });
    await spend.record(call(0.25));
    await spend.record(call(0.5));
    expect(seen).toEqual([0.25, 0.5]);
    expect(() => spend.check()).not.toThrow();
    await spend.record(call(0.25));
    expect(() => spend.check()).toThrow(/cap/);
  });

  it("stops once spend reaches the cap, saying how to raise it", async () => {
    const spend = cappedSpend(1);
    await spend.record(call(1));
    expect(() => spend.check()).toThrow(/\$1\.00 cap.*--cap/);
  });
});
