"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type ForceGraph from "force-graph";
import { visibleConnections, type GraphBook, type GraphCluster, type GraphConnection, type GraphView } from "@/domain/graph";
import {
  ARRIVAL_FRAME,
  CLUSTER_NAME_CLEAR,
  CLUSTER_NAME_COLOR,
  CLUSTER_NAME_OFFSET,
  CLUSTER_NAME_SIZE,
  DRAG,
  DRAW_MS,
  EDGE_WIDTH,
  EDGE_WIDTH_CHOSEN_EXTRA,
  EDGE_WIDTH_FADED,
  EDGE_WIDTH_HOVER_EXTRA,
  FADED_EDGE,
  FADED_LABEL,
  FADED_NODE,
  FIT_PADDING,
  INK,
  LABEL_GAP,
  LABEL_PLATE,
  LABEL_SIZE,
  LAND_MS,
  LAND_RING,
  layoutScale,
  MAX_FIT_ZOOM,
  PAPER_PLATE,
  RECENT_LABELS,
  TYPE_COLOR,
  RING_GAP,
  TRAIL_CASING,
  TYPICAL_EDGE_LENGTH,
  WASH,
  WASH_ALPHA,
  WASH_FADE_MS,
  WASH_RADIUS,
  nodeRadius,
} from "./graph-style";

export type Selection = { kind: "book"; bookId: string } | { kind: "connection"; id: string } | { kind: "cluster"; id: string } | null;

type Node = { id: string; book: GraphBook; label: string; radius: number; homeX: number; homeY: number; x?: number; y?: number; vx?: number; vy?: number };
// force-graph's names: a node is a Book, a link is a Connection.
type Link = { id: string; source: string | Node; target: string | Node; connection: GraphConnection; rest: number };

// What a selection lights up. Worked out once per selection, so the render callbacks only look things up.
type Focus = {
  visible: Set<string>;
  // Books and Connections drawn at full strength; null when nothing is selected and everything is.
  litBooks: Set<string> | null;
  litLinks: Set<string> | null;
  // The Books on the Follow trail, and the Connections between consecutive ones.
  trailBooks: Set<string>;
  trailLinks: Set<string>;
  chosenBookId: string | null;
  chosenLinkId: string | null;
  chosenClusterId: string | null;
  // Label priority: the selection and its neighbours first, then the graph's own order.
  labelOrder: Node[];
};

// Graph data for force-graph, built once per graph: stored positions scaled by layoutScale, an
// id-to-node map, and each Cluster's Books.
function prepare(graph: GraphView) {
  const raw = new Map(graph.books.map((b) => [b.bookId, b]));
  const lengths = graph.connections.map((c) => Math.hypot(raw.get(c.a)!.x - raw.get(c.b)!.x, raw.get(c.a)!.y - raw.get(c.b)!.y));
  const scale = layoutScale(graph.books, graph.connections);
  const nodes: Node[] = graph.books.map((b) => ({
    id: b.bookId,
    book: b,
    label: b.label,
    radius: nodeRadius(b.degree),
    homeX: b.x * scale,
    homeY: b.y * scale,
    x: b.x * scale,
    y: b.y * scale,
  }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const links: Link[] = graph.connections.map((c, i) => ({ id: c.id, source: c.a, target: c.b, connection: c, rest: lengths[i] * scale }));
  // Label priority at rest: the most recently finished few, then by Connections, then most recent.
  const recent = new Set(
    [...nodes]
      .sort((p, q) => q.book.finishedAt - p.book.finishedAt)
      .slice(0, RECENT_LABELS)
      .map((n) => n.id),
  );
  const byPriority = [...nodes].sort(
    (p, q) =>
      Number(recent.has(q.id)) - Number(recent.has(p.id)) ||
      q.book.degree - p.book.degree ||
      q.book.finishedAt - p.book.finishedAt ||
      (p.id < q.id ? -1 : 1),
  );
  const clusters = graph.clusters.map((cluster) => ({ cluster, nodes: cluster.bookIds.map((id) => byId.get(id)!).filter(Boolean) }));
  return { nodes, links, byId, byPriority, clusters };
}

function focusFor(graph: GraphView, prepared: ReturnType<typeof prepare>, selection: Selection, trail: string[]): Focus {
  const chosenBookId = selection?.kind === "book" ? selection.bookId : null;
  const chosenLink = selection?.kind === "connection" ? graph.connections.find((c) => c.id === selection.id) : undefined;
  const chosenCluster = selection?.kind === "cluster" ? graph.clusters.find((c) => c.id === selection.id) : undefined;
  const visible = new Set(visibleConnections(graph, chosenBookId).map((c) => c.id));
  let litBooks: Set<string> | null = null;
  let litLinks: Set<string> | null = null;
  if (chosenBookId) {
    litBooks = new Set([chosenBookId]);
    litLinks = new Set();
    for (const c of graph.connections) {
      if (c.a !== chosenBookId && c.b !== chosenBookId) continue;
      litLinks.add(c.id);
      litBooks.add(c.a === chosenBookId ? c.b : c.a);
    }
  } else if (chosenLink) {
    visible.add(chosenLink.id);
    litBooks = new Set([chosenLink.a, chosenLink.b]);
    litLinks = new Set([chosenLink.id]);
  } else if (chosenCluster) {
    // A Cluster lights its Books and every Connection among them.
    litBooks = new Set(chosenCluster.bookIds);
    litLinks = new Set();
    for (const c of graph.connections) {
      if (!litBooks.has(c.a) || !litBooks.has(c.b)) continue;
      litLinks.add(c.id);
      visible.add(c.id);
    }
  }
  // The trail stays lit behind the chosen Book: its Books, and the Connections followed between them.
  const trailLinks = new Set<string>();
  for (let i = 1; i < trail.length; i++) {
    const [x, y] = [trail[i - 1], trail[i]];
    const c = graph.connections.find((c) => (c.a === x && c.b === y) || (c.a === y && c.b === x));
    if (c) trailLinks.add(c.id);
  }
  if (litBooks && litLinks) {
    for (const id of trail) litBooks.add(id);
    for (const id of trailLinks) {
      visible.add(id);
      litLinks.add(id);
    }
  }
  const lit = litBooks;
  const labelOrder = lit
    ? [...prepared.byPriority].sort((p, q) => Number(lit.has(q.id)) - Number(lit.has(p.id)) || Number(q.id === chosenBookId) - Number(p.id === chosenBookId))
    : prepared.byPriority;
  return {
    visible,
    litBooks,
    litLinks,
    trailBooks: new Set(trail),
    trailLinks,
    chosenBookId,
    chosenLinkId: chosenLink?.id ?? null,
    chosenClusterId: chosenCluster?.id ?? null,
    labelOrder,
  };
}

// Camera moves glide, new Clusters fade in, and new Books arrive, unless the reader asked for less motion.
export const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const glide = () => (reducedMotion() ? 0 : 600);

type Box = { x0: number; y0: number; x1: number; y1: number };
type Side = "right" | "left" | "above" | "below";

const endId = (end: string | Node) => (typeof end === "string" ? end : end.id);

// Exponential ease-out: quick to start, settling slowly. `p` runs 0 to 1.
const easeOut = (p: number) => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * p));

// The reader's graph, full-bleed. Books are ink dots at their stored places, each Cluster a wash behind
// its Books with its name beside it; a selection lights a Book and its Connections, one Connection, or
// a Cluster, and fades the rest. A fresh graph (after background work) keeps the reader's view.
// Arriving Books land, and their Connections held back are left off until each draws in.
export function GraphCanvas({
  graph,
  selection,
  trail,
  onSelect,
  panelInset,
  pointedBookId,
  landing,
  withheld,
}: {
  graph: GraphView;
  // Books arriving: each lands as it first appears here.
  landing: string[];
  // Connections not drawn in yet: hidden, and each grows out from its arriving Book once it leaves.
  withheld: Set<string>;
  selection: Selection;
  // The Books followed to reach the selection, oldest first; drawn as a path.
  trail: string[];
  onSelect: (s: Selection) => void;
  // A Book the reader has reached from the keyboard list: marked on the canvas as if hovered.
  pointedBookId: string | null;
  // Pixels of the canvas's right edge covered by the floating panel, so a chosen Book centres in what is left.
  panelInset: number;
}) {
  const el = useRef<HTMLDivElement>(null);
  const fgRef = useRef<ForceGraph<Node, Link> | null>(null);
  const [ready, setReady] = useState(false);
  const prepared = useMemo(() => prepare(graph), [graph]);
  const dataRef = useRef(prepared);
  // Each Cluster's name, placed over the canvas every frame; and its measured size, by name.
  const nameEls = useRef(new Map<string, HTMLButtonElement>());
  const nameSizes = useRef(new Map<string, { w: number; h: number }>());
  // When each Cluster that formed while the graph was open appeared, for its fade-in.
  const appeared = useRef(new Map<string, number>());
  // How far into its fade-in a Cluster is, 0 to 1; 1 for one that was there from the start.
  const faded = (id: string, now: number) => {
    const since = appeared.current.get(id);
    return since === undefined ? 1 : Math.min(1, (now - since) / WASH_FADE_MS);
  };
  // When each arriving Book landed, and when each of their Connections began to draw in.
  const landed = useRef(new Map<string, number>());
  const drawing = useRef(new Map<string, number>());
  const withheldRef = useRef(withheld);
  // Every Connection held back that has not started drawing in, even from before the canvas was ready.
  const held = useRef(new Set<string>());
  // Redraws every frame for at least `ms`, while something moves that the simulation does not.
  const animateFor = useRef<(ms: number) => void>(() => {});
  const focus = useMemo(() => focusFor(graph, prepared, selection, trail), [graph, prepared, selection, trail]);
  const focusRef = useRef(focus);
  const hoverRef = useRef<string | null>(null);
  const hoverLinkRef = useRef<string | null>(null);
  const pointedRef = useRef(pointedBookId);
  const onSelectRef = useRef(onSelect);
  const insetRef = useRef(panelInset);
  useEffect(() => {
    onSelectRef.current = onSelect;
    insetRef.current = panelInset;
  });

  // One force-graph for the life of the view; a fresh graph swaps its data, a selection the focus it reads.
  useEffect(() => {
    const host = el.current;
    if (!host) return;
    let fg: ForceGraph<Node, Link> | null = null;
    let ro: ResizeObserver | null = null;
    let cancelled = false;
    let until = 0;
    let pause: ReturnType<typeof setTimeout> | undefined;
    const serif = getComputedStyle(document.documentElement).getPropertyValue("--nf-serif").trim() || "Georgia";
    const font = (k: number) => `500 ${LABEL_SIZE / k}px ${serif}, Georgia, serif`;
    const widths = new Map<string, number>();
    // Where one Cluster's pools are drawn before they go on the canvas together, so they never add up.
    const layer = document.createElement("canvas");

    void import("force-graph").then(({ default: ForceGraphCtor }) => {
      if (cancelled) return;
      const f = (fg = new ForceGraphCtor<Node, Link>(host));
      fgRef.current = f;
      animateFor.current = (ms) => {
        until = Math.max(until, performance.now() + ms);
        f.autoPauseRedraw(false);
        clearTimeout(pause);
        pause = setTimeout(() => f.autoPauseRedraw(true), until - performance.now() + 50);
      };
      // How far into its landing a Book is, and into its drawing-in a Connection, 0 to 1.
      const progress = (since: number | undefined, ms: number) => (since === undefined ? 1 : Math.min(1, (performance.now() - since) / ms));
      const data = () => dataRef.current;
      const pointed = () => hoverRef.current ?? pointedRef.current;
      const ringed = (id: string) => id === focusRef.current.chosenBookId || id === pointed() || focusRef.current.trailBooks.has(id);
      const isLitBook = (id: string) => !focusRef.current.litBooks || focusRef.current.litBooks.has(id);
      const linkState = (l: Link) => {
        const { litLinks, chosenLinkId } = focusRef.current;
        if (l.id === chosenLinkId) return "chosen";
        return !litLinks || litLinks.has(l.id) ? "lit" : "faded";
      };
      const colorOf = (l: Link) => (linkState(l) === "faded" ? FADED_EDGE : TYPE_COLOR[l.connection.type]);
      const widthOf = (l: Link) => {
        const state = linkState(l);
        if (state === "faded") return EDGE_WIDTH_FADED;
        const extra = state === "chosen" ? EDGE_WIDTH_CHOSEN_EXTRA : l.id === hoverLinkRef.current ? EDGE_WIDTH_HOVER_EXTRA : 0;
        return EDGE_WIDTH[l.connection.strength] + extra;
      };

      f.width(host.clientWidth)
        .height(host.clientHeight)
        .backgroundColor("rgba(0,0,0,0)")
        .nodeId("id")
        // Washes first, under everything: each Cluster's pools drawn at full tint into the layer, which
        // goes on the paper at the Cluster's strength. Lighter behind any other selection.
        .onRenderFramePre((ctx) => {
          const { chosenClusterId, litBooks } = focusRef.current;
          const { width, height } = ctx.canvas;
          if (layer.width !== width || layer.height !== height) Object.assign(layer, { width, height });
          const lc = layer.getContext("2d")!;
          const r = WASH_RADIUS * TYPICAL_EDGE_LENGTH;
          const now = performance.now();
          for (const { cluster, nodes } of data().clusters) {
            const alpha = (cluster.id === chosenClusterId ? WASH_ALPHA.chosen : litBooks ? WASH_ALPHA.faded : WASH_ALPHA.rest) * faded(cluster.id, now);
            if (alpha <= 0 || nodes.length === 0) continue;
            const tint = WASH[cluster.wash];
            // Only the part of the canvas this Cluster's pools cover, in device pixels.
            const m = ctx.getTransform();
            const xs = nodes.map((n) => m.a * n.x! + m.e);
            const ys = nodes.map((n) => m.d * n.y! + m.f);
            const pad = r * m.a;
            const x0 = Math.max(0, Math.floor(Math.min(...xs) - pad));
            const y0 = Math.max(0, Math.floor(Math.min(...ys) - pad));
            const w = Math.min(width, Math.ceil(Math.max(...xs) + pad)) - x0;
            const h = Math.min(height, Math.ceil(Math.max(...ys) + pad)) - y0;
            if (w <= 0 || h <= 0) continue;
            lc.setTransform(1, 0, 0, 1, 0, 0);
            lc.clearRect(x0, y0, w, h);
            lc.setTransform(m);
            for (const n of nodes) {
              const g = lc.createRadialGradient(n.x!, n.y!, 0, n.x!, n.y!, r);
              g.addColorStop(0, tint);
              g.addColorStop(0.45, `${tint}c0`);
              g.addColorStop(1, `${tint}00`);
              lc.fillStyle = g;
              lc.beginPath();
              lc.arc(n.x!, n.y!, r, 0, Math.PI * 2);
              lc.fill();
            }
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.globalAlpha = alpha;
            ctx.drawImage(layer, x0, y0, w, h, x0, y0, w, h);
            ctx.restore();
          }
        })
        .linkVisibility((l) => focusRef.current.visible.has(l.id) && !withheldRef.current.has(l.id))
        .linkColor(colorOf)
        // Screen pixels: force-graph keeps link widths constant across zoom.
        .linkWidth(widthOf)
        .linkHoverPrecision(6)
        // A Connection drawing in replaces its line with one growing out from the arriving Book; the
        // trail's ink casing goes under the Connection's own line.
        .linkCanvasObjectMode((l) =>
          progress(drawing.current.get(l.id), DRAW_MS) < 1 ? "replace" : focusRef.current.trailLinks.has(l.id) ? "before" : undefined,
        )
        .linkCanvasObject((l, ctx, k) => {
          const s = l.source as Node;
          const t = l.target as Node;
          const grown = progress(drawing.current.get(l.id), DRAW_MS);
          if (grown < 1) {
            const [from, to] = landed.current.has(t.id) && !landed.current.has(s.id) ? [t, s] : [s, t];
            const p = easeOut(grown);
            ctx.beginPath();
            ctx.moveTo(from.x!, from.y!);
            ctx.lineTo(from.x! + (to.x! - from.x!) * p, from.y! + (to.y! - from.y!) * p);
            ctx.lineWidth = widthOf(l) / k;
            ctx.strokeStyle = colorOf(l);
            ctx.stroke();
            return;
          }
          ctx.beginPath();
          ctx.moveTo(s.x!, s.y!);
          ctx.lineTo(t.x!, t.y!);
          ctx.lineWidth = (EDGE_WIDTH[l.connection.strength] + 2 * TRAIL_CASING) / k;
          ctx.strokeStyle = INK;
          ctx.stroke();
        })
        .nodeCanvasObject((n, ctx, k) => {
          // A landing Book's dot grows in while a hairline ring spreads from it and fades, steadily, so it
          // is still seen once the camera has arrived.
          const since = progress(landed.current.get(n.id), LAND_MS);
          const land = easeOut(since);
          if (since < 1) {
            ctx.beginPath();
            ctx.arc(n.x!, n.y!, (n.radius + RING_GAP + LAND_RING * land) / k, 0, Math.PI * 2);
            ctx.lineWidth = 1 / k;
            ctx.strokeStyle = INK;
            ctx.globalAlpha = 1 - since;
            ctx.stroke();
            ctx.globalAlpha = 1;
          }
          const r = (n.radius * land) / k;
          const lit = isLitBook(n.id);
          if (ringed(n.id)) {
            // A Book on the trail behind the chosen one gets a lighter ring.
            const behind = n.id !== focusRef.current.chosenBookId && n.id !== pointed();
            ctx.beginPath();
            ctx.arc(n.x!, n.y!, r + RING_GAP / k, 0, Math.PI * 2);
            ctx.lineWidth = (behind ? 1 : 1.5) / k;
            ctx.strokeStyle = INK;
            ctx.stroke();
          }
          ctx.beginPath();
          ctx.arc(n.x!, n.y!, r, 0, Math.PI * 2);
          ctx.fillStyle = lit ? INK : FADED_NODE;
          ctx.fill();
        })
        .nodePointerAreaPaint((n, color, ctx, k) => {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(n.x!, n.y!, (n.radius + 5) / k, 0, Math.PI * 2);
          ctx.fill();
        })
        // Labels last, over the edges, each on a paper plate so no edge strikes through it. In priority
        // order, each goes to the first side of its dot (right, left, above, below) where it overlaps no
        // dot and no label already placed, or is left off; a coarse grid keeps the checks cheap. The
        // hovered and chosen Books always get theirs, in full. Then each Cluster's name goes above or
        // below it, whichever crosses fewer of the labels drawn (and names placed before it).
        .onRenderFramePost((ctx, k) => {
          const { labelOrder, litBooks, chosenBookId } = focusRef.current;
          ctx.font = font(k);
          ctx.textBaseline = "middle";
          const CELL = 48;
          const taken = new Map<string, Box[]>();
          const cells = (b: Box) => {
            const keys = [];
            for (let i = Math.floor(b.x0 / CELL); i <= Math.floor(b.x1 / CELL); i++)
              for (let j = Math.floor(b.y0 / CELL); j <= Math.floor(b.y1 / CELL); j++) keys.push(`${i}:${j}`);
            return keys;
          };
          const free = (b: Box) => !cells(b).some((key) => taken.get(key)?.some((o) => o.x0 < b.x1 && b.x0 < o.x1 && o.y0 < b.y1 && b.y0 < o.y1));
          const take = (b: Box) => {
            for (const key of cells(b)) taken.set(key, [...(taken.get(key) ?? []), b]);
          };
          const width = (text: string) => {
            let w = widths.get(text);
            if (w === undefined) {
              ctx.save();
              ctx.setTransform(1, 0, 0, 1, 0, 0);
              ctx.font = font(1);
              w = ctx.measureText(text).width;
              ctx.restore();
              widths.set(text, w);
            }
            return w;
          };
          // Every dot is an obstacle, so no label sits on another Book.
          const { nodes, byId, clusters } = data();
          const screen = new Map(nodes.map((n) => [n.id, f.graph2ScreenCoords(n.x!, n.y!)]));
          for (const n of nodes) {
            const s = screen.get(n.id)!;
            take({ x0: s.x - n.radius, y0: s.y - n.radius, x1: s.x + n.radius, y1: s.y + n.radius });
          }

          const hovered = pointed();
          const order = hovered ? [byId.get(hovered), ...labelOrder] : labelOrder;
          const labels: Box[] = [];
          const drawn = new Set<string>();
          const H = LABEL_SIZE * 1.24;
          for (const n of order) {
            if (!n || drawn.has(n.id)) continue;
            const lit = !litBooks || litBooks.has(n.id);
            const must = n.id === hovered || n.id === chosenBookId;
            // Faded Books stay unlabelled unless the reader is close enough to read them anyway.
            if (!lit && k < 1.6 && !must) continue;
            const text = must ? n.book.title : n.label;
            const w = width(text) + 2 * LABEL_PLATE;
            const gap = n.radius + LABEL_GAP + (ringed(n.id) ? RING_GAP : 0);
            const s = screen.get(n.id)!;
            const sides: { side: Side; box: Box }[] = [
              { side: "right", box: { x0: s.x + gap - LABEL_PLATE, y0: s.y - H / 2, x1: s.x + gap - LABEL_PLATE + w, y1: s.y + H / 2 } },
              { side: "left", box: { x0: s.x - gap + LABEL_PLATE - w, y0: s.y - H / 2, x1: s.x - gap + LABEL_PLATE, y1: s.y + H / 2 } },
              { side: "above", box: { x0: s.x - w / 2, y0: s.y - gap - H, x1: s.x + w / 2, y1: s.y - gap } },
              { side: "below", box: { x0: s.x - w / 2, y0: s.y + gap, x1: s.x + w / 2, y1: s.y + gap + H } },
            ];
            const spot = sides.find((c) => free(c.box)) ?? (must ? sides[0] : undefined);
            if (!spot) continue;
            take(spot.box);
            labels.push(spot.box);
            drawn.add(n.id);
            // Back to graph units for drawing.
            const p = (sx: number, sy: number) => ({ x: n.x! + (sx - s.x) / k, y: n.y! + (sy - s.y) / k });
            const corner = p(spot.box.x0, spot.box.y0);
            ctx.fillStyle = PAPER_PLATE;
            ctx.beginPath();
            ctx.roundRect(corner.x, corner.y, w / k, H / k, 2 / k);
            ctx.fill();
            const mid = p((spot.box.x0 + spot.box.x1) / 2, (spot.box.y0 + spot.box.y1) / 2);
            ctx.textAlign = "center";
            ctx.fillStyle = lit ? INK : FADED_LABEL;
            ctx.fillText(text, mid.x, mid.y);
          }

          const now = performance.now();
          const hit = (b: Box, o: Box) => o.x0 < b.x1 && b.x0 < o.x1 && o.y0 < b.y1 && b.y0 < o.y1;
          const r = WASH_RADIUS * TYPICAL_EDGE_LENGTH * k;
          // The side crossing fewer labels (and names) wins; on a tie, the one clear of other Clusters'
          // washes, then the one over fewer dots.
          const crowding = (b: Box, mine: Set<string>) => {
            let near = 0;
            let dots = 0;
            for (const n of nodes) {
              const p = screen.get(n.id)!;
              if (hit(b, { x0: p.x - n.radius, y0: p.y - n.radius, x1: p.x + n.radius, y1: p.y + n.radius })) dots++;
              const dx = Math.max(b.x0 - p.x, 0, p.x - b.x1);
              const dy = Math.max(b.y0 - p.y, 0, p.y - b.y1);
              if (!mine.has(n.id) && Math.hypot(dx, dy) < r) near++;
            }
            return [labels.filter((o) => hit(b, o)).length, near, dots];
          };
          const names: Box[] = [];
          const { chosenClusterId } = focusRef.current;
          const fontSize = Math.round(Math.min(CLUSTER_NAME_SIZE.max, Math.max(CLUSTER_NAME_SIZE.min, r * CLUSTER_NAME_SIZE.perRadius)) * 2) / 2;
          // Whether one side's crowding is lower, comparing in order of importance.
          const fewer = (p: number[], q: number[]) => {
            for (let i = 0; i < p.length; i++) if (p[i] !== q[i]) return p[i] < q[i];
            return false;
          };
          const uncovered = f.width() - insetRef.current;
          for (const { cluster, nodes: members } of clusters) {
            const nameEl = nameEls.current.get(cluster.id);
            if (!nameEl || members.length === 0) continue;
            if (nameEl.style.fontSize !== `${fontSize}px`) nameEl.style.fontSize = `${fontSize}px`;
            const key = `${cluster.id}:${cluster.name}:${fontSize}`;
            let size = nameSizes.current.get(key);
            if (!size) nameSizes.current.set(key, (size = { w: nameEl.offsetWidth, h: nameEl.offsetHeight }));
            // Placed by the Books on screen, and kept on screen itself; with none of them showing, left off.
            const { top, bottom, side } = CLUSTER_NAME_CLEAR;
            const [canvasW, canvasH] = [f.width(), f.height()];
            const pts = members.map((n) => screen.get(n.id)!).filter((p) => p.x >= 0 && p.x <= canvasW && p.y >= 0 && p.y <= canvasH);
            if (pts.length === 0) {
              nameEl.style.visibility = "hidden";
              continue;
            }
            const x = Math.min(canvasW - side - size.w / 2, Math.max(side + size.w / 2, pts.reduce((sum, p) => sum + p.x, 0) / pts.length));
            const gap = r * CLUSTER_NAME_OFFSET + size.h / 2;
            const at = (y: number): Box => {
              const cy = Math.min(canvasH - bottom - size.h / 2, Math.max(top + size.h / 2, y));
              return { x0: x - size.w / 2, y0: cy - size.h / 2, x1: x + size.w / 2, y1: cy + size.h / 2 };
            };
            const above = at(Math.min(...pts.map((p) => p.y)) - gap);
            const below = at(Math.max(...pts.map((p) => p.y)) + gap);
            const mine = new Set(cluster.bookIds);
            const box = fewer(crowding(below, mine), crowding(above, mine)) ? below : above;
            const chosen = cluster.id === chosenClusterId;
            // Left off where it would sit on another name or under the panel; the chosen name always shows.
            const off = !chosen && (names.some((o) => hit(box, o)) || box.x1 > uncovered);
            nameEl.style.visibility = off ? "hidden" : "visible";
            if (off) continue;
            labels.push(box);
            names.push(box);
            nameEl.toggleAttribute("data-faded", litBooks !== null && !chosen);
            nameEl.style.transform = `translate(${box.x0}px, ${box.y0}px)`;
            nameEl.style.opacity = String(faded(cluster.id, now));
          }
        })
        .onNodeHover((n) => {
          hoverRef.current = n?.id ?? null;
          host.style.cursor = n ? "pointer" : "";
        })
        .onLinkHover((l) => {
          hoverLinkRef.current = l?.id ?? null;
          if (!hoverRef.current) host.style.cursor = l ? "pointer" : "";
        })
        .onNodeClick((n) => onSelectRef.current({ kind: "book", bookId: n.id }))
        .onLinkClick((l) => onSelectRef.current({ kind: "connection", id: l.id }))
        .onBackgroundClick(() => onSelectRef.current(null))
        // The stored layout stays put; a drag wakes the simulation, which settles everything back home.
        .warmupTicks(0)
        .cooldownTicks(0)
        .d3AlphaDecay(DRAG.alphaDecay)
        .d3VelocityDecay(DRAG.velocityDecay);
      const link = f.d3Force("link") as unknown as { distance: (fn: (l: Link) => number) => { strength: (s: number) => void } };
      link.distance((l) => l.rest).strength(DRAG.link);
      const charge = f.d3Force("charge") as unknown as { strength: (s: number) => { distanceMax: (d: number) => void } };
      charge.strength(DRAG.charge).distanceMax(TYPICAL_EDGE_LENGTH);
      f.d3Force("center", null);
      f.d3Force("home", (() => {
        for (const n of data().nodes) {
          n.vx! += (n.homeX - n.x!) * DRAG.home;
          n.vy! += (n.homeY - n.y!) * DRAG.home;
        }
      }) as never);
      ro = new ResizeObserver(() => f.width(host.clientWidth).height(host.clientHeight));
      ro.observe(host);
      // Names measured in a fallback face are measured again in Newsreader.
      void document.fonts.ready.then(() => nameSizes.current.clear());
      setReady(true);
    });

    return () => {
      cancelled = true;
      clearTimeout(pause);
      ro?.disconnect();
      fg?._destructor();
      fgRef.current = null;
    };
  }, []);

  // The first graph is fitted to the screen once, by whichever comes first: the graph, or a move to a
  // selection made before the canvas was ready (an arrival), which needs the fitted view to move from.
  // False until force-graph has taken the graph in (it does so a tick after being handed it).
  const fitted = useRef(false);
  const fitFirst = (f: ForceGraph<Node, Link>) => {
    if (fitted.current) return true;
    if (!f.getGraphBbox()) return false;
    fitted.current = true;
    f.zoomToFit(0, FIT_PADDING);
    if (f.zoom() > MAX_FIT_ZOOM) f.zoom(MAX_FIT_ZOOM);
    return true;
  };

  // Each graph in turn: the first is fitted to the screen; a later one, fetched after background work,
  // keeps the reader's view, and any Cluster it has that the last one lacked fades in.
  const shown = useRef<Set<string> | null>(null);
  useEffect(() => {
    const f = fgRef.current;
    if (!f) return;
    const first = shown.current === null;
    const now = performance.now();
    const fresh = first || reducedMotion() ? [] : prepared.clusters.filter((c) => !shown.current!.has(c.cluster.id));
    for (const c of fresh) appeared.current.set(c.cluster.id, now);
    shown.current = new Set(prepared.clusters.map((c) => c.cluster.id));
    dataRef.current = prepared;
    // The stored layout stays put; a drag wakes the simulation, which settles everything back home.
    f.cooldownTicks(0).graphData({ nodes: prepared.nodes, links: prepared.links });
    // Redrawn every frame while a Cluster fades in, since nothing else is moving.
    if (fresh.length) animateFor.current(WASH_FADE_MS);
    // Once the canvas has its size, fit the first graph, then let drags run the simulation.
    let frame = requestAnimationFrame(function settle() {
      if (first && !fitFirst(f)) {
        frame = requestAnimationFrame(settle);
        return;
      }
      f.cooldownTicks(DRAG.settleTicks);
    });
    return () => cancelAnimationFrame(frame);
  }, [ready, prepared]);

  // An arriving Book lands as it first appears; a Connection leaving `withheld` starts drawing in.
  useEffect(() => {
    for (const id of withheld) held.current.add(id);
    withheldRef.current = withheld;
    const f = fgRef.current;
    if (!f) return;
    const now = performance.now();
    const still = reducedMotion();
    let moving = 0;
    for (const id of landing) {
      if (landed.current.has(id)) continue;
      landed.current.set(id, still ? -Infinity : now);
      moving = Math.max(moving, LAND_MS);
    }
    for (const id of held.current) {
      if (withheld.has(id)) continue;
      held.current.delete(id);
      if (still) continue;
      drawing.current.set(id, now);
      moving = Math.max(moving, DRAW_MS);
    }
    f.linkVisibility(f.linkVisibility());
    if (moving) animateFor.current(moving);
  }, [ready, landing, withheld]);

  // A new selection: swap the focus, redraw, and bring the chosen Book, Connection or Cluster into the part of
  // the canvas the panel leaves uncovered. Clearing the selection returns the view the reader had.
  // A change to the trail alone only redraws.
  const before = useRef<{ x: number; y: number; zoom: number } | null>(null);
  const centredOn = useRef<string | null>(null);
  // Arriving Books already framed: only the arrival brings the Books a Book connects to into view.
  const framed = useRef(new Set<string>());
  useEffect(() => {
    focusRef.current = focus;
    const f = fgRef.current;
    if (!f) return;
    f.linkVisibility(f.linkVisibility());
    const key = focus.chosenBookId ?? focus.chosenLinkId ?? focus.chosenClusterId;
    // On the next frame, once the canvas has its size, moving from the fitted view.
    let frame = requestAnimationFrame(function move() {
      if (key === centredOn.current) return;
      if (!fitFirst(f)) {
        frame = requestAnimationFrame(move);
        return;
      }
      centredOn.current = key;
      const chosen = focus.chosenBookId
        ? [prepared.byId.get(focus.chosenBookId)]
        : focus.chosenLinkId
          ? (() => {
              const l = prepared.links.find((x) => x.id === focus.chosenLinkId)!;
              return [prepared.byId.get(endId(l.source)), prepared.byId.get(endId(l.target))];
            })()
          : (prepared.clusters.find((c) => c.cluster.id === focus.chosenClusterId)?.nodes ?? []);
      const at = chosen.filter((n) => n !== undefined);
      const arrived = focus.chosenBookId !== null && landed.current.has(focus.chosenBookId) && !framed.current.has(focus.chosenBookId);
      if (arrived) {
        // A Book arriving is framed with the Books it connects to, zooming out if they need the room,
        // so the reader sees where it sits.
        const id = focus.chosenBookId!;
        framed.current.add(id);
        const ends = prepared.links.filter((l) => endId(l.source) === id || endId(l.target) === id);
        const others = ends.map((l) => prepared.byId.get(endId(l.source) === id ? endId(l.target) : endId(l.source)));
        const all = [...at, ...others.filter((n) => n !== undefined)];
        const [xs, ys] = [all.map((n) => n.x!), all.map((n) => n.y!)];
        const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
        const zoom = Math.min(f.zoom(), (f.width() - insetRef.current - 2 * ARRIVAL_FRAME) / (x1 - x0 || 1), (f.height() - 2 * ARRIVAL_FRAME) / (y1 - y0 || 1));
        before.current ??= { ...f.centerAt(), zoom: f.zoom() };
        f.centerAt((x0 + x1) / 2 + insetRef.current / 2 / zoom, (y0 + y1) / 2, glide());
        f.zoom(zoom, glide());
      } else if (at.length) {
        before.current ??= { ...f.centerAt(), zoom: f.zoom() };
        const x = at.reduce((sum, n) => sum + n.x!, 0) / at.length;
        const y = at.reduce((sum, n) => sum + n.y!, 0) / at.length;
        f.centerAt(x + insetRef.current / 2 / f.zoom(), y, glide());
      } else if (before.current) {
        f.centerAt(before.current.x, before.current.y, glide());
        f.zoom(before.current.zoom, glide());
        before.current = null;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [focus, prepared, ready]);

  useEffect(() => {
    pointedRef.current = pointedBookId;
    const f = fgRef.current;
    if (f) f.linkVisibility(f.linkVisibility());
  }, [pointedBookId]);

  return (
    <>
      {/* How many Connections are still to draw in, for the browser tests. */}
      <div ref={el} className="absolute inset-0" aria-hidden data-withheld={withheld.size} />
      {/* Cluster names, placed by the canvas each frame. The keyboard reaches Clusters through the
          workspace's list instead. Hidden until first placed. */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        {graph.clusters.map((c) => (
          <ClusterName
            key={c.id}
            cluster={c}
            chosen={c.id === focus.chosenClusterId}
            onSelect={() => onSelect({ kind: "cluster", id: c.id })}
            nameRef={(node) => {
              if (node) nameEls.current.set(c.id, node);
              else nameEls.current.delete(c.id);
            }}
          />
        ))}
      </div>
    </>
  );
}

function ClusterName({ cluster, chosen, onSelect, nameRef }: { cluster: GraphCluster; chosen: boolean; onSelect: () => void; nameRef: (node: HTMLButtonElement | null) => void }) {
  return (
    <button
      ref={nameRef}
      type="button"
      tabIndex={-1}
      data-cluster-name={cluster.id}
      data-chosen={chosen || undefined}
      onClick={onSelect}
      style={{ "--name": CLUSTER_NAME_COLOR, "--faded": FADED_LABEL, fontSize: CLUSTER_NAME_SIZE.max, visibility: "hidden" } as React.CSSProperties}
      className="pointer-events-auto absolute top-0 left-0 rounded-[2px] bg-paper/80 px-1.5 py-0.5 font-serif leading-tight font-medium whitespace-nowrap text-(--name) italic decoration-rule decoration-1 underline-offset-[5px] transition-colors duration-150 hover:bg-paper/95 hover:text-ink hover:underline data-chosen:bg-paper/95 data-chosen:text-ink data-faded:bg-transparent data-faded:text-(--faded)"
    >
      {cluster.name}
    </button>
  );
}
