// How the graph canvas draws a Book and its label, in screen pixels: shared with the worker, which leaves
// room for labels when it places a new Book (LABEL_ROOM in ./graph.ts). The rest of the canvas's look is
// in src/app/graph/graph-style.ts.

// The layout is scaled so a typical Connection is this long at zoom 1, which the drag forces assume.
export const TYPICAL_EDGE_LENGTH = 70;

// A Book's dot grows with its Connections, slowly, so hubs stand out without swallowing their labels. A
// Book with none is a hollow ring the size of a dot with one, so it still reads as a Book.
export const nodeRadius = (degree: number) => (degree === 0 ? 5 : 3.5 + 1.7 * Math.sqrt(degree));

// A label's type size, its line (so the height of its plate) as a share of that, and its gap from the dot.
export const LABEL_SIZE = 13;
export const LABEL_LINE = 1.24;
export const LABEL_GAP = 4;
// Newsreader's characters average this share of the type size across, measured over real titles.
export const LABEL_CHAR = 0.48;

// Each Cluster wash pool's radius, as a share of a typical Connection's length.
export const WASH_RADIUS = 0.65;

// Paper showing around a label, so edges pass behind it rather than through it.
export const LABEL_PLATE = 2;

// A Cluster's name, centred over it, above or below its wash. Its size follows the wash it names, within
// these bounds, so a zoomed-out graph's names don't outweigh their Clusters; it sits on a plate padded
// this much each way (the canvas's name button), this many pixels clear of the wash.
export const CLUSTER_NAME_SIZE = { min: 13, max: 18, perRadius: 1 / 9 };
export const CLUSTER_NAME_PAD = { x: 6, y: 2 };
export const CLUSTER_NAME_GAP = 8;
// A name's size at a zoom: by its wash's radius on screen, to the half pixel.
export const clusterNameSize = (zoom: number) =>
  Math.round(Math.min(CLUSTER_NAME_SIZE.max, Math.max(CLUSTER_NAME_SIZE.min, WASH_RADIUS * TYPICAL_EDGE_LENGTH * zoom * CLUSTER_NAME_SIZE.perRadius)) * 2) / 2;
// Room a name keeps from the canvas edges (the wordmark above, the legend below), so a Cluster the
// reader has zoomed into still shows its name.
export const CLUSTER_NAME_CLEAR = { top: 96, bottom: 88, side: 16 };

// The first view of a graph fits it, labels and washes and all, within this margin of the canvas edges
// (clear of the wordmark above and the legend below, in line with them at the sides), and its Cluster
// names within CLUSTER_NAME_CLEAR; zoomed in no further than MAX_FIT_ZOOM: a typical Connection about a
// fifth of a desktop canvas across, so two or three Books don't look huge.
export const FIT_MARGIN = { top: 72, bottom: 72, side: 48 };
export const MAX_FIT_ZOOM = 4;

// The desktop canvases the layout is shaped for, from a small laptop to a large monitor: it fills them as
// best it can, and spreads its Books so no label is drawn over another label, a dot or a name on any of
// them, as first fitted.
export const DESKTOP = {
  "1024×700": { width: 1024, height: 700 },
  "1280×800": { width: 1280, height: 800 },
  "1440×900": { width: 1440, height: 900 },
  "1680×1050": { width: 1680, height: 1050 },
  "1920×1080": { width: 1920, height: 1080 },
};

// Unconnected Books sit in a halo around the connected ones: each dot and label at least HALO_GAP typical
// Connection lengths clear of the connected Books' dots, labels, washes and Cluster names.
export const HALO_GAP = 0.6;
