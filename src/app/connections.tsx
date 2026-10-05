"use client";

import { useEffect, useState } from "react";
import type { ConnectionCard, ConnectionsView } from "@/domain/connections";
import { countFindingConnectionsAction, getConnectionsAction } from "./actions";

// While Connections are being found, check back now and then.
const POLL_MS = 4000;

const TYPE: Record<ConnectionCard["type"], { label: string; swatch: string }> = {
  thematic: { label: "Thematic", swatch: "bg-thematic" },
  contrast: { label: "Contrast", swatch: "bg-contrast" },
  context: { label: "Context", swatch: "bg-context" },
};

// The Book's Connections: each other Book it links to and why. Quiet while there is nothing to say.
export function ConnectionsSection({ bookId }: { bookId: string }) {
  const [view, setView] = useState<ConnectionsView | null | undefined>(undefined);

  const running = view === undefined || view?.status === "running";
  useEffect(() => {
    let live = true;
    const load = () =>
      getConnectionsAction(bookId).then((res) => {
        if (live && res) setView(res);
      });
    load();
    if (!running) return () => void (live = false);
    const timer = setInterval(load, POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [bookId, running]);

  if (!view) return null;
  const { cards, status, finished } = view;
  if (!finished && cards.length === 0) return null;

  return (
    <section aria-label="Connections" className="mb-8 border-b border-rule pb-6">
      <h3 className="border-b border-rule pb-2 text-[1.35rem] leading-tight font-medium">Connections</h3>
      {status === "running" && (
        <p role="status" className="pt-4 text-ink-2 italic">
          Finding Connections…
        </p>
      )}
      {status === "failed" && cards.length === 0 && (
        <p className="pt-4 text-ink-2 italic">Couldn’t find Connections just now.</p>
      )}
      {status === "idle" && cards.length === 0 && <p className="pt-4 text-ink-2 italic">No Connections yet.</p>}
      {cards.length > 0 && (
        <ul className="divide-y divide-rule/60">
          {cards.map((c) => (
            <li key={c.otherBookId} className="py-4">
              <p className="text-[1.05rem] leading-snug font-medium">{c.otherTitle}</p>
              <p className="mt-0.5 flex items-center gap-2 font-sans text-[0.8rem] text-ink-2">
                <span aria-hidden className={`inline-block h-2.5 w-2.5 rounded-[2px] ${TYPE[c.type].swatch}`} />
                {TYPE[c.type].label} · {c.strength === "strong" ? "Strong" : "Moderate"}
              </p>
              <p className="mt-2 max-w-[60ch]">{c.explanation}</p>
              {c.grounding === "enrichment" && <p className="mt-1 font-sans text-xs text-ink-3 italic">Not drawn from your notes</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// The quiet line beside the wordmark while Books are finding their Connections.
export function FindingIndicator({ initial }: { initial: number }) {
  const [count, setCount] = useState(initial);
  useEffect(() => setCount(initial), [initial]);
  const idle = count === 0;
  useEffect(() => {
    if (idle) return;
    let live = true;
    const timer = setInterval(
      () => countFindingConnectionsAction().then((n) => live && n !== null && setCount(n)),
      POLL_MS,
    );
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [idle]);
  if (count === 0) return null;
  return (
    <p role="status" className="ml-4 mr-auto font-serif text-sm text-ink-3 italic">
      {count} {count === 1 ? "Book" : "Books"} finding Connections
    </p>
  );
}
