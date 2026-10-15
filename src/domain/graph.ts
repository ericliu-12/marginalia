import { eq, sql } from "drizzle-orm";
import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import type { Db } from "@/db/client";
import { book, bookPosition, libraryEntry } from "@/db/schema";
import { readClusters } from "./clusters";
import {
  CLUSTER_NAME_GAP,
  clusterNameSize,
  DESKTOP,
  HALO_GAP,
  LABEL_CHAR,
  LABEL_GAP,
  LABEL_LINE,
  LABEL_PLATE,
  LABEL_SIZE,
  nodeRadius,
  TYPICAL_EDGE_LENGTH,
  WASH_RADIUS,
} from "./graph-drawing";
import { fitDrawn, nameBox, readDrawn, textWidth, type Clash, type Drawn } from "./graph-fit";
import { similarities } from "./embeddings";
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
// Packing: the room between separate groups of connected Books, in typical Connection lengths beyond the
// Cluster washes, and the directions tried when packing one beside those already packed.
const GROUP_GAP = 0.5;
const PACK_ANGLES = 24;
// The halo of unconnected Books (HALO_GAP clear of the connected ones, in ./graph-drawing.ts). Each Book
// aims toward the side its HALO_SIMILAR most similar connected Books sit on (by stored embeddings), or
// with none a side of its own, strays from that by up to HALO_SCATTER, and sits up to HALO_LOOSENESS
// lengths beyond the nearest spot with room: all three seeded from its id, so it keeps its place from
// one layout to the next. Of HALO_ANGLES directions around the connected Books, it takes the spot that
// grows the fitted view least, a turn of half the circle away from its aim counting as HALO_PULL of the
// view. Placed in HALO_ROUNDS at most, each with labels at the size the last was fitted at.
const HALO_SIMILAR = 3;
const HALO_SCATTER = Math.PI / 4;
const HALO_LOOSENESS = 0.6;
const HALO_ANGLES = 36;
const HALO_PULL = 0.25;
const HALO_ROUNDS = 4;
// Labels are measured as if the graph were fitted this much smaller than it is, so a halo laid out
// before still has room unless the connected Books have moved in on it.
const HALO_SLACK = 0.9;
// Paper kept between two halo Books' dots and labels, in pixels.
const HALO_PAD = 6;
// The canvas is wide, so the graph is laid out wide: ForceAtlas2 settles it this much narrower than it is
// drawn, a graph laid out afresh is first turned so its longest spread lies across, and packing and the
// halo aim to fill a view of the desktop's shape.
export const WIDEN = 1.6;
const ASPECT = DESKTOP["1280×800"].width / DESKTOP["1280×800"].height;
// Rounds of spreading Books apart where labels and names would be drawn over each other, at most.
const SPREAD_ROUNDS = 200;

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
  const at = place(
    books.map((r) => ({ id: r.book.id, stored: kept.has(r.book.id) ? stored(r) : null })),
    connections,
  );
  return { books, connections, at, finished, kept };
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
// spot with room for it and its label. Books with no Connections go to the halo around the rest (see
// lineUpHalo). `fresh` lays the whole graph out anew, as the first time;
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
  const { books, connections, at, kept } = await loadGraph(db, userId, fresh);
  if (books.length === 0) return new Map();
  const placed = (r: (typeof books)[number]) => kept.has(r.book.id);

  const g = new Graph({ type: "undirected" });
  for (const r of books) g.addNode(r.book.id, { ...at.get(r.book.id)! });
  for (const c of connections) g.addEdge(c.a, c.b, { weight: CLUSTER_WEIGHT[c.strength] });
  const unit = typicalLength(g);
  // Only the connected Books settle: the halo places the rest, which would otherwise push them about.
  const linkedGraph = g.copy();
  linkedGraph.forEachNode((id) => linkedGraph.degree(id) === 0 && linkedGraph.dropNode(id));
  const widen = (h: Graph, by: number) => h.updateEachNodeAttributes((_, a) => ({ ...a, x: a.x * by }));
  widen(linkedGraph, 1 / WIDEN);
  if (linkedGraph.order > 0) {
    forceAtlas2.assign(linkedGraph, {
      iterations: books.some(placed) ? SETTLE_ITERATIONS : FRESH_ITERATIONS,
      getEdgeWeight: "weight",
      settings: { ...forceAtlas2.inferSettings(linkedGraph), barnesHutOptimize: linkedGraph.order > 500 },
    });
  }
  if (!books.some(placed)) turnAcross(linkedGraph);
  widen(linkedGraph, WIDEN);
  // ForceAtlas2 draws the whole graph about a little every run; the main connected part's placed Books
  // stay centred where they were (packing places the other groups beside it), so the halo keeps its place.
  const [main = []] = connectedGroups(linkedGraph.nodes(), connections);
  const anchors = main.filter((id) => kept.has(id));
  const shift = { x: 0, y: 0 };
  for (const id of anchors) {
    shift.x += (linkedGraph.getNodeAttribute(id, "x") - at.get(id)!.x) / anchors.length;
    shift.y += (linkedGraph.getNodeAttribute(id, "y") - at.get(id)!.y) / anchors.length;
  }
  linkedGraph.forEachNode((id, a) => g.mergeNodeAttributes(id, { x: a.x - shift.x, y: a.y - shift.y }));
  // Groups packed, then each placed Book held to MAX_DRIFT; a new connected Book moved to a spot with
  // room. Without a unit to measure by (a lone Book), placed Books stay put.
  const labels = new Map(books.map((r) => [r.book.id, labelOf(displayed(r.book, r.entry).title)]));
  const linked = books.filter((r) => g.degree(r.book.id) > 0);
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
  const settled = linked.filter(placed).map((r) => r.book.id);
  packGroups(g, labels);
  hold(settled);
  makeRoom(
    g,
    linked.map((r) => ({ id: r.book.id, label: labels.get(r.book.id)!, placed: placed(r) })),
  );
  // The halo around them; then apart where labels and names would still be drawn over each other, the
  // placed Books again held to MAX_DRIFT, so a crowded graph eases over a few runs; then the halo again,
  // around the connected Books where they end up.
  const clusters = await readClusters(db, userId, new Set(books.map((r) => r.book.id)));
  const similar = new Map<string, { id: string; similarity: number }[]>();
  for (const s of await similarities(db, userId, lone, linked.map((r) => r.book.id))) {
    similar.set(s.a, [...(similar.get(s.a) ?? []), { id: s.b, similarity: s.similarity }]);
  }
  const homes = new Map(lone.filter((id) => kept.has(id)).map((id) => [id, at.get(id)!]));
  lineUpHalo(g, labels, clusters, similar, homes);
  spread(g, labels, clusters);
  hold(settled);
  lineUpHalo(g, labels, clusters, similar, homes);
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
  // The area of the smallest view of the canvas's shape around them.
  const room = (boxes: Box[]) => {
    const b = union(boxes);
    const across = Math.max(b.x1 - b.x0 + unit, (b.y1 - b.y0 + unit) * ASPECT);
    return (across * across) / ASPECT;
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

// Turns the graph about the middle of its connected Books so their longest spread (their principal axis)
// lies across.
function turnAcross(g: Graph) {
  const ids = g.filterNodes((id) => g.degree(id) > 0);
  if (ids.length < 3) return;
  const pts = ids.map((id) => ({ x: g.getNodeAttribute(id, "x") as number, y: g.getNodeAttribute(id, "y") as number }));
  const mx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const my = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const [xx, yy, xy] = pts.reduce(([a, b, c], p) => [a + (p.x - mx) ** 2, b + (p.y - my) ** 2, c + (p.x - mx) * (p.y - my)], [0, 0, 0]);
  const angle = -Math.atan2(2 * xy, xx - yy) / 2;
  const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
  g.updateEachNodeAttributes((_, a) => ({ ...a, x: mx + (a.x - mx) * cos - (a.y - my) * sin, y: my + (a.x - mx) * sin + (a.y - my) * cos }));
}

// A number in [0, 1) from a Book's id and a salt: the same every layout.
function seeded(id: string, salt: number) {
  let h = 0x811c9dc5 ^ salt;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  return ((h ^ (h >>> 13)) >>> 0) / 2 ** 32;
}

// The convex hull of a set of points, counter-clockwise (Andrew's monotone chain).
function hull(points: Point[]): Point[] {
  const pts = [...points].sort((p, q) => p.x - q.x || p.y - q.y);
  if (pts.length < 3) return pts;
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (list: Point[]) => {
    const out: Point[] = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    return out.slice(0, -1);
  };
  return [...half(pts), ...half([...pts].reverse())];
}

// Whether a box and a convex polygon overlap: no axis (the box's two, each edge's normal) parts them.
function meetsHull(b: Box, poly: Point[]) {
  if (poly.length === 0) return false;
  const corners = [{ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }, { x: b.x1, y: b.y1 }, { x: b.x0, y: b.y1 }];
  if (Math.max(...poly.map((p) => p.x)) <= b.x0 || Math.min(...poly.map((p) => p.x)) >= b.x1) return false;
  if (Math.max(...poly.map((p) => p.y)) <= b.y0 || Math.min(...poly.map((p) => p.y)) >= b.y1) return false;
  for (let i = 0; i < poly.length; i++) {
    const [p, q] = [poly[i], poly[(i + 1) % poly.length]];
    const n = { x: q.y - p.y, y: p.x - q.x };
    const along = (c: Point) => n.x * c.x + n.y * c.y;
    const edge = along(p);
    if (Math.min(...corners.map(along)) >= edge) return false;
  }
  return true;
}

// Places each Book with no Connections in a halo around the connected ones: outside the hull of their
// dots, labels, washes and Cluster names (both sides a name may take), HALO_GAP wider, and clear of the
// halo Books placed before it, by id. Each takes the spot, toward its aim (see HALO_SIMILAR), that grows
// the fitted view least. A Book already in the halo keeps its `homes` spot, placed first, pushed straight
// out where the connected Books now reach it, unless that is more than HALO_LOOSENESS beyond the nearest
// spot with room in its direction. Labels are measured at HALO_SLACK of the smallest zoom the graph is
// fitted at on any DESKTOP canvas (the connected Books alone, at first), and placed again until it is
// fitted no smaller than that. With nothing connected, the Books gather the same way around the middle.
function lineUpHalo(
  g: Graph,
  labels: Map<string, string>,
  clusters: Drawn["clusters"],
  similar: Map<string, { id: string; similarity: number }[]>,
  homes: Map<string, Point>,
) {
  const lone = g.filterNodes((id) => g.degree(id) === 0).sort();
  if (lone.length === 0) return;
  const linked = g.filterNodes((id) => g.degree(id) > 0);
  const point = (id: string): Point => ({ x: g.getNodeAttribute(id, "x"), y: g.getNodeAttribute(id, "y") });
  const fitted = (only?: (id: string) => boolean) => {
    const unit = typicalLength(g);
    const d = drawnOf(g, labels, clusters, unit, only);
    return { unit, zoom: Math.min(...Object.values(DESKTOP).map((view) => fitDrawn(d, view).zoom)) };
  };
  let { unit, zoom } = fitted(linked.length ? (id) => g.degree(id) > 0 : undefined);
  for (let round = 0; round < HALO_ROUNDS; round++) {
    if (!(unit > 0) || !Number.isFinite(unit)) return;
    const planned = zoom * HALO_SLACK;
    place(unit, unit / (TYPICAL_EDGE_LENGTH * planned), clusterNameSize(planned));
    ({ unit, zoom } = fitted());
    if (zoom >= planned) return;
  }

  // One placing, `px` graph units to a pixel.
  function place(unit: number, px: number, nameSize: number) {
    const dotOf = (p: Point, degree: number): Box => grown({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }, nodeRadius(degree) * px);
    const labelBox = (p: Point, degree: number, text: string): Box => {
      const x0 = p.x + (nodeRadius(degree) + LABEL_GAP - LABEL_PLATE) * px;
      const h = (LABEL_SIZE * LABEL_LINE * px) / 2;
      return { x0, y0: p.y - h, x1: x0 + (textWidth(text, LABEL_SIZE) + 2 * LABEL_PLATE) * px, y1: p.y + h };
    };
    // What the halo keeps clear of, HALO_GAP wider: boxes, and washes as circles about their Books.
    const gap = HALO_GAP * unit;
    const boxes: Box[] = linked.flatMap((id) => [dotOf(point(id), g.degree(id)), labelBox(point(id), g.degree(id), labels.get(id)!)]);
    const pools: Point[] = [];
    const wash = WASH_RADIUS * unit;
    for (const c of clusters) {
      const pts = c.bookIds.filter((id) => g.hasNode(id) && g.degree(id) > 0).map(point);
      if (pts.length === 0) continue;
      pools.push(...pts);
      const { w, h } = nameBox(c.name, nameSize);
      const mid = pts.reduce((sum, p) => sum + p.x, 0) / pts.length;
      const reach = wash + CLUSTER_NAME_GAP * px;
      const top = Math.min(...pts.map((p) => p.y)) - reach;
      const bottom = Math.max(...pts.map((p) => p.y)) + reach;
      boxes.push({ x0: mid - (w / 2) * px, y0: top - h * px, x1: mid + (w / 2) * px, y1: top });
      boxes.push({ x0: mid - (w / 2) * px, y0: bottom, x1: mid + (w / 2) * px, y1: bottom + h * px });
    }
    // Circles become the polygons around them.
    const sides = 16;
    const out = (wash + gap) / Math.cos(Math.PI / sides);
    const keepOut = hull([
      ...boxes.flatMap((b) => {
        const w = grown(b, gap);
        return [{ x: w.x0, y: w.y0 }, { x: w.x1, y: w.y0 }, { x: w.x1, y: w.y1 }, { x: w.x0, y: w.y1 }];
      }),
      ...pools.flatMap((p) => Array.from({ length: sides }, (_, i) => ({ x: p.x + out * Math.cos((2 * Math.PI * i) / sides), y: p.y + out * Math.sin((2 * Math.PI * i) / sides) }))),
    ]);
    const centre = linked.length ? linked.map(point).reduce((p, q) => ({ x: p.x + q.x / linked.length, y: p.y + q.y / linked.length }), { x: 0, y: 0 }) : { x: 0, y: 0 };
    // The view needed around everything placed so far: the area of the smallest of the canvas's shape.
    const extent = [...boxes, ...pools.map((p) => grown({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }, wash))];
    const room = (extra: Box[]) => {
      const b = union([...extent, ...extra]);
      const across = Math.max(b.x1 - b.x0 + unit, (b.y1 - b.y0 + unit) * ASPECT);
      return (across * across) / ASPECT;
    };
    const taken: Box[] = [];
    const pad = HALO_PAD * px;
    const clear = (own: Box[]) => own.every((b) => !meetsHull(b, keepOut) && !taken.some((t) => overlaps(grown(b, pad), t)));
    const step = unit / 8;
    const far = 200 * unit;

    const own = (id: string, p: Point) => {
      const dot = grown(dotOf(p, 0), (LABEL_ROOM.spacing * unit) / 2 - nodeRadius(0) * px);
      return [dot, labelBox(p, 0, labels.get(id)!)];
    };
    // From the middle out along a direction, the first spot where the Book has room, or null.
    const nearest = (id: string, cos: number, sin: number) => {
      const at = (r: number) => ({ x: centre.x + cos * r, y: centre.y + sin * r });
      for (let r = 0; r < far; r += step) if (clear(own(id, at(r)))) return r;
      return null;
    };
    // A Book's spot in the halo as it stands: where it is, or pushed out to the nearest spot with room
    // in the same direction; null if that is more than HALO_LOOSENESS short of where it is.
    const home = (id: string): Point | null => {
      const p = homes.get(id);
      const r = p ? Math.hypot(p.x - centre.x, p.y - centre.y) : 0;
      if (!p || r === 0) return null;
      const [cos, sin] = [(p.x - centre.x) / r, (p.y - centre.y) / r];
      const first = nearest(id, cos, sin);
      if (first === null || r > first + HALO_LOOSENESS * unit + step) return null;
      return r >= first && clear(own(id, p)) ? p : { x: centre.x + cos * first, y: centre.y + sin * first };
    };
    const search: string[] = [];
    for (const id of lone) {
      const p = home(id);
      if (!p) {
        search.push(id);
        continue;
      }
      g.mergeNodeAttributes(id, p);
      taken.push(...own(id, p));
    }

    for (const id of search) {
      const near = (similar.get(id) ?? [])
        .filter((s) => g.hasNode(s.id) && g.degree(s.id) > 0 && s.similarity > 0)
        .sort((p, q) => q.similarity - p.similarity || (p.id < q.id ? -1 : 1))
        .slice(0, HALO_SIMILAR);
      const weight = near.reduce((sum, s) => sum + s.similarity, 0);
      const toward = near.length
        ? Math.atan2(near.reduce((sum, s) => sum + point(s.id).y * s.similarity, 0) / weight - centre.y, near.reduce((sum, s) => sum + point(s.id).x * s.similarity, 0) / weight - centre.x)
        : seeded(id, 1) * 2 * Math.PI;
      const aim = toward + (seeded(id, 2) * 2 - 1) * HALO_SCATTER;
      const loose = seeded(id, 3) * HALO_LOOSENESS * unit;
      let best: { at: Point; cost: number } | null = null;
      const base = room(taken);
      for (let k = 0; k < HALO_ANGLES; k++) {
        const turn = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * ((2 * Math.PI) / HALO_ANGLES);
        const [cos, sin] = [Math.cos(aim + turn), Math.sin(aim + turn)];
        const at = (r: number) => ({ x: centre.x + cos * r, y: centre.y + sin * r });
        let r = nearest(id, cos, sin);
        if (r === null) continue;
        if (clear(own(id, at(r + loose)))) r += loose;
        const cost = room([...taken, ...own(id, at(r))]) / base - 1 + (HALO_PULL * Math.abs(turn)) / Math.PI;
        if (best === null || cost < best.cost) best = { at: at(r), cost };
      }
      if (!best) continue;
      g.mergeNodeAttributes(id, best.at);
      taken.push(...own(id, best.at));
    }
  }
}

// Moves Books apart, a round at a time, until on each DESKTOP canvas, fitted, no label is drawn over another
// label or dot and no Cluster name over a label or another name (readDrawn): each such pair across or
// down, whichever parts them sooner, half each way, a name with its Cluster's Books. Parting them can
// shrink the fitted zoom, and so grow the labels against the graph, so it gives up after SPREAD_ROUNDS.
// The graph as the canvas would draw it: all of it, or only the Books for which `only` holds.
const drawnOf = (g: Graph, labels: Map<string, string>, clusters: Drawn["clusters"], unit: number, only = (_: string) => true): Drawn => ({
  books: g.filterNodes(only).map((id) => ({ id, x: g.getNodeAttribute(id, "x") as number, y: g.getNodeAttribute(id, "y") as number, label: labels.get(id)!, degree: g.degree(id) })),
  clusters: clusters.map((c) => ({ ...c, bookIds: c.bookIds.filter((id) => g.hasNode(id) && only(id)) })),
  unit,
});

function spread(g: Graph, labels: Map<string, string>, clusters: Drawn["clusters"]) {
  const members = new Map(clusters.map((c) => [c.id, c.bookIds.filter((id) => g.hasNode(id))]));
  const owners = (o: Clash["a"]) => ("book" in o ? [o.book] : members.get(o.cluster)!);
  for (let round = 0; round < SPREAD_ROUNDS; round++) {
    const unit = typicalLength(g);
    if (!(unit > 0) || !Number.isFinite(unit)) return;
    // Each clash on the canvas where it is worst, in graph units.
    const d = drawnOf(g, labels, clusters, unit);
    const clashes = Object.values(DESKTOP).flatMap((view) => {
      const r = readDrawn(d, view);
      const perPixel = unit / (TYPICAL_EDGE_LENGTH * r.zoom);
      return r.clashes.map((c) => ({ ...c, across: c.across * perPixel, down: c.down * perPixel, pad: perPixel }));
    });
    if (clashes.length === 0) return;
    const moves = new Map<string, Point>();
    for (const c of clashes) {
      const [a, b] = [owners(c.a), owners(c.b)];
      if (a.some((id) => b.includes(id))) continue;
      const across = c.across < c.down;
      const step = (((across ? c.across : c.down) + c.pad) / 2) * (c.aFirst[across ? "x" : "y"] ? -1 : 1);
      for (const [ids, by] of [[a, step], [b, -step]] as const) {
        for (const id of ids) {
          const m = moves.get(id) ?? { x: 0, y: 0 };
          moves.set(id, across ? { x: m.x + by, y: m.y } : { x: m.x, y: m.y + by });
        }
      }
    }
    if (moves.size === 0) return;
    for (const [id, m] of moves) g.mergeNodeAttributes(id, { x: g.getNodeAttribute(id, "x") + m.x, y: g.getNodeAttribute(id, "y") + m.y });
  }
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
