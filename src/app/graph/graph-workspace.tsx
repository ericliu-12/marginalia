"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { visibleConnections, type GraphView } from "@/domain/graph";
import type { LibraryItem } from "@/domain/library";
import { graphStatusAction } from "../actions";
import { BookPanel } from "../book-panel";
import { FindingIndicator, POLL_MS, usePoll } from "../connections";
import { ViewSwitch } from "../view-switch";
import { arriving, drawOrder } from "./arrival";
import { ClusterPanel } from "./cluster-panel";
import { ConnectionPanel } from "./connection-panel";
import { GraphCanvas, reducedMotion, type Selection } from "./graph-canvas";
import { DRAW_FIRST_MS, DRAW_STEP_MS, DRAW_UNHURRIED, TYPE_COLOR, TYPE_LABEL } from "./graph-style";
import { follow, rewind } from "./trail";
import { TrailCrumbs } from "./trail-crumbs";

// Matches Tailwind's lg: the graph is a desktop surface.
const WIDE = "(min-width: 1024px)";
const subscribe = (cb: () => void) => {
  const mq = window.matchMedia(WIDE);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};
const useWide = () => useSyncExternalStore(subscribe, () => window.matchMedia(WIDE).matches, () => true);

// The floating panel: 27rem, as the library's right pane, inset from the canvas edge.
const PANEL_INSET = 27 * 17 + 24;

// The Books the graph last showed, kept in this browser, so a Book finished since arrives.
const SHOWN_KEY = "marginalia:graph-shown";
function readShown(): string[] | null {
  try {
    const raw = localStorage.getItem(SHOWN_KEY);
    return raw ? (JSON.parse(raw) as string[]) : null;
  } catch {
    return null;
  }
}
function saveShown(bookIds: string[]) {
  try {
    localStorage.setItem(SHOWN_KEY, JSON.stringify(bookIds));
  } catch {}
}
const NONE = new Set<string>();

export function GraphWorkspace({ graph, items, finding }: { graph: GraphView; items: LibraryItem[]; finding: number }) {
  const router = useRouter();
  const wide = useWide();
  // While background work is about to change the graph (after a dismissal, a removal, a Refresh or a
  // Connections run), check back until it settles, then fetch the page again for the fresh graph. The
  // Clusters and positions come once more before that, as soon as only their names are left to come.
  const [seen, setSeen] = useState(graph);
  const [waiting, setWaiting] = useState(graph.pending);
  if (seen !== graph) {
    setSeen(graph);
    setWaiting(graph.pending);
  }
  const check = useCallback(
    () =>
      graphStatusAction().then((status) => {
        if (!status) return;
        if (!status.pending) setWaiting(false);
        if (!status.pending || (status.naming && !graph.naming)) router.refresh();
      }),
    [router, graph.naming],
  );
  usePoll(check, POLL_MS, waiting);
  const [selection, setSelection] = useState<Selection>(null);
  // The Books followed from the panel, oldest first. Anything chosen on the canvas starts afresh.
  const [trail, setTrail] = useState<string[]>([]);
  // Said to screen readers when following a Book already on the trail quietly rewinds to it.
  const [said, setSaid] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);
  const [pointed, setPointed] = useState<string | null>(null);
  // The keyboard list item that opened the panel, so closing it puts focus back there.
  const returnTo = useRef<HTMLElement | null>(null);
  // The arrival under way: the Books that landed, the newest first, and which of their Connections have
  // drawn in. `fresh` is the one whose panel says it was just finished, until the panel closes.
  const [arrival, setArrival] = useState<{ books: string[]; drawn: Set<string> } | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const item = selection?.kind === "book" ? items.find((i) => i.bookId === selection.bookId) : undefined;
  const close = () => {
    setFresh(null);
    setSelection(null);
    setTrail([]);
    const back = returnTo.current;
    returnTo.current = null;
    if (back?.isConnected) requestAnimationFrame(() => back.focus());
  };
  const select = (s: Selection) => {
    if (!s) return close();
    setSelection(s);
    setTrail(s.kind === "book" ? [s.bookId] : []);
  };
  const openFromList = (target: HTMLElement, s: Selection) => {
    returnTo.current = target;
    select(s);
  };
  const goTo = (next: string[]) => {
    setTrail(next);
    setSelection({ kind: "book", bookId: next[next.length - 1] });
  };
  const labelOf = new Map(graph.books.map((b) => [b.bookId, b.label]));
  const followTo = (from: string[], bookId: string) => {
    const next = follow(from, bookId);
    // Emptied first, so the same words said twice are still announced.
    setSaid("");
    if (next.length <= from.length) requestAnimationFrame(() => setSaid(`Back to ${labelOf.get(bookId)} on your trail`));
    goTo(next);
  };

  // Escape closes the panel wherever focus is. Forms inside the panel stop their own Escape first.
  const closeRef = useRef(close);
  const selectionRef = useRef(selection);
  useEffect(() => {
    closeRef.current = close;
    selectionRef.current = selection;
  });

  // Each graph fetched: any Book the graph has not shown before arrives. It lands, the view glides to it
  // and opens its panel, and its Connections draw in one by one. In a burst, or while the reader has a
  // panel open, new Books simply appear. Below lg there is no graph to arrive in, so nothing is seen yet.
  useEffect(() => {
    if (!window.matchMedia(WIDE).matches) return;
    const books = arriving(readShown(), graph.books);
    // With a panel open, the arrival waits: the Books are left unremembered, to arrive with the next graph.
    if (books.length > 0 && selectionRef.current) return;
    saveShown(graph.books.map((b) => b.bookId));
    if (books.length === 0) return;
    setArrival({ books, drawn: new Set() });
    setFresh(books[0]);
    setSelection({ kind: "book", bookId: books[0] });
    setTrail([books[0]]);
    const titles = books.map((id) => graph.books.find((b) => b.bookId === id)?.title);
    const words = `${new Intl.ListFormat("en").format(titles.filter((t) => t !== undefined))} ${titles.length === 1 ? "is" : "are"} now in your graph`;
    // After a frame, so the status region exists before it is spoken into on a fresh page.
    requestAnimationFrame(() => setSaid(words));
  }, [graph, wide]);
  // The arriving Books' Connections still to draw in, in order, of those on show; all at once for less motion.
  const chosenBookId = selection?.kind === "book" ? selection.bookId : null;
  const queue = useMemo(
    () => (arrival ? drawOrder(visibleConnections(graph, chosenBookId), arrival.books, arrival.drawn) : []),
    [graph, chosenBookId, arrival],
  );
  const withheld = useMemo(() => (queue.length && !reducedMotion() ? new Set(queue) : NONE), [queue]);
  const next = withheld.size ? queue[0] : undefined;
  const first = arrival?.drawn.size === 0;
  const drawnSoFar = arrival?.drawn.size ?? 0;
  useEffect(() => {
    if (!next) return;
    const step = drawnSoFar < DRAW_UNHURRIED ? DRAW_STEP_MS : DRAW_STEP_MS / 2;
    const t = setTimeout(() => setArrival((a) => a && { ...a, drawn: new Set(a.drawn).add(next) }), first ? DRAW_FIRST_MS : step);
    return () => clearTimeout(t);
  }, [next, first, drawnSoFar]);
  const landing = useMemo(() => arrival?.books ?? [], [arrival?.books]);
  const freshBook = fresh && item?.bookId === fresh ? graph.books.find((b) => b.bookId === fresh) : undefined;
  useEffect(() => {
    if (!selection) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection]);
  const byTitle = [...graph.books].sort((a, b) => a.title.localeCompare(b.title));

  return (
    <div className="relative h-screen overflow-hidden">
      {wide && graph.books.length > 0 && (
        <GraphCanvas
          graph={graph}
          selection={selection}
          trail={trail}
          onSelect={select}
          panelInset={selection ? PANEL_INSET : 0}
          pointedBookId={pointed}
          landing={landing}
          withheld={withheld}
        />
      )}

      <header className="pointer-events-none absolute inset-x-0 top-0 flex items-baseline gap-8 px-8 pt-7 lg:px-12">
        <h1 className="pointer-events-auto text-[1.75rem] leading-none font-medium tracking-[-0.01em] italic">Marginalia</h1>
        <div className="pointer-events-auto">
          <ViewSwitch current="graph" />
        </div>
        <FindingIndicator initial={finding} />
      </header>

      {!wide && (
        <p className="absolute inset-x-8 top-24 max-w-[34ch] text-xl text-ink-2 italic">
          The graph needs a larger screen. Your books are in the{" "}
          <Link href="/" className="text-ink underline decoration-rule underline-offset-4">
            library
          </Link>
          .
        </p>
      )}
      {wide && graph.books.length === 0 && (
        <p className="absolute inset-x-12 top-28 max-w-[34ch] text-xl text-ink-2 italic">
          Books you finish appear here, linked by their Connections.
        </p>
      )}

      {wide && graph.connections.length > 0 && (
        <div className="pointer-events-none absolute bottom-7 left-12 flex flex-col gap-1.5 font-sans text-[0.8rem] text-ink-2">
          <ul className="flex gap-5" aria-label="Connection types">
            {(["thematic", "contrast", "context"] as const).map((t) => (
              <li key={t} className="flex items-center gap-2 font-medium text-ink-2">
                <span aria-hidden className="inline-block h-[3px] w-6 rounded-[2px]" style={{ background: TYPE_COLOR[t] }} />
                {TYPE_LABEL[t]}
              </li>
            ))}
          </ul>
          <p className="text-ink-3">
            Thicker lines are stronger Connections. Select a Book to see all of its own, or a Cluster’s name to see what its Books share.
          </p>
        </div>
      )}

      {/* The canvas is not readable by assistive tech; the same Books, as a list, open the same panel.
          The Book a list item stands for is ringed and labelled on the canvas while it has focus. */}
      {wide && (
        <nav aria-label="Books in the graph" className="sr-only">
          <ul>
            {byTitle.map((b) => (
              <li key={b.bookId}>
                <button
                  type="button"
                  onFocus={() => setPointed(b.bookId)}
                  onBlur={() => setPointed(null)}
                  onClick={(e) => openFromList(e.currentTarget, { kind: "book", bookId: b.bookId })}
                >
                  {b.title}, {b.degree} {b.degree === 1 ? "Connection" : "Connections"}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}
      {wide && graph.clusters.length > 0 && (
        <nav aria-label="Clusters in the graph" className="sr-only">
          <ul>
            {graph.clusters.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={(e) => openFromList(e.currentTarget, { kind: "cluster", id: c.id })}>
                  {/* An unnamed Cluster's name already counts its Books. */}
                  {c.named ? `${c.name}, ${c.bookIds.length} Books` : c.name}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <p role="status" className="sr-only">
        {said}
      </p>

      {wide && selection && (
        <div ref={panelRef} className="absolute top-6 right-6 bottom-6 w-[27rem] overflow-hidden rounded-[3px] border border-rule shadow-[0_12px_32px_-8px_rgb(35_29_23/0.18),0_2px_6px_rgb(35_29_23/0.06)]">
          {selection.kind === "cluster" ? (
            <ClusterPanel
              key={selection.id}
              cluster={graph.clusters.find((c) => c.id === selection.id)}
              books={graph.books}
              onBack={close}
              // A Book opened from its Cluster starts a trail of its own.
              onOpenBook={(bookId) => select({ kind: "book", bookId })}
            />
          ) : selection.kind === "connection" ? (
            <ConnectionPanel
              key={selection.id}
              id={selection.id}
              onBack={close}
              // Following from a Connection starts the trail at its other Book, so the way back is kept.
              onOpenBook={(bookId) => {
                const c = graph.connections.find((x) => x.id === selection.id);
                followTo(c ? [c.a === bookId ? c.b : c.a] : trail, bookId);
              }}
            />
          ) : (
            item && (
              <BookPanel
                key={item.bookId}
                item={item}
                backLabel="Back to the graph"
                onBack={close}
                onOpenBook={(bookId) => followTo(trail, bookId)}
                crumbs={
                  <>
                    {freshBook && (
                      <p className="px-6 pb-4 text-ink-2 italic">
                        You just finished this.
                        {(freshBook.degree > 0 || graph.pending) && " Here is where it sits among your earlier reading."}
                      </p>
                    )}
                    {trail.length > 1 && (
                      <TrailCrumbs
                        labels={trail.map((id) => labelOf.get(id) ?? "")}
                        onRewind={(i) => goTo(rewind(trail, i))}
                        onClear={() => {
                          setTrail([item.bookId]);
                          // The crumbs, and the focused Clear with them, are gone; the Book's heading is next.
                          requestAnimationFrame(() => panelRef.current?.querySelector<HTMLElement>("h2")?.focus());
                        }}
                      />
                    )}
                  </>
                }
                withheldConnections={arrival?.books.includes(item.bookId) ? withheld : undefined}
                onRemoved={() => {
                  close();
                  router.refresh();
                }}
              />
            )
          )}
        </div>
      )}
    </div>
  );
}
