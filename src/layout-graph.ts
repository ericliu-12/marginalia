import { eq } from "drizzle-orm";
import { appDb } from "@/db/client";
import { user } from "@/db/schema";
import { layoutGraph, readGraph } from "@/domain/graph";
import { DESKTOP } from "@/domain/graph-drawing";
import { backupPositions, layoutStats, restorePositions, type LayoutStats } from "@/domain/relayout";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");

// One-off: lays every Reader's graph out anew, as the first time, for graphs crowded by placing Books
// one at a time among fixed ones (#130); after this the worker settles it after every Connections job.
// Safe beside a running worker: a layout and the worker's graph job of one Reader take turns.
//
//   pnpm graph:layout [--reader <email>] [--dry-run]   lay out (or only report on) every Reader, or one
//   pnpm graph:layout --restore <table>                 put back the positions a layout backed up
const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  if (!args[i + 1] || args[i + 1].startsWith("--")) throw new Error(`${name} needs a value.`);
  return args[i + 1];
};
const dryRun = args.includes("--dry-run");
const email = option("--reader");
const restore = option("--restore");
const db = appDb();

if (restore) {
  const n = await restorePositions(db, restore);
  console.log(`Restored ${n} Book positions from ${restore}.`);
  process.exit(0);
}

const readers = await db.select({ id: user.id, email: user.email }).from(user).where(email ? eq(user.email, email) : undefined);
if (email && readers.length === 0) throw new Error(`No Reader with the email ${email}.`);

const shape = (s: LayoutStats) =>
  `${s.crossings} crossings, ${s.width.toFixed(1)} × ${s.height.toFixed(1)}, main part ${s.mainShare === null ? "—" : `${Math.round(s.mainShare * 100)}%`} of the view`;
const reads = (v: LayoutStats["views"][keyof LayoutStats["views"]]) =>
  `zoom ${v.zoom.toFixed(2)} (${v.limit === "max" ? "at the max" : `by ${v.limit}`}), fills ${Math.round(v.filled * 100)}%, ${v.labelOverlaps} label overlaps (${v.dotOverlaps} over dots), ${v.nameOverlaps} name overlaps, ${v.namesOnWash} names on their wash; halo: ${v.halo.onWash} on a wash, ${v.halo.onName} on a name, ${v.halo.near} too near`;
let table: string | undefined;
if (!dryRun) {
  table = await backupPositions(db, email ? readers.map((r) => r.id) : undefined);
  console.log(`Backed up the positions to ${table}.`);
}
console.log(
  `Sizes are width × height in typical Connection lengths; each canvas as first fitted, filled by the box around the Books' dots, labels at their real size.${dryRun ? " Dry run: nothing is written." : ""}`,
);
for (const r of readers) {
  const before = await readGraph(db, r.id);
  if (before.books.length === 0) continue;
  const laidOut = await layoutGraph(db, r.id, { fresh: true, dryRun });
  const after = dryRun ? { ...before, books: before.books.map((b) => ({ ...b, ...laidOut.get(b.bookId) })) } : await readGraph(db, r.id);
  const [was, now] = [layoutStats(before), layoutStats(after)];
  console.log(`${r.email} (${before.books.length} Books): ${shape(was)} → ${shape(now)}`);
  for (const view of Object.keys(DESKTOP) as (keyof typeof DESKTOP)[]) console.log(`  ${view}: ${reads(was.views[view])} → ${reads(now.views[view])}`);
}
if (table) console.log(`To put the old positions back: pnpm graph:layout --restore ${table}`);
process.exit(0);
