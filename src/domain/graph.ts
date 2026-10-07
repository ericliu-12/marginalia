import { and, eq, isNull, sql } from "drizzle-orm";
import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import type { Db } from "@/db/client";
import { book, bookPosition, connection, graphJob, libraryEntry } from "@/db/schema";
import { readClusters } from "./clusters";
import { CLUSTER_WEIGHT, countFindingConnections, STRENGTH_RANK, type ConnectionType, type Strength } from "./connections";
import { displayed } from "./library";
import { readFinished } from "./library-entry";

// At rest, only Connections this strong show, and each Book shows its strongest of them up to
// DISPLAY_CAP; a Connection shows when either of its Books ranks it that high. Selecting a Book shows
// all of its own, weak ones included.
export const AT_REST_STRENGTHS: readonly Strength[] = ["strong", "moderate"];
export const DISPLAY_CAP = 3;

// ForceAtlas2 passes: a graph laid out for the first time needs many; placing new Books among fixed
// ones only has to settle those.
const FRESH_ITERATIONS = 500;
const SETTLE_ITERATIONS = 100;

// A Book's label: its title cut at a subtitle, then to LABEL_MAX_CHARS.
export const LABEL_MAX_CHARS = 32;
export function labelOf(title: string) {
  const main = title.split(/:\s/)[0];
  return main.length > LABEL_MAX_CHARS ? `${main.slice(0, LABEL_MAX_CHARS - 1).trimEnd()}…` : main;
}

// Room a new Book is given, in typical Connection lengths (the median, the unit the graph is drawn at):
// no nearer another Book than `spacing`, and its right-hand label (`gap` from the dot, `char` per
// character, `height` tall) clear of other Books and their labels. Sized for the zoom a graph of a few
// dozen Books is shown at.
export const LABEL_ROOM = { spacing: 0.6, gap: 0.12, char: 0.045, height: 0.16 };
// Where else a new Book may go when its own spot is crowded: rings this far apart, this many spots each.
const ROOM_RINGS = 6;
const ROOM_RING_STEP = 0.35;
const ROOM_SPOTS = 16;

export type GraphBook = {
  bookId: string;
  title: string;
  authors: string[];
  // Its stored position, or a provisional one near its Connections until the worker lays it out.
  x: number;
  y: number;
  // What the canvas writes beside it.
  label: string;
  // How many Connections it has.
  degree: number;
  // When the reader last finished it (its latest completed Read-through), in ms.
  finishedAt: number;
  // That Read-through's own start and finish dates, in ms, where known.
  latestPass: { startedAt: number | null; finishedAt: number | null };
};

export type GraphConnection = {
  id: string;
  a: string;
  b: string;
  type: ConnectionType;
  strength: Strength;
  // Shown at rest: strong enough, and one of the strongest DISPLAY_CAP of either Book.
  featured: boolean;
};

// A Cluster as last computed by the worker, with the Books in it. Its name is "Cluster of N Books"
// and its description null until it has been named. `wash` picks its colour, and stays with it.
export type GraphCluster = { id: string; bookIds: string[]; name: string; description: string | null; named: boolean; wash: number };

export type GraphView = {
  books: GraphBook[];
  connections: GraphConnection[];
  clusters: GraphCluster[];
  // A Book is finding Connections, or the reader's graph job is queued or running: Connections,
  // Clusters or positions are about to change.
  pending: boolean;
  // Pending, but the Clusters and positions are already current: only their names are on the way.
  naming: boolean;
};

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
  return { books, connections, at, finished };
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
// non-dismissed Connection between them, each marked whether it shows before anything is selected,
// and their Clusters.
export async function readGraph(db: Db, userId: string): Promise<GraphView> {
  const { books, connections, at, finished } = await loadGraph(db, userId);

  // Each Book's Connections, strongest first, then most similar, then by id so ties hold still.
  const byBook = new Map<string, typeof connections>();
  for (const c of connections) for (const id of [c.bookAId, c.bookBId]) byBook.set(id, [...(byBook.get(id) ?? []), c]);
  const featured = new Set<string>();
  for (const list of byBook.values()) {
    list
      .filter((c) => AT_REST_STRENGTHS.includes(c.strength))
      .sort((p, q) => STRENGTH_RANK[p.strength] - STRENGTH_RANK[q.strength] || q.similarity - p.similarity || (p.id < q.id ? -1 : 1))
      .slice(0, DISPLAY_CAP)
      .forEach((c) => featured.add(c.id));
  }

  return {
    books: books.map((r) => {
      const shown = displayed(r.book, r.entry);
      return {
        bookId: r.book.id,
        ...shown,
        ...at.get(r.book.id)!,
        label: labelOf(shown.title),
        degree: byBook.get(r.book.id)?.length ?? 0,
        finishedAt: finished.get(r.entry.id)!.lastCompletedAt,
        latestPass: finished.get(r.entry.id)!.latestPass,
      };
    }),
    connections: connections.map((c) => ({ id: c.id, a: c.bookAId, b: c.bookBId, type: c.type, strength: c.strength, featured: featured.has(c.id) })),
    clusters: await readClusters(db, userId, new Set(books.map((r) => r.book.id))),
    ...(await readGraphStatus(db, userId)),
  };
}

export type GraphStatus = Pick<GraphView, "pending" | "naming">;

// Domain seam: whether the reader's graph is about to change (GraphView's `pending` and `naming`),
// checked alone while the graph waits for background work to settle.
export async function readGraphStatus(db: Db, userId: string): Promise<GraphStatus> {
  const [job] = await db.select({ laidOut: graphJob.laidOut }).from(graphJob).where(eq(graphJob.userId, userId));
  const finding = (await countFindingConnections(db, userId)) > 0;
  return { pending: job !== undefined || finding, naming: job?.laidOut === true && !finding };
}

// The reader's graph job is about to be queued: the graph is pending until it settles. Returns the mark.
export async function markGraphQueued(db: Db, userId: string): Promise<number> {
  const [row] = await db
    .insert(graphJob)
    .values({ userId })
    .onConflictDoUpdate({ target: graphJob.userId, set: { request: sql`${graphJob.request} + 1`, laidOut: false } })
    .returning({ request: graphJob.request });
  return row.request;
}

// The latest request for the reader's graph job, or null when none is pending.
export async function readGraphMark(db: Db, userId: string): Promise<number | null> {
  const [row] = await db.select({ request: graphJob.request }).from(graphJob).where(eq(graphJob.userId, userId));
  return row?.request ?? null;
}

// The graph job has recomputed the Clusters and laid the graph out, for `mark` if no request came in since.
export async function markGraphLaidOut(db: Db, userId: string, mark: number): Promise<void> {
  await db.update(graphJob).set({ laidOut: true }).where(and(eq(graphJob.userId, userId), eq(graphJob.request, mark)));
}

// The graph job settled. Given the mark it started with, a request that came in since stays pending,
// since the job queued for it has yet to run; without one, nothing stays pending.
export async function clearGraphMark(db: Db, userId: string, mark?: number): Promise<void> {
  await db.delete(graphJob).where(and(eq(graphJob.userId, userId), mark === undefined ? undefined : eq(graphJob.request, mark)));
}

// The Connections on show: the featured ones, and every one of the selected Book's.
export function visibleConnections(graph: GraphView, selectedBookId: string | null): GraphConnection[] {
  return graph.connections.filter((c) => c.featured || c.a === selectedBookId || c.b === selectedBookId);
}

// Domain seam, run by the worker: gives each newly Finished Book a stored position with ForceAtlas2.
// Books already placed are fixed and never move, so the graph stays a place the reader knows; a new
// one starts beside the placed Books it connects to, settles in among them, and then moves to the
// nearest spot with room for it and its label. Nothing new, no change.
export async function layoutGraph(db: Db, userId: string): Promise<void> {
  const { books, connections, at } = await loadGraph(db, userId);
  const unplaced = books.filter((r) => stored(r) === null);
  if (unplaced.length === 0) return;

  const g = new Graph({ type: "undirected" });
  for (const r of books) g.addNode(r.book.id, { ...at.get(r.book.id)!, fixed: stored(r) !== null });
  for (const c of connections) g.addEdge(c.bookAId, c.bookBId, { weight: CLUSTER_WEIGHT[c.strength] });
  forceAtlas2.assign(g, {
    iterations: unplaced.length === books.length ? FRESH_ITERATIONS : SETTLE_ITERATIONS,
    getEdgeWeight: "weight",
    settings: { ...forceAtlas2.inferSettings(g), barnesHutOptimize: books.length > 500 },
  });
  makeRoom(
    g,
    books.map((r) => ({ id: r.book.id, label: labelOf(displayed(r.book, r.entry).title), placed: stored(r) !== null })),
  );

  await db
    .insert(bookPosition)
    .values(
      unplaced.map((r) => ({
        libraryEntryId: r.entry.id,
        userId,
        x: g.getNodeAttribute(r.book.id, "x") as number,
        y: g.getNodeAttribute(r.book.id, "y") as number,
      })),
    )
    .onConflictDoNothing({ target: bookPosition.libraryEntryId });
}

type Box = { x0: number; y0: number; x1: number; y1: number };
const overlaps = (p: Box, q: Box) => p.x0 < q.x1 && q.x0 < p.x1 && p.y0 < q.y1 && q.y0 < p.y1;

// Moves each new Book, one at a time, to the first spot near where ForceAtlas2 left it with room for it
// and its label among the Books already settled; failing that, to the least crowded spot tried.
function makeRoom(g: Graph, books: { id: string; label: string; placed: boolean }[]) {
  const point = (id: string): Point => ({ x: g.getNodeAttribute(id, "x"), y: g.getNodeAttribute(id, "y") });
  const lengths = g.mapEdges((_, __, a, b) => Math.hypot(point(a).x - point(b).x, point(a).y - point(b).y)).sort((p, q) => p - q);
  const nearest = books.map((b) => Math.min(...books.filter((o) => o.id !== b.id).map((o) => Math.hypot(point(o.id).x - point(b.id).x, point(o.id).y - point(b.id).y))));
  const unit = lengths.length ? lengths[Math.floor(lengths.length / 2)] : [...nearest].sort((p, q) => p - q)[Math.floor(nearest.length / 2)];
  if (!(unit > 0) || !Number.isFinite(unit)) return;

  const { spacing, gap, char, height } = LABEL_ROOM;
  const dot = (p: Point): Box => ({ x0: p.x - gap * unit, y0: p.y - gap * unit, x1: p.x + gap * unit, y1: p.y + gap * unit });
  const label = (p: Point, text: string): Box => ({
    x0: p.x + gap * unit,
    y0: p.y - (height / 2) * unit,
    x1: p.x + (gap + text.length * char) * unit,
    y1: p.y + (height / 2) * unit,
  });
  const settled = books.filter((b) => b.placed).map((b) => ({ at: point(b.id), label: b.label }));
  const crowding = (p: Point, text: string) =>
    settled.reduce((n, o) => {
      const near = Math.hypot(o.at.x - p.x, o.at.y - p.y) < spacing * unit;
      const mine = label(p, text);
      const theirs = label(o.at, o.label);
      return n + Number(near) + Number(overlaps(mine, dot(o.at)) || overlaps(mine, theirs)) + Number(overlaps(theirs, dot(p)));
    }, 0);

  for (const b of books.filter((x) => !x.placed)) {
    const start = point(b.id);
    let best = { at: start, crowding: crowding(start, b.label) };
    for (let ring = 1; ring <= ROOM_RINGS && best.crowding > 0; ring++) {
      for (let i = 0; i < ROOM_SPOTS && best.crowding > 0; i++) {
        const angle = (i / ROOM_SPOTS) * Math.PI * 2;
        const at = { x: start.x + Math.cos(angle) * ring * ROOM_RING_STEP * unit, y: start.y + Math.sin(angle) * ring * ROOM_RING_STEP * unit };
        const c = crowding(at, b.label);
        if (c < best.crowding) best = { at, crowding: c };
      }
    }
    g.mergeNodeAttributes(b.id, best.at);
    settled.push({ at: best.at, label: b.label });
  }
}
