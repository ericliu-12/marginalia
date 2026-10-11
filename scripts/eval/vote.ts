// The eval's majority vote and cost cap. The judge's answers vary from run to run (claude-sonnet-5-5 takes
// no temperature), so the eval judges each input several times and reports only what most runs agree on.
import { parseArgs } from "node:util";
import type { SpendLog } from "@/domain/spend";

// How many runs flagged each key, from each run's list of flagged keys.
export function tally(flagged: Iterable<string>[]) {
  const counts = new Map<string, number>();
  for (const run of flagged) for (const key of new Set(run)) counts.set(key, (counts.get(key) ?? 0) + 1);
  return counts;
}

export const majority = (agree: number, runs: number) => agree * 2 > runs;

// pnpm eval [--runs N] [--cap USD]
export function evalOptions(argv: string[]) {
  const { values } = parseArgs({
    args: argv.filter((a) => a !== "--"),
    options: { runs: { type: "string", default: "3" }, cap: { type: "string", default: "1.5" } },
  });
  const runs = Number(values.runs), capUsd = Number(values.cap);
  if (!Number.isInteger(runs) || runs < 1) throw new Error(`--runs must be a whole number of at least 1, not ${values.runs}`);
  if (!Number.isFinite(capUsd) || capUsd <= 0) throw new Error(`--cap must be a positive number of dollars, not ${values.cap}`);
  return { runs, capUsd };
}

// Adds up what the eval has paid for. check() runs before each judge call, so the eval can go over the cap
// by at most one call.
export function cappedSpend(capUsd: number, inner?: SpendLog) {
  let spent = 0;
  return {
    spentUsd: () => spent,
    async record(call: Parameters<SpendLog["record"]>[0]) {
      spent += call.costUsd;
      await inner?.record(call);
    },
    check() {
      if (spent >= capUsd) {
        throw new Error(`Eval stopped: spent $${spent.toFixed(3)}, which reaches the $${capUsd.toFixed(2)} cap. Raise it with pnpm eval --cap <usd>, or use fewer --runs.`);
      }
    },
  };
}
