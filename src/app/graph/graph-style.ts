import type { ConnectionType, Strength } from "@/domain/connections";

// The graph's tunable look, in one place. Sizes are screen pixels, whatever the zoom.
// Which Connections show at rest (AT_REST_STRENGTHS, DISPLAY_CAP per Book) is set in src/domain/graph.ts.

export const EDGE_WIDTH: Record<Strength, number> = { strong: 4.5, moderate: 2.5, weak: 1.25 };
// A faded edge, behind a selection.
export const EDGE_WIDTH_FADED = 1;
// Added to the chosen Connection's width, and to one under the pointer.
export const EDGE_WIDTH_CHOSEN_EXTRA = 2.5;
export const EDGE_WIDTH_HOVER_EXTRA = 1.5;
// Added to a Connection on the Follow trail, so the path walked reads through the faded rest.
export const EDGE_WIDTH_TRAIL_EXTRA = 1.5;

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
