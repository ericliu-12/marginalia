import { AsyncLocalStorage } from "node:async_hooks";
import { and, eq, gte, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { allowedEmail, paidCall, user } from "@/db/schema";

export type PaidCall = Omit<typeof paidCall.$inferInsert, "id" | "createdAt" | "userId">;

// Where the model clients report each paid call, as soon as it has been paid for (a reply that then
// fails to parse still cost money).
export interface SpendLog {
  record(call: PaidCall): Promise<void>;
}

// The Reader a background job is run for: every call it pays for is charged to them.
const chargedReader = new AsyncLocalStorage<string | null>();
export const chargeTo = <T>(userId: string | null, run: () => Promise<T>): Promise<T> => chargedReader.run(userId, run);

// Never throws: the call has already been paid for, and failing the job would only pay for it again. A
// Reader deleted since their job was queued is charged as nobody, so the call still counts.
export function spendLog(db: Db): SpendLog {
  return {
    async record(call) {
      const reader = chargedReader.getStore() ?? null;
      const values = { ...call, userId: reader && sql<string>`(select ${user.id} from ${user} where ${user.id} = ${reader})` };
      try {
        await db.insert(paidCall).values(values);
      } catch (err) {
        console.error("Could not record a paid call", values, err);
      }
    },
  };
}

type Env = Record<string, string | undefined>;

const positive = (value: string | undefined) => {
  const usd = Number(value);
  return value && Number.isFinite(usd) && usd > 0 ? usd : null;
};

// MONTHLY_AI_BUDGET_USD, the cap on everyone together, or null (no cap) when it is unset or not a
// positive number.
export function monthlyBudgetUsd(env: Env = process.env): number | null {
  return positive(env.MONTHLY_AI_BUDGET_USD);
}

const DAY_MS = 24 * 60 * 60 * 1000;
const FIRST_MONTH_DAYS = 30;
const FIRST_MONTH_BUDGET_USD = 1;
const READER_BUDGET_USD = 5;

// A Reader's monthly budget: the owner's override for them if there is one; otherwise $1 while their
// account is under 30 days old, then READER_MONTHLY_BUDGET_USD ($5).
export function readerBudgetUsd(
  reader: { createdAt: Date; overrideUsd: number | null },
  now = new Date(),
  env: Env = process.env,
): { usd: number; firstMonthUntil: Date | null } {
  if (reader.overrideUsd !== null) return { usd: reader.overrideUsd, firstMonthUntil: null };
  const firstMonthUntil = new Date(reader.createdAt.getTime() + FIRST_MONTH_DAYS * DAY_MS);
  if (now < firstMonthUntil) return { usd: FIRST_MONTH_BUDGET_USD, firstMonthUntil };
  return { usd: positive(env.READER_MONTHLY_BUDGET_USD) ?? READER_BUDGET_USD, firstMonthUntil: null };
}

// Months run in UTC, as the providers' monthly limits do.
const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
const nextMonthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });

// Everyone's spend this month, or one Reader's.
export async function spentThisMonthUsd(db: Db, now = new Date(), userId?: string): Promise<number> {
  const [row] = await db
    .select({ usd: sql<number>`coalesce(sum(${paidCall.costUsd}), 0)::float8` })
    .from(paidCall)
    .where(and(gte(paidCall.createdAt, monthStart(now)), userId ? eq(paidCall.userId, userId) : undefined));
  return row.usd;
}

// `resumesOn` is the day work starts again, e.g. "1 November". `firstMonth` when it is the Reader's
// first-month limit, which lifts when their account is 30 days old or the month turns, whichever is first.
export type Pause = { resumesOn: string; firstMonth: boolean };

// Background work that may pay for a model call waits while this month's spend has reached the cap on
// everyone, or (for work a Reader caused) that Reader's spend has reached their budget. Null while
// nothing is paused.
export async function readPause(
  db: Db,
  userId: string | null,
  { globalBudgetUsd = monthlyBudgetUsd(), now = new Date(), env = process.env }: { globalBudgetUsd?: number | null; now?: Date; env?: Env } = {},
): Promise<Pause | null> {
  const monthTurns = nextMonthStart(now);
  if (globalBudgetUsd !== null && (await spentThisMonthUsd(db, now)) >= globalBudgetUsd) return { resumesOn: day(monthTurns), firstMonth: false };
  if (!userId) return null;
  const [reader] = await db
    .select({ createdAt: user.createdAt, overrideUsd: allowedEmail.monthlyBudgetUsd })
    .from(user)
    .leftJoin(allowedEmail, eq(allowedEmail.email, user.email))
    .where(eq(user.id, userId));
  if (!reader) return null;
  const budget = readerBudgetUsd(reader, now, env);
  if ((await spentThisMonthUsd(db, now, userId)) < budget.usd) return null;
  if (budget.firstMonthUntil && budget.firstMonthUntil < monthTurns) return { resumesOn: day(budget.firstMonthUntil), firstMonth: true };
  return { resumesOn: day(monthTurns), firstMonth: budget.firstMonthUntil !== null };
}
