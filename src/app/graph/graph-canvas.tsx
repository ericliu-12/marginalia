"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type ForceGraph from "force-graph";
import { joins, otherBook, touches } from "@/domain/connection-pair";
import { fitDrawn } from "@/domain/graph-fit";
import { visibleConnections, type GraphBook, type GraphCluster, type GraphConnection, type GraphView } from "@/domain/graph";
import {
  ARRIVAL_FRAME,
  blend,
  CLUSTER_NAME_CLEAR,
  CLUSTER_NAME_GAP,
  CLUSTER_NAME_SIZE,
  clusterNameSize,
  DRAG,
  DRAW_MS,
  EDGE_WIDTH,
  EDGE_WIDTH_CHOSEN_EXTRA,
  EDGE_WIDTH_FADED,
  EDGE_WIDTH_HOVER_EXTRA,
  FADED_EDGE,
  FADED_LABEL,
  FADED_NODE,
  INK,
  LABEL_GAP,
  LABEL_LINE,
  LABEL_PLATE,
  LABEL_SIZE,
  LAND_MS,
  LAND_RING,
  LONE_INK,
  LONE_RING,
  layoutScale,
  RECENT_LABELS,
  TYPE_COLOR,
  RING_GAP,
  SELECT_FADE_MS,
  TRAIL_CASING,
  TYPICAL_EDGE_LENGTH,
  WASH_ALPHA,
  WASH_BLUR,
  WASH_CORE,
  WASH_FADE_MS,
  WASH_FOLLOW_MS,
  WASH_HOVER_MS,
  WASH_REACH,
  WASH_SHAPE_MS,
  nodeRadius,
} from "./graph-style";
import { clusterTint } from "../cluster-tint";
import { overlaps, placeLabels, placeNames, type Box, type Dot, type LabelRequest, type NameRequest } from "./placement";
import { washAt } from "./wash";

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
// id-to-node map, and each Cluster's Books (as nodes, and as a set of ids) and the Connections drawn at
// rest between them (the bands of its wash).
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
  const clusters = graph.clusters.map((cluster) => {
    const members = new Set(cluster.bookIds);
    const nodes = cluster.bookIds.map((id) => byId.get(id)!).filter(Boolean);
    const bands = graph.connections.filter((c) => c.featured && members.has(c.a) && members.has(c.b)).map((c): [Node, Node] => [byId.get(c.a)!, byId.get(c.b)!]);
    return { cluster, nodes, members, bands, shape: { id: cluster.id, books: nodes, bands } };
  });
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

// A Cluster's wash: its shape (a disc at each Book, a band along each Connection between two) at full
// tint, blurred, in a canvas of its own covering it at (x, y), w by h graph units. Being blurred, it is
// drawn coarse, WASH_PIXELS of blur deep, and scaled up on the paper, so it never needs drawing again
// for a zoom: only when its Books move. Where they were when it was drawn is kept to tell.
// A wash whose shape changed with a fresh graph keeps its last shape, `was`, to ease out of.
type Wash = {
  canvas: HTMLCanvasElement;
  nodes: Node[];
  drawnAt: Float64Array;
  drawn: number;
  x: number;
  y: number;
  w: number;
  h: number;
  // Its Connections, by their Books, to tell a fresh graph that changed its shape from one that didn't.
  bands: string;
  was?: { canvas: HTMLCanvasElement; x: number; y: number; w: number; h: number; since: number };
};
const WASH_PIXELS = 8;
const WASH_MAX_SIDE = 2048;
// The solid shape, before its blur.
let solid: HTMLCanvasElement | null = null;

function drawWash(nodes: Node[], bands: [Node, Node][], tint: string, canvas = document.createElement("canvas")): Wash {
  const core = WASH_CORE * TYPICAL_EDGE_LENGTH;
  const blur = WASH_BLUR * TYPICAL_EDGE_LENGTH;
  const pad = core + 3 * blur;
  const xs = nodes.map((n) => n.x!);
  const ys = nodes.map((n) => n.y!);
  const [x, y] = [Math.min(...xs) - pad, Math.min(...ys) - pad];
  const [w, h] = [Math.max(...xs) + pad - x, Math.max(...ys) + pad - y];
  const scale = Math.min(WASH_PIXELS / blur, WASH_MAX_SIDE / Math.max(w, h));
  const [width, height] = [Math.ceil(w * scale), Math.ceil(h * scale)];
  solid ??= document.createElement("canvas");
  // Setting a size clears it.
  Object.assign(solid, { width, height });
  Object.assign(canvas, { width, height });
  const sc = solid.getContext("2d")!;
  sc.setTransform(scale, 0, 0, scale, -x * scale, -y * scale);
  sc.fillStyle = sc.strokeStyle = "#000";
  sc.lineWidth = 2 * core;
  sc.lineCap = sc.lineJoin = "round";
  sc.beginPath();
  for (const [p, q] of bands) {
    sc.moveTo(p.x!, p.y!);
    sc.lineTo(q.x!, q.y!);
  }
  sc.stroke();
  sc.beginPath();
  for (const n of nodes) {
    sc.moveTo(n.x! + core, n.y!);
    sc.arc(n.x!, n.y!, core, 0, Math.PI * 2);
  }
  sc.fill();
  // Blurred as a shadow in the tint, cast from a copy drawn off the canvas, so only the shadow lands:
  // every browser blurs a shadow, and the shape is one image, so its parts never add up where they meet.
  const lc = canvas.getContext("2d")!;
  lc.shadowColor = tint;
  lc.shadowBlur = 2 * blur * scale;
  lc.shadowOffsetX = width;
  lc.drawImage(solid, -width, 0);
  const drawnAt = new Float64Array(nodes.length * 2);
  nodes.forEach((n, i) => drawnAt.set([n.x!, n.y!], i * 2));
  return { canvas, nodes, drawnAt, drawn: performance.now(), x, y, w, h, bands: bandsKey(bands) };
}

const bandsKey = (bands: [Node, Node][]) => bands.map(([p, q]) => `${p.id}-${q.id}`).join();
// Whether a fresh graph gives a wash another shape: other Books, Books elsewhere, or other Connections.
function reshaped(wash: Wash, nodes: Node[], bands: [Node, Node][]) {
  if (wash.nodes.length !== nodes.length || wash.bands !== bandsKey(bands)) return true;
  return nodes.some((n, i) => n.id !== wash.nodes[i].id || Math.abs(n.x! - wash.drawnAt[i * 2]) > WASH_STILL || Math.abs(n.y! - wash.drawnAt[i * 2 + 1]) > WASH_STILL);
}

// Whether any of a wash's Books has moved since it was drawn, by more than a hair.
const WASH_STILL = 0.5;
function washMoved(wash: Wash) {
  return wash.nodes.some((n, i) => Math.abs(n.x! - wash.drawnAt[i * 2]) > WASH_STILL || Math.abs(n.y! - wash.drawnAt[i * 2 + 1]) > WASH_STILL);
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
  pointedClusterId,
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
  // A Cluster the reader has reached from the keyboard list: its wash deepens as if hovered.
  pointedClusterId: string | null;
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
  // The focus before the last selection change, and when it changed: the graph fades from one to the other.
  const wasFocusRef = useRef<Focus | null>(null);
  const focusAt = useRef(0);
  const hoverRef = useRef<string | null>(null);
  const hoverLinkRef = useRef<string | null>(null);
  const pointedRef = useRef(pointedBookId);
  const pointedClusterRef = useRef(pointedClusterId);
  // The wash under the pointer, where no Book or Connection is; and when the deepened wash last changed.
  const hoverWashRef = useRef<string | null>(null);
  const deepened = useRef<{ id: string | null; was: string | null; at: number }>({ id: null, was: null, at: 0 });
  // Works out the hovered wash again, as the pointer or the keyboard list moves.
  const rehover = useRef(() => {});
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
    const font = (k: number, italic = false) => `${italic ? "italic " : ""}500 ${LABEL_SIZE / k}px ${serif}, Georgia, serif`;
    const widths = new Map<string, number>();
    // Names and labels measured in a fallback face are measured again once Newsreader has loaded.
    const remeasure = () => {
      nameSizes.current.clear();
      widths.clear();
    };
    document.fonts.addEventListener("loadingdone", remeasure);
    // Each Cluster's wash, as last drawn; and whether a drag's simulation is moving the Books.
    const washes = new Map<string, Wash>();
    let simulating = false;
    // The pointer's place over the canvas, while it is there.
    let pointer: { x: number; y: number } | null = null;
    // Asks force-graph for a frame: it draws again when one of its settings is set.
    const redraw = () => fg?.linkVisibility(fg.linkVisibility());

    // Whether the pointer is moving with a button held (a pan or a drag): no wash is hovered meanwhile.
    // A press alone keeps the hover, so a click on a wash doesn't flicker it.
    let held = false;
    const onPointer = (e: PointerEvent) => {
      const box = host.getBoundingClientRect();
      pointer = e.type === "pointerleave" ? null : { x: e.clientX - box.left, y: e.clientY - box.top };
      if (e.type === "pointermove") held = e.buttons !== 0;
      else if (e.type !== "pointerdown") held = false;
      hoverWash();
    };
    const hoverWash = () => rehover.current();
    for (const type of ["pointermove", "pointerdown", "pointerup", "pointerleave"] as const) host.addEventListener(type, onPointer);

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
      // A wash's strength under a focus, before any hover deepens it.
      const washBase = (focus: Focus, id: string) => (id === focus.chosenClusterId ? WASH_ALPHA.chosen : focus.litBooks ? WASH_ALPHA.faded : WASH_ALPHA.rest);
      // The wash at a point on the canvas, in screen pixels: the smallest, where washes overlap.
      const washUnder = (x: number, y: number) => {
        const at = f.screen2GraphCoords(x, y);
        return washAt(at.x, at.y, data().clusters.map((c) => c.shape), WASH_REACH * TYPICAL_EDGE_LENGTH);
      };
      // Which wash the pointer is on, where no Book or Connection is (they come first) and it is not
      // panning or dragging; the cursor says so, and that wash, or the one reached from the keyboard
      // list, deepens.
      rehover.current = () => {
        const over = hoverRef.current ?? hoverLinkRef.current;
        hoverWashRef.current = !over && pointer && !held ? washUnder(pointer.x, pointer.y) : null;
        host.style.cursor = over || hoverWashRef.current ? "pointer" : "";
        const id = hoverWashRef.current ?? pointedClusterRef.current;
        const deep = deepened.current;
        if (id === deep.id) return;
        // The hovered wash's name is underlined with it, so the two read as one thing to choose.
        for (const [cid, nameEl] of nameEls.current) nameEl.toggleAttribute("data-hovered", cid === hoverWashRef.current);
        deepened.current = { id, was: deep.id, at: performance.now() };
        animateFor.current(reducedMotion() ? 0 : WASH_HOVER_MS);
        redraw();
      };
      const ringed = (id: string) => id === focusRef.current.chosenBookId || id === pointed() || focusRef.current.trailBooks.has(id);
      // How far the graph is from the last focus to this one, 0 to 1; 1 once the fade is over, or with
      // no fade to make.
      const shift = () => {
        const was = wasFocusRef.current;
        return was ? easeOut(progress(focusAt.current, SELECT_FADE_MS)) : 1;
      };
      // How lit a Book is, 0 (faded) to 1, part way while a selection fades the rest in or out.
      const litIn = (focus: Focus, id: string) => (!focus.litBooks || focus.litBooks.has(id) ? 1 : 0);
      const bookLit = (id: string) => {
        const now = litIn(focusRef.current, id);
        const t = shift();
        if (t >= 1) return now;
        const was = litIn(wasFocusRef.current!, id);
        return was + (now - was) * t;
      };
      // Two colours by how lit a Book is: either, or a blend while it fades.
      const byLit = (lit: number, faded: string, full: string) => (lit >= 1 ? full : lit <= 0 ? faded : blend(faded, full, lit));
      // A Connection as one focus draws it: whether shown, its colour and its width.
      const linkLook = (focus: Focus, l: Link) => {
        const shown = focus.visible.has(l.id);
        if (l.id === focus.chosenLinkId) return { shown, color: TYPE_COLOR[l.connection.type], width: EDGE_WIDTH[l.connection.strength] + EDGE_WIDTH_CHOSEN_EXTRA };
        if (focus.litLinks && !focus.litLinks.has(l.id)) return { shown, color: FADED_EDGE, width: EDGE_WIDTH_FADED };
        const extra = l.id === hoverLinkRef.current ? EDGE_WIDTH_HOVER_EXTRA : 0;
        return { shown, color: TYPE_COLOR[l.connection.type], width: EDGE_WIDTH[l.connection.strength] + extra };
      };
      // Mid-fade, a Connection eases from the last focus's look to this one's, fading in or out where
      // only one of them shows it.
      const colorOf = (l: Link) => {
        const now = linkLook(focusRef.current, l);
        const t = shift();
        if (t >= 1) return now.color;
        const was = linkLook(wasFocusRef.current!, l);
        if (!was.shown) return blend(now.color, now.color, 1, t);
        if (!now.shown) return blend(was.color, was.color, 1, 1 - t);
        return blend(was.color, now.color, t);
      };
      const widthOf = (l: Link) => {
        const now = linkLook(focusRef.current, l);
        const t = shift();
        if (t >= 1 || !now.shown) return now.width;
        const was = linkLook(wasFocusRef.current!, l);
        return was.shown ? was.width + (now.width - was.width) * t : now.width;
      };

      // Places every label and Cluster name afresh, moving the names into place; the labels, each with
      // its box relative to its dot.
      const place = (ctx: CanvasRenderingContext2D, k: number, view: { width: number; height: number }, dots: Dot[], screen: Map<string, Dot>) => {
        const { labelOrder, litBooks, chosenBookId, chosenClusterId } = focusRef.current;
        const width = (text: string, italic: boolean) => {
          const key = `${italic ? "i" : ""}:${text}`;
          let w = widths.get(key);
          if (w === undefined) {
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.font = font(1, italic);
            w = ctx.measureText(text).width;
            ctx.restore();
            widths.set(key, w);
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
          requests.push({ id: n.id, x: s.x, y: s.y, gap, plate: LABEL_PLATE, w: width(text, n.book.degree === 0) + 2 * LABEL_PLATE, h: H, must });
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
        // The Connections drawn now, which labels keep off where they can.
        const idOf = (end: string | Node) => (typeof end === "string" ? end : end.id);
        const lines = data()
          .links.filter((l) => focusRef.current.visible.has(l.id) && !withheldRef.current.has(l.id))
          .map((l) => [screen.get(idOf(l.source)), screen.get(idOf(l.target))])
          .filter((ends): ends is [Dot, Dot] => ends.every((e) => e !== undefined))
          .map(([p, q]) => ({ x0: p.x, y0: p.y, x1: q.x, y1: q.y }));
        const first = placeLabels({ view, dots: blocking, requests, obstacles: chrome, lines });

        // Names sit just past where a wash's tint is still plainly seen, so each reads as its wash's.
        const r = WASH_REACH * TYPICAL_EDGE_LENGTH * k;
        const fontSize = clusterNameSize(k);
        const names: NameRequest[] = [];
        for (const { cluster, nodes: books, members } of clusters) {
          const nameEl = nameEls.current.get(cluster.id);
          if (!nameEl || books.length === 0) continue;
          if (nameEl.style.fontSize !== `${fontSize}px`) nameEl.style.fontSize = `${fontSize}px`;
          const key = `${cluster.id}:${cluster.name}:${fontSize}`;
          let size = nameSizes.current.get(key);
          if (!size) nameSizes.current.set(key, (size = { w: nameEl.offsetWidth, h: nameEl.offsetHeight }));
          // A Cluster reached from the keyboard always shows its name, as the chosen one does: it is the focus.
          names.push({ id: cluster.id, members, ...size, chosen: cluster.id === chosenClusterId || cluster.id === pointedClusterRef.current });
        }
        const placed = placeNames({
          view,
          clear: CLUSTER_NAME_CLEAR,
          uncovered: view.width - insetRef.current,
          washRadius: r,
          gap: CLUSTER_NAME_GAP,
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
        const holding = [...placed]
          .filter(([id, box]) => box !== null && (!litBooks || id === chosenClusterId || id === pointedClusterRef.current))
          .map(([, box]) => box!);
        const labels = holding.length ? placeLabels({ view, dots: blocking, requests, obstacles: [...chrome, ...holding], lines }) : first;
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
        // Washes first, under everything: each Cluster's shape drawn at full tint into a canvas of its
        // own, which goes on the paper at the Cluster's strength. Deeper under the pointer and while its
        // Cluster is chosen, lighter behind any other selection. Drawn in graph units and kept while the
        // camera moves; drawn again for a fresh graph, or once its Books have moved: while a drag's
        // simulation runs, at most every WASH_FOLLOW_MS, so it follows the Book being dragged.
        .onRenderFramePre((ctx) => {
          const now = performance.now();
          const t = shift();
          const { clusters } = data();
          // The deepened wash eases in as the last one eases out.
          const deep = deepened.current;
          const eased = progress(deep.at, reducedMotion() ? 0 : WASH_HOVER_MS);
          // Washes of Clusters gone from a fresh graph are let go.
          if (washes.size > clusters.length) for (const id of washes.keys()) if (!clusters.some((c) => c.cluster.id === id)) washes.delete(id);
          ctx.save();
          for (const { cluster, nodes, bands } of clusters) {
            const depth = cluster.id === deep.id ? eased : cluster.id === deep.was ? 1 - eased : 0;
            const toBase = washBase(focusRef.current, cluster.id);
            const base = t >= 1 ? toBase : washBase(wasFocusRef.current!, cluster.id) * (1 - t) + toBase * t;
            const alpha = (base + Math.max(0, WASH_ALPHA.hover - base) * depth) * faded(cluster.id, now);
            if (alpha <= 0 || nodes.length === 0) continue;
            let wash = washes.get(cluster.id);
            if (wash && wash.nodes !== nodes && !reducedMotion() && reshaped(wash, nodes, bands)) {
              // A fresh graph: drawn anew on a canvas of its own, easing out of the shape it had.
              const { canvas, x, y, w, h } = wash;
              washes.set(cluster.id, (wash = drawWash(nodes, bands, clusterTint(cluster.wash).tint)));
              wash.was = { canvas, x, y, w, h, since: now };
            } else if (!wash || wash.nodes !== nodes || ((!simulating || now - wash.drawn >= WASH_FOLLOW_MS) && washMoved(wash))) {
              washes.set(cluster.id, (wash = drawWash(nodes, bands, clusterTint(cluster.wash).tint, wash?.canvas)));
            }
            const reshaping = wash.was ? easeOut(progress(wash.was.since, WASH_SHAPE_MS)) : 1;
            if (reshaping < 1) {
              ctx.globalAlpha = alpha * (1 - reshaping);
              ctx.drawImage(wash.was!.canvas, wash.was!.x, wash.was!.y, wash.was!.w, wash.was!.h);
            } else wash.was = undefined;
            ctx.globalAlpha = alpha * reshaping;
            ctx.drawImage(wash.canvas, wash.x, wash.y, wash.w, wash.h);
          }
          ctx.restore();
        })
        // Mid-fade, a Connection the last focus showed stays, fading out.
        .linkVisibility(
          (l) => !withheldRef.current.has(l.id) && (focusRef.current.visible.has(l.id) || (shift() < 1 && wasFocusRef.current!.visible.has(l.id))),
        )
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
          const lit = bookLit(n.id);
          if (ringed(n.id)) {
            // A Book on the trail behind the chosen one gets a lighter ring.
            const behind = n.id !== focusRef.current.chosenBookId && n.id !== pointed();
            ctx.beginPath();
            ctx.arc(n.x!, n.y!, r + RING_GAP / k, 0, Math.PI * 2);
            ctx.lineWidth = (behind ? 1 : 1.5) / k;
            ctx.strokeStyle = INK;
            ctx.stroke();
          }
          // A Book with no Connections is a hollow dot, its ring inside the dot's size.
          ctx.beginPath();
          if (n.book.degree === 0) {
            ctx.arc(n.x!, n.y!, Math.max(0, r - LONE_RING / 2 / k), 0, Math.PI * 2);
            ctx.lineWidth = LONE_RING / k;
            // Behind a selection, in the faded label's colour: FADED_NODE as a hairline would all but vanish.
            ctx.strokeStyle = byLit(lit, FADED_LABEL, LONE_INK);
            ctx.stroke();
            return;
          }
          ctx.arc(n.x!, n.y!, r, 0, Math.PI * 2);
          ctx.fillStyle = byLit(lit, FADED_NODE, INK);
          ctx.fill();
        })
        .nodePointerAreaPaint((n, color, ctx, k) => {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(n.x!, n.y!, (n.radius + 5) / k, 0, Math.PI * 2);
          ctx.fill();
        })
        // Labels last, over the edges, as plain text, placed in priority order by placeLabels; the hovered and chosen Books always get theirs, in full. Each
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
          ctx.textBaseline = "middle";
          for (const { id, text, box } of kept!.labels) {
            const n = byId.get(id)!;
            const lone = n.book.degree === 0;
            ctx.font = font(k, lone);
            // Back to graph units for drawing, from where the dot is now. The text starts at the edge of
            // its box nearest the dot (centred above or below it), so it never reaches back over the dot.
            const p = (sx: number, sy: number) => ({ x: n.x! + sx / k, y: n.y! + sy / k });
            const [align, sx] = box.x0 > 0 ? (["left", box.x0 + LABEL_PLATE] as const) : box.x1 < 0 ? (["right", box.x1 - LABEL_PLATE] as const) : (["center", (box.x0 + box.x1) / 2] as const);
            ctx.textAlign = align;
            const at = p(sx, (box.y0 + box.y1) / 2);
            ctx.fillStyle = byLit(bookLit(id), FADED_LABEL, lone ? LONE_INK : INK);
            ctx.fillText(text, at.x, at.y);
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
          // One more frame, so each wash is drawn where its Books came to rest.
          redraw();
        })
        .onNodeHover((n) => {
          hoverRef.current = n?.id ?? null;
          hoverWash();
        })
        .onLinkHover((l) => {
          hoverLinkRef.current = l?.id ?? null;
          hoverWash();
        })
        .onNodeClick((n) => onSelectRef.current({ kind: "book", bookId: n.id }))
        .onLinkClick((l) => onSelectRef.current({ kind: "connection", id: l.id }))
        // A click on a wash (with no Book or Connection over it) chooses its Cluster, or lets go of it if
        // it is already chosen; a click on bare paper lets go of any selection (#48).
        .onBackgroundClick((e) => {
          const box = host.getBoundingClientRect();
          const id = washUnder(e.clientX - box.left, e.clientY - box.top);
          onSelectRef.current(id && id !== focusRef.current.chosenClusterId ? { kind: "cluster", id } : null);
        })
        // force-graph would show the pointer over all of the bare canvas, since a click there does
        // something; the canvas's own cursor (set on its host) says where it means a Cluster.
        .showPointerCursor((obj) => obj !== undefined)
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
      void document.fonts.ready.then(remeasure);
      setReady(true);
    });

    return () => {
      cancelled = true;
      document.fonts.removeEventListener("loadingdone", remeasure);
      for (const type of ["pointermove", "pointerdown", "pointerup", "pointerleave"] as const) host.removeEventListener(type, onPointer);
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
    // Positions are already drawn to scale: a typical Connection is TYPICAL_EDGE_LENGTH long.
    const { nodes, clusters, links } = dataRef.current;
    const fit = fitDrawn(
      {
        books: nodes.map((n) => ({ id: n.id, x: n.x!, y: n.y!, label: n.label, degree: n.book.degree })),
        clusters: clusters.map(({ cluster }) => cluster),
        connections: links.filter((l) => l.connection.featured).map((l) => ({ a: l.connection.a, b: l.connection.b })),
        unit: TYPICAL_EDGE_LENGTH,
      },
      { width: f.width(), height: f.height() },
    );
    f.centerAt(fit.x, fit.y);
    f.zoom(fit.zoom);
    return true;
  };

  // Each graph in turn: the first is fitted to the screen; a later one, fetched after background work,
  // keeps the reader's view, and any Cluster it has that the last one lacked fades in.
  // The Clusters last shown, with their names; and those whose name is writing in.
  const shown = useRef<Map<string, string> | null>(null);
  const [writing, setWriting] = useState<Set<string>>(new Set());
  useEffect(() => {
    const f = fgRef.current;
    if (!f) return;
    const first = shown.current === null;
    const now = performance.now();
    const fresh = first || reducedMotion() ? [] : prepared.clusters.filter((c) => !shown.current!.has(c.cluster.id));
    for (const c of fresh) appeared.current.set(c.cluster.id, now);
    // A Cluster that forms or takes a new name writes it in.
    // Kept, not replaced, so a graph fetched mid-write doesn't cut it short; a name writes in once, as it mounts.
    if (!first) {
      const named = prepared.clusters.filter((c) => shown.current!.get(c.cluster.id) !== c.cluster.name).map((c) => c.cluster.id);
      if (named.length) setWriting((w) => new Set([...w, ...named]));
    }
    shown.current = new Map(prepared.clusters.map((c) => [c.cluster.id, c.cluster.name]));
    dataRef.current = prepared;
    // The stored layout stays put; a drag wakes the simulation, which settles everything back home.
    f.cooldownTicks(0).graphData({ nodes: prepared.nodes, links: prepared.links });
    // Redrawn every frame while a Cluster fades in or a wash changes shape, since nothing else is moving.
    if (fresh.length) animateFor.current(WASH_FADE_MS);
    else if (!first && !reducedMotion()) animateFor.current(WASH_SHAPE_MS);
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
    // The graph fades from the last focus to this one, or with less motion changes at once; so does a
    // change that comes mid-fade, rather than jumping back to fade again.
    const midFade = wasFocusRef.current !== null && performance.now() - focusAt.current < SELECT_FADE_MS;
    const fade = focusRef.current !== focus && !reducedMotion() && !midFade;
    wasFocusRef.current = fade ? focusRef.current : null;
    focusAt.current = performance.now();
    focusRef.current = focus;
    const f = fgRef.current;
    if (!f) return;
    if (fade) animateFor.current(SELECT_FADE_MS);
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
    pointedClusterRef.current = pointedClusterId;
    rehover.current();
  }, [pointedClusterId]);

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
            // Keyed by name too, so each new name writes in afresh.
            key={`${c.id}:${c.name}`}
            cluster={c}
            writing={writing.has(c.id)}
            chosen={c.id === focus.chosenClusterId}
            pointed={c.id === pointedClusterId}
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

function ClusterName({
  cluster,
  chosen,
  pointed,
  writing,
  onSelect,
  nameRef,
}: {
  cluster: GraphCluster;
  writing: boolean;
  chosen: boolean;
  pointed: boolean;
  onSelect: () => void;
  nameRef: (node: HTMLButtonElement | null) => void;
}) {
  return (
    <button
      ref={nameRef}
      type="button"
      tabIndex={-1}
      data-cluster-name={cluster.id}
      data-chosen={chosen || undefined}
      data-pointed={pointed || undefined}
      onClick={onSelect}
      style={
        {
          "--name": clusterTint(cluster.wash).name,
          "--faded": FADED_LABEL,
          fontSize: CLUSTER_NAME_SIZE.max,
          visibility: "hidden",
        } as React.CSSProperties
      }
      className={`pointer-events-auto absolute top-0 left-0 rounded-[2px] bg-paper/80 px-1.5 py-0.5 font-serif leading-tight font-medium whitespace-nowrap text-(--name) italic decoration-(--name) decoration-1 underline-offset-[5px] transition-colors duration-150 hover:bg-paper/95 hover:underline data-chosen:bg-paper/95 data-chosen:underline data-hovered:bg-paper/95 data-hovered:underline data-pointed:bg-paper/95 data-pointed:underline data-pointed:outline-2 data-pointed:outline-offset-2 data-pointed:outline-thematic data-faded:bg-paper/60 data-faded:text-(--faded) data-faded:decoration-(--faded) motion-reduce:transition-none`}
    >
      {/* Written in inside the plate, so the clip never cuts the keyboard's outline. */}
      <span className={writing ? "inline-block animate-write-in" : undefined}>{cluster.name}</span>
    </button>
  );
}
