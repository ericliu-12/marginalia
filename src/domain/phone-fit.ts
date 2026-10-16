// The phone draws the reader's stored layout, which is shaped for wide desktop canvases, on a tall
// screen. A layout wider than the room it is drawn in is turned a quarter turn clockwise, so it fills
// the height rather than a strip across the middle. Only positions turn, never the text, and always the
// same way, so the reader meets the same picture each visit. Nothing stored changes.

import { CLUSTER_NAME_GAP, clusterNameSize, nodeRadius, TYPICAL_EDGE_LENGTH, WASH_RADIUS } from "./graph-drawing";
import { fitView, nameBox, type Extent, type Fit, type View } from "./graph-fit";

type Point = { x: number; y: number };

// Whether `points` are wider, for their height, than `room`.
export function turnsFor(points: Point[], room: { width: number; height: number }) {
  if (points.length < 2 || room.width <= 0 || room.height <= 0) return false;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const [w, h] = [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
  return w * room.height > h * room.width;
}

// A quarter turn clockwise on the screen, where y runs down: right becomes down, down becomes left.
export const turnClockwise = ({ x, y }: Point): Point => ({ x: -y, y: x });

// The phone's first view: the largest zoom at which every Book's dot and every Cluster's wash, with room
// above it for its name, fits the view within its margin. Labels are left out: on a screen this
// narrow, room beside every dot for its label would leave no room for the graph, and the canvas keeps
// each label on screen as it places it. Positions are in drawn units (TYPICAL_EDGE_LENGTH to a
// typical Connection).
export function fitPhone(
  books: { id: string; x: number; y: number; degree: number }[],
  clusters: { bookIds: string[] }[],
  view: View,
): Fit {
  const at = new Map(books.map((b) => [b.id, b]));
  const extents: Extent[] = books.map((b) => {
    const r = nodeRadius(b.degree);
    return { x0: b.x, x1: b.x, y0: b.y, y1: b.y, left: r, right: r, up: r, down: r };
  });
  const wash = WASH_RADIUS * TYPICAL_EDGE_LENGTH;
  const name = CLUSTER_NAME_GAP + nameBox("Name", clusterNameSize(1)).h;
  for (const c of clusters) {
    const pts = c.bookIds.map((id) => at.get(id)).filter((p) => p !== undefined);
    if (pts.length === 0) continue;
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    extents.push({ x0: Math.min(...xs) - wash, x1: Math.max(...xs) + wash, y0: Math.min(...ys) - wash, y1: Math.max(...ys) + wash, left: 0, right: 0, up: name, down: 0 });
  }
  return fitView(extents, view);
}
