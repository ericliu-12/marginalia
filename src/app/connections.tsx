"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import type { ConnectionCard, ConnectionsView } from "@/domain/connections";
import { countFindingConnectionsAction, dismissConnectionAction, getConnectionsAction, refreshConnectionsAction } from "./actions";
import { dangerLink, quietLink } from "./quiet-link";

// While Connections are being found, check back now and then.
const POLL_MS = 4000;

// Calls `fn` now and then every `ms` after the previous call settles, so requests never overlap.
// Pauses while the tab is hidden and checks again as soon as it is shown.
function usePoll(fn: () => Promise<unknown>, ms: number, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    let busy = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      clearTimeout(timer);
      if (busy || document.hidden) return;
      busy = true;
      try {
        await fn();
      } catch {
        // the next tick tries again
      }
      busy = false;
      if (live) timer = setTimeout(tick, ms);
    };
    const onVisible = () => {
      if (!document.hidden) void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    void tick();
    return () => {
      live = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fn, ms, enabled]);
}

const TYPE: Record<ConnectionCard["type"], { label: string; swatch: string }> = {
  thematic: { label: "Thematic", swatch: "bg-thematic" },
  contrast: { label: "Contrast", swatch: "bg-contrast" },
  context: { label: "Context", swatch: "bg-context" },
};

// A Book's title that opens that Book: here, and in the graph's Connection panel.
export const titleLink =
  "text-left underline decoration-rule decoration-1 underline-offset-[5px] transition-colors duration-150 hover:decoration-ink hover:decoration-2";

const STRENGTH_LABEL: Record<ConnectionCard["strength"], string> = { strong: "Strong", moderate: "Moderate", weak: "Weak" };

// The Book's Connections: each other Book it links to and why. Quiet while there is nothing to say.
// Each other Book's title opens that Book, as the host decides (in the graph, it is followed).
export function ConnectionsSection({ bookId, onOpenBook }: { bookId: string; onOpenBook: (bookId: string) => void }) {
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

  if (!view) {
    if (!loadFailed) return null;
    return (
      <section aria-label="Connections" className="mb-8 border-b border-rule pb-6">
        <h3 className="border-b border-rule pb-2 text-[1.35rem] leading-tight font-medium">Connections</h3>
        <p role="alert" className="pt-4 text-contrast">
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
    <section aria-label="Connections" className="mb-8 border-b border-rule pb-6">
      <h3 ref={headingRef} tabIndex={-1} className="border-b border-rule pb-2 text-[1.35rem] leading-tight font-medium outline-none">
        Connections
      </h3>
      {status === "running" && <p className="pt-4 text-ink-2 italic">Finding Connections…</p>}
      {status === "failed" && <p className="pt-4 text-ink-2 italic">Couldn’t find Connections just now.</p>}
      {status === "idle" && cards.length === 0 && <p className="pt-4 text-ink-2 italic">No Connections yet.</p>}
      {cards.length > 0 && (
        <ul className="divide-y divide-rule/60">
          {cards.map((c) => (
            <li key={c.id} className="py-4">
              <p className="text-[1.05rem] leading-snug font-medium">
                <button
                  type="button"
                  onClick={() => onOpenBook(c.otherBookId)}
                  className={titleLink}
                >
                  {c.otherTitle}
                </button>
              </p>
              <p className="mt-2 max-w-[60ch]">{c.explanation}</p>
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 font-sans text-[0.8rem] text-ink-2">
                <span aria-hidden className={`inline-block h-2.5 w-2.5 shrink-0 rounded-[2px] ${TYPE[c.type].swatch}`} />
                <span>
                  {TYPE[c.type].label} · {STRENGTH_LABEL[c.strength]}
                  {c.grounding === "enrichment" && " · Not drawn from your notes"}
                </span>
                <DismissConnection
                  connectionId={c.id}
                  label={`Dismiss the Connection to ${c.otherTitle}`}
                  className="lg:ml-auto"
                  onDismissed={() => {
                    setSaid(`Connection to ${c.otherTitle} dismissed`);
                    setView((v) => v && { ...v, cards: v.cards.filter((x) => x.id !== c.id) });
                    // The dismissed card took focus with it; the heading is the nearest stable place.
                    headingRef.current?.focus();
                  }}
                />
              </div>
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
  return <p className="pt-4 font-sans text-[0.8rem] text-ink-2">Connections can’t draw on {what} yet. Refresh to try again.</p>;
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
        <p role="alert" className="mt-1 font-sans text-sm text-contrast">
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
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(false);
  const [pending, start] = useTransition();
  const keepRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);

  useEffect(() => {
    if (confirming) keepRef.current?.focus();
    else if (wasConfirming.current) triggerRef.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  function dismiss() {
    setError(false);
    start(async () => {
      const res = await dismissConnectionAction(connectionId);
      if (res.ok) onDismissed();
      else setError(true);
    });
  }

  return (
    <div
      aria-busy={pending}
      onKeyDown={(e) => {
        if (confirming && e.key === "Escape" && !pending) {
          e.stopPropagation();
          setConfirming(false);
        }
      }}
      className={`${className ?? ""} ${confirming ? "flex w-full flex-wrap items-center gap-x-5 gap-y-1 pt-1" : ""}`}
    >
      {confirming ? (
        <>
          <span id={`dismiss-${connectionId}`} className="w-full font-sans text-[0.8rem] text-ink-2">
            Dismiss this Connection? It won’t come back.
          </span>
          <button type="button" onClick={dismiss} disabled={pending} aria-describedby={`dismiss-${connectionId}`} className={dangerLink}>
            {pending ? "Dismissing…" : "Yes, dismiss"}
          </button>
          <button ref={keepRef} type="button" onClick={() => setConfirming(false)} disabled={pending} className={quietLink}>
            Keep
          </button>
        </>
      ) : (
        <button ref={triggerRef} type="button" onClick={() => setConfirming(true)} aria-label={label} className={quietLink}>
          Dismiss
        </button>
      )}
      {error && (
        <p role="alert" className="mt-1 w-full font-sans text-sm text-contrast">
          Couldn’t dismiss this Connection. Try again.
        </p>
      )}
    </div>
  );
}

// The quiet line beside the wordmark while Books are finding their Connections.
export function FindingIndicator({ initial }: { initial: number }) {
  const [seen, setSeen] = useState(initial);
  const [count, setCount] = useState(initial);
  // A fresh count from the server replaces whatever polling had found.
  if (seen !== initial) {
    setSeen(initial);
    setCount(initial);
  }
  const poll = useCallback(
    () =>
      countFindingConnectionsAction().then((n) => {
        if (n !== null) setCount(n);
      }),
    [],
  );
  usePoll(poll, POLL_MS, count > 0);
  // The live region stays mounted so the line is announced when it appears.
  return (
    <p role="status" className={`mr-auto font-serif text-sm text-ink-3 italic ${count > 0 ? "ml-4" : ""}`}>
      {count > 0 && `${count} ${count === 1 ? "Book" : "Books"} finding Connections`}
    </p>
  );
}
