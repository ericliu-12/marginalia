import {
  CLUSTER_NAME_CLEAR,
  CLUSTER_NAME_GAP,
  CLUSTER_NAME_PAD,
  clusterNameSize,
  EDGE_CLEARANCE,
  FIT_MARGIN,
  HALO_GAP,
  LABEL_GAP,
  LABEL_LINE,
  LABEL_PLATE,
  LABEL_SIZE,
  MAX_FIT_ZOOM,
  nodeRadius,
  PARALLEL_MIN,
  TYPICAL_EDGE_LENGTH,
  WASH_RADIUS,
} from "./graph-drawing";

// How the canvas first frames a graph, and how it then reads: worked out from positions and text alone,
// so the canvas, the worker's layout and `pnpm graph:layout --dry-run` agree.

// Newsreader's advance widths, in ems, for the printable ASCII characters (space to tilde), measured in
// Chromium at the sizes drawn: upright 500 at 13px (Book labels), italic 500 at 16px (Cluster names).
// Kerning moves a title's width by well under 1%.
const UPRIGHT = [
  0.235, 0.294, 0.393, 0.614, 0.614, 0.836, 0.763, 0.219, 0.312, 0.312, 0.444, 0.529, 0.259, 0.376, 0.254, 0.42, 0.614, 0.614, 0.614, 0.614, 0.614, 0.614, 0.614, 0.614,
  0.614, 0.614, 0.277, 0.288, 0.529, 0.529, 0.529, 0.511, 0.913, 0.769, 0.695, 0.733, 0.798, 0.688, 0.639, 0.789, 0.849, 0.379, 0.499, 0.784, 0.648, 1.04, 0.81, 0.805,
  0.66, 0.805, 0.71, 0.603, 0.717, 0.804, 0.749, 1.045, 0.778, 0.734, 0.666, 0.35, 0.42, 0.351, 0.529, 0.411, 0.5, 0.516, 0.593, 0.482, 0.605, 0.505, 0.393, 0.539,
  0.612, 0.313, 0.282, 0.599, 0.3, 0.905, 0.625, 0.567, 0.61, 0.59, 0.439, 0.443, 0.392, 0.593, 0.582, 0.807, 0.559, 0.575, 0.48, 0.345, 0.267, 0.345, 0.529,
];
const ITALIC = [
  0.228, 0.274, 0.363, 0.587, 0.587, 0.829, 0.698, 0.197, 0.282, 0.282, 0.432, 0.517, 0.238, 0.347, 0.233, 0.408, 0.587, 0.587, 0.587, 0.587, 0.587, 0.587, 0.587, 0.654,
  0.587, 0.587, 0.262, 0.27, 0.517, 0.517, 0.517, 0.466, 0.909, 0.697, 0.644, 0.688, 0.75, 0.637, 0.586, 0.741, 0.786, 0.346, 0.438, 0.715, 0.586, 0.96, 0.745, 0.76,
  0.608, 0.758, 0.654, 0.553, 0.648, 0.744, 0.678, 0.948, 0.697, 0.67, 0.621, 0.318, 0.379, 0.319, 0.517, 0.391, 0.5, 0.519, 0.487, 0.396, 0.52, 0.416, 0.327, 0.441,
  0.521, 0.301, 0.273, 0.504, 0.278, 0.798, 0.563, 0.47, 0.533, 0.488, 0.422, 0.363, 0.337, 0.54, 0.491, 0.7, 0.503, 0.492, 0.434, 0.315, 0.248, 0.315, 0.517,
];
// Anything else (an ellipsis, an accented letter) is taken as a wide letter.
const OTHER = 0.7;

// A line of text's width in pixels, in Newsreader at `size`.
export function textWidth(text: string, size: number, italic = false) {
  const widths = italic ? ITALIC : UPRIGHT;
  let em = 0;
  for (const ch of text) em += widths[ch.charCodeAt(0) - 32] ?? OTHER;
  return em * size;
}

// A graph's typical Connection length, the unit it is drawn at: the median Connection, or with none the
// median distance from a Book to its nearest other; 0 for a lone Book.
export function typicalLength(books: { bookId: string; x: number; y: number }[], connections: { a: string; b: string }[]) {
  const at = new Map(books.map((b) => [b.bookId, b]));
  const apart = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.hypot(p.x - q.x, p.y - q.y);
  const lengths = (connections.length ? connections.map((c) => apart(at.get(c.a)!, at.get(c.b)!)) : books.map((b) => Math.min(...books.filter((o) => o !== b).map((o) => apart(b, o)))))
    .filter((x) => x > 0 && Number.isFinite(x))
    .sort((p, q) => p - q);
  return lengths.length ? lengths[Math.floor(lengths.length / 2)] : 0;
}

export type Box = { x0: number; y0: number; x1: number; y1: number };
const overlaps = (p: Box, q: Box) => p.x0 < q.x1 && q.x0 < p.x1 && p.y0 < q.y1 && q.y0 < p.y1;

// Something the fit must show: a box in graph units, and pixels it reaches beyond that box on screen
// whatever the zoom (a label beside a dot, a name past a wash).
export type Extent = Box & { left: number; right: number; up: number; down: number };
// A canvas's size, and the room its first view keeps at its edges: FIT_MARGIN, unless the phone gives
// its own, measured from its header and legend.
export type View = { width: number; height: number; margin?: { top: number; bottom: number; side: number } };
// Which side bounds the fitted zoom: the canvas's width, its height, or MAX_FIT_ZOOM.
export type FitLimit = "width" | "height" | "max";
export type Fit = { zoom: number; x: number; y: number; limit: FitLimit };

// The largest zoom, up to `max`, at which every extent fits the view within its margin, and the graph point to centre on so they sit in the middle of the room left.
export function fitView(extents: Extent[], view: View, max = MAX_FIT_ZOOM): Fit {
  const margin = view.margin ?? FIT_MARGIN;
  const room = { x: view.width - 2 * margin.side, y: view.height - margin.top - margin.bottom };
  // From the screen's left (or top) edge of the extents to their right (or bottom), at zoom k.
  const span = (k: number, axis: "x" | "y") => {
    const [lo, hi] = axis === "x" ? [Math.min(...extents.map((e) => k * e.x0 - e.left)), Math.max(...extents.map((e) => k * e.x1 + e.right))] : [Math.min(...extents.map((e) => k * e.y0 - e.up)), Math.max(...extents.map((e) => k * e.y1 + e.down))];
    return { lo, hi };
  };
  const fits = (k: number) => (["x", "y"] as const).every((a) => span(k, a).hi - span(k, a).lo <= room[a]);
  let zoom = max;
  let limit: FitLimit = "max";
  if (!fits(max)) {
    // Each span grows with the zoom, so the largest that fits is found by halving.
    let [lo, hi] = [0, max];
    for (let i = 0; i < 40; i++) [lo, hi] = fits((lo + hi) / 2) ? [(lo + hi) / 2, hi] : [lo, (lo + hi) / 2];
    zoom = Math.max(lo, 1e-6);
    const over = (a: "x" | "y") => (span(hi, a).hi - span(hi, a).lo) / room[a];
    limit = over("x") >= over("y") ? "width" : "height";
  }
  // Graph point x shows at zoom·(x − centre) + width/2; the spans' middle goes to the middle of the room.
  const centre = (a: "x" | "y") => {
    const s = span(zoom, a);
    const mid = a === "x" ? view.width / 2 : margin.top + room.y / 2;
    const half = a === "x" ? view.width / 2 : view.height / 2;
    return ((s.lo + s.hi) / 2 - mid + half) / zoom;
  };
  return { zoom, x: centre("x"), y: centre("y"), limit };
}

// A graph as the canvas draws it at rest: each Book's dot and label, each Cluster's wash and name, and
// the Connections shown at rest. Positions are in any units; `unit` is the typical Connection length in
// them, drawn TYPICAL_EDGE_LENGTH pixels long at zoom 1.
export type Drawn = {
  books: { id: string; x: number; y: number; label: string; degree: number }[];
  clusters: { id: string; bookIds: string[]; name: string }[];
  connections?: { a: string; b: string }[];
  unit: number;
};

// Whether the line from p to q passes through box b.
export function crossesBox(b: Box, p: { x: number; y: number }, q: { x: number; y: number }) {
  if (Math.max(p.x, q.x) < b.x0 || Math.min(p.x, q.x) > b.x1 || Math.max(p.y, q.y) < b.y0 || Math.min(p.y, q.y) > b.y1) return false;
  let [t0, t1] = [0, 1];
  const [dx, dy] = [q.x - p.x, q.y - p.y];
  for (const [num, den] of [
    [p.x - b.x0, -dx],
    [b.x1 - p.x, dx],
    [p.y - b.y0, -dy],
    [b.y1 - p.y, dy],
  ]) {
    if (den === 0) {
      if (num < 0) return false;
      continue;
    }
    const t = num / den;
    if (den < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
}

// Things filed by the coarse cells of the screen their boxes cover, so a check looks only at its
// neighbours: those whose boxes share a cell with `b`, each once.
function filed<T>(boxOf: (item: T) => Box, items: T[] = []) {
  const CELL = 64;
  const cells = new Map<number, T[]>();
  const each = (b: Box, f: (key: number) => void) => {
    for (let i = Math.floor(b.x0 / CELL); i <= Math.floor(b.x1 / CELL); i++) for (let j = Math.floor(b.y0 / CELL); j <= Math.floor(b.y1 / CELL); j++) f(i * 1_000_003 + j);
  };
  const add = (item: T) =>
    each(boxOf(item), (k) => {
      const cell = cells.get(k);
      if (cell) cell.push(item);
      else cells.set(k, [item]);
    });
  items.forEach(add);
  const near = (b: Box) => {
    const out = new Set<T>();
    each(b, (k) => cells.get(k)?.forEach((item) => out.add(item)));
    return out;
  };
  return { add, near };
}

// How far point c is from the line from p to q, and the nearest point of it.
function toSegment(c: { x: number; y: number }, p: { x: number; y: number }, q: { x: number; y: number }) {
  const [dx, dy] = [q.x - p.x, q.y - p.y];
  const t = Math.max(0, Math.min(1, ((c.x - p.x) * dx + (c.y - p.y) * dy) / (dx * dx + dy * dy || 1)));
  const at = { x: p.x + t * dx, y: p.y + t * dy };
  return { distance: Math.hypot(c.x - at.x, c.y - at.y), at };
}

// The four places a label may take beside a dot of radius r at (x, y), in the order tried: right, left,
// above, below, each `gap` from the dot's middle (its plate reaching `plate` back toward it beside the
// dot), `w` by `h`.
export function labelSides(x: number, y: number, gap: number, plate: number, w: number, h: number): Box[] {
  const beside = gap - plate;
  return [
    { x0: x + beside, y0: y - h / 2, x1: x + beside + w, y1: y + h / 2 },
    { x0: x - beside - w, y0: y - h / 2, x1: x - beside, y1: y + h / 2 },
    { x0: x - w / 2, y0: y - gap - h, x1: x + w / 2, y1: y - gap },
    { x0: x - w / 2, y0: y + gap, x1: x + w / 2, y1: y + gap + h },
  ];
}

const LABEL_HEIGHT = LABEL_SIZE * LABEL_LINE;
// A Cluster name's box: its italic line on a padded plate (as the canvas's name button).
export const nameBox = (name: string, size: number) => ({ w: textWidth(name, size, true) + 2 * CLUSTER_NAME_PAD.x, h: size * 1.25 + 2 * CLUSTER_NAME_PAD.y });

// What the fit must show, in graph units of TYPICAL_EDGE_LENGTH to a Connection: every Book with its
// label to the right (or on the side `sides` gives it, by index into labelSides), and every Cluster's wash with its name above it, within CLUSTER_NAME_CLEAR (a name
// goes below only where that is as clear; see readDrawn).
export function drawnExtents(d: Drawn, nameSize = CLUSTER_NAME_SIZE_MAX, sides = new Map<string, number>()): Extent[] {
  const scale = TYPICAL_EDGE_LENGTH / d.unit;
  const at = new Map(d.books.map((b) => [b.id, { x: b.x * scale, y: b.y * scale }]));
  const extents: Extent[] = d.books.map((b) => {
    const r = nodeRadius(b.degree);
    const { x, y } = at.get(b.id)!;
    const reach = r + LABEL_GAP + textWidth(b.label, LABEL_SIZE) + LABEL_PLATE;
    const across = Math.max(r, textWidth(b.label, LABEL_SIZE) / 2 + LABEL_PLATE);
    const level = Math.max(r, LABEL_HEIGHT / 2);
    const side = sides.get(b.id) ?? 0;
    // Its label to the right of its dot, unless `sides` puts it left (1), above (2) or below (3).
    const [left, right, up, down] =
      side === 1 ? [reach, r, level, level]
      : side === 2 ? [across, across, r + LABEL_GAP + LABEL_HEIGHT, r]
      : side === 3 ? [across, across, r, r + LABEL_GAP + LABEL_HEIGHT]
      : [r, reach, level, level];
    return { x0: x, x1: x, y0: y, y1: y, left, right, up, down };
  });
  const wash = WASH_RADIUS * TYPICAL_EDGE_LENGTH;
  for (const c of d.clusters) {
    const pts = c.bookIds.map((id) => at.get(id)).filter((p) => p !== undefined);
    if (pts.length === 0) continue;
    const box = { x0: Math.min(...pts.map((p) => p.x)) - wash, x1: Math.max(...pts.map((p) => p.x)) + wash, y0: Math.min(...pts.map((p) => p.y)) - wash, y1: Math.max(...pts.map((p) => p.y)) + wash };
    const { w, h } = nameBox(c.name, nameSize);
    const mid = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    extents.push({ ...box, left: 0, right: 0, up: 0, down: 0 });
    const side = Math.max(0, CLUSTER_NAME_CLEAR.side - FIT_MARGIN.side) + w / 2;
    extents.push({ x0: mid, x1: mid, y0: box.y0, y1: box.y0, left: side, right: side, up: CLUSTER_NAME_GAP + h + CLUSTER_NAME_CLEAR.top - FIT_MARGIN.top, down: 0 });
  }
  return extents;
}
const CLUSTER_NAME_SIZE_MAX = clusterNameSize(Infinity);

// Where the canvas first frames the graph: fitted with the names at the largest size they can take, then
// again at the size they take at that zoom, then again with each label on the side readDrawn gives it.
export function fitDrawn(d: Drawn, view: View, sides = true): Fit {
  const first = fitView(drawnExtents(d), view);
  const size = clusterNameSize(first.zoom);
  const second = fitView(drawnExtents(d, size), view);
  // Then again with each label on the side it takes there, unless `sides` is false (a quicker, slightly
  // rougher fit, for the many readings the layout takes as it spreads Books apart).
  return sides ? fitView(drawnExtents(d, size, readDrawn(d, view, second).sides), view) : second;
}

// Two things drawn over each other, which spreading the Books apart would part: Books by id, Clusters
// (their names) by id; and by how many pixels they overlap across and down.
export type Clash = { a: { book: string } | { cluster: string }; b: { book: string } | { cluster: string }; across: number; down: number; aFirst: { x: boolean; y: boolean } };
// A move that would ease a Connection that runs near a Book, lies along another, or crosses a label: these
// Books, by this many pixels across and down.
export type Push = { ids: string[]; dx: number; dy: number };

// How the graph reads in `view` once fitted: the zoom and what bounds it, the share of the canvas the
// box around the Books' dots fills, and what is drawn over what. Each label takes the first side of its
// dot (right, left, above, below) clear of other dots, labels placed before it (most connected Books
// first), Cluster names and the Connections shown at rest, or failing that the side over fewest of them,
// at its real size: pairs of Books where a label covers the other's label or dot, and of those, where it
// covers a dot; labels crossed by a Connection, pair by pair; Connections passing within EDGE_CLEARANCE
// dot-widths of a Book not at either end; pairs of Connections from one Book nearer than PARALLEL_MIN; names (each above its Cluster, or below where that is as
// clear of the canvas edges and covers fewer labels, kept clear of the edges as the canvas keeps them)
// over a label or another name; and names nearer their own wash than half of CLUSTER_NAME_GAP. And the
// halo, the Books with no Connections around a graph that has some: how many have their dot or label
// over a wash, or over a Cluster name, or nearer than HALO_GAP to a connected Book's dot, label or
// wash, or to a name.
export type Reading = {
  zoom: number;
  limit: FitLimit;
  filled: number;
  labelOverlaps: number;
  dotOverlaps: number;
  nameOverlaps: number;
  namesOnWash: number;
  halo: { onWash: number; onName: number; near: number };
  labelEdgeCrossings: number;
  edgesNearBooks: number;
  parallelEdges: number;
  clashes: Clash[];
  pushes: Push[];
  // Each Book's label side, by index into labelSides.
  sides: Map<string, number>;
};

export function readDrawn(d: Drawn, view: View, fit = fitDrawn(d, view)): Reading {
  const screen = new Map(d.books.map((b) => [b.id, { x: (b.x * TYPICAL_EDGE_LENGTH) / d.unit, y: (b.y * TYPICAL_EDGE_LENGTH) / d.unit }]));
  for (const [id, p] of screen) screen.set(id, { x: fit.zoom * (p.x - fit.x) + view.width / 2, y: fit.zoom * (p.y - fit.y) + view.height / 2 });

  const books = d.books.map((b) => {
    const { x, y } = screen.get(b.id)!;
    const r = nodeRadius(b.degree);
    const sides = labelSides(x, y, r + LABEL_GAP, LABEL_PLATE, textWidth(b.label, LABEL_SIZE) + 2 * LABEL_PLATE, LABEL_HEIGHT);
    return { id: b.id, x, y, r, degree: b.degree, dot: { x0: x - r, y0: y - r, x1: x + r, y1: y + r }, sides, label: sides[0] };
  });
  const byId = new Map(books.map((b) => [b.id, b]));
  const lines = (d.connections ?? []).filter((c) => byId.has(c.a) && byId.has(c.b)).map((c) => ({ a: c.a, b: c.b, p: byId.get(c.a)!, q: byId.get(c.b)! }));
  const span = (l: (typeof lines)[number]) => ({ x0: Math.min(l.p.x, l.q.x), y0: Math.min(l.p.y, l.q.y), x1: Math.max(l.p.x, l.q.x), y1: Math.max(l.p.y, l.q.y) });
  const dotsNear = filed((b: (typeof books)[number]) => b.dot, books);
  const linesNear = filed(span, lines);
  // Each label to its side, most connected Books first, among `names`.
  const order = [...books].sort((p, q) => q.degree - p.degree || (p.id < q.id ? -1 : 1));
  const chooseLabels = (names: Box[]) => {
    const placed = filed((b: Box) => b);
    for (const b of order) {
      const cost = (box: Box) => {
        let over = 0;
        let crossed = 0;
        for (const o of dotsNear.near(box)) if (o !== b && overlaps(box, o.dot)) over++;
        for (const o of placed.near(box)) if (overlaps(box, o)) over++;
        for (const n of names) if (overlaps(box, n)) over++;
        for (const l of linesNear.near(box)) if (crossesBox(box, l.p, l.q)) crossed++;
        return [over, crossed];
      };
      let best = 0;
      let least = cost(b.sides[0]);
      for (let i = 1; i < b.sides.length && (least[0] > 0 || least[1] > 0); i++) {
        const c = cost(b.sides[i]);
        if (c[0] < least[0] || (c[0] === least[0] && c[1] < least[1])) [best, least] = [i, c];
      }
      b.label = b.sides[best];
      placed.add(b.label);
    }
  };
  chooseLabels([]);
  const clashes: Clash[] = [];
  const clash = (a: Clash["a"], p: Box, b: Clash["b"], q: Box) => {
    const across = Math.min(p.x1, q.x1) - Math.max(p.x0, q.x0);
    const down = Math.min(p.y1, q.y1) - Math.max(p.y0, q.y0);
    clashes.push({ a, b, across, down, aFirst: { x: p.x0 + p.x1 < q.x0 + q.x1, y: p.y0 + p.y1 < q.y0 + q.y1 } });
  };
  const wash = WASH_RADIUS * TYPICAL_EDGE_LENGTH * fit.zoom;
  const size = clusterNameSize(fit.zoom);
  const names: { id: string; box: Box }[] = [];
  let namesOnWash = 0;
  for (const c of d.clusters) {
    const pts = c.bookIds.map((id) => byId.get(id)).filter((b) => b !== undefined);
    if (pts.length === 0) continue;
    const { w, h } = nameBox(c.name, size);
    const x = Math.min(view.width - CLUSTER_NAME_CLEAR.side - w / 2, Math.max(CLUSTER_NAME_CLEAR.side + w / 2, pts.reduce((s, p) => s + p.x, 0) / pts.length));
    const at = (cy: number) => {
      const y = Math.min(view.height - CLUSTER_NAME_CLEAR.bottom - h / 2, Math.max(CLUSTER_NAME_CLEAR.top + h / 2, cy));
      return { x0: x - w / 2, y0: y - h / 2, x1: x + w / 2, y1: y + h / 2, held: y !== cy };
    };
    const above = at(Math.min(...pts.map((p) => p.y)) - wash - CLUSTER_NAME_GAP - h / 2);
    const below = at(Math.max(...pts.map((p) => p.y)) + wash + CLUSTER_NAME_GAP + h / 2);
    const crossed = (b: Box) => books.filter((o) => overlaps(b, o.label)).length;
    const box = below.held !== above.held ? (below.held ? above : below) : crossed(below) < crossed(above) ? below : above;
    names.push({ id: c.id, box });
    // Nearest a name comes to the middle of any of its Cluster's pools.
    const nearest = Math.min(...pts.map((p) => Math.hypot(Math.max(box.x0 - p.x, 0, p.x - box.x1), Math.max(box.y0 - p.y, 0, p.y - box.y1))));
    if (nearest < wash + CLUSTER_NAME_GAP / 2) namesOnWash++;
  }
  // The labels again, now clear of the names, as the canvas places them.
  chooseLabels(names.map((n) => n.box));
  let labelOverlaps = 0;
  let dotOverlaps = 0;
  books.forEach((p, i) => {
    for (const q of books.slice(i + 1)) {
      const hit = [
        [p.label, q.label],
        [p.label, q.dot],
        [p.dot, q.label],
      ].find(([s, t]) => overlaps(s, t));
      if (!hit) continue;
      labelOverlaps++;
      if (overlaps(p.label, q.dot) || overlaps(p.dot, q.label)) dotOverlaps++;
      clash({ book: p.id }, hit[0], { book: q.id }, hit[1]);
    }
  });

  let nameOverlaps = 0;
  names.forEach((n, i) => {
    for (const b of books) {
      if (!overlaps(n.box, b.label)) continue;
      nameOverlaps++;
      clash({ cluster: n.id }, n.box, { book: b.id }, b.label);
    }
    for (const o of names.slice(i + 1)) {
      if (!overlaps(n.box, o.box)) continue;
      nameOverlaps++;
      clash({ cluster: n.id }, n.box, { cluster: o.id }, o.box);
    }
  });

  const connected = books.filter((b) => b.degree > 0);
  const pools = d.clusters.flatMap((c) => c.bookIds.map((id) => byId.get(id)).filter((b) => b !== undefined));
  const gap = HALO_GAP;
  const toPoint = (b: Box, p: { x: number; y: number }) => Math.hypot(Math.max(b.x0 - p.x, 0, p.x - b.x1), Math.max(b.y0 - p.y, 0, p.y - b.y1));
  const halo = { onWash: 0, onName: 0, near: 0 };
  for (const h of connected.length ? books.filter((b) => b.degree === 0) : []) {
    const own = [h.dot, h.label];
    const wide = own.map((b) => ({ x0: b.x0 - gap, y0: b.y0 - gap, x1: b.x1 + gap, y1: b.y1 + gap }));
    if (own.some((b) => pools.some((p) => toPoint(b, p) < wash))) halo.onWash++;
    if (own.some((b) => names.some((n) => overlaps(b, n.box)))) halo.onName++;
    if (
      wide.some((b) => connected.some((c) => overlaps(b, c.dot) || overlaps(b, c.label)) || names.some((n) => overlaps(b, n.box))) ||
      own.some((b) => pools.some((p) => toPoint(b, p) < wash + gap))
    )
      halo.near++;
  }

  // The Connections: through labels, past other Books, along each other. Each, with the move that would
  // ease it, half on each side.
  const pushes: Push[] = [];
  const away = (ids: string[], from: { x: number; y: number }, to: { x: number; y: number }, by: number, back: string[]) => {
    const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    const [ux, uy] = [(to.x - from.x) / len, (to.y - from.y) / len];
    pushes.push({ ids, dx: (ux * by) / 2, dy: (uy * by) / 2 }, { ids: back, dx: (-ux * by) / 2, dy: (-uy * by) / 2 });
  };
  let labelEdgeCrossings = 0;
  for (const b of books) {
    for (const l of linesNear.near(b.label)) {
      if (!crossesBox(b.label, l.p, l.q)) continue;
      labelEdgeCrossings++;
      const mid = { x: (b.label.x0 + b.label.x1) / 2, y: (b.label.y0 + b.label.y1) / 2 };
      const { distance, at } = toSegment(mid, l.p, l.q);
      const reach = Math.hypot(b.label.x1 - b.label.x0, b.label.y1 - b.label.y0) / 2;
      const off = distance > 0.5 ? mid : { x: at.x - (l.q.y - l.p.y), y: at.y + (l.q.x - l.p.x) };
      // Its own Connection is left to the choice of side: turning it aside unsettles the layout.
      if (l.a === b.id || l.b === b.id) continue;
      // Another's: the Book moves off the line by as far as its label reaches across it.
      away([b.id], at, off, reach - distance + 2, [l.a, l.b]);
    }
  }
  let edgesNearBooks = 0;
  const reachOff = EDGE_CLEARANCE * 2 * Math.max(0, ...books.map((b) => b.r));
  for (const l of lines) {
    const b = span(l);
    for (const c of dotsNear.near({ x0: b.x0 - reachOff, y0: b.y0 - reachOff, x1: b.x1 + reachOff, y1: b.y1 + reachOff })) {
      if (c.id === l.a || c.id === l.b) continue;
      const clearance = EDGE_CLEARANCE * 2 * c.r;
      const { distance, at } = toSegment(c, l.p, l.q);
      if (distance >= clearance) continue;
      edgesNearBooks++;
      away([c.id], at, distance > 0.5 ? c : { x: at.x - (l.q.y - l.p.y), y: at.y + (l.q.x - l.p.x) }, clearance - distance + 1, [l.a, l.b]);
    }
  }
  let parallelEdges = 0;
  const ends = new Map<string, (typeof books)[number][]>();
  for (const l of lines) {
    ends.set(l.a, [...(ends.get(l.a) ?? []), l.q]);
    ends.set(l.b, [...(ends.get(l.b) ?? []), l.p]);
  }
  for (const s of books) {
    const own = ends.get(s.id) ?? [];
    own.forEach((o, i) => {
      for (const t of own.slice(i + 1)) {
        const turn = Math.abs(Math.atan2(Math.sin(Math.atan2(o.y - s.y, o.x - s.x) - Math.atan2(t.y - s.y, t.x - s.x)), Math.cos(Math.atan2(o.y - s.y, o.x - s.x) - Math.atan2(t.y - s.y, t.x - s.x))));
        if (turn >= PARALLEL_MIN) continue;
        parallelEdges++;
        // The nearer end moves off the other's line, sideways, by the arc it lacks.
        const [near, other] = Math.hypot(o.x - s.x, o.y - s.y) < Math.hypot(t.x - s.x, t.y - s.y) ? [o, t] : [t, o];
        const { at } = toSegment(near, s, other);
        const side = Math.hypot(near.x - at.x, near.y - at.y) > 0.5 ? near : { x: at.x - (other.y - s.y), y: at.y + (other.x - s.x) };
        away([near.id], at, side, (PARALLEL_MIN - turn) * Math.hypot(near.x - s.x, near.y - s.y) + 1, [other.id]);
      }
    });
  }

  const xs = books.map((b) => b.x);
  const ys = books.map((b) => b.y);
  const filled = books.length ? ((Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys))) / (view.width * view.height) : 0;
  return { zoom: fit.zoom, limit: fit.limit, filled, labelOverlaps, dotOverlaps, nameOverlaps, namesOnWash, halo, labelEdgeCrossings, edgesNearBooks, parallelEdges, clashes, pushes, sides: new Map(books.map((b) => [b.id, b.sides.indexOf(b.label)])) };
}
