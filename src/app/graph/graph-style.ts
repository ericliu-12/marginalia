import type { ConnectionType, Strength } from "@/domain/connections";
import type { GraphBook, GraphConnection } from "@/domain/graph";
import { TYPICAL_EDGE_LENGTH } from "@/domain/graph-drawing";
import { typicalLength } from "@/domain/graph-fit";

// The graph's tunable look, in one place. Sizes are screen pixels, whatever the zoom.
// Which Connections show at rest (AT_REST_STRENGTHS, DISPLAY_CAP per Book) is set in src/domain/graph.ts;
// the dots, the label type and the drawing scale, which the worker also uses, in src/domain/graph-drawing.ts.
export {
  CLUSTER_NAME_CLEAR,
  CLUSTER_NAME_GAP,
  CLUSTER_NAME_SIZE,
  clusterNameSize,
  LABEL_GAP,
  LABEL_LINE,
  LABEL_PLATE,
  LABEL_SIZE,
  nodeRadius,
  TYPICAL_EDGE_LENGTH,
} from "@/domain/graph-drawing";

export const EDGE_WIDTH: Record<Strength, number> = { strong: 4.5, moderate: 2.5, weak: 1.25 };
// A faded edge, behind a selection.
export const EDGE_WIDTH_FADED = 1;
// Added to the chosen Connection's width, and to one under the pointer.
export const EDGE_WIDTH_CHOSEN_EXTRA = 2.5;
export const EDGE_WIDTH_HOVER_EXTRA = 1.5;
// A Connection on the Follow trail is cased in ink this wide on each side, and each Book on it ringed,
// so the path walked reads without touching width, which is Strength.
export const TRAIL_CASING = 1;

// Space between a chosen or hovered Book's dot and the ring around it.
export const RING_GAP = 4;
// Labels go to the right of a Book's dot, or failing that to its left, above or below, never over
// another Book's dot; where none fits, the label is left off. Books keep theirs in this order: the most
// recently finished few, then those with more Connections. (Label text is cut by labelOf in
// src/domain/graph.ts.)
export const RECENT_LABELS = 3;

// How much to scale stored positions by so the median Connection is TYPICAL_EDGE_LENGTH long. A graph
// with no Connections yet is scaled by how far each Book sits from its nearest other, so Books with
// nothing between them still stand a Connection's length apart.
export function layoutScale(books: Pick<GraphBook, "bookId" | "x" | "y">[], connections: Pick<GraphConnection, "a" | "b">[]) {
  const typical = typicalLength(books, connections);
  return typical > 0 ? TYPICAL_EDGE_LENGTH / typical : 1;
}
// Dragging a Book wakes a gentle simulation: its Connections pull, near Books push a little, and every
// Book is drawn back toward its stored place.
// The home pull is a steady spring, so a Book always gets back; the others fade as the simulation cools.
export const DRAG = { home: 0.06, link: 0.2, charge: -24, alphaDecay: 0.04, velocityDecay: 0.5, settleTicks: 200 };

export const INK = "#1a1a1a";
export const FADED_NODE = "#d9d2c4";
export const FADED_EDGE = "#e3dccd";
export const FADED_LABEL = "#a39b8d";
// A Book with no Connections: a hollow dot, ringed this thick, and a muted italic label, in ink tertiary.
export const LONE_INK = "#6e675d";
export const LONE_RING = 1.5;
export const TYPE_COLOR: Record<ConnectionType, string> = { thematic: "#3e5a80", contrast: "#9a3b2e", context: "#6b7a3a" };
export const TYPE_LABEL: Record<ConnectionType, string> = { thematic: "Thematic", contrast: "Contrast", context: "Context" };
export const STRENGTH_LABEL: Record<Strength, string> = { strong: "Strong", moderate: "Moderate", weak: "Weak" };

// Cluster washes: one soft shape per Cluster behind its Books, under the Connections, in the Cluster's
// tint (src/app/cluster-tint.tsx, as its dot in the library). The shape is a disc at each Book and a
// band along each Connection drawn between two of them, WASH_CORE from centre or line, blurred by
// WASH_BLUR (a standard deviation): both in typical Connection lengths. Together they reach about
// WASH_RADIUS, which the names and the first view's fit keep clear of.
export { WASH_RADIUS } from "@/domain/graph-drawing";
export const WASH_CORE = 0.38;
export const WASH_BLUR = 0.17;
// A click or hover this near a wash's Books or bands is on it: where its tint is still plainly seen.
export const WASH_REACH = WASH_CORE + WASH_BLUR;
// How much of its tint a wash lays on the paper where it is fullest: at rest, under the pointer (or
// reached from the keyboard), while its Cluster is chosen, and behind some other selection. A Cluster's
// shape never adds up past this.
export const WASH_ALPHA = { rest: 0.4, hover: 0.56, chosen: 0.6, faded: 0.16 };
// A wash deepens under the pointer over this long (at once for less motion).
export const WASH_HOVER_MS = 150;
// While a drag's simulation moves the Books, each wash follows its Books, drawn again at most this often.
export const WASH_FOLLOW_MS = 50;
// A Cluster that forms while the graph is open fades in over this long.
export const WASH_FADE_MS = 600;
// A wash whose Books or Connections change in a fresh graph eases from its old shape to its new.
export const WASH_SHAPE_MS = 300;
// A Cluster's name writes itself in, left to right, when the Cluster forms or is named (CSS: write-in).

// A selection fades the rest of the graph, and letting go brings it back, over this long.
export const SELECT_FADE_MS = 200;

// `from` to `to` (both #rrggbb), `t` of the way, at `alpha`: for a colour mid-fade.
const rgb = new Map<string, number[]>();
export function blend(from: string, to: string, t: number, alpha = 1) {
  const [p, q] = [from, to].map((hex) => {
    let c = rgb.get(hex);
    if (!c) rgb.set(hex, (c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))));
    return c;
  });
  const [r, g, b] = p.map((v, i) => Math.round(v + (q[i] - v) * t));
  return `rgba(${r},${g},${b},${alpha})`;
}

// A Cluster's name is in its tint's name colour on a paper plate (as Book labels are), so no Connection
// strikes through it; its size, place and room from the canvas edges are in src/domain/graph-drawing.ts.
// The plate's opacity (bg-paper/80 in ClusterName), which the names' contrast is checked through.
export const CLUSTER_NAME_PLATE = 0.8;

// The arrival of a Book the graph has not shown before. Its dot grows in while one hairline ink ring
// spreads LAND_RING beyond it and fades; then its Connections draw in one at a time, the first
// DRAW_FIRST_MS after it lands and each next DRAW_STEP_MS later, each line growing out from the new
// Book over DRAW_MS.
export const LAND_MS = 900;
export const LAND_RING = 22;
export const DRAW_FIRST_MS = 1100;
export const DRAW_STEP_MS = 1000;
export const DRAW_MS = 700;
// After this many, the rest of a long run of Connections draw in twice as fast.
export const DRAW_UNHURRIED = 3;
// The view frames an arriving Book with the Books it connects to, keeping this much room at each edge.
export const ARRIVAL_FRAME = 140;
