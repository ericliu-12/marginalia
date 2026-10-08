"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type ForceGraph from "force-graph";
import { joins, otherBook, touches } from "@/domain/connection-pair";
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
  LABEL_LINE,
  LABEL_PLATE,
  LABEL_SIZE,
  LAND_MS,
  LAND_RING,
  LEAD_LABELS,
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
import { overlaps, placeLabels, placeNames, type Box, type Dot, type LabelRequest, type NameRequest } from "./placement";

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
// id-to-node map, and each Cluster's Books (as nodes, and as a set of ids).
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
  const clusters = graph.clusters.map((cluster) => ({
    cluster,
    nodes: cluster.bookIds.map((id) => byId.get(id)!).filter(Boolean),
    members: new Set(cluster.bookIds),
  }));
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
      if (!touches(c, chosenBookId)) continue;
      litLinks.add(c.id);
      litBooks.add(otherBook(c, chosenBookId));
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
    const c = graph.connections.find((c) => joins(c, x, y));
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

// A Cluster's wash: its pools at full tint, in a canvas covering them at (x, y), w by h graph units.
// Drawn `sharp` device pixels to the graph unit, or coarser for a big Cluster (pools are soft), and
// again once the zoom has moved WASH_RESCALE times from that or the Books have moved.
type Wash = { canvas: HTMLCanvasElement; nodes: Node[]; x: number; y: number; w: number; h: number; sharp: number; moved: boolean };
const WASH_RESCALE = 2;
const WASH_MAX_SIDE = 1024;

function drawWash(nodes: Node[], tint: string, r: number, sharp: number, canvas = document.createElement("canvas")): Wash {
  const xs = nodes.map((n) => n.x!);
  const ys = nodes.map((n) => n.y!);
  const [x, y] = [Math.min(...xs) - r, Math.min(...ys) - r];
  const [w, h] = [Math.max(...xs) + r - x, Math.max(...ys) + r - y];
  const scale = Math.min(sharp, WASH_MAX_SIDE / Math.max(w, h));
  // Resizing clears it.
  Object.assign(canvas, { width: Math.ceil(w * scale), height: Math.ceil(h * scale) });
  const lc = canvas.getContext("2d")!;
  lc.setTransform(scale, 0, 0, scale, -x * scale, -y * scale);
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
  return { canvas, nodes, x, y, w, h, sharp, moved: false };
}

// Camera moves glide, new Clusters fade in, and new Books arrive, unless the reader asked for less motion.
export const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const glide = () => (reducedMotion() ? 0 : 600);

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
    // Each Cluster's wash, as last drawn; and whether a drag's simulation is moving the Books.
    const washes = new Map<string, Wash>();
    let simulating = false;

    // The last placement, and what it was made for: each label's box relative to its dot.
    let kept: { scene: { focus: Focus; data: ReturnType<typeof prepare>; key: string }; labels: { id: string; text: string; box: Box }[] } | null = null;
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

      // Places every label and Cluster name afresh, moving the names into place; the labels, each with
      // its box relative to its dot.
      const place = (ctx: CanvasRenderingContext2D, k: number, view: { width: number; height: number }, dots: Dot[], screen: Map<string, Dot>) => {
        const { labelOrder, litBooks, chosenBookId, chosenClusterId } = focusRef.current;
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
        const { byId, clusters } = data();
        const hovered = pointed();
        const requests: LabelRequest[] = [];
        const texts = new Map<string, string>();
        const H = LABEL_SIZE * LABEL_LINE;
        for (const n of hovered ? [byId.get(hovered), ...labelOrder] : labelOrder) {
          if (!n || texts.has(n.id)) continue;
          const must = n.id === hovered || n.id === chosenBookId;
          // Faded Books stay unlabelled unless the reader is close enough to read them anyway.
          if (litBooks && !litBooks.has(n.id) && k < 1.6 && !must) continue;
          const text = must ? n.book.title : n.label;
          texts.set(n.id, text);
          const s = screen.get(n.id)!;
          const gap = n.radius + LABEL_GAP + (ringed(n.id) ? RING_GAP : 0);
          const over = requests.length < LEAD_LABELS;
          requests.push({ id: n.id, x: s.x, y: s.y, gap, plate: LABEL_PLATE, w: width(text) + 2 * LABEL_PLATE, h: H, must, over });
        }
        // Behind a selection, faded Books give way to the lit ones' labels; and no label goes under the
        // wordmark, the legend or the panel.
        const blocking = litBooks ? dots.filter((d) => litBooks.has(d.id)) : dots;
        const origin = host.getBoundingClientRect();
        const chrome: Box[] = [...document.querySelectorAll("[data-graph-chrome]")].map((el) => {
          const r = el.getBoundingClientRect();
          return { x0: r.left - origin.left, y0: r.top - origin.top, x1: r.right - origin.left, y1: r.bottom - origin.top };
        });
        if (insetRef.current) chrome.push({ x0: view.width - insetRef.current, y0: 0, x1: view.width, y1: view.height });
        const first = placeLabels({ view, dots: blocking, requests, obstacles: chrome });

        const r = WASH_RADIUS * TYPICAL_EDGE_LENGTH * k;
        const fontSize = Math.round(Math.min(CLUSTER_NAME_SIZE.max, Math.max(CLUSTER_NAME_SIZE.min, r * CLUSTER_NAME_SIZE.perRadius)) * 2) / 2;
        const names: NameRequest[] = [];
        for (const { cluster, nodes: books, members } of clusters) {
          const nameEl = nameEls.current.get(cluster.id);
          if (!nameEl || books.length === 0) continue;
          if (nameEl.style.fontSize !== `${fontSize}px`) nameEl.style.fontSize = `${fontSize}px`;
          const key = `${cluster.id}:${cluster.name}:${fontSize}`;
          let size = nameSizes.current.get(key);
          if (!size) nameSizes.current.set(key, (size = { w: nameEl.offsetWidth, h: nameEl.offsetHeight }));
          names.push({ id: cluster.id, members, ...size, chosen: cluster.id === chosenClusterId });
        }
        const placed = placeNames({
          view,
          clear: CLUSTER_NAME_CLEAR,
          uncovered: view.width - insetRef.current,
          washRadius: r,
          offset: CLUSTER_NAME_OFFSET,
          dots,
          labels: first.map((l) => l.box),
          names,
        });
        const now = performance.now();
        for (const [id, box] of placed) {
          const nameEl = nameEls.current.get(id)!;
          nameEl.style.visibility = box ? "visible" : "hidden";
          if (!box) continue;
          nameEl.toggleAttribute("data-faded", litBooks !== null && id !== chosenClusterId);
          nameEl.style.transform = `translate(${box.x0}px, ${box.y0}px)`;
          nameEl.style.opacity = String(faded(id, now));
        }

        // Placed again, now clear of the names, so none is drawn under one; behind a selection, only the
        // chosen Cluster's name holds its place, and any other a label then lands on is left off.
        const holding = [...placed].filter(([id, box]) => box !== null && (!litBooks || id === chosenClusterId)).map(([, box]) => box!);
        const labels = holding.length ? placeLabels({ view, dots: blocking, requests, obstacles: [...chrome, ...holding] }) : first;
        for (const [id, box] of placed) {
          if (!box || holding.includes(box) || !labels.some((l) => overlaps(l.box, box))) continue;
          nameEls.current.get(id)!.style.visibility = "hidden";
        }
        return labels.map(({ id, box }) => {
          const s = screen.get(id)!;
          return { id, text: texts.get(id)!, box: { x0: box.x0 - s.x, y0: box.y0 - s.y, x1: box.x1 - s.x, y1: box.y1 - s.y } };
        });
      };

      f.width(host.clientWidth)
        .height(host.clientHeight)
        .backgroundColor("rgba(0,0,0,0)")
        .nodeId("id")
        // Washes first, under everything: each Cluster's pools drawn at full tint into a canvas of its
        // own, which goes on the paper at the Cluster's strength, so they never add up. Lighter behind any
        // other selection. Drawn in graph units and kept while the camera moves, and while a drag's
        // simulation runs (they catch up once it settles); drawn again for a fresh graph, or once the zoom
        // is far from the one they were drawn at.
        .onRenderFramePre((ctx, k) => {
          const { chosenClusterId, litBooks } = focusRef.current;
          const r = WASH_RADIUS * TYPICAL_EDGE_LENGTH;
          const now = performance.now();
          const sharp = k * window.devicePixelRatio;
          const { clusters } = data();
          // Washes of Clusters gone from a fresh graph are let go.
          if (washes.size > clusters.length) for (const id of washes.keys()) if (!clusters.some((c) => c.cluster.id === id)) washes.delete(id);
          for (const { cluster, nodes } of clusters) {
            const alpha = (cluster.id === chosenClusterId ? WASH_ALPHA.chosen : litBooks ? WASH_ALPHA.faded : WASH_ALPHA.rest) * faded(cluster.id, now);
            if (alpha <= 0 || nodes.length === 0) continue;
            let wash = washes.get(cluster.id);
            const stale =
              !wash || wash.nodes !== nodes || (!simulating && (wash.moved || sharp > wash.sharp * WASH_RESCALE || sharp < wash.sharp / WASH_RESCALE));
            if (stale) washes.set(cluster.id, (wash = drawWash(nodes, WASH[cluster.wash], r, sharp, wash?.canvas)));
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.drawImage(wash!.canvas, wash!.x, wash!.y, wash!.w, wash!.h);
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
        // Labels last, over the edges, each on a paper plate so no edge strikes through it, placed in
        // priority order by placeLabels; the hovered and chosen Books always get theirs, in full. Each
        // Cluster's name is placed by placeNames among those labels, and the labels then again around the
        // names. While a drag's simulation runs and nothing else changes, the labels keep their sides and
        // follow their dots, and the names stay put, until it settles.
        .onRenderFramePost((ctx, k) => {
          const { nodes, byId } = data();
          const dots: Dot[] = nodes.map((n) => ({ id: n.id, ...f.graph2ScreenCoords(n.x!, n.y!), radius: n.radius }));
          const screen = new Map(dots.map((d) => [d.id, d]));
          const origin = f.graph2ScreenCoords(0, 0);
          const view = { width: f.width(), height: f.height() };
          const scene = { focus: focusRef.current, data: data(), key: [k, origin.x, origin.y, view.width, view.height, insetRef.current, pointed()].join() };
          const still = simulating && kept && kept.scene.focus === scene.focus && kept.scene.data === scene.data && kept.scene.key === scene.key;
          if (!still) kept = { scene, labels: place(ctx, k, view, dots, screen) };
          const { litBooks } = focusRef.current;
          ctx.font = font(k);
          ctx.textBaseline = "middle";
          ctx.textAlign = "center";
          for (const { id, text, box } of kept!.labels) {
            const n = byId.get(id)!;
            // Back to graph units for drawing, from where the dot is now.
            const p = (sx: number, sy: number) => ({ x: n.x! + sx / k, y: n.y! + sy / k });
            const corner = p(box.x0, box.y0);
            ctx.fillStyle = PAPER_PLATE;
            ctx.beginPath();
            ctx.roundRect(corner.x, corner.y, (box.x1 - box.x0) / k, (box.y1 - box.y0) / k, 2 / k);
            ctx.fill();
            const mid = p((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2);
            ctx.fillStyle = !litBooks || litBooks.has(id) ? INK : FADED_LABEL;
            ctx.fillText(text, mid.x, mid.y);
          }
        })
        // Only a drag runs the simulation, and the settling after it; a fresh graph never starts it.
        .onNodeDrag(() => {
          simulating = true;
          f.cooldownTicks(DRAG.settleTicks);
        })
        .onNodeDragEnd(() => f.cooldownTicks(DRAG.settleTicks))
        .onEngineStop(() => {
          simulating = false;
          f.cooldownTicks(0);
          // The Books have moved: each wash is drawn again where they now are.
          for (const wash of washes.values()) wash.moved = true;
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
    // Once the canvas has its size, fit the first graph.
    let frame = requestAnimationFrame(function fit() {
      if (first && !fitFirst(f)) frame = requestAnimationFrame(fit);
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
      className="pointer-events-auto absolute top-0 left-0 rounded-[2px] bg-paper/80 px-1.5 py-0.5 font-serif leading-tight font-medium whitespace-nowrap text-(--name) italic decoration-rule decoration-1 underline-offset-[5px] transition-colors duration-150 hover:bg-paper/95 hover:text-ink hover:underline data-chosen:bg-paper/95 data-chosen:text-ink data-faded:bg-paper/60 data-faded:text-(--faded)"
    >
      {cluster.name}
    </button>
  );
}
