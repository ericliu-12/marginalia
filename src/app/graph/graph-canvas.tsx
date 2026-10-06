"use client";

import { useEffect, useMemo, useRef } from "react";
import type ForceGraph from "force-graph";
import { visibleConnections, type GraphBook, type GraphConnection, type GraphView } from "@/domain/graph";
import {
  DRAG,
  EDGE_WIDTH,
  EDGE_WIDTH_CHOSEN_EXTRA,
  EDGE_WIDTH_FADED,
  FADED_EDGE,
  FADED_LABEL,
  FADED_NODE,
  INK,
  LABEL_GAP,
  LABEL_MAX_CHARS,
  LABEL_SIZE,
  MAX_FIT_ZOOM,
  PAPER,
  TYPE_COLOR,
  TYPICAL_EDGE_LENGTH,
  nodeRadius,
} from "./graph-style";

export type Selection = { kind: "book"; bookId: string } | { kind: "connection"; id: string } | null;

type Node = { id: string; book: GraphBook; label: string; radius: number; homeX: number; homeY: number; x?: number; y?: number; vx?: number; vy?: number };
type Link = { id: string; source: string | Node; target: string | Node; connection: GraphConnection; rest: number };

// What a selection lights up. Worked out once per selection, so the render callbacks only look things up.
type Focus = {
  visible: Set<string>;
  // Books and Connections drawn at full strength; null when nothing is selected and everything is.
  litBooks: Set<string> | null;
  litLinks: Set<string> | null;
  chosenBookId: string | null;
  chosenLinkId: string | null;
  // Label priority: the selection and its neighbours first, then by Connections.
  labelOrder: Node[];
};

function shortLabel(title: string) {
  const main = title.split(/:\s/)[0];
  return main.length > LABEL_MAX_CHARS ? `${main.slice(0, LABEL_MAX_CHARS - 1).trimEnd()}…` : main;
}

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
    label: shortLabel(b.title),
    radius: nodeRadius(b.degree),
    homeX: b.x * scale,
    homeY: b.y * scale,
    x: b.x * scale,
    y: b.y * scale,
  }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const links: Link[] = graph.connections.map((c, i) => ({ id: c.id, source: c.a, target: c.b, connection: c, rest: lengths[i] * scale }));
  const byDegree = [...nodes].sort((p, q) => q.book.degree - p.book.degree || (p.id < q.id ? -1 : 1));
  return { nodes, links, byId, byDegree };
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
    ? [...prepared.byDegree].sort((p, q) => Number(lit.has(q.id)) - Number(lit.has(p.id)) || Number(q.id === chosenBookId) - Number(p.id === chosenBookId))
    : prepared.byDegree;
  return { visible, litBooks, litLinks, chosenBookId, chosenLinkId: chosenLink?.id ?? null, labelOrder };
}

const endId = (end: string | Node) => (typeof end === "string" ? end : end.id);

// The reader's graph, full-bleed. Books are ink dots at their stored places; a selection lights a Book
// and its Connections, or one Connection, and fades the rest.
export function GraphCanvas({
  graph,
  selection,
  onSelect,
  panelInset,
}: {
  graph: GraphView;
  selection: Selection;
  onSelect: (s: Selection) => void;
  // Pixels of the canvas's right edge covered by the floating panel, so a chosen Book centres in what is left.
  panelInset: number;
}) {
  const el = useRef<HTMLDivElement>(null);
  const fgRef = useRef<ForceGraph<Node, Link> | null>(null);
  const prepared = useMemo(() => prepare(graph), [graph]);
  const focus = useMemo(() => focusFor(graph, prepared, selection), [graph, prepared, selection]);
  const focusRef = useRef(focus);
  const hoverRef = useRef<string | null>(null);
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
          return state === "faded" ? EDGE_WIDTH_FADED : EDGE_WIDTH[l.connection.strength] + (state === "chosen" ? EDGE_WIDTH_CHOSEN_EXTRA : 0);
        })
        .linkHoverPrecision(6)
        .nodeCanvasObject((n, ctx, k) => {
          const r = n.radius / k;
          const lit = isLitBook(n.id);
          if (n.id === focusRef.current.chosenBookId || n.id === hoverRef.current) {
            ctx.beginPath();
            ctx.arc(n.x!, n.y!, r + 4 / k, 0, Math.PI * 2);
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
        // Labels last, over the edges: in priority order, each placed only where it overlaps none
        // already drawn (a coarse grid keeps the check cheap). Hovered and lit Books always get theirs.
        .onRenderFramePost((ctx, k) => {
          const { labelOrder, litBooks } = focusRef.current;
          ctx.font = font(k);
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          ctx.lineJoin = "round";
          ctx.lineWidth = 3 / k;
          ctx.strokeStyle = PAPER;
          const CELL = 48;
          const taken = new Map<string, { x0: number; y0: number; x1: number; y1: number }[]>();
          const cells = (x0: number, y0: number, x1: number, y1: number) => {
            const keys = [];
            for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++)
              for (let j = Math.floor(y0 / CELL); j <= Math.floor(y1 / CELL); j++) keys.push(`${i}:${j}`);
            return keys;
          };
          const hovered = hoverRef.current;
          const order = hovered ? [prepared.byId.get(hovered)!, ...labelOrder] : labelOrder;
          const drawn = new Set<string>();
          for (const n of order) {
            if (!n || drawn.has(n.id)) continue;
            const lit = !litBooks || litBooks.has(n.id);
            // Faded Books stay unlabelled unless the reader is close enough to read them anyway.
            if (!lit && k < 1.6 && n.id !== hovered) continue;
            let w = widths.get(n.label);
            if (w === undefined) {
              ctx.save();
              ctx.setTransform(1, 0, 0, 1, 0, 0);
              ctx.font = font(1);
              w = ctx.measureText(n.label).width;
              ctx.restore();
              widths.set(n.label, w);
            }
            const s = f.graph2ScreenCoords(n.x!, n.y!);
            const x0 = s.x + n.radius + LABEL_GAP - 2;
            const box = { x0, y0: s.y - LABEL_SIZE * 0.7, x1: x0 + w + 4, y1: s.y + LABEL_SIZE * 0.7 };
            const keys = cells(box.x0, box.y0, box.x1, box.y1);
            const must = n.id === hovered || n.id === focusRef.current.chosenBookId;
            if (!must && keys.some((key) => taken.get(key)?.some((b) => b.x0 < box.x1 && box.x0 < b.x1 && b.y0 < box.y1 && box.y0 < b.y1)))
              continue;
            for (const key of keys) taken.set(key, [...(taken.get(key) ?? []), box]);
            drawn.add(n.id);
            const x = n.x! + (n.radius + LABEL_GAP) / k;
            ctx.strokeText(n.label, x, n.y!);
            ctx.fillStyle = lit ? INK : FADED_LABEL;
            ctx.fillText(n.label, x, n.y!);
          }
        })
        .onNodeHover((n) => {
          hoverRef.current = n?.id ?? null;
          host.style.cursor = n ? "pointer" : "";
        })
        .onLinkHover((l) => {
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

  // A new selection: swap the focus, redraw, and bring a chosen Book into the uncovered part of the canvas.
  useEffect(() => {
    focusRef.current = focus;
    const f = fgRef.current;
    if (!f) return;
    f.linkVisibility(f.linkVisibility());
    const n = focus.chosenBookId ? prepared.byId.get(focus.chosenBookId) : undefined;
    if (n) f.centerAt(n.x! + insetRef.current / 2 / f.zoom(), n.y!, 600);
  }, [focus, prepared]);

  return <div ref={el} className="absolute inset-0" aria-hidden />;
}
