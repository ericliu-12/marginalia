import { createDb } from "./db/client";
import { listReaders } from "./domain/readers";

// `pnpm readers`: how many Readers there are and who they are, newest first. Reads only.
const { db, pool } = createDb(process.env.DATABASE_URL!);
const { totals, readers } = await listReaders(db);
await pool.end();

const date = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
const usd = (n: number) => `$${n.toFixed(2)}`;
console.log(`Readers: ${totals.readers}. Joined in the last 7 days: ${totals.last7Days}; in the last 30 days: ${totals.last30Days}.`);
console.log();
const table = [
  ["Email", "Joined", "Sign-in", "Last session", "Books", "Spend this month"],
  ...readers.map((r) => [r.email, date(r.joinedAt), r.signIn.join(", "), date(r.lastSessionAt), String(r.books), `${usd(r.spentUsd)} / ${usd(r.budgetUsd)}`]),
];
const widths = table[0].map((_, i) => Math.max(...table.map((row) => row[i].length)));
for (const row of table) console.log(row.map((cell, i) => cell.padEnd(widths[i])).join("  ").trimEnd());
