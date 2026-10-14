import { eq, sql } from "drizzle-orm";
import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import type { Db } from "@/db/client";
import { book, bookPosition, libraryEntry } from "@/db/schema";
import { readClusters } from "./clusters";
import { LABEL_CHAR, LABEL_GAP, LABEL_LINE, LABEL_SIZE, nodeRadius, TYPICAL_EDGE_LENGTH, WASH_RADIUS } from "./graph-drawing";
import { readGraphStatus } from "./graph-job";
import { byStrength, otherBook, touches, type Pair } from "./connection-pair";
import { CLUSTER_WEIGHT, readLiveConnections, type ConnectionType, type Strength } from "./connections";
import { displayed } from "./library";
import { readFinished } from "./library-entry";

// At rest, only Connections this strong show, and each Book shows its strongest of them up to
// DISPLAY_CAP; a Connection shows when either of its Books ranks it that high. Selecting a Book shows
// all of its own, weak ones included.
export const AT_REST_STRENGTHS: readonly Strength[] = ["strong", "moderate"];
export const DISPLAY_CAP = 3;

// ForceAtlas2 passes: a graph laid out for the first time needs many; settling one already laid out
// needs fewer.
const FRESH_ITERATIONS = 500;
const SETTLE_ITERATIONS = 100;
// How far a placed Book may move in one layout, in typical Connection lengths: enough that crowding
// eases over a few runs, little enough that the graph stays a place the reader knows.
export const MAX_DRIFT = 0.25;

// A Book's label: its title cut at a subtitle, then to LABEL_MAX_CHARS, at the last whole word that fits
// (mid-word only when the first word alone is too long).
export const LABEL_MAX_CHARS = 32;
export function labelOf(title: string) {
  const main = title.split(/:\s/)[0];
  if (main.length <= LABEL_MAX_CHARS) return main;
  const fits = main.slice(0, LABEL_MAX_CHARS);
  const word = fits.lastIndexOf(" ");
  return `${(word > 0 ? fits.slice(0, word) : fits.slice(0, LABEL_MAX_CHARS - 1)).trimEnd()}…`;
}

// Room a new Book is given, in typical Connection lengths (the median, the unit the graph is drawn at):
// no nearer another Book than `spacing`, and its right-hand label (`gap` from the dot, `char` per
// character, `height` tall) clear of other Books and their labels. The label is the canvas's, at
// ROOM_ZOOM, about the zoom a graph of a few dozen Books is shown at, beside the dot of a Book with
// DISPLAY_CAP Connections.
const ROOM_ZOOM = 1.5;
const PIXEL = 1 / (TYPICAL_EDGE_LENGTH * ROOM_ZOOM);
export const LABEL_ROOM = {
  spacing: 0.6,
  gap: (nodeRadius(DISPLAY_CAP) + LABEL_GAP) * PIXEL,
  char: LABEL_SIZE * LABEL_CHAR * PIXEL,
  height: LABEL_SIZE * LABEL_LINE * PIXEL,
};
// Where else a new Book may go when its own spot is crowded: rings this far apart, this many spots each.
const ROOM_RINGS = 6;
const ROOM_RING_STEP = 0.35;
const ROOM_SPOTS = 16;
// Packing, in typical Connection lengths beyond the Cluster washes: the room between separate groups of
// connected Books, between the connected Books and the band of unconnected ones beside them, and between
// the band's columns.
const GROUP_GAP = 0.5;
const BAND_GAP = 0.5;
const BAND_COLUMN_GAP = 0.5;
// Directions tried when packing a separate group beside those already packed.
const PACK_ANGLES = 24;

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
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

// Finished Books with their Entry and where each sits (stored, or provisional), and the non-dismissed
// Connections between them; Books ordered by id so every layout of the same graph starts the same way.
// A Book keeps its stored place only while it is as connected as when it was laid out (unconnected, or
// not); `fresh` ignores every stored place, as if none were.
async function loadGraph(db: Db | Tx, userId: string, fresh = false) {
  const finished = await readFinished(db, userId);
  const rows = await db
    .select({ entry: libraryEntry, book, x: bookPosition.x, y: bookPosition.y, lone: bookPosition.lone })
    .from(libraryEntry)
    .innerJoin(book, eq(book.id, libraryEntry.bookId))
    .leftJoin(bookPosition, eq(bookPosition.libraryEntryId, libraryEntry.id))
    .where(eq(libraryEntry.userId, userId));
  const books = rows.filter((r) => finished.has(r.entry.id)).sort((p, q) => (p.book.id < q.book.id ? -1 : 1));
  const connections = await readLiveConnections(db, userId);
  const connected = new Set(connections.flatMap((c) => [c.a, c.b]));
  const kept = new Set(books.filter((r) => !fresh && stored(r) !== null && r.lone === !connected.has(r.book.id)).map((r) => r.book.id));
  // The band of unconnected Books holds the same Books as when it was laid out.
  const sameBand = !fresh && books.every((r) => (r.lone === true && stored(r) !== null) === !connected.has(r.book.id));
  const at = place(
    books.map((r) => ({ id: r.book.id, stored: kept.has(r.book.id) ? stored(r) : null })),
    connections,
  );
  return { books, connections, at, finished, kept, sameBand };
}

// Stored positions where there are any. A Book without one starts beside the placed Books it connects
// to, or else on a ring around the placed graph (a spiral when nothing is placed yet). Deterministic.
function place(books: { id: string; stored: Point | null }[], pairs: Pair[]): Map<string, Point> {
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
      .filter((e) => touches(e, n.id))
      .map((e) => otherBook(e, n.id))
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
  for (const c of connections) for (const id of [c.a, c.b]) byBook.set(id, [...(byBook.get(id) ?? []), c]);
  const featured = new Set<string>();
  for (const list of byBook.values()) {
    list
      .filter((c) => AT_REST_STRENGTHS.includes(c.strength))
      .sort(byStrength)
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
    connections: connections.map((c) => ({ id: c.id, a: c.a, b: c.b, type: c.type, strength: c.strength, featured: featured.has(c.id) })),
    clusters: await readClusters(db, userId, new Set(books.map((r) => r.book.id))),
    ...(await readGraphStatus(db, userId)),
  };
}

// The Connections on show: the featured ones, and every one of the selected Book's.
export function visibleConnections(graph: GraphView, selectedBookId: string | null): GraphConnection[] {
  return graph.connections.filter((c) => c.featured || (selectedBookId !== null && touches(c, selectedBookId)));
}

// Domain seam, run by the worker: settles the reader's graph with ForceAtlas2 and stores where each
// Finished Book sits. A placed Book starts where it is and moves at most MAX_DRIFT, so the graph stays a
// place the reader knows while crowding eases and Books drift toward Connections they gained; a new one
// starts beside the placed Books it connects to, settles in among them, and then moves to the nearest
// spot with room for it and its label. `fresh` lays the whole graph out anew, as the first time;
// `dryRun` only works out where each Book would go. Returns where each Book is laid out, by Book id.
export async function layoutGraph(db: Db, userId: string, { fresh = false, dryRun = false } = {}): Promise<Map<string, Point>> {
  return db.transaction(async (tx) => {
    await lockLayout(tx, userId);
    return layOut(tx, userId, fresh, dryRun);
  });
}

// Layouts and restores of one reader's graph take turns, so none writes positions worked out from ones
// another has since replaced.
export const lockLayout = (tx: Tx, userId: string) => tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`layout:${userId}`}))`);

async function layOut(db: Tx, userId: string, fresh: boolean, dryRun: boolean): Promise<Map<string, Point>> {
  const { books, connections, at, kept, sameBand } = await loadGraph(db, userId, fresh);
  if (books.length === 0) return new Map();
  const placed = (r: (typeof books)[number]) => kept.has(r.book.id);

  const g = new Graph({ type: "undirected" });
  for (const r of books) g.addNode(r.book.id, { ...at.get(r.book.id)! });
  for (const c of connections) g.addEdge(c.a, c.b, { weight: CLUSTER_WEIGHT[c.strength] });
  const unit = typicalLength(g);
  forceAtlas2.assign(g, {
    iterations: books.some(placed) ? SETTLE_ITERATIONS : FRESH_ITERATIONS,
    getEdgeWeight: "weight",
    settings: { ...forceAtlas2.inferSettings(g), barnesHutOptimize: books.length > 500 },
  });
  // Groups packed, then each placed Book held to MAX_DRIFT, then the band beside where they end up. A
  // band whose Books changed is laid out anew at once; one that kept them keeps its shape, so moves as
  // a block, within MAX_DRIFT too. Without a unit to measure by (a lone Book), placed Books stay put.
  const labels = new Map(books.map((r) => [r.book.id, labelOf(displayed(r.book, r.entry).title)]));
  const lone = books.filter((r) => g.degree(r.book.id) === 0).map((r) => r.book.id);
  const limit = unit > 0 && Number.isFinite(unit) ? MAX_DRIFT * unit : 0;
  const hold = (ids: string[]) => {
    for (const id of ids) {
      const from = at.get(id)!;
      const dx = g.getNodeAttribute(id, "x") - from.x;
      const dy = g.getNodeAttribute(id, "y") - from.y;
      const scale = Math.min(1, limit / (Math.hypot(dx, dy) || 1));
      g.mergeNodeAttributes(id, { x: from.x + dx * scale, y: from.y + dy * scale });
    }
  };
  packGroups(g, labels);
  hold(books.filter((r) => placed(r) && g.degree(r.book.id) > 0).map((r) => r.book.id));
  const shape = sameBand && lone.length ? bandShape(lone.map((id) => [id, at.get(id)!]), books.filter((r) => !lone.includes(r.book.id)).map((r) => at.get(r.book.id)!)) : undefined;
  lineUpBand(g, labels, shape);
  if (shape) hold(lone.filter((id) => kept.has(id)));
  // An unconnected Book already has its spot in the band, which the others keep clear of.
  makeRoom(
    g,
    books.map((r) => ({ id: r.book.id, label: labelOf(displayed(r.book, r.entry).title), placed: placed(r) || g.degree(r.book.id) === 0 })),
  );
  const laidOut = new Map(books.map((r) => [r.book.id, { x: g.getNodeAttribute(r.book.id, "x") as number, y: g.getNodeAttribute(r.book.id, "y") as number }]));
  if (dryRun) return laidOut;

  await db
    .insert(bookPosition)
    .values(
      books.map((r) => ({ libraryEntryId: r.entry.id, userId, ...laidOut.get(r.book.id)!, lone: g.degree(r.book.id) === 0 })),
    )
    .onConflictDoUpdate({
      target: bookPosition.libraryEntryId,
      set: { x: sql`excluded.x`, y: sql`excluded.y`, lone: sql`excluded.lone`, updatedAt: sql`now()` },
    });
  return laidOut;
}

// The graph's typical Connection length (the median), or with no Connections the median distance from a
// Book to its nearest neighbour; not finite for a lone Book.
function typicalLength(g: Graph): number {
  const point = (id: string): Point => ({ x: g.getNodeAttribute(id, "x"), y: g.getNodeAttribute(id, "y") });
  const lengths = g.mapEdges((_, __, a, b) => Math.hypot(point(a).x - point(b).x, point(a).y - point(b).y)).sort((p, q) => p - q);
  if (lengths.length) return lengths[Math.floor(lengths.length / 2)];
  const ids = g.nodes();
  const nearest = ids.map((id) => Math.min(...ids.filter((o) => o !== id).map((o) => Math.hypot(point(o).x - point(id).x, point(o).y - point(id).y))));
  return nearest.sort((p, q) => p - q)[Math.floor(nearest.length / 2)];
}

type Box = { x0: number; y0: number; x1: number; y1: number };
const overlaps = (p: Box, q: Box) => p.x0 < q.x1 && q.x0 < p.x1 && p.y0 < q.y1 && q.y0 < p.y1;
const shifted = (b: Box, dx: number, dy: number): Box => ({ x0: b.x0 + dx, y0: b.y0 + dy, x1: b.x1 + dx, y1: b.y1 + dy });
const grown = (b: Box, by: number): Box => ({ x0: b.x0 - by, y0: b.y0 - by, x1: b.x1 + by, y1: b.y1 + by });
const middle = (b: Box): Point => ({ x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 });
const union = (boxes: Box[]): Box =>
  boxes.reduce((p, q) => ({ x0: Math.min(p.x0, q.x0), y0: Math.min(p.y0, q.y0), x1: Math.max(p.x1, q.x1), y1: Math.max(p.y1, q.y1) }));

// The groups of Books joined by Connections, two Books or more, largest first (then by smallest id),
// each in id order. The first is the graph's main connected part.
export function connectedGroups(ids: string[], pairs: Pair[]): string[][] {
  const next = new Map(ids.map((id) => [id, [] as string[]]));
  for (const p of pairs) {
    next.get(p.a)?.push(p.b);
    next.get(p.b)?.push(p.a);
  }
  const seen = new Set<string>();
  const groups: string[][] = [];
  for (const id of [...ids].sort()) {
    if (seen.has(id) || next.get(id)!.length === 0) continue;
    const group = [id];
    seen.add(id);
    for (let i = 0; i < group.length; i++) {
      for (const o of next.get(group[i])!) if (!seen.has(o)) (seen.add(o), group.push(o));
    }
    groups.push(group.sort());
  }
  return groups.sort((p, q) => q.length - p.length || (p[0] < q[0] ? -1 : 1));
}

type Side = "below" | "right" | "above" | "left";
type BandShape = { slots: Map<string, { column: number; row: number }>; side: Side };

// The band's shape as it was laid out: each Book's column and row in it, and which side of the connected
// Books' dots it sat on.
function bandShape(band: [string, Point][], connected: Point[]): BandShape {
  const ranks = (v: number[]) => {
    const spread = Math.max(...v) - Math.min(...v);
    const levels = [...v].sort((p, q) => p - q).filter((x, i, all) => i === 0 || x - all[i - 1] > spread * 1e-6);
    return (x: number) => levels.findLastIndex((l) => l <= x + spread * 1e-6);
  };
  const column = ranks(band.map(([, p]) => p.x));
  const row = ranks(band.map(([, p]) => p.y));
  const slots = new Map(band.map(([id, p]) => [id, { column: column(p.x), row: row(p.y) }]));
  if (connected.length === 0) return { slots, side: "below" };
  const mid = (v: number[]) => (Math.min(...v) + Math.max(...v)) / 2;
  const [bx, by] = [mid(band.map(([, p]) => p.x)), mid(band.map(([, p]) => p.y))];
  const side: Side =
    by > Math.max(...connected.map((p) => p.y)) ? "below"
    : by < Math.min(...connected.map((p) => p.y)) ? "above"
    : bx > mid(connected.map((p) => p.x)) ? "right"
    : "left";
  return { slots, side };
}

// How the packing measures the graph as it stands: the typical Connection length (null without one),
// a group's dots, labels and washes (only a group of three or more can be a Cluster, and have one), its
// dots alone (as the canvas fits them), and the room a set of those takes in the fitted view, half a
// length wider each way.
function measure(g: Graph, labels: Map<string, string>) {
  const unit = typicalLength(g);
  if (!(unit > 0) || !Number.isFinite(unit)) return null;
  const point = (id: string): Point => ({ x: g.getNodeAttribute(id, "x"), y: g.getNodeAttribute(id, "y") });
  const reach = (id: string) => (LABEL_ROOM.gap + labels.get(id)!.length * LABEL_ROOM.char) * unit;
  const box = (ids: string[]): Box => {
    const wash = ids.length >= 3 ? WASH_RADIUS * unit : 0;
    return {
      x0: Math.min(...ids.map((id) => point(id).x)) - wash,
      y0: Math.min(...ids.map((id) => point(id).y)) - wash,
      x1: Math.max(...ids.map((id) => point(id).x + Math.max(wash, reach(id)))),
      y1: Math.max(...ids.map((id) => point(id).y)) + wash,
    };
  };
  const dots = (ids: string[]): Box => ({
    x0: Math.min(...ids.map((id) => point(id).x)),
    y0: Math.min(...ids.map((id) => point(id).y)),
    x1: Math.max(...ids.map((id) => point(id).x)),
    y1: Math.max(...ids.map((id) => point(id).y)),
  });
  const room = (boxes: Box[]) => {
    const b = union(boxes);
    return (b.x1 - b.x0 + unit) * (b.y1 - b.y0 + unit);
  };
  const groups = connectedGroups(g.nodes(), g.mapEdges((_, __, a, b) => ({ a, b })));
  return { unit, point, reach, box, dots, room, groups };
}

// Keeps the fitted view on the connected Books: moves each separate group of connected Books whole, as
// near the groups already packed as it fits (the main one first), where it grows the fitted view least,
// toward where ForceAtlas2 left it on a tie.
function packGroups(g: Graph, labels: Map<string, string>) {
  const m = measure(g, labels);
  if (!m) return;
  const { unit, box, dots, room, groups } = m;
  const packed: Box[] = [];
  const fitted: Box[] = [];
  for (const ids of groups) {
    const own = box(ids);
    if (packed.length === 0) {
      packed.push(own);
      fitted.push(dots(ids));
      continue;
    }
    const centre = middle(packed[0]);
    const from = middle(own);
    const toward = Math.atan2(from.y - centre.y, from.x - centre.x);
    let best: { dx: number; dy: number; room: number } | null = null;
    for (let k = 0; k < PACK_ANGLES; k++) {
      const angle = toward + ((k % 2 ? 1 : -1) * Math.ceil(k / 2) * 2 * Math.PI) / PACK_ANGLES;
      for (let r = 0; ; r += unit / 4) {
        const dx = centre.x + Math.cos(angle) * r - from.x;
        const dy = centre.y + Math.sin(angle) * r - from.y;
        if (packed.some((p) => overlaps(grown(shifted(own, dx, dy), GROUP_GAP * unit), p))) continue;
        const taken = room([...fitted, shifted(dots(ids), dx, dy)]);
        if (best === null || taken < best.room) best = { dx, dy, room: taken };
        break;
      }
    }
    packed.push(shifted(own, best!.dx, best!.dy));
    fitted.push(shifted(dots(ids), best!.dx, best!.dy));
    for (const id of ids) g.mergeNodeAttributes(id, { x: m.point(id).x + best!.dx, y: m.point(id).y + best!.dy });
  }
}

// Lines the unconnected Books up, by label, in evenly spaced rows beside the connected Books as they
// now stand, BAND_GAP clear of their labels and washes, each column as wide as the longest label: on the
// side and in as many columns as keep the fitted view smallest (below them on a tie), or, given the
// band's `shape`, in that shape on that side.
function lineUpBand(g: Graph, labels: Map<string, string>, shape?: BandShape) {
  const m = measure(g, labels);
  if (!m) return;
  const { unit, reach, box, dots, room, groups } = m;
  const lone = g.filterNodes((id) => g.degree(id) === 0).sort((p, q) => labels.get(p)!.localeCompare(labels.get(q)!) || (p < q ? -1 : 1));
  if (lone.length === 0) return;
  const packed = groups.map(box);
  const fitted = groups.map(dots);
  const longest = Math.max(...lone.map(reach));
  const column = longest + BAND_COLUMN_GAP * unit;
  const row = LABEL_ROOM.spacing * unit;
  // The band's dots in so many columns and rows, on one side of the connected Books and centred along
  // it; on the left, its labels clear of them too.
  const around = packed.length ? union(packed) : { x0: 0, y0: 0, x1: 0, y1: 0 };
  const mid = middle(around);
  const away = packed.length ? BAND_GAP * unit : 0;
  const band = (side: Side, columns: number, rows = Math.ceil(lone.length / columns)): Box => {
    const w = (columns - 1) * column;
    const h = (rows - 1) * row;
    const x0 = side === "right" ? around.x1 + away : side === "left" ? around.x0 - away - w - longest : mid.x - w / 2;
    const y0 = side === "below" ? around.y1 + away : side === "above" ? around.y0 - away - h : mid.y - h / 2;
    return { x0, y0, x1: x0 + w, y1: y0 + h };
  };
  if (shape) {
    const slots = [...shape.slots.values()];
    const at = band(shape.side, Math.max(...slots.map((s) => s.column)) + 1, Math.max(...slots.map((s) => s.row)) + 1);
    for (const [id, slot] of shape.slots) g.mergeNodeAttributes(id, { x: at.x0 + slot.column * column, y: at.y0 + slot.row * row });
    return;
  }
  let best = band("below", 1);
  for (const side of ["below", "right", "above", "left"] as const) {
    for (let c = 1; c <= lone.length; c++) {
      if (room([...fitted, band(side, c)]) < room([...fitted, best])) best = band(side, c);
    }
  }
  const columns = Math.round((best.x1 - best.x0) / column) + 1;
  lone.forEach((id, i) => g.mergeNodeAttributes(id, { x: best.x0 + (i % columns) * column, y: best.y0 + Math.floor(i / columns) * row }));
}

// Moves each new Book, one at a time, to the first spot near where ForceAtlas2 left it with room for it
// and its label among the Books already settled; failing that, to the least crowded spot tried.
function makeRoom(g: Graph, books: { id: string; label: string; placed: boolean }[]) {
  const point = (id: string): Point => ({ x: g.getNodeAttribute(id, "x"), y: g.getNodeAttribute(id, "y") });
  const unit = typicalLength(g);
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
