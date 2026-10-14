import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { connectedGroups, LABEL_ROOM, lockLayout, type GraphView } from "./graph";

// For `pnpm graph:layout`: how readable a graph's layout is, and a copy of the stored positions to go
// back to.

// How a laid-out graph reads: its Books, pairs of Books where one's label covers the other's dot or
// label (as the canvas draws them; see LABEL_ROOM), crossings among the Connections shown at rest, how
// far it spreads, width by height, in typical Connection lengths, and the share of the fitted view (the
// box around every Book's dot, as the canvas fits it, half a length wider each way) that the box around
// the main connected part takes up; null with no Connections.
export type LayoutStats = { books: number; labelOverlaps: number; crossings: number; width: number; height: number; mainShare: number | null };

export function layoutStats(graph: GraphView): LayoutStats {
  const at = new Map(graph.books.map((b) => [b.bookId, b]));
  const lengths = graph.connections.map((c) => Math.hypot(at.get(c.a)!.x - at.get(c.b)!.x, at.get(c.a)!.y - at.get(c.b)!.y)).sort((p, q) => p - q);
  const unit = lengths.length ? lengths[Math.floor(lengths.length / 2)] : 1;

  const { gap, char, height } = LABEL_ROOM;
  type Box = { x0: number; y0: number; x1: number; y1: number };
  const overlaps = (p: Box, q: Box) => p.x0 < q.x1 && q.x0 < p.x1 && p.y0 < q.y1 && q.y0 < p.y1;
  const dot = (b: GraphView["books"][number]): Box => ({ x0: b.x - gap * unit, y0: b.y - gap * unit, x1: b.x + gap * unit, y1: b.y + gap * unit });
  const label = (b: GraphView["books"][number]): Box => ({
    x0: b.x + gap * unit,
    y0: b.y - (height / 2) * unit,
    x1: b.x + (gap + b.label.length * char) * unit,
    y1: b.y + (height / 2) * unit,
  });
  let labelOverlaps = 0;
  graph.books.forEach((p, i) => {
    for (const q of graph.books.slice(i + 1)) {
      if (overlaps(label(p), label(q)) || overlaps(label(p), dot(q)) || overlaps(label(q), dot(p))) labelOverlaps++;
    }
  });

  const side = (a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }) =>
    Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  const featured = graph.connections.filter((c) => c.featured);
  let crossings = 0;
  featured.forEach((e, i) => {
    for (const f of featured.slice(i + 1)) {
      if ([f.a, f.b].includes(e.a) || [f.a, f.b].includes(e.b)) continue;
      const [p1, p2, p3, p4] = [e.a, e.b, f.a, f.b].map((id) => at.get(id)!);
      if (side(p1, p2, p3) * side(p1, p2, p4) < 0 && side(p3, p4, p1) * side(p3, p4, p2) < 0) crossings++;
    }
  });

  const xs = graph.books.map((b) => b.x);
  const ys = graph.books.map((b) => b.y);
  const spread = (v: number[]) => (v.length ? (Math.max(...v) - Math.min(...v)) / unit : 0);
  const [main] = connectedGroups(graph.books.map((b) => b.bookId), graph.connections);
  const area = (ids: string[]) => (spread(ids.map((id) => at.get(id)!.x)) + 1) * (spread(ids.map((id) => at.get(id)!.y)) + 1);
  const mainShare = main ? area(main) / area(graph.books.map((b) => b.bookId)) : null;
  return { books: graph.books.length, labelOverlaps, crossings, width: spread(xs), height: spread(ys), mainShare };
}

const BACKUP = /^book_position_backup_\d{8}_\d{6}$/;

// Copies the stored positions, of these Readers or of all, into a new table named for the moment
// (UTC), and returns its name.
export async function backupPositions(db: Db, userIds?: string[]): Promise<string> {
  const table = `book_position_backup_${new Date().toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "_")}`;
  const which = userIds ? sql`WHERE user_id IN (${sql.join(userIds.map((id) => sql`${id}::uuid`), sql`, `)})` : sql``;
  await db.execute(sql`CREATE TABLE ${sql.identifier(table)} AS SELECT * FROM book_position ${which}`);
  return table;
}

// Puts back each backed-up Reader's positions exactly as they were in `table`: a Book placed since is
// unplaced until the next layout, and one no longer in their library is left out; each counts as
// connected, so the next layout moves an unconnected one straight to the band. Returns how many
// Books were placed back.
export async function restorePositions(db: Db, table: string): Promise<number> {
  if (!BACKUP.test(table)) throw new Error(`Not a position backup: ${table}`);
  const from = sql.identifier(table);
  const { rows } = await db.execute<{ user_id: string }>(sql`SELECT DISTINCT user_id FROM ${from}`);
  let restored = 0;
  for (const { user_id: userId } of rows) {
    await db.transaction(async (tx) => {
      await lockLayout(tx, userId);
      await tx.execute(sql`DELETE FROM book_position WHERE user_id = ${userId}`);
      const { rowCount } = await tx.execute(sql`
        INSERT INTO book_position (library_entry_id, user_id, x, y, updated_at)
        SELECT b.library_entry_id, b.user_id, b.x, b.y, b.updated_at FROM ${from} b
        JOIN library_entry e ON e.id = b.library_entry_id AND e.user_id = b.user_id
        WHERE b.user_id = ${userId}`);
      restored += rowCount ?? 0;
    });
  }
  return restored;
}
