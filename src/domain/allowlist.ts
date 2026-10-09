import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { allowedEmail, user } from "@/db/schema";

// An invited friend isn't held to the first-month limit (#66).
const INVITED_MONTHLY_BUDGET_USD = 5;

export const normaliseEmail = (email: string) => email.trim().toLowerCase();

// Allowlists the email with the invited budget and returns the sign-in URL to send them. Sends nothing.
export async function invite(db: Db, email: string, baseURL: string): Promise<string> {
  const values = { email: normaliseEmail(email), monthlyBudgetUsd: INVITED_MONTHLY_BUDGET_USD };
  await db.insert(allowedEmail).values(values).onConflictDoUpdate({ target: allowedEmail.email, set: values });
  return new URL("/sign-in", baseURL).toString();
}

// While signup is allowlist-only, only an invited email or an existing Reader's may sign in.
export async function mayBecomeReader(db: Db, email: string): Promise<boolean> {
  const address = normaliseEmail(email);
  const [invited] = await db.select({ email: allowedEmail.email }).from(allowedEmail).where(eq(allowedEmail.email, address));
  if (invited) return true;
  const [reader] = await db.select({ id: user.id }).from(user).where(eq(user.email, address));
  return Boolean(reader);
}
