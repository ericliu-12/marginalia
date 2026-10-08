// Where the graph's Book labels and Cluster names go, worked out over boxes in screen pixels. Pure, so
// the canvas only measures, places and draws.

export type Box = { x0: number; y0: number; x1: number; y1: number };
export const overlaps = (p: Box, q: Box) => p.x0 < q.x1 && q.x0 < p.x1 && p.y0 < q.y1 && q.y0 < p.y1;

// A Book's dot on screen: an obstacle to every label but its own.
export type Dot = { id: string; x: number; y: number; radius: number };
const dotBox = (d: Dot): Box => ({ x0: d.x - d.radius, y0: d.y - d.radius, x1: d.x + d.radius, y1: d.y + d.radius });

// A label wanted beside the dot at (x, y): `gap` from its centre, `w` by `h`, its paper plate reaching
// `plate` back into the gap beside the dot (left or right; above or below it keeps the whole gap). One
// that `must` show (the hovered or chosen Book's) always does.
export type LabelRequest = { id: string; x: number; y: number; gap: number; plate: number; w: number; h: number; must: boolean };
export type PlacedLabel = { id: string; box: Box };

// Boxes and dots are filed by the coarse cells they cover, column then row, so a check only looks at
// its neighbours.
const CELL = 48;
function filed<T>(items: T[], boxOf: (item: T) => Box) {
  const columns = new Map<number, Map<number, T[]>>();
  // The cells `b` covers that hold anything.
  const cellsOf = function* (b: Box) {
    for (let i = Math.floor(b.x0 / CELL); i <= Math.floor(b.x1 / CELL); i++) {
      const column = columns.get(i);
      if (column) for (let j = Math.floor(b.y0 / CELL); j <= Math.floor(b.y1 / CELL); j++) {
        const cell = column.get(j);
        if (cell) yield cell;
      }
    }
  };
  const add = (item: T) => {
    const b = boxOf(item);
    for (let i = Math.floor(b.x0 / CELL); i <= Math.floor(b.x1 / CELL); i++) {
      let column = columns.get(i);
      if (!column) columns.set(i, (column = new Map()));
      for (let j = Math.floor(b.y0 / CELL); j <= Math.floor(b.y1 / CELL); j++) {
        const cell = column.get(j);
        if (cell) cell.push(item);
        else column.set(j, [item]);
      }
    }
  };
  items.forEach(add);
  // Each item in the cells `b` covers: more than once, if it covers more than one of them.
  const around = (b: Box) => {
    const out: T[] = [];
    for (const cell of cellsOf(b)) out.push(...cell);
    return out;
  };
  const any = (b: Box, hit: (item: T) => boolean) => {
    for (const cell of cellsOf(b)) if (cell.some(hit)) return true;
    return false;
  };
  return { add, around, any };
}

// In priority order, each label goes to the first side of its dot (right, left, above, below) where it
// overlaps no dot and no label already placed, or is left off; one that must show takes the right if
// nothing is free. A label that could not reach the view is left off unless it must show, and dots too
// far out to meet any label that could are left out of the checks. `obstacles` (Cluster names) are kept
// clear of as dots are.
export function placeLabels({
  view,
  dots,
  requests,
  obstacles = [],
}: {
  view: { width: number; height: number };
  dots: Dot[];
  requests: LabelRequest[];
  obstacles?: Box[];
}): PlacedLabel[] {
  const reach = (r: LabelRequest) => r.gap + r.w;
  const seen = (r: LabelRequest) => r.must || (r.x + reach(r) > 0 && r.x - reach(r) < view.width && r.y + reach(r) > 0 && r.y - reach(r) < view.height);
  const wanted = requests.filter(seen);
  const far = Math.max(0, ...wanted.map((r) => (r.must ? 0 : reach(r))));
  const near = dots.filter((d) => d.x > -far && d.x < view.width + far && d.y > -far && d.y < view.height + far);
  const taken = filed([...near.map(dotBox), ...obstacles], (b) => b);
  const placed: PlacedLabel[] = [];
  for (const { id, x, y, gap, plate, w, h, must } of wanted) {
    const beside = gap - plate;
    const sides: Box[] = [
      { x0: x + beside, y0: y - h / 2, x1: x + beside + w, y1: y + h / 2 },
      { x0: x - beside - w, y0: y - h / 2, x1: x - beside, y1: y + h / 2 },
      { x0: x - w / 2, y0: y - gap - h, x1: x + w / 2, y1: y - gap },
      { x0: x - w / 2, y0: y + gap, x1: x + w / 2, y1: y + gap + h },
    ];
    // The label's own dot is no obstacle to it: no side reaches back over it.
    const box = sides.find((b) => !taken.any(b, (o) => overlaps(o, b))) ?? (must ? sides[0] : undefined);
    if (!box) continue;
    taken.add(box);
    placed.push({ id, box });
  }
  return placed;
}

// A Cluster's name, `w` by `h`, for the Books in `members`; the chosen Cluster's always shows.
export type NameRequest = { id: string; members: Set<string>; w: number; h: number; chosen: boolean };

// Each Cluster's name, in order, centred over its Books on screen and `offset` wash radii above or below
// the outermost, whichever side crosses fewer labels (and names placed before it); on a tie, the side
// clear of other Clusters' Books, then the one over fewer dots. Kept `clear` of the canvas edges. Null,
// left off, with none of its Books on screen, or where it would sit on another name or past
// `uncovered` (under the panel), unless chosen.
export function placeNames({
  view,
  clear,
  uncovered,
  washRadius,
  offset,
  dots,
  labels,
  names,
}: {
  view: { width: number; height: number };
  clear: { top: number; bottom: number; side: number };
  uncovered: number;
  washRadius: number;
  offset: number;
  dots: Dot[];
  labels: Box[];
  names: NameRequest[];
}): Map<string, Box | null> {
  const r = washRadius;
  const onScreen = (d: Dot) => d.x >= 0 && d.x <= view.width && d.y >= 0 && d.y <= view.height;
  // Names stay on screen, so only Books within a wash's reach of it can crowd one.
  const near = dots.filter((d) => d.x > -r && d.x < view.width + r && d.y > -r && d.y < view.height + r);
  const byId = new Map(near.map((d) => [d.id, d]));
  // Filed by their centres, so each is in one cell.
  const nearby = filed(near, (d) => ({ x0: d.x, y0: d.y, x1: d.x, y1: d.y }));
  const reach = Math.max(r, ...near.map((d) => d.radius));
  const crossed = filed(labels, (b) => b);
  const crowding = (b: Box, mine: Set<string>) => {
    let others = 0;
    let over = 0;
    for (const d of nearby.around({ x0: b.x0 - reach, y0: b.y0 - reach, x1: b.x1 + reach, y1: b.y1 + reach })) {
      if (overlaps(b, dotBox(d))) over++;
      const dx = Math.max(b.x0 - d.x, 0, d.x - b.x1);
      const dy = Math.max(b.y0 - d.y, 0, d.y - b.y1);
      if (!mine.has(d.id) && Math.hypot(dx, dy) < r) others++;
    }
    return [[...new Set(crossed.around(b))].filter((o) => overlaps(b, o)).length, others, over];
  };
  // Whether one side's crowding is lower, comparing in order of importance.
  const fewer = (p: number[], q: number[]) => {
    for (let i = 0; i < p.length; i++) if (p[i] !== q[i]) return p[i] < q[i];
    return false;
  };

  const placed = new Map<string, Box | null>();
  const shown: Box[] = [];
  for (const { id, members, w, h, chosen } of names) {
    const pts = [...members].map((m) => byId.get(m)).filter((d): d is Dot => d !== undefined && onScreen(d));
    if (pts.length === 0) {
      placed.set(id, null);
      continue;
    }
    const x = Math.min(view.width - clear.side - w / 2, Math.max(clear.side + w / 2, pts.reduce((sum, p) => sum + p.x, 0) / pts.length));
    const gap = r * offset + h / 2;
    const at = (y: number): Box => {
      const cy = Math.min(view.height - clear.bottom - h / 2, Math.max(clear.top + h / 2, y));
      return { x0: x - w / 2, y0: cy - h / 2, x1: x + w / 2, y1: cy + h / 2 };
    };
    const above = at(Math.min(...pts.map((p) => p.y)) - gap);
    const below = at(Math.max(...pts.map((p) => p.y)) + gap);
    const box = fewer(crowding(below, members), crowding(above, members)) ? below : above;
    if (!chosen && (shown.some((o) => overlaps(box, o)) || box.x1 > uncovered)) {
      placed.set(id, null);
      continue;
    }
    crossed.add(box);
    shown.push(box);
    placed.set(id, box);
  }
  return placed;
}
