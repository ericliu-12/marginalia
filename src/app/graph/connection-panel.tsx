"use client";

import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { ConnectionDetail } from "@/domain/connections";
import { getConnectionAction } from "../client-actions";
import { ConnectBookForm } from "../connect-book";
import { DeleteConnection, DismissConnection, titleLink } from "../connections";
import { quietLink } from "../quiet-link";
import { EDGE_WIDTH, typeColor, typeLabel, typeText } from "./graph-style";

// One Connection, chosen on the graph: its two Books, its Connection Type and Strength, and why. Either title opens
// that Book. Lives in the same floating panel as the Book panel, with the same way out.
export function ConnectionPanel({ id, onBack, onOpenBook }: { id: string; onBack: () => void; onOpenBook: (bookId: string) => void }) {
  const [state, setState] = useState<{ id: string; connection: ConnectionDetail | null } | "failed" | undefined>(undefined);
  const [retry, setRetry] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const goneRef = useRef<HTMLParagraphElement>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  // The reader's own, being edited in place of its reason.
  const [editing, setEditing] = useState(false);
  const [said, setSaid] = useState("");

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
    else if (c === null) goneRef.current?.focus();
  }, [c]);

  return (
    <aside aria-label="Connection" onKeyDown={(e) => e.key === "Escape" && onBack()} className="flex h-full min-h-0 flex-col bg-paper-2">
      <div className="px-6 pt-5 pb-3">
        <button
          type="button"
          onClick={onBack}
          className="-ml-0.5 flex items-center gap-1.5 text-[0.8rem] font-medium text-ink-3 transition-colors duration-150 hover:text-ink"
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
            Couldn’t open this connection.{" "}
            <button type="button" onClick={() => setRetry((n) => n + 1)} className="underline underline-offset-2">
              Try again
            </button>
          </p>
        )}
        {state !== "failed" && c === undefined && <p className="text-ink-2 italic">Opening this connection…</p>}
        {c === null && (
          <p ref={goneRef} tabIndex={-1} className="text-ink-2 italic outline-none">
            This connection is no longer in your graph.
          </p>
        )}
        {c && (
          <article>
            {/* The reader's own is labelled in its type's hue. */}
            <p className={`caps flex items-center gap-2.5 text-[12px] tracking-[1.2px] ${c.madeBy === "reader" ? typeText(c.type) : "text-ink-2"}`}>
              <span aria-hidden className="inline-block w-6 rounded-[2px]" style={{ height: Math.max(2, EDGE_WIDTH[c.strength]), background: typeColor(c.type) }} />
              {typeLabel(c)}
            </p>
            <h2 ref={headingRef} tabIndex={-1} className="mt-4 text-[1.35rem] leading-tight font-medium text-balance outline-none">
              <BookLink title={c.a.title} onOpen={() => onOpenBook(c.a.bookId)} />
              <span className="mx-2 font-normal text-ink-3 italic">and</span>
              <BookLink title={c.b.title} onOpen={() => onOpenBook(c.b.bookId)} />
            </h2>
            {editing ? (
              // The heading names both Books, so the form needn't.
              <ConnectBookForm
                bookId={c.a.bookId}
                editing={{ connectionId: c.id, type: c.type, reason: c.explanation }}
                onCancel={() => {
                  flushSync(() => setEditing(false));
                  editRef.current?.focus();
                }}
                onDone={async () => {
                  const res = await getConnectionAction(id);
                  flushSync(() => {
                    if (res) setState({ id, connection: res.connection });
                    setEditing(false);
                  });
                  setSaid("Connection saved.");
                  editRef.current?.focus();
                }}
              />
            ) : (
              <p className="mt-5 max-w-[60ch] text-[1.0625rem] leading-relaxed">{c.explanation}</p>
            )}
            {c.grounding === "enrichment" && <p className="mt-3 text-[0.8rem] text-ink-2">Not drawn from your notes</p>}
            {/* The reader's own is never dismissed: it is theirs to edit or delete. */}
            {c.madeBy === "reader" && !editing && (
              <DeleteConnection
                connectionId={c.id}
                className="mt-8 border-t border-rule pt-4"
                before={
                  <button ref={editRef} type="button" onClick={() => setEditing(true)} className={quietLink}>
                    Edit
                  </button>
                }
                onDeleted={() => {
                  setSaid(`Connection between ${c.a.title} and ${c.b.title} deleted.`);
                  setState({ id, connection: null });
                }}
              />
            )}
            {c.madeBy === "judge" && (
              <DismissConnection connectionId={c.id} className="mt-8 border-t border-rule pt-4" onDismissed={() => setState({ id, connection: null })} />
            )}
          </article>
        )}
        <p role="status" className="sr-only">
          {said}
        </p>
      </div>
    </aside>
  );
}

function BookLink({ title, onOpen }: { title: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={titleLink}
    >
      {title}
    </button>
  );
}
