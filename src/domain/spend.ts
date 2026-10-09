import { gte, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { paidCall } from "@/db/schema";

export type PaidCall = Omit<typeof paidCall.$inferInsert, "id" | "createdAt">;

// Where the model clients report each paid call, as soon as it has been paid for (a reply that then
// fails to parse still cost money).
export interface SpendLog {
  record(call: PaidCall): Promise<void>;
}

// Never throws: the call has already been paid for, and failing the job would only pay for it again.
export function spendLog(db: Db): SpendLog {
  return {
    async record(call) {
      try {
        await db.insert(paidCall).values(call);
      } catch (err) {
        console.error("Could not record a paid call", call, err);
      }
    },
  };
}

// MONTHLY_AI_BUDGET_USD, or null (no budget) when it is unset or not a positive number.
export function monthlyBudgetUsd(env: Record<string, string | undefined> = process.env): number | null {
  const usd = Number(env.MONTHLY_AI_BUDGET_USD);
  return env.MONTHLY_AI_BUDGET_USD && Number.isFinite(usd) && usd > 0 ? usd : null;
}

// Months run in UTC, as the providers' monthly limits do.
const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
const nextMonthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

export async function spentThisMonthUsd(db: Db, now = new Date()): Promise<number> {
  const [row] = await db
    .select({ usd: sql<number>`coalesce(sum(${paidCall.costUsd}), 0)::float8` })
    .from(paidCall)
    .where(gte(paidCall.createdAt, monthStart(now)));
  return row.usd;
}

// Background work that may pay for a model call waits while this month's spend has reached the budget.
// `resumesOn` is the day it starts again, e.g. "1 November"; null while nothing is paused.
export async function readPause(db: Db, budgetUsd = monthlyBudgetUsd(), now = new Date()): Promise<{ resumesOn: string } | null> {
  if (budgetUsd === null || (await spentThisMonthUsd(db, now)) < budgetUsd) return null;
  return { resumesOn: nextMonthStart(now).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" }) };
}
