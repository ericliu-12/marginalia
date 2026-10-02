"use client";

import { useState, useTransition } from "react";
import type { LibraryItem } from "@/domain/library";
import type { Status } from "@/domain/search";
import { changeStatusAction } from "./actions";
import { Cover } from "./cover";

// Quiet one-click moves per Status; the full Status control lives in the Book panel.
const MOVES: Record<Status, { label: string; to: Status }[]> = {
  reading: [
    { label: "Mark finished", to: "read" },
    { label: "Want to read", to: "want" },
  ],
  want: [
    { label: "Start reading", to: "reading" },
    { label: "Mark finished", to: "read" },
  ],
  read: [{ label: "Read again", to: "reading" }],
};

const SECTIONS = [
  { status: "reading", label: "Reading", collapsible: false },
  { status: "want", label: "Want to read", collapsible: true },
  { status: "read", label: "Read", collapsible: true },
] as const;

export function LibraryList({ items, openBookId, onOpen }: { items: LibraryItem[]; openBookId?: string; onOpen: (bookId: string) => void }) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  if (items.length === 0) {
    return (
      <p className="max-w-[34ch] pt-6 text-xl text-ink-2 italic">
        Your library is empty. Search for a book to begin.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-10">
      {SECTIONS.map(({ status, label, collapsible }) => {
        const rows = items.filter((i) => i.status === status);
        if (rows.length === 0) return null;
        const open = !collapsed[status];
        return (
          <section key={status} aria-labelledby={`h-${status}`}>
            <h2 id={`h-${status}`} className="border-b border-rule pb-2 text-[1.35rem] leading-tight font-medium">
              {collapsible ? (
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setCollapsed((c) => ({ ...c, [status]: open }))}
                  className="flex min-h-11 w-full items-center gap-2 text-left lg:min-h-0"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className={`text-ink-3 transition-transform duration-200 ease-out-expo ${open ? "rotate-90" : ""}`}>
                    <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {label}
                  <span className="font-sans text-sm font-normal text-ink-3">{rows.length}</span>
                </button>
              ) : (
                <span className="flex items-baseline gap-2">
                  {label}
                  <span className="font-sans text-sm font-normal text-ink-3">{rows.length}</span>
                </span>
              )}
            </h2>
            {open && (
              <ul className="divide-y divide-rule/60">
                {rows.map((item) => (
                  <Row key={item.bookId} item={item} open={item.bookId === openBookId} onOpen={onOpen} />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

function Row({ item, open, onOpen }: { item: LibraryItem; open: boolean; onOpen: (bookId: string) => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState(false);
  const [moving, setMoving] = useState<Status | null>(null);

  function move(to: Status) {
    setError(false);
    setMoving(to);
    start(async () => {
      const res = await changeStatusAction(item.bookId, to);
      if (!res.ok) setError(true);
    });
  }

  return (
    <li aria-busy={pending} className="group flex items-start gap-4 py-3">
      <Cover title={item.title} url={item.coverUrl} />
      <div className="min-w-0">
        <p className="text-[1.05rem] leading-snug font-medium">
          <button
            type="button"
            aria-current={open || undefined}
            onClick={() => onOpen(item.bookId)}
            className="text-left decoration-rule underline-offset-4 transition-colors hover:underline hover:decoration-ink"
          >
            {item.title}
          </button>
        </p>
        {(item.authors.length > 0 || item.reReading) && (
          <p className="font-sans text-sm text-ink-2">
            {item.authors.join(", ")}
            {item.reReading && (
              <span className="font-serif text-ink-3 italic">
                {item.authors.length > 0 && " · "}Re-reading
              </span>
            )}
          </p>
        )}
        <div className="mt-2 flex flex-wrap gap-2 [@media(hover:hover)]:gap-4 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:transition-opacity [@media(hover:hover)]:duration-150 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100" role="group" aria-label={`Change status of ${item.title}`}>
          {MOVES[item.status].map(({ label, to }) => (
            <button
              key={to}
              type="button"
              disabled={pending}
              aria-label={`${label}: ${item.title}`}
              onClick={() => move(to)}
              className="min-h-11 rounded-[3px] border border-ink/70 px-2.5 font-sans text-[0.8rem] font-medium text-ink transition-colors duration-150 hover:bg-ink hover:text-paper disabled:border-rule disabled:text-ink-3 disabled:hover:bg-transparent disabled:hover:text-ink-3 [@media(hover:hover)]:min-h-0 [@media(hover:hover)]:border-transparent [@media(hover:hover)]:px-0 [@media(hover:hover)]:py-0 [@media(hover:hover)]:text-ink-3 [@media(hover:hover)]:underline [@media(hover:hover)]:decoration-rule [@media(hover:hover)]:underline-offset-4 [@media(hover:hover)]:hover:bg-transparent [@media(hover:hover)]:hover:text-ink [@media(hover:hover)]:hover:decoration-ink">
              {pending && moving === to ? "Moving…" : label}
            </button>
          ))}
        </div>
        {error && <p role="alert" className="mt-1.5 font-sans text-sm text-contrast">Couldn’t move this book. Try again.</p>}
      </div>
    </li>
  );
}
