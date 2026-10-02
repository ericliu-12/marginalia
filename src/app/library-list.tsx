"use client";

import { useState } from "react";
import type { LibraryItem } from "@/domain/library";
import { Cover } from "./cover";

const SECTIONS = [
  { status: "reading", label: "Reading", collapsible: false },
  { status: "want", label: "Want to read", collapsible: true },
  { status: "read", label: "Read", collapsible: true },
] as const;

export function LibraryList({ items }: { items: LibraryItem[] }) {
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
                  className="flex w-full items-center gap-2 text-left"
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
                  <li key={item.bookId} className="flex items-center gap-4 py-3">
                    <Cover title={item.title} url={item.coverUrl} />
                    <div className="min-w-0">
                      <p className="text-[1.05rem] leading-snug font-medium">{item.title}</p>
                      {item.authors.length > 0 && (
                        <p className="font-sans text-sm text-ink-2">{item.authors.join(", ")}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
