import { createDb } from "./db/client";
import { normaliseEmail, setReaderBudget } from "./domain/allowlist";

// `pnpm reader-budget <email> <usd>` sets a Reader's monthly AI budget; `pnpm reader-budget <email> clear`
// removes it, so they are back on $1 for their first 30 days, then READER_MONTHLY_BUDGET_USD. The worker
// reads it on the next job, so it needs no deploy.
const [email = "", amount = ""] = process.argv.slice(2);
const usd = amount === "clear" ? null : Number(amount);
const valid = usd === null || (amount.trim() !== "" && Number.isFinite(usd) && usd >= 0);
if (!email.trim() || !valid) {
  console.error("Usage: pnpm reader-budget <email> <usd>, or pnpm reader-budget <email> clear");
  process.exit(1);
}
const { db, pool } = createDb(process.env.DATABASE_URL!);
const found = await setReaderBudget(db, email, usd);
await pool.end();
if (!found) {
  console.error(`No Reader or invite has ${normaliseEmail(email)}.`);
  process.exit(1);
}
console.log(usd === null ? `Cleared ${normaliseEmail(email)}'s monthly budget.` : `${normaliseEmail(email)}'s monthly budget is now $${usd}.`);
