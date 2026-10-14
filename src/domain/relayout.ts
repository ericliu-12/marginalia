import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { connectedGroups, lockLayout, type GraphView } from "./graph";
import { DESKTOP } from "./graph-drawing";
import { readDrawn, typicalLength, type Reading } from "./graph-fit";

// For `pnpm graph:layout`: how readable a graph's layout is, and a copy of the stored positions to go
// back to.

// How a laid-out graph reads: its Books; how it reads on each DESKTOP canvas once fitted (see readDrawn:
// the zoom and what bounds it, the share of the canvas the Books fill, labels and names drawn over each
// other, names on their wash); crossings among the Connections shown at rest; how far it spreads, width
// by height, in typical Connection lengths; and the share of the fitted view (the box around every
// Book's dot, half a length wider each way) that the box around the main connected part takes up, null
// with no Connections.
export type LayoutStats = {
  books: number;
  views: Record<keyof typeof DESKTOP, Omit<Reading, "clashes">>;
  crossings: number;
  width: number;
  height: number;
  mainShare: number | null;
};

export function layoutStats(graph: GraphView): LayoutStats {
  const at = new Map(graph.books.map((b) => [b.bookId, b]));
  const unit = typicalLength(graph.books, graph.connections) || 1;
  const drawn = { books: graph.books.map((b) => ({ ...b, id: b.bookId })), clusters: graph.clusters, unit };
  const views = Object.fromEntries(
    Object.entries(DESKTOP).map(([name, view]) => {
      const { clashes: _, ...reading } = readDrawn(drawn, view);
      return [name, reading];
    }),
  ) as LayoutStats["views"];

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
  return { books: graph.books.length, views, crossings, width: spread(xs), height: spread(ys), mainShare };
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
