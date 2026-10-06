import { and, eq, isNull, sql } from "drizzle-orm";
import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import type { Db } from "@/db/client";
import { book, bookPosition, connection, libraryEntry } from "@/db/schema";
import { CLUSTER_WEIGHT, STRENGTH_RANK, type ConnectionType, type Strength } from "./connections";
import { displayed } from "./library";
import { readFinished } from "./library-entry";

// Each Book shows its strongest Connections up to this many; a Connection shows when either of its
// Books ranks it that high. Selecting a Book shows all of its own.
export const DISPLAY_CAP = 7;

// ForceAtlas2 passes: a graph laid out for the first time needs many; one seeded from stored positions
// only has to settle what changed.
const FRESH_ITERATIONS = 500;
const SETTLE_ITERATIONS = 100;

export type GraphBook = {
  bookId: string;
  title: string;
  authors: string[];
  // Its stored position, or a provisional one near its Connections until the worker lays it out.
  x: number;
  y: number;
  // How many Connections it has.
  degree: number;
};

export type GraphConnection = {
  id: string;
  a: string;
  b: string;
  type: ConnectionType;
  strength: Strength;
  // Shown before anything is selected: one of the strongest DISPLAY_CAP of either Book.
  featured: boolean;
};

export type GraphView = { books: GraphBook[]; connections: GraphConnection[] };

type Point = { x: number; y: number };

// Finished Books with their Entry and where each sits (stored, or provisional), and the non-dismissed
// Connections between them; Books ordered by id so every layout of the same graph starts the same way.
async function loadGraph(db: Db, userId: string) {
  const finished = await readFinished(db, userId);
  const rows = await db
    .select({ entry: libraryEntry, book, x: bookPosition.x, y: bookPosition.y })
    .from(libraryEntry)
    .innerJoin(book, eq(book.id, libraryEntry.bookId))
    .leftJoin(bookPosition, eq(bookPosition.libraryEntryId, libraryEntry.id))
    .where(eq(libraryEntry.userId, userId));
  const books = rows.filter((r) => finished.has(r.entry.id)).sort((p, q) => (p.book.id < q.book.id ? -1 : 1));
  const ids = new Set(books.map((r) => r.book.id));
  const connections = (
    await db
      .select()
      .from(connection)
      .where(and(eq(connection.userId, userId), isNull(connection.dismissedAt)))
  ).filter((c) => ids.has(c.bookAId) && ids.has(c.bookBId));
  const at = place(
    books.map((r) => ({ id: r.book.id, stored: stored(r) })),
    connections.map((c) => ({ a: c.bookAId, b: c.bookBId })),
  );
  return { books, connections, at };
}

// Stored positions where there are any. A Book without one starts beside the placed Books it connects
// to, or else on a ring around the placed graph (a spiral when nothing is placed yet). Deterministic.
function place(books: { id: string; stored: Point | null }[], pairs: { a: string; b: string }[]): Map<string, Point> {
  const fixed = new Map<string, Point>();
  for (const n of books) if (n.stored) fixed.set(n.id, n.stored);
  const at = new Map(fixed);
  const placed = [...fixed.values()];
  const cx = placed.reduce((s, p) => s + p.x, 0) / (placed.length || 1);
  const cy = placed.reduce((s, p) => s + p.y, 0) / (placed.length || 1);
  const radius = Math.max(1, ...placed.map((p) => Math.hypot(p.x - cx, p.y - cy)));
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  books.forEach((n, i) => {
    if (at.has(n.id)) return;
    const angle = i * GOLDEN;
    const near = pairs
      .flatMap((e) => (e.a === n.id ? [e.b] : e.b === n.id ? [e.a] : []))
      .map((o) => fixed.get(o))
      .filter((p) => p !== undefined);
    if (near.length) {
      const x = near.reduce((s, p) => s + p.x, 0) / near.length;
      const y = near.reduce((s, p) => s + p.y, 0) / near.length;
      at.set(n.id, { x: x + Math.cos(angle) * radius * 0.1, y: y + Math.sin(angle) * radius * 0.1 });
    } else if (placed.length) {
      at.set(n.id, { x: cx + Math.cos(angle) * radius * 1.2, y: cy + Math.sin(angle) * radius * 1.2 });
    } else {
      at.set(n.id, { x: Math.cos(angle) * Math.sqrt(i + 1) * 10, y: Math.sin(angle) * Math.sqrt(i + 1) * 10 });
    }
  });
  return at;
}

const stored = (r: { x: number | null; y: number | null }) => (r.x === null || r.y === null ? null : { x: r.x, y: r.y });

// Domain seam: the reader's graph. Finished Books only, at their stored positions, with every
// non-dismissed Connection between them, each marked whether it shows before anything is selected.
export async function readGraph(db: Db, userId: string): Promise<GraphView> {
  const { books, connections, at } = await loadGraph(db, userId);

  // Each Book's Connections, strongest first, then most similar, then by id so ties hold still.
  const byBook = new Map<string, typeof connections>();
  for (const c of connections) for (const id of [c.bookAId, c.bookBId]) byBook.set(id, [...(byBook.get(id) ?? []), c]);
  const featured = new Set<string>();
  for (const list of byBook.values()) {
    list
      .sort((p, q) => STRENGTH_RANK[p.strength] - STRENGTH_RANK[q.strength] || q.similarity - p.similarity || (p.id < q.id ? -1 : 1))
      .slice(0, DISPLAY_CAP)
      .forEach((c) => featured.add(c.id));
  }

  return {
    books: books.map((r) => ({
      bookId: r.book.id,
      ...displayed(r.book, r.entry),
      ...at.get(r.book.id)!,
      degree: byBook.get(r.book.id)?.length ?? 0,
    })),
    connections: connections.map((c) => ({ id: c.id, a: c.bookAId, b: c.bookBId, type: c.type, strength: c.strength, featured: featured.has(c.id) })),
  };
}

// The Connections on show: the featured ones, and every one of the selected Book's.
export function visibleConnections(graph: GraphView, selectedBookId: string | null): GraphConnection[] {
  return graph.connections.filter((c) => c.featured || c.a === selectedBookId || c.b === selectedBookId);
}

// Domain seam, run by the worker: lays out the reader's graph with ForceAtlas2 and stores each Finished
// Book's position. Seeded from the stored positions, so Books already placed stay close to where they
// were and a new one settles in among its Connections.
export async function layoutGraph(db: Db, userId: string): Promise<void> {
  const { books, connections, at } = await loadGraph(db, userId);
  if (books.length === 0) return;

  const g = new Graph({ type: "undirected" });
  for (const r of books) g.addNode(r.book.id, { ...at.get(r.book.id)! });
  for (const c of connections) g.addEdge(c.bookAId, c.bookBId, { weight: CLUSTER_WEIGHT[c.strength] });
  const fresh = books.every((r) => stored(r) === null);
  forceAtlas2.assign(g, {
    iterations: fresh ? FRESH_ITERATIONS : SETTLE_ITERATIONS,
    getEdgeWeight: "weight",
    settings: { ...forceAtlas2.inferSettings(g), barnesHutOptimize: books.length > 500 },
  });

  const rows = books.map((r) => ({
    libraryEntryId: r.entry.id,
    userId,
    x: g.getNodeAttribute(r.book.id, "x") as number,
    y: g.getNodeAttribute(r.book.id, "y") as number,
    updatedAt: new Date(),
  }));
  await db
    .insert(bookPosition)
    .values(rows)
    .onConflictDoUpdate({
      target: bookPosition.libraryEntryId,
      set: { x: sql`excluded.x`, y: sql`excluded.y`, updatedAt: sql`excluded.updated_at` },
    });
}
