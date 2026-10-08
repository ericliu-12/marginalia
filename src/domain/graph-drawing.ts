// How the graph canvas draws a Book and its label, in screen pixels: shared with the worker, which leaves
// room for labels when it places a new Book (LABEL_ROOM in ./graph.ts). The rest of the canvas's look is
// in src/app/graph/graph-style.ts.

// The layout is scaled so a typical Connection is this long at zoom 1, which the drag forces assume.
export const TYPICAL_EDGE_LENGTH = 70;

// A Book's dot grows with its Connections, slowly, so hubs stand out without swallowing their labels.
export const nodeRadius = (degree: number) => 3.5 + 1.7 * Math.sqrt(degree);

// A label's type size, its line (so the height of its plate) as a share of that, and its gap from the dot.
export const LABEL_SIZE = 13;
export const LABEL_LINE = 1.24;
export const LABEL_GAP = 4;
// Newsreader's characters average this share of the type size across, measured over real titles.
export const LABEL_CHAR = 0.48;
