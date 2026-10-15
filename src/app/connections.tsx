"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import type { ConnectionCard, ConnectionsView } from "@/domain/connections";
import type { Pause } from "@/domain/spend";
import { backgroundStatusAction, dismissConnectionAction, getConnectionsAction, refreshConnectionsAction } from "./client-actions";
import { dangerLink, quietLink } from "./quiet-link";
import { useInlineConfirm } from "./use-inline-confirm";
import { POLL_MS, usePoll } from "./use-poll";

const TYPE: Record<ConnectionCard["type"], { label: string; hue: string }> = {
  thematic: { label: "Thematic", hue: "text-thematic" },
  contrast: { label: "Contrast", hue: "text-contrast" },
  context: { label: "Context", hue: "text-context" },
};

// The small-caps label over each part of the Book's panel, in the accent: "notes", "connections".
export const panelLabel = "caps text-[13px] font-medium tracking-[1.8px] text-accent outline-none";

// A Book's title that opens that Book: here, and in the graph's Connection panel.
export const titleLink =
  "text-left underline decoration-rule decoration-1 underline-offset-[5px] transition-colors duration-150 hover:decoration-ink hover:decoration-2";

const STRENGTH_LABEL: Record<ConnectionCard["strength"], string> = { strong: "Strong", moderate: "Moderate", weak: "Weak" };

// "Your first Connection.", said once on this device, over the reader's first Connections: counted as
// said once it has been up long enough to read.
const firstSaidKey = "marginalia:first-connection-said";
const FIRST_READ_MS = 1500;
function useFirstSaid(first: boolean) {
  const [say, setSay] = useState(false);
  useEffect(() => {
    if (!first) return;
    try {
      if (localStorage.getItem(firstSaidKey)) return;
    } catch {
      return;
    }
    setSay(true);
    const said = setTimeout(() => {
      try {
        localStorage.setItem(firstSaidKey, "1");
      } catch {}
    }, FIRST_READ_MS);
    return () => clearTimeout(said);
  }, [first]);
  return say;
}

// The Book's Connections: each other Book it links to and why. Quiet while there is nothing to say.
// Each other Book's title opens that Book, as the host decides (in the graph, it is followed).
// While the graph draws an arriving Book's Connections in, the ones still `withheld` wait, and each
// row appears as its line does.
export function ConnectionsSection({ bookId, onOpenBook, withheld }: { bookId: string; onOpenBook: (bookId: string) => void; withheld?: Set<string> }) {
  const [view, setView] = useState<ConnectionsView | undefined>(undefined);
  const [loadFailed, setLoadFailed] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [said, setSaid] = useState("");

  const load = useCallback(
    () =>
      getConnectionsAction(bookId).then((res) => {
        setLoadFailed(res === null);
        if (res) setView(res);
      }),
    [bookId],
  );
  // With nothing to show, a failed load stops the polling until "Try again".
  usePoll(load, POLL_MS, !(loadFailed && !view) && (view === undefined || view.status === "running"));
  // Not while the graph still holds them back: said as the first one appears.
  const shown = view?.cards.filter((c) => !withheld?.has(c.id)) ?? [];
  const sayFirst = useFirstSaid(!!view?.first && shown.length > 0);

  if (!view) {
    if (!loadFailed) return null;
    return (
      <section aria-label="Connections" className="mt-7 border-t border-rule-2 pt-3.5">
        <h3 className={panelLabel}>Connections</h3>
        <p role="alert" className="pt-2 text-contrast">
          Couldn’t load Connections.{" "}
          <button type="button" onClick={() => setLoadFailed(false)} className="underline underline-offset-2">
            Try again
          </button>
        </p>
      </section>
    );
  }
  const { cards, status, finished, leftOut } = view;
  if (!finished && cards.length === 0) return null;

  return (
    <section aria-label="Connections" className="mt-7 border-t border-rule-2 pt-3.5">
      <h3 ref={headingRef} tabIndex={-1} className={panelLabel}>
        Connections
      </h3>
      {status === "running" && <p className="pt-2 text-ink-2 italic">Finding Connections…</p>}
      {status === "failed" && <p className="pt-2 text-ink-2 italic">Couldn’t find Connections just now.</p>}
      {status === "idle" && cards.length === 0 && <p className="pt-2 text-ink-2 italic">No Connections yet.</p>}
      {/* In ink, not the secondary of the status lines, with its full stop in the accent: a moment, not a status. */}
      {sayFirst && (
        <p role="status" className="pt-2 text-[17px] text-ink italic motion-safe:animate-ink-in">
          Your first {cards.length === 1 ? "Connection" : "Connections"}
          <span className="text-accent">.</span>
        </p>
      )}
      {cards.length > 0 && (
        <ul className="mt-1.5 flex flex-col gap-3">
          {shown.map((c) => (
            <li key={c.id} className={withheld ? "motion-safe:animate-draw-in" : undefined}>
              {/* The type in its hue, then the other Book in italic and why. */}
              <div className="flex flex-wrap items-baseline gap-x-2">
                <p className={`caps text-[12px] tracking-[1.2px] ${TYPE[c.type].hue}`}>
                  {TYPE[c.type].label} · {STRENGTH_LABEL[c.strength]}
                  {c.grounding === "enrichment" && <span className="text-ink-3"> · Not drawn from your notes</span>}
                  {/* While its Book arrives in the graph, each Connection is marked new. */}
                  {withheld && <span className="text-accent"> · New</span>}
                </p>
                <DismissConnection
                  connectionId={c.id}
                  label={`Dismiss the Connection to ${c.otherTitle}`}
                  className="ml-auto"
                  onDismissed={() => {
                    setSaid(`Connection to ${c.otherTitle} dismissed`);
                    setView((v) => v && { ...v, cards: v.cards.filter((x) => x.id !== c.id) });
                    // The dismissed card took focus with it; the heading is the nearest stable place.
                    headingRef.current?.focus();
                  }}
                />
              </div>
              <p className="max-w-[60ch] text-[16px] leading-normal">
                <button type="button" onClick={() => onOpenBook(c.otherBookId)} className={`${titleLink} -my-2.5 py-2.5 italic lg:my-0 lg:py-0`}>
                  {c.otherTitle}
                </button>
                : {c.explanation}
              </p>
            </li>
          ))}
        </ul>
      )}
      <p role="status" className="sr-only">
        {said}
      </p>
      {finished && status !== "running" && <LeftOut leftOut={leftOut} />}
      {finished && status !== "running" && <RefreshConnections bookId={bookId} onRequested={load} />}
    </section>
  );
}

// What Connections couldn't draw on, just above the Refresh that tries it again.
function LeftOut({ leftOut: { notes, enrichment } }: { leftOut: ConnectionsView["leftOut"] }) {
  if (notes === 0 && !enrichment) return null;
  const yours = notes === 1 ? "one of your notes" : `${notes} of your notes`;
  const what = enrichment ? (notes > 0 ? `this book’s summary or ${yours}` : "this book’s summary") : yours;
  return <p className="pt-3 text-[0.8rem] text-ink-2">Connections can’t draw on {what} yet. Refresh to try again.</p>;
}

// Last in the section: regenerates the Book's Connections from its current Notes. Afterwards the section
// reads the status again, so it shows the run ("Finding Connections…") and checks back until it is done.
function RefreshConnections({ bookId, onRequested }: { bookId: string; onRequested: () => Promise<void> }) {
  const [error, setError] = useState(false);
  const [pending, start] = useTransition();

  function refresh() {
    setError(false);
    start(async () => {
      const res = await refreshConnectionsAction(bookId);
      if (res.ok) await onRequested();
      else setError(true);
    });
  }

  return (
    <div className="pt-3">
      <button type="button" onClick={refresh} disabled={pending} className={quietLink}>
        {pending ? "Refreshing…" : "Refresh connections"}
      </button>
      {error && (
        <p role="alert" className="mt-1 text-sm text-contrast">
          Couldn’t refresh Connections. Try again.
        </p>
      )}
    </div>
  );
}

// A quiet "Dismiss", then an inline confirmation, as in deleting a Note: focus lands on Keep, and returns
// to Dismiss when the reader keeps the Connection. Used on a Book's Connection cards and in the graph's
// Connection panel. While confirming it takes a line of its own.
export function DismissConnection({
  connectionId,
  label,
  className,
  onDismissed,
}: {
  connectionId: string;
  // Names which Connection, where several sit side by side.
  label?: string;
  className?: string;
  onDismissed: () => void;
}) {
  const { confirming, pending, error, keepRef, triggerRef, ask, keep, confirm, onKeyDown } = useInlineConfirm(
    () => dismissConnectionAction(connectionId),
    onDismissed,
  );

  return (
    <div
      aria-busy={pending}
      onKeyDown={onKeyDown}
      className={`${className ?? ""} ${confirming ? "flex w-full flex-wrap items-center gap-x-5 gap-y-1 pt-1" : ""}`}
    >
      {confirming ? (
        <>
          <span id={`dismiss-${connectionId}`} className="w-full text-[0.8rem] text-ink-2">
            Dismiss this Connection? It won’t come back.
          </span>
          <button type="button" onClick={confirm} disabled={pending} aria-describedby={`dismiss-${connectionId}`} className={dangerLink}>
            {pending ? "Dismissing…" : "Yes, dismiss"}
          </button>
          <button ref={keepRef} type="button" onClick={keep} disabled={pending} className={quietLink}>
            Keep
          </button>
        </>
      ) : (
        <button ref={triggerRef} type="button" onClick={ask} aria-label={label} className={quietLink}>
          Dismiss
        </button>
      )}
      {error && (
        <p role="alert" className="mt-1 w-full text-sm text-contrast">
          Couldn’t dismiss this Connection. Try again.
        </p>
      )}
    </div>
  );
}

// Where a narrow phone wraps the line, it wraps at the dot, never inside the date.
const unbroken = (text: string) => text.replaceAll(" ", "\u00a0");

// While paused, and nothing is finding Connections, the line checks back this often for the month to turn.
const PAUSED_POLL_MS = 60_000;

// The quiet line beside the wordmark while Books are finding their Connections, or while the Reader's
// background work is paused at a spending limit, which it says instead: a new Reader's first-month
// limit by name, and that it is their Connections that wait, so it reads as neither a fault nor a block
// on adding Books. `className` places it; by default it sits
// after the wordmark.
export function FindingIndicator({ initial, paused: initialPaused, className }: { initial: number; paused: Pause | null; className?: string }) {
  const [seen, setSeen] = useState({ initial, initialPaused });
  const [count, setCount] = useState(initial);
  const [paused, setPaused] = useState(initialPaused);
  // A fresh reading from the server replaces whatever polling had found.
  if (seen.initial !== initial || seen.initialPaused !== initialPaused) {
    setSeen({ initial, initialPaused });
    setCount(initial);
    setPaused(initialPaused);
  }
  const poll = useCallback(
    () =>
      backgroundStatusAction().then((s) => {
        if (s === null) return;
        setCount(s.finding);
        setPaused(s.paused);
      }),
    [],
  );
  usePoll(poll, count > 0 ? POLL_MS : PAUSED_POLL_MS, count > 0 || paused !== null);
  const line = paused
    ? paused.firstMonth
      ? `First-month limit · ${unbroken(`Connections back ${paused.resumesOn}`)}`
      : `Spending limit reached · ${unbroken(`resumes ${paused.resumesOn}`)}`
    : count > 0 ? `${count} ${count === 1 ? "Book" : "Books"} finding Connections` : null;
  // The live region stays mounted so the line is announced when it appears.
  return (
    <p role="status" className={`font-serif text-sm text-ink-3 italic ${className ?? `mr-auto ${line ? "ml-4" : ""}`}`}>
      {line}
    </p>
  );
}
