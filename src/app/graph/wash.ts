// A Cluster's wash as a shape: a disc at each of its Books and a band along each Connection drawn
// between two of them, both `core` from their centre or line. graph-canvas.tsx draws it blurred, so a
// Cluster in a chain reads as one soft shape rather than a string of beads.
type At = { x?: number; y?: number };
export type WashShape = { id: string; books: At[]; bands: [At, At][] };

// How far (x, y) is from the segment p–q.
function toSegment(x: number, y: number, p: At, q: At) {
  const [dx, dy] = [q.x! - p.x!, q.y! - p.y!];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - p.x!) * dx + (y - p.y!) * dy) / len2));
  return Math.hypot(x - (p.x! + t * dx), y - (p.y! + t * dy));
}

// The wash under (x, y): within `reach` of one of its Books or bands. Where washes overlap, the
// smallest wins (by the area its discs and bands cover, roughly), so a Cluster inside or across a
// larger one can still be reached. Null over bare paper.
export function washAt(x: number, y: number, shapes: WashShape[], reach: number): string | null {
  let best: string | null = null;
  let smallest = Infinity;
  for (const { id, books, bands } of shapes) {
    const hit = books.some((b) => Math.hypot(x - b.x!, y - b.y!) <= reach) || bands.some(([p, q]) => toSegment(x, y, p, q) <= reach);
    if (!hit) continue;
    const area = books.length * Math.PI * reach * reach + bands.reduce((sum, [p, q]) => sum + 2 * reach * Math.hypot(q.x! - p.x!, q.y! - p.y!), 0);
    if (area < smallest) [best, smallest] = [id, area];
  }
  return best;
}
