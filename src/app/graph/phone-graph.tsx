"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import type { ConnectionCard } from "@/domain/connections";
import type { GraphBook, GraphCluster, GraphView } from "@/domain/graph";
import { turnsFor } from "@/domain/phone-fit";
import type { Pause } from "@/domain/spend";
import { AccountLink } from "../account-link";
import { getConnectionsAction } from "../client-actions";
import { clusterTint } from "../cluster-tint";
import { FindingIndicator } from "../connections";
import { openedFromGraph, PhoneSwitch, useArrivedBySwitch } from "../view-switch";
import { GraphCanvas, type Phone, type Selection } from "./graph-canvas";
import { GraphLists } from "./graph-lists";
import { STRENGTH_LABEL, TYPE_COLOR, TYPE_LABEL } from "./graph-style";
import { CLOSED, panelState } from "./panel-state";

// How many of a Book's Connections the sheet shows before "Show N more".
const FIRST_SHOWN = 3;

// The graph on a phone: the reader's graph fitted to the tall screen (turned a quarter turn if it is
// wider than the screen), under the wordmark and the Shelf / Graph switch, over a legend. Pinch zooms,
// a drag pans, and a tap chooses a Book or a Cluster, fading the rest and raising a sheet over the
// legend; "Whole graph" (or a tap on bare paper) lets go. The page itself never scrolls.
export function PhoneGraph({ graph, finding, paused, loneThemes }: { graph: GraphView; finding: number; paused: Pause | null; loneThemes: string[] }) {
  const switched = useArrivedBySwitch();
  const [{ selection }, dispatch] = useReducer(panelState, CLOSED);
  const [pointed, setPointed] = useState<string | null>(null);
  const [pointedCluster, setPointedCluster] = useState<string | null>(null);
  const headerRef = useRef<HTMLElement>(null);
  const legendRef = useRef<HTMLElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  // The list item that chose something, so letting go puts focus back there.
  const returnTo = useRef<HTMLElement | null>(null);

  // A choice is a step in history, so back (and the phone's edge swipe) lets go of it rather than
  // leaving the graph.
  const pushed = useRef(false);
  const select = (s: Selection) => {
    if (s) {
      if (!pushed.current) window.history.pushState(null, "", "?chosen");
      pushed.current = true;
      return dispatch({ kind: "select", selection: s });
    }
    if (pushed.current) {
      pushed.current = false;
      window.history.back();
    }
    dispatch({ kind: "close" });
    const back = returnTo.current;
    returnTo.current = null;
    if (back?.isConnected) requestAnimationFrame(() => back.focus());
  };
  const selectRef = useRef(select);
  useEffect(() => {
    selectRef.current = select;
  });
  useEffect(() => {
    const onPop = () => {
      if (!pushed.current || window.location.search.includes("chosen")) return;
      pushed.current = false;
      selectRef.current(null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => {
    if (!selection) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && selectRef.current(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection]);

  // What the header covers at the top, and the sheet (or the legend) at the bottom, as drawn now.
  const phone = useRef<Phone>({
    turn: false,
    room: () => ({
      top: headerRef.current?.getBoundingClientRect().bottom ?? 0,
      bottom: (sheetRef.current ?? legendRef.current)?.offsetHeight ?? 0,
    }),
  });
  // Whether the stored layout turns to fit the room between the header and the legend: worked out once
  // they are on the page, and again as the screen turns.
  const [turn, setTurn] = useState<boolean | null>(null);
  useLayoutEffect(() => {
    const decide = () => {
      const { top, bottom } = phone.current.room();
      setTurn(turnsFor(graph.books, { width: window.innerWidth, height: window.innerHeight - top - bottom }));
    };
    decide();
    window.addEventListener("resize", decide);
    return () => window.removeEventListener("resize", decide);
  }, [graph.books]);
  const phoneProp = useMemo<Phone | undefined>(() => (turn === null ? undefined : { turn, room: phone.current.room }), [turn]);

  const chosenBook = selection?.kind === "book" ? graph.books.find((b) => b.bookId === selection.bookId) : undefined;
  const chosenCluster = selection?.kind === "cluster" ? graph.clusters.find((c) => c.id === selection.id) : undefined;
  const open = chosenBook ?? chosenCluster;
  const connected = graph.connections.length > 0;

  return (
    <div className={`fixed inset-0 touch-none overflow-hidden overscroll-none bg-paper ${switched ? "animate-view-in" : ""}`}>
      {phoneProp && graph.books.length > 0 && (
        <GraphCanvas
          // Drawn afresh, and fitted again, when the screen turns the layout the other way.
          key={String(turn)}
          graph={graph}
          selection={selection}
          trail={NO_TRAIL}
          onSelect={select}
          panelInset={0}
          pointedBookId={pointed}
          pointedClusterId={pointedCluster}
          landing={NO_TRAIL}
          withheld={NONE}
          phone={phoneProp}
        />
      )}

      {/* The wordmark where the shelf has it; under it the switch, or the way back to the whole graph. */}
      <header ref={headerRef} data-graph-chrome className="absolute inset-x-0 top-0 bg-paper px-5 pt-[max(1.125rem,env(safe-area-inset-top))] pb-2">
        <div className="flex items-baseline gap-x-4">
          <div className="flex min-h-11 flex-1 flex-wrap items-baseline gap-x-4 gap-y-1">
            <p className="text-[24px] leading-none italic">Marginalia</p>
            <FindingIndicator initial={finding} paused={paused} className="max-w-[calc(100vw-2.5rem)] shrink-0" />
          </div>
          <AccountLink />
        </div>
        <div className="mt-2.5">
          {open ? (
            <button
              type="button"
              onClick={() => select(null)}
              className="-ml-1 flex min-h-[46px] items-center gap-2 pr-3 pl-1 text-[16px] text-ink-2 transition-colors duration-150 active:text-ink"
            >
              <svg aria-hidden width="10" height="16" viewBox="0 0 10 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 2 L2 8 L8 14" />
              </svg>
              Whole graph
            </button>
          ) : (
            <PhoneSwitch current="graph" />
          )}
        </div>
      </header>

      {graph.books.length === 0 && (
        <p className="absolute inset-x-5 top-40 max-w-[32ch] text-[19px] text-ink-2 italic">
          Finish a book and its connections will gather here.{" "}
          <Link href="/?add" className="text-ink underline decoration-rule underline-offset-4">
            Add a book
          </Link>
        </p>
      )}

      {/* The legend, or until the first Connection, what is coming. */}
      {graph.books.length > 0 && (
        <footer
          ref={legendRef}
          data-graph-chrome
          className="absolute inset-x-0 bottom-0 flex flex-col gap-1.5 border-t border-rule-2 bg-paper px-5 pt-2.5 pb-[max(1.375rem,env(safe-area-inset-bottom))] text-[13px] text-ink-2"
        >
          {connected ? (
            <>
              <ul className="caps flex gap-4 tracking-[1px]" aria-label="Connection types">
                {(["thematic", "contrast", "context"] as const).map((t) => (
                  <li key={t} className="flex items-center gap-1.5">
                    <span aria-hidden className="inline-block h-[3px] w-[18px]" style={{ background: TYPE_COLOR[t] }} />
                    {TYPE_LABEL[t].toLowerCase()}
                  </li>
                ))}
              </ul>
              <p className="italic">Tap a book or a cluster’s name. Pinch to zoom.</p>
            </>
          ) : (
            <>
              {graph.books.length === 1 && loneThemes.length > 0 && (
                <p>
                  Themes of <i className="text-[14px] text-ink">{graph.books[0].label}</i>: {loneThemes.join(" · ")}
                </p>
              )}
              <p className="text-[15px] italic">{finding > 0 ? "Finding connections…" : "Connections appear as you finish more books."}</p>
            </>
          )}
        </footer>
      )}

      <GraphLists
        graph={graph}
        onPoint={setPointed}
        onPointCluster={setPointedCluster}
        onOpen={(target, s) => {
          returnTo.current = target;
          select(s);
        }}
      />

      {open && (
        <section
          ref={sheetRef}
          aria-labelledby="sheet-title"
          data-graph-chrome
          className="absolute inset-x-0 bottom-0 flex h-[min(25.5rem,52dvh)] flex-col border-t border-rule bg-paper-2 shadow-[0_-12px_32px_-8px_rgb(26_26_26/0.18),0_-2px_6px_rgb(26_26_26/0.06)] motion-safe:animate-sheet-up"
        >
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-4 pb-[max(1.375rem,env(safe-area-inset-bottom))]">
            {chosenBook ? (
              <BookSheet key={chosenBook.bookId} book={chosenBook} onSelect={(bookId) => select({ kind: "book", bookId })} />
            ) : (
              chosenCluster && <ClusterSheet key={chosenCluster.id} cluster={chosenCluster} books={graph.books} onSelect={(bookId) => select({ kind: "book", bookId })} />
            )}
          </div>
        </section>
      )}
    </div>
  );
}

const NO_TRAIL: string[] = [];
// A type label's text in its hue: context's a hair darker than its line, to hold 4.5:1.
const HUE = { thematic: "text-thematic", contrast: "text-contrast", context: "text-context" } as const;
const NONE = new Set<string>();

// The sheet's heading, focused as it opens so a screen reader starts there.
function useFocusedHeading() {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => ref.current?.focus({ preventScroll: true }), []);
  return ref;
}

// A chosen Book: its title, author and Connections, and the way to its Book screen. Each Connection's
// other Book chooses that Book on the graph.
function BookSheet({ book, onSelect }: { book: GraphBook; onSelect: (bookId: string) => void }) {
  const headingRef = useFocusedHeading();
  const [cards, setCards] = useState<ConnectionCard[] | null | undefined>(undefined);
  const [all, setAll] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    setCards(undefined);
    getConnectionsAction(book.bookId).then((v) => live && setCards(v ? v.cards : null));
    return () => {
      live = false;
    };
  }, [book.bookId, retry]);
  const shown = cards && (all ? cards : cards.slice(0, FIRST_SHOWN));
  const meta = [book.authors.join(", "), `${book.degree} ${book.degree === 1 ? "connection" : "connections"}`].filter(Boolean).join(" · ");

  return (
    <>
      <div className="flex items-baseline justify-between gap-4">
        <div className="min-w-0">
          <h2 id="sheet-title" ref={headingRef} tabIndex={-1} className="text-[22px] leading-[1.2] font-medium text-balance italic outline-none">
            {book.title}
          </h2>
          <p className="caps mt-1 text-[13px] tracking-[1px] text-ink-2">{meta}</p>
        </div>
        <Link
          href={`/?book=${book.bookId}&from=graph`}
          onClick={() => (openedFromGraph.current = true)}
          className="-mr-1 flex min-h-11 shrink-0 items-center px-1 text-[15px] whitespace-nowrap italic underline decoration-rule underline-offset-4 transition-colors duration-150 active:decoration-ink"
        >
          Open book
        </Link>
      </div>
      {cards === undefined && book.degree > 0 && <p className="mt-4 border-t border-rule-2 pt-3 text-[15px] text-ink-3 italic">Gathering connections…</p>}
      {cards === null && (
        <p role="alert" className="mt-4 border-t border-rule-2 pt-3 text-[15px] text-contrast">
          Couldn’t load connections.{" "}
          <button type="button" onClick={() => setRetry((r) => r + 1)} className="-my-3 min-h-11 underline underline-offset-2">
            Try again
          </button>
        </p>
      )}
      {cards && cards.length === 0 && <p className="mt-4 border-t border-rule-2 pt-3 text-[15px] text-ink-2 italic">No connections yet.</p>}
      {shown && shown.length > 0 && (
        <ul aria-label="Connections" className="mt-4 flex flex-col gap-3 border-t border-rule-2 pt-3">
          {shown.map((c) => (
            <li key={c.id} className="flex flex-col gap-0.5">
              <p className={`caps text-[12px] tracking-[1.2px] ${HUE[c.type]}`}>
                {TYPE_LABEL[c.type]} · {STRENGTH_LABEL[c.strength]}
              </p>
              <p className="text-[16px] leading-normal">
                <button
                  type="button"
                  onClick={() => onSelect(c.otherBookId)}
                  className="-my-2.5 py-2.5 text-left italic underline decoration-rule decoration-1 underline-offset-[5px] transition-colors duration-150 active:decoration-ink"
                >
                  {c.otherTitle}
                </button>
                : {c.explanation}
              </p>
            </li>
          ))}
        </ul>
      )}
      {cards && !all && cards.length > FIRST_SHOWN && (
        <button type="button" onClick={() => setAll(true)} className="mt-2 min-h-11 text-[15px] text-ink-2 italic underline decoration-rule underline-offset-4 active:text-ink">
          Show {cards.length - FIRST_SHOWN} more
        </button>
      )}
    </>
  );
}

// A chosen Cluster: its name in its own colour, what its Books share, and its Books, each choosing that
// Book on the graph.
function ClusterSheet({ cluster, books, onSelect }: { cluster: GraphCluster; books: GraphBook[]; onSelect: (bookId: string) => void }) {
  const headingRef = useFocusedHeading();
  const members = books.filter((b) => cluster.bookIds.includes(b.bookId)).sort((p, q) => p.finishedAt - q.finishedAt);
  return (
    <>
      <h2 id="sheet-title" ref={headingRef} tabIndex={-1} className="text-[22px] leading-[1.2] font-medium text-balance italic outline-none" style={{ color: clusterTint(cluster.wash).name }}>
        {cluster.name}
      </h2>
      <p className="caps mt-1 text-[13px] tracking-[1px] text-ink-2">{cluster.named ? `cluster of ${members.length} books` : "not named yet"}</p>
      {cluster.named && cluster.description && <p className="mt-3 max-w-[60ch] text-[16px] leading-normal">{cluster.description}</p>}
      <ul aria-label="Books in this cluster" className="mt-4 divide-y divide-rule-3 border-t border-rule-2">
        {members.map((b) => (
          <li key={b.bookId}>
            <button type="button" onClick={() => onSelect(b.bookId)} className="flex min-h-11 w-full flex-col items-start py-2 text-left transition-colors duration-150 active:bg-paper-3/60">
              <span className="text-[17px] leading-[1.25] italic">{b.title}</span>
              {b.authors.length > 0 && <span className="caps text-[13px] tracking-[1px] text-ink-2">{b.authors.join(", ")}</span>}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
