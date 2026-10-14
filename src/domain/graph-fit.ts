import {
  CLUSTER_NAME_CLEAR,
  CLUSTER_NAME_GAP,
  CLUSTER_NAME_PAD,
  clusterNameSize,
  FIT_MARGIN,
  LABEL_GAP,
  LABEL_LINE,
  LABEL_PLATE,
  LABEL_SIZE,
  MAX_FIT_ZOOM,
  nodeRadius,
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
export type View = { width: number; height: number };
// Which side bounds the fitted zoom: the canvas's width, its height, or MAX_FIT_ZOOM.
export type FitLimit = "width" | "height" | "max";
export type Fit = { zoom: number; x: number; y: number; limit: FitLimit };

// The largest zoom, up to `max`, at which every extent fits the view within FIT_MARGIN, and the graph
// point to centre on so they sit in the middle of the room left.
export function fitView(extents: Extent[], view: View, max = MAX_FIT_ZOOM): Fit {
  const room = { x: view.width - 2 * FIT_MARGIN.side, y: view.height - FIT_MARGIN.top - FIT_MARGIN.bottom };
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
    const mid = a === "x" ? view.width / 2 : FIT_MARGIN.top + room.y / 2;
    const half = a === "x" ? view.width / 2 : view.height / 2;
    return ((s.lo + s.hi) / 2 - mid + half) / zoom;
  };
  return { zoom, x: centre("x"), y: centre("y"), limit };
}

// A graph as the canvas draws it at rest: each Book's dot and label, each Cluster's wash and name.
// Positions are in any units; `unit` is the typical Connection length in them, drawn TYPICAL_EDGE_LENGTH
// pixels long at zoom 1.
export type Drawn = {
  books: { id: string; x: number; y: number; label: string; degree: number }[];
  clusters: { id: string; bookIds: string[]; name: string }[];
  unit: number;
};

const LABEL_HEIGHT = LABEL_SIZE * LABEL_LINE;
// A Cluster name's box: its italic line on a padded plate (as the canvas's name button).
export const nameBox = (name: string, size: number) => ({ w: textWidth(name, size, true) + 2 * CLUSTER_NAME_PAD.x, h: size * 1.25 + 2 * CLUSTER_NAME_PAD.y });

// What the fit must show, in graph units of TYPICAL_EDGE_LENGTH to a Connection: every Book with its
// label to the right, and every Cluster's wash with its name above it, within CLUSTER_NAME_CLEAR (a name
// goes below only where that is as clear; see readDrawn).
export function drawnExtents(d: Drawn, nameSize = CLUSTER_NAME_SIZE_MAX): Extent[] {
  const scale = TYPICAL_EDGE_LENGTH / d.unit;
  const at = new Map(d.books.map((b) => [b.id, { x: b.x * scale, y: b.y * scale }]));
  const extents: Extent[] = d.books.map((b) => {
    const r = nodeRadius(b.degree);
    const { x, y } = at.get(b.id)!;
    return { x0: x, x1: x, y0: y, y1: y, left: r, right: r + LABEL_GAP + textWidth(b.label, LABEL_SIZE) + LABEL_PLATE, up: Math.max(r, LABEL_HEIGHT / 2), down: Math.max(r, LABEL_HEIGHT / 2) };
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

// Where the canvas first frames the graph: fitted with the names at the largest size they can take,
// then again at the size they take at that zoom.
export function fitDrawn(d: Drawn, view: View): Fit {
  const first = fitView(drawnExtents(d), view);
  return fitView(drawnExtents(d, clusterNameSize(first.zoom)), view);
}

// Two things drawn over each other, which spreading the Books apart would part: Books by id, Clusters
// (their names) by id; and by how many pixels they overlap across and down.
export type Clash = { a: { book: string } | { cluster: string }; b: { book: string } | { cluster: string }; across: number; down: number; aFirst: { x: boolean; y: boolean } };

// How the graph reads in `view` once fitted: the zoom and what bounds it, the share of the canvas the
// box around the Books' dots fills, and what is drawn over what. Each label sits right of its dot (where
// the canvas puts one first) at its real size: pairs of Books where a label covers the other's label or
// dot; names (each above its Cluster, or below where that is as clear of the canvas edges and covers
// fewer labels, kept clear of the edges as the canvas keeps them) over a label or another name; and
// names nearer their own wash than half of CLUSTER_NAME_GAP.
export type Reading = { zoom: number; limit: FitLimit; filled: number; labelOverlaps: number; nameOverlaps: number; namesOnWash: number; clashes: Clash[] };

export function readDrawn(d: Drawn, view: View, fit = fitDrawn(d, view)): Reading {
  const screen = new Map(d.books.map((b) => [b.id, { x: (b.x * TYPICAL_EDGE_LENGTH) / d.unit, y: (b.y * TYPICAL_EDGE_LENGTH) / d.unit }]));
  for (const [id, p] of screen) screen.set(id, { x: fit.zoom * (p.x - fit.x) + view.width / 2, y: fit.zoom * (p.y - fit.y) + view.height / 2 });

  const books = d.books.map((b) => {
    const { x, y } = screen.get(b.id)!;
    const r = nodeRadius(b.degree);
    const x0 = x + r + LABEL_GAP - LABEL_PLATE;
    return {
      id: b.id,
      x,
      y,
      dot: { x0: x - r, y0: y - r, x1: x + r, y1: y + r },
      label: { x0, y0: y - LABEL_HEIGHT / 2, x1: x0 + textWidth(b.label, LABEL_SIZE) + 2 * LABEL_PLATE, y1: y + LABEL_HEIGHT / 2 },
    };
  });
  const clashes: Clash[] = [];
  const clash = (a: Clash["a"], p: Box, b: Clash["b"], q: Box) => {
    const across = Math.min(p.x1, q.x1) - Math.max(p.x0, q.x0);
    const down = Math.min(p.y1, q.y1) - Math.max(p.y0, q.y0);
    clashes.push({ a, b, across, down, aFirst: { x: p.x0 + p.x1 < q.x0 + q.x1, y: p.y0 + p.y1 < q.y0 + q.y1 } });
  };
  let labelOverlaps = 0;
  books.forEach((p, i) => {
    for (const q of books.slice(i + 1)) {
      const hit = [
        [p.label, q.label],
        [p.label, q.dot],
        [p.dot, q.label],
      ].find(([s, t]) => overlaps(s, t));
      if (!hit) continue;
      labelOverlaps++;
      clash({ book: p.id }, hit[0], { book: q.id }, hit[1]);
    }
  });

  const wash = WASH_RADIUS * TYPICAL_EDGE_LENGTH * fit.zoom;
  const size = clusterNameSize(fit.zoom);
  const byId = new Map(books.map((b) => [b.id, b]));
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

  const xs = books.map((b) => b.x);
  const ys = books.map((b) => b.y);
  const filled = books.length ? ((Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys))) / (view.width * view.height) : 0;
  return { zoom: fit.zoom, limit: fit.limit, filled, labelOverlaps, nameOverlaps, namesOnWash, clashes };
}
