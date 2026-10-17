// How much of a large graph is drawn at a zoom, and how its edges fade into the paper (#156). Pure, so
// the canvas only measures and draws. A graph under LARGE_GRAPH Books is drawn whole, as it always was.
import type { Strength } from "@/domain/connections";
import { overlaps, type Box } from "./placement";

export const LARGE_GRAPH = 40;

// Detail follows how far apart the Books stand on screen, in pixels (`spacing`: the side of the square
// each would have if they shared the graph's extent evenly), not the zoom itself: a phone's 300 Books
// and a monitor's 1000 thin out alike at the same density. Each thing is out below its threshold and
// fades in over the next part of a step up, so zooming never makes it pop.
//
// Books are ranked by their Connections, 0 for the best connected to 1 for the least. The top
// HUB_SHARE keep their dots at every zoom; the rest rest at DOT_FAINT until the zoom brings them in,
// better connected first. Labels come in the same way, later, over a shorter step, so a label at rest
// is in or out and only fades on the way. Lines come in by Strength: strong ones are always there,
// faintly (at STRONG_FAINT) at the farthest zoom, so the graph never loses its web; then the rest
// (weak ones show only behind a selection, which keeps them).
export const HUB_SHARE = 0.15;
export const DOT_FAINT = 0.22;
// A dot drawn this much of its size when all but gone, growing to its full size as it comes in.
export const FAINT_SIZE = 0.5;
const DOT_FROM = { first: 30, last: 70 };
const LABEL_FROM = { first: 24, last: 110 };
const LINE_FROM: Record<Strength, number> = { strong: 44, moderate: 64, weak: 76 };
// Each fades in from its threshold to this many times it.
const FADE_SPAN = 1.4;
const LABEL_SPAN = 1.12;
export const STRONG_FAINT = 0.3;

// 0 below `from`, 1 above `to`, eased between.
export function ramp(x: number, from: number, to: number) {
  if (x <= from) return 0;
  if (x >= to) return 1;
  const t = (x - from) / (to - from);
  return t * t * (3 - 2 * t);
}

const across = ({ first, last }: { first: number; last: number }, rank: number) => first + (last - first) * rank;

// How much of a Book's dot shows, 0 to 1, at its rank and the zoom.
export function dotDetail(rank: number, spacing: number) {
  if (rank < HUB_SHARE) return 1;
  const from = across(DOT_FROM, rank);
  return DOT_FAINT + (1 - DOT_FAINT) * ramp(spacing, from, from * FADE_SPAN);
}

// How much of a Book's label shows, 0 to 1.
export function labelDetail(rank: number, spacing: number) {
  const from = across(LABEL_FROM, rank);
  return ramp(spacing, from, from * LABEL_SPAN);
}

// How much of a Connection's line shows, 0 to 1.
export function lineDetail(strength: Strength, spacing: number) {
  const shown = ramp(spacing, LINE_FROM[strength], LINE_FROM[strength] * FADE_SPAN);
  return strength === "strong" ? STRONG_FAINT + (1 - STRONG_FAINT) * shown : shown;
}

// Dots drawn smaller where the Books stand closer than DOT_ROOM pixels apart (a phone's whole graph),
// down to DOT_SHRUNK of their size, so the hubs don't crowd into one another.
const DOT_ROOM = 36;
const DOT_SHRUNK = 0.65;
export const dotScale = (spacing: number) => Math.max(DOT_SHRUNK, Math.min(1, spacing / DOT_ROOM));

// The spacing the detail shows, easing toward the zoom's over about DETAIL_FADE_MS, so a step of the
// wheel or the end of a glide fades rather than jumps. Eased on a log scale: a zoom is a ratio.
export const DETAIL_FADE_MS = 200;
// A change of zoom from one frame to the next under this (as a log ratio: about 12%; a pinch or a
// trackpad moves a few percent a frame, a step of the wheel 18%) is gradual, and needs no easing.
export const GRADUAL_ZOOM = 0.115;
export function easeSpacing(shown: number, target: number, ms: number) {
  const left = Math.pow(shown / target, Math.exp((-ms * 5) / DETAIL_FADE_MS));
  // Near enough to stop drawing for.
  return Math.abs(Math.log(left)) < 0.004 ? target : target * left;
}

// Fog: the graph thins towards the edges of the view into the paper, around the middle of the room it
// has (clear of the panel, or on a phone between the header and the legend or sheet). Nothing within
// FOG_CLEAR of the middle (as a share of the way to the edge, across and down) is touched; at FOG_EDGE
// and beyond, FOG_MOST of everything is gone. None at all while the whole graph fits the view; fully
// by the time it overflows it FOG_FULL times.
export const FOG_CLEAR = 0.45;
export const FOG_EDGE = 1.05;
export const FOG_MOST = 0.8;
const FOG_FULL = 1.6;
export type Lens = { cx: number; cy: number; rx: number; ry: number; amount: number };

// The fog's strength over a view, from how many times over the graph's extent overflows it.
export const fogAmount = (overflow: number) => ramp(overflow, 1, FOG_FULL);

// How much of a thing at (x, y) the fog takes, 0 to FOG_MOST.
export function mist(x: number, y: number, lens: Lens) {
  if (lens.amount === 0) return 0;
  const [dx, dy] = [(x - lens.cx) / lens.rx, (y - lens.cy) / lens.ry];
  return lens.amount * FOG_MOST * ramp(Math.sqrt(dx * dx + dy * dy), FOG_CLEAR, FOG_EDGE);
}

// Less of a dot or line than this isn't drawn, nor found under the pointer or a finger, so a click on
// a wash where only mist is reaches the wash. A label fainter than LABEL_SEEN (deep in the mist) isn't
// placed, so it takes no room from one that can be read.
export const SEEN = 0.04;
export const LABEL_SEEN = 0.3;

// At most this many off-screen hints show at once.
export const HINTS_MAX = { desktop: 6, phone: 3 };

// Off-screen hints: the names of Clusters wholly out of view, each pinned to the edge of `area` where the
// line from `from` (the middle of the view) toward its Books crosses it, nearest Clusters first. A hint
// that would sit on or beside one already placed (within HINT_APART) is left off, and at most `max`
// show. Each comes with the angle it points along, in radians.
export const HINT_APART = 6;
export type HintRequest = { id: string; x: number; y: number; w: number; h: number };
export type PlacedHint = { box: Box; angle: number };
export function placeHints({ area, from, hints, max }: { area: Box; from: { x: number; y: number }; hints: HintRequest[]; max: number }) {
  const placed = new Map<string, PlacedHint>();
  const boxes: Box[] = [];
  const near = [...hints].sort((p, q) => Math.hypot(p.x - from.x, p.y - from.y) - Math.hypot(q.x - from.x, q.y - from.y));
  for (const { id, x, y, w, h } of near) {
    if (placed.size >= max) break;
    const angle = Math.atan2(y - from.y, x - from.x);
    // Where the hint's middle may go: the area, less half the hint each way.
    const inner = { x0: area.x0 + w / 2, y0: area.y0 + h / 2, x1: area.x1 - w / 2, y1: area.y1 - h / 2 };
    if (inner.x0 > inner.x1 || inner.y0 > inner.y1) continue;
    const ox = Math.min(inner.x1, Math.max(inner.x0, from.x));
    const oy = Math.min(inner.y1, Math.max(inner.y0, from.y));
    const [dx, dy] = [Math.cos(angle), Math.sin(angle)];
    const t = Math.min(
      dx > 1e-9 ? (inner.x1 - ox) / dx : dx < -1e-9 ? (inner.x0 - ox) / dx : Infinity,
      dy > 1e-9 ? (inner.y1 - oy) / dy : dy < -1e-9 ? (inner.y0 - oy) / dy : Infinity,
    );
    const [px, py] = [ox + dx * t, oy + dy * t];
    const box = { x0: px - w / 2, y0: py - h / 2, x1: px + w / 2, y1: py + h / 2 };
    const apart = { x0: box.x0 - HINT_APART, y0: box.y0 - HINT_APART, x1: box.x1 + HINT_APART, y1: box.y1 + HINT_APART };
    if (boxes.some((b) => overlaps(apart, b))) continue;
    boxes.push(box);
    placed.set(id, { box, angle });
  }
  return placed;
}
