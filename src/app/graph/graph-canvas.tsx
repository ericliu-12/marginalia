"use client";

import { useEffect, useMemo, useRef } from "react";
import type ForceGraph from "force-graph";
import { visibleConnections, type GraphBook, type GraphConnection, type GraphView } from "@/domain/graph";
import {
  DRAG,
  EDGE_WIDTH,
  EDGE_WIDTH_CHOSEN_EXTRA,
  EDGE_WIDTH_FADED,
  EDGE_WIDTH_HOVER_EXTRA,
  FADED_EDGE,
  FADED_LABEL,
  FADED_NODE,
  INK,
  LABEL_GAP,
  LABEL_PLATE,
  LABEL_SIZE,
  MAX_FIT_ZOOM,
  PAPER_PLATE,
  RECENT_LABELS,
  TYPE_COLOR,
  RING_GAP,
  TYPICAL_EDGE_LENGTH,
  nodeRadius,
} from "./graph-style";

export type Selection = { kind: "book"; bookId: string } | { kind: "connection"; id: string } | null;

type Node = { id: string; book: GraphBook; label: string; radius: number; homeX: number; homeY: number; x?: number; y?: number; vx?: number; vy?: number };
// force-graph's names: a node is a Book, a link is a Connection.
type Link = { id: string; source: string | Node; target: string | Node; connection: GraphConnection; rest: number };

// What a selection lights up. Worked out once per selection, so the render callbacks only look things up.
type Focus = {
  visible: Set<string>;
  // Books and Connections drawn at full strength; null when nothing is selected and everything is.
  litBooks: Set<string> | null;
  litLinks: Set<string> | null;
  chosenBookId: string | null;
  chosenLinkId: string | null;
  // Label priority: the selection and its neighbours first, then the graph's own order.
  labelOrder: Node[];
};

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

// Graph data for force-graph, built once per graph: stored positions scaled so a typical Connection
// is TYPICAL_EDGE_LENGTH long, and an id-to-node map.
function prepare(graph: GraphView) {
  const raw = new Map(graph.books.map((b) => [b.bookId, b]));
  const lengths = graph.connections.map((c) => Math.hypot(raw.get(c.a)!.x - raw.get(c.b)!.x, raw.get(c.a)!.y - raw.get(c.b)!.y));
  const scale = TYPICAL_EDGE_LENGTH / (median(lengths.filter((l) => l > 0)) || TYPICAL_EDGE_LENGTH);
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
  return { nodes, links, byId, byPriority };
}

function focusFor(graph: GraphView, prepared: ReturnType<typeof prepare>, selection: Selection): Focus {
  const chosenBookId = selection?.kind === "book" ? selection.bookId : null;
  const chosenLink = selection?.kind === "connection" ? graph.connections.find((c) => c.id === selection.id) : undefined;
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
  }
  const lit = litBooks;
  const labelOrder = lit
    ? [...prepared.byPriority].sort((p, q) => Number(lit.has(q.id)) - Number(lit.has(p.id)) || Number(q.id === chosenBookId) - Number(p.id === chosenBookId))
    : prepared.byPriority;
  return { visible, litBooks, litLinks, chosenBookId, chosenLinkId: chosenLink?.id ?? null, labelOrder };
}

// Camera moves glide, unless the reader asked for less motion.
const glide = () => (window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 600);

type Box = { x0: number; y0: number; x1: number; y1: number };
type Side = "right" | "left" | "above" | "below";

const endId = (end: string | Node) => (typeof end === "string" ? end : end.id);

// The reader's graph, full-bleed. Books are ink dots at their stored places; a selection lights a Book
// and its Connections, or one Connection, and fades the rest.
export function GraphCanvas({
  graph,
  selection,
  onSelect,
  panelInset,
  pointedBookId,
}: {
  graph: GraphView;
  selection: Selection;
  onSelect: (s: Selection) => void;
  // A Book the reader has reached from the keyboard list: marked on the canvas as if hovered.
  pointedBookId: string | null;
  // Pixels of the canvas's right edge covered by the floating panel, so a chosen Book centres in what is left.
  panelInset: number;
}) {
  const el = useRef<HTMLDivElement>(null);
  const fgRef = useRef<ForceGraph<Node, Link> | null>(null);
  const prepared = useMemo(() => prepare(graph), [graph]);
  const focus = useMemo(() => focusFor(graph, prepared, selection), [graph, prepared, selection]);
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

  // One force-graph per graph; selection changes only swap the focus it reads.
  useEffect(() => {
    const host = el.current;
    if (!host) return;
    let fg: ForceGraph<Node, Link> | null = null;
    let ro: ResizeObserver | null = null;
    let cancelled = false;
    const serif = getComputedStyle(document.documentElement).getPropertyValue("--nf-serif").trim() || "Georgia";
    const font = (k: number) => `500 ${LABEL_SIZE / k}px ${serif}, Georgia, serif`;
    const widths = new Map<string, number>();

    void import("force-graph").then(({ default: ForceGraphCtor }) => {
      if (cancelled) return;
      const f = (fg = new ForceGraphCtor<Node, Link>(host));
      fgRef.current = f;
      const pointed = () => hoverRef.current ?? pointedRef.current;
      const ringed = (id: string) => id === focusRef.current.chosenBookId || id === pointed();
      const isLitBook = (id: string) => !focusRef.current.litBooks || focusRef.current.litBooks.has(id);
      const linkState = (l: Link) => {
        const { litLinks, chosenLinkId } = focusRef.current;
        if (l.id === chosenLinkId) return "chosen";
        return !litLinks || litLinks.has(l.id) ? "lit" : "faded";
      };

      f.width(host.clientWidth)
        .height(host.clientHeight)
        .backgroundColor("rgba(0,0,0,0)")
        .nodeId("id")
        .graphData({ nodes: prepared.nodes, links: prepared.links })
        .linkVisibility((l) => focusRef.current.visible.has(l.id))
        .linkColor((l) => (linkState(l) === "faded" ? FADED_EDGE : TYPE_COLOR[l.connection.type]))
        // Screen pixels: force-graph keeps link widths constant across zoom.
        .linkWidth((l) => {
          const state = linkState(l);
          if (state === "faded") return EDGE_WIDTH_FADED;
          const extra = state === "chosen" ? EDGE_WIDTH_CHOSEN_EXTRA : l.id === hoverLinkRef.current ? EDGE_WIDTH_HOVER_EXTRA : 0;
          return EDGE_WIDTH[l.connection.strength] + extra;
        })
        .linkHoverPrecision(6)
        .nodeCanvasObject((n, ctx, k) => {
          const r = n.radius / k;
          const lit = isLitBook(n.id);
          if (ringed(n.id)) {
            ctx.beginPath();
            ctx.arc(n.x!, n.y!, r + RING_GAP / k, 0, Math.PI * 2);
            ctx.lineWidth = 1.5 / k;
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
        // hovered and chosen Books always get theirs, in full.
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
          const screen = new Map(prepared.nodes.map((n) => [n.id, f.graph2ScreenCoords(n.x!, n.y!)]));
          for (const n of prepared.nodes) {
            const s = screen.get(n.id)!;
            take({ x0: s.x - n.radius, y0: s.y - n.radius, x1: s.x + n.radius, y1: s.y + n.radius });
          }

          const hovered = pointed();
          const order = hovered ? [prepared.byId.get(hovered), ...labelOrder] : labelOrder;
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
        for (const n of prepared.nodes) {
          n.vx! += (n.homeX - n.x!) * DRAG.home;
          n.vy! += (n.homeY - n.y!) * DRAG.home;
        }
      }) as never);

      const fit = () => {
        f.zoomToFit(0, 80);
        if (f.zoom() > MAX_FIT_ZOOM) f.zoom(MAX_FIT_ZOOM);
      };
      // Fit once the canvas has its size, then let drags run the simulation.
      requestAnimationFrame(() => {
        if (cancelled) return;
        fit();
        f.cooldownTicks(DRAG.settleTicks);
      });
      ro = new ResizeObserver(() => f.width(host.clientWidth).height(host.clientHeight));
      ro.observe(host);
    });

    return () => {
      cancelled = true;
      ro?.disconnect();
      fg?._destructor();
      fgRef.current = null;
    };
  }, [prepared]);

  // A new selection: swap the focus, redraw, and bring the chosen Book or Connection into the part of
  // the canvas the panel leaves uncovered. Clearing the selection returns the view the reader had.
  const before = useRef<{ x: number; y: number; zoom: number } | null>(null);
  useEffect(() => {
    focusRef.current = focus;
    const f = fgRef.current;
    if (!f) return;
    f.linkVisibility(f.linkVisibility());
    const chosen = focus.chosenBookId
      ? [prepared.byId.get(focus.chosenBookId)]
      : focus.chosenLinkId
        ? (() => {
            const l = prepared.links.find((x) => x.id === focus.chosenLinkId)!;
            return [prepared.byId.get(endId(l.source)), prepared.byId.get(endId(l.target))];
          })()
        : [];
    const at = chosen.filter((n) => n !== undefined);
    if (at.length) {
      before.current ??= { ...f.centerAt(), zoom: f.zoom() };
      const x = at.reduce((sum, n) => sum + n.x!, 0) / at.length;
      const y = at.reduce((sum, n) => sum + n.y!, 0) / at.length;
      f.centerAt(x + insetRef.current / 2 / f.zoom(), y, glide());
    } else if (before.current) {
      f.centerAt(before.current.x, before.current.y, glide());
      f.zoom(before.current.zoom, glide());
      before.current = null;
    }
  }, [focus, prepared]);

  useEffect(() => {
    pointedRef.current = pointedBookId;
    const f = fgRef.current;
    if (f) f.linkVisibility(f.linkVisibility());
  }, [pointedBookId]);

  return <div ref={el} className="absolute inset-0" aria-hidden />;
}
