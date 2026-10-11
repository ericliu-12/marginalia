import { createDb } from "./db/client";
import { listReaders, type SignIn } from "./domain/readers";

// `pnpm readers`: how many Readers there are and who they are, newest first. Reads only. A failure
// prints one line and nothing of the error, which could carry the connection string.
const { db, pool } = createDb(process.env.DATABASE_URL!);
let result: Awaited<ReturnType<typeof listReaders>>;
try {
  result = await listReaders(db);
} catch {
  console.error("Could not list the Readers.");
  process.exit(1);
} finally {
  await pool.end().catch(() => {});
}
const { totals, readers } = result;

const LABELS: Record<SignIn, string> = { google: "Google", email: "email" };
const date = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "—");
const usd = (n: number) => `$${n.toFixed(2)}`;
console.log(`Readers: ${readers.length}. Joined in the last 7 days: ${totals.last7Days}; in the last 30 days: ${totals.last30Days}.`);
console.log();
const table = [
  ["Email", "Joined", "Sign-in", "Last sign-in", "Books", "Spend this month"],
  ...readers.map((r) => [
    r.email, date(r.joinedAt), r.signIn.map((s) => LABELS[s]).join(", "), date(r.lastSessionAt), String(r.books), `${usd(r.spentUsd)} / ${usd(r.budgetUsd)}`,
  ]),
];
const widths = table[0].map((_, i) => Math.max(...table.map((row) => row[i].length)));
for (const row of table) console.log(row.map((cell, i) => cell.padEnd(widths[i])).join("  ").trimEnd());
console.log();
console.log("A Last sign-in of — means they have no session now: they signed out or it expired, not necessarily that they never signed in.");
