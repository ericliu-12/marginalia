"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { GraphView } from "@/domain/graph";
import type { LibraryItem } from "@/domain/library";
import { BookPanel } from "../book-panel";
import { FindingIndicator } from "../connections";
import { ViewSwitch } from "../view-switch";
import { ConnectionPanel } from "./connection-panel";
import { GraphCanvas, type Selection } from "./graph-canvas";
import { TYPE_COLOR, TYPE_LABEL } from "./graph-style";

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

export function GraphWorkspace({ graph, items, finding }: { graph: GraphView; items: LibraryItem[]; finding: number }) {
  const router = useRouter();
  const wide = useWide();
  const [selection, setSelection] = useState<Selection>(null);
  const [pointed, setPointed] = useState<string | null>(null);
  // The keyboard list item that opened the panel, so closing it puts focus back there.
  const returnTo = useRef<HTMLElement | null>(null);
  const item = selection?.kind === "book" ? items.find((i) => i.bookId === selection.bookId) : undefined;
  const close = () => {
    setSelection(null);
    const back = returnTo.current;
    returnTo.current = null;
    if (back?.isConnected) requestAnimationFrame(() => back.focus());
  };
  const select = (s: Selection) => (s ? setSelection(s) : close());

  // Escape closes the panel wherever focus is. Forms inside the panel stop their own Escape first.
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });
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
        <GraphCanvas graph={graph} selection={selection} onSelect={select} panelInset={selection ? PANEL_INSET : 0} pointedBookId={pointed} />
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
          <p className="text-ink-3">Thicker lines are stronger Connections. Select a Book to see all of its own.</p>
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
                  onClick={(e) => {
                    returnTo.current = e.currentTarget;
                    setSelection({ kind: "book", bookId: b.bookId });
                  }}
                >
                  {b.title}, {b.degree} {b.degree === 1 ? "Connection" : "Connections"}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {wide && selection && (
        <div className="absolute top-6 right-6 bottom-6 w-[27rem] overflow-hidden rounded-[3px] border border-rule shadow-[0_12px_32px_-8px_rgb(35_29_23/0.18),0_2px_6px_rgb(35_29_23/0.06)]">
          {selection.kind === "connection" ? (
            <ConnectionPanel key={selection.id} id={selection.id} onBack={close} onOpenBook={(bookId) => setSelection({ kind: "book", bookId })} />
          ) : (
            item && (
              <BookPanel
                item={item}
                backLabel="Back to the graph"
                onBack={close}
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
