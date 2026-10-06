"use client";

import { useEffect, useRef, useState } from "react";
import type { ConnectionDetail } from "@/domain/connections";
import { getConnectionAction } from "../actions";
import { EDGE_WIDTH, STRENGTH_LABEL, TYPE_COLOR, TYPE_LABEL } from "./graph-style";

// The Connection behind an edge: its two Books, what kind of link it is, and why. Either title opens
// that Book. Lives in the same floating panel as the Book panel, with the same way out.
export function ConnectionPanel({ id, onBack, onOpenBook }: { id: string; onBack: () => void; onOpenBook: (bookId: string) => void }) {
  const [state, setState] = useState<{ id: string; connection: ConnectionDetail | null } | "failed" | undefined>(undefined);
  const [retry, setRetry] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let live = true;
    getConnectionAction(id).then((res) => {
      if (live) setState(res ? { id, connection: res.connection } : "failed");
    });
    return () => {
      live = false;
    };
  }, [id, retry]);

  const c = state && state !== "failed" && state.id === id ? state.connection : undefined;
  useEffect(() => {
    if (c) headingRef.current?.focus();
  }, [c]);

  return (
    <aside aria-label="Connection" onKeyDown={(e) => e.key === "Escape" && onBack()} className="flex h-full min-h-0 flex-col bg-paper-2">
      <div className="px-6 pt-5 pb-3">
        <button
          type="button"
          onClick={onBack}
          className="-ml-0.5 flex items-center gap-1.5 font-sans text-[0.8rem] font-medium text-ink-3 transition-colors duration-150 hover:text-ink"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
            <path d="M8 2L4 6l4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back to the graph
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-2 pb-10">
        {state === "failed" && (
          <p role="alert" className="text-contrast">
            Couldn’t open this Connection.{" "}
            <button type="button" onClick={() => setRetry((n) => n + 1)} className="underline underline-offset-2">
              Try again
            </button>
          </p>
        )}
        {state !== "failed" && c === undefined && <p className="text-ink-2 italic">Opening this Connection…</p>}
        {c === null && <p className="text-ink-2 italic">This Connection is no longer in your graph.</p>}
        {c && (
          <article>
            <p className="flex items-center gap-2.5 font-sans text-[0.8rem] font-medium text-ink-2">
              <span aria-hidden className="inline-block w-6 rounded-[2px]" style={{ height: Math.max(2, EDGE_WIDTH[c.strength]), background: TYPE_COLOR[c.type] }} />
              {TYPE_LABEL[c.type]} · {STRENGTH_LABEL[c.strength]}
            </p>
            <h2 ref={headingRef} tabIndex={-1} className="mt-4 text-[1.35rem] leading-tight font-medium text-balance outline-none">
              <BookLink title={c.a.title} onOpen={() => onOpenBook(c.a.bookId)} />
              <span className="mx-2 font-normal text-ink-3 italic">and</span>
              <BookLink title={c.b.title} onOpen={() => onOpenBook(c.b.bookId)} />
            </h2>
            <p className="mt-5 max-w-[60ch] text-[1.0625rem] leading-relaxed">{c.explanation}</p>
            {c.grounding === "enrichment" && <p className="mt-3 font-sans text-[0.8rem] text-ink-2">Not drawn from your notes</p>}
          </article>
        )}
      </div>
    </aside>
  );
}

function BookLink({ title, onOpen }: { title: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="text-left underline decoration-rule decoration-1 underline-offset-[5px] transition-colors duration-150 hover:decoration-ink"
    >
      {title}
    </button>
  );
}
