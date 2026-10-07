import type { ConnectionType, Strength } from "@/domain/connections";

// The graph's tunable look, in one place. Sizes are screen pixels, whatever the zoom.
// Which Connections show at rest (AT_REST_STRENGTHS, DISPLAY_CAP per Book) is set in src/domain/graph.ts.

export const EDGE_WIDTH: Record<Strength, number> = { strong: 4.5, moderate: 2.5, weak: 1.25 };
// A faded edge, behind a selection.
export const EDGE_WIDTH_FADED = 1;
// Added to the chosen Connection's width, and to one under the pointer.
export const EDGE_WIDTH_CHOSEN_EXTRA = 2.5;
export const EDGE_WIDTH_HOVER_EXTRA = 1.5;
// A Connection on the Follow trail is cased in ink this wide on each side, and each Book on it ringed,
// so the path walked reads without touching width, which is Strength.
export const TRAIL_CASING = 1;

// A Book's dot grows with its Connections, slowly, so hubs stand out without swallowing their labels.
export const nodeRadius = (degree: number) => 3.5 + 1.7 * Math.sqrt(degree);

export const LABEL_SIZE = 13;
export const LABEL_GAP = 4;
// Paper showing around a label, so edges pass behind it rather than through it.
export const LABEL_PLATE = 2;
// Space between a chosen or hovered Book's dot and the ring around it.
export const RING_GAP = 4;
// Labels go to the right of a Book's dot, or failing that to its left, above or below; where none
// fits, the label is left off. Books keep theirs in this order: the most recently finished few, then
// those with more Connections. (Label text is cut by labelOf in src/domain/graph.ts.)
export const RECENT_LABELS = 3;

// The layout is scaled so a typical Connection is this long, which the drag forces below assume.
export const TYPICAL_EDGE_LENGTH = 70;
// Dragging a Book wakes a gentle simulation: its Connections pull, near Books push a little, and every
// Book is drawn back toward its stored place.
// The home pull is a steady spring, so a Book always gets back; the others fade as the simulation cools.
export const DRAG = { home: 0.06, link: 0.2, charge: -24, alphaDecay: 0.04, velocityDecay: 0.5, settleTicks: 200 };

// Fitting a small graph to the screen never zooms in past this.
export const MAX_FIT_ZOOM = 2.4;

export const INK = "#231d17";
export const PAPER_PLATE = "rgb(243 236 221 / 0.88)";
export const FADED_NODE = "#d9cfbb";
export const FADED_EDGE = "#e2d8c5";
export const FADED_LABEL = "#a89c88";
export const TYPE_COLOR: Record<ConnectionType, string> = { thematic: "#3e5f8a", contrast: "#a8432f", context: "#6f7a3a" };
export const TYPE_LABEL: Record<ConnectionType, string> = { thematic: "Thematic", contrast: "Contrast", context: "Context" };
export const STRENGTH_LABEL: Record<Strength, string> = { strong: "Strong", moderate: "Moderate", weak: "Weak" };

// Cluster washes: soft pools of colour behind each Cluster's Books, under the Connections. Six pale
// tints kept apart from the Connection Type hues, so no Connection's line sinks into its wash; a
// Cluster keeps its tint (its stored `wash`) for as long as it keeps its identity. WASH_COUNT in
// src/domain/clusters.ts is their number.
// Equal in lightness and chroma (OKLCH 0.76, 0.065), so no Cluster reads stronger than another.
export const WASH = ["#c4ae82", "#d0a1bb", "#81bfb6", "#d6a492", "#b0abd8", "#d1a888"];
// How much of its tint a wash lays on the paper where it is fullest: at rest, while its Cluster is
// chosen, and behind some other selection. A Cluster's pools never add up past this.
export const WASH_ALPHA = { rest: 0.35, chosen: 0.55, faded: 0.16 };
// Each pool's radius, as a share of a typical Connection's length.
export const WASH_RADIUS = 0.65;
// A Cluster that forms while the graph is open fades in over this long.
export const WASH_FADE_MS = 600;

// A Cluster's name, centred over it, above or below its wash, on a paper plate (as Book labels are) so
// no Connection strikes through it. Its colour holds 4.5:1 even without the plate, where two of the
// darkest washes overlap at rest.
// Its size follows the wash it names, within these bounds, so a zoomed-out graph's names don't outweigh
// their Clusters; a name with no room left among the others is left off.
export const CLUSTER_NAME_SIZE = { min: 13, max: 18, perRadius: 1 / 9 };
export const CLUSTER_NAME_COLOR = "#4a4137";
// How far the name sits beyond the Cluster's outermost Book, as a share of a pool's radius.
export const CLUSTER_NAME_OFFSET = 0.75;
// Room a name keeps from the canvas edges (the wordmark above, the legend below), so a Cluster the
// reader has zoomed into still shows its name.
export const CLUSTER_NAME_CLEAR = { top: 96, bottom: 88, side: 16 };

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
