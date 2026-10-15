"use client";

import { useCallback, useEffect, useState } from "react";
import type { LibraryItem } from "@/domain/library";
import type { Status } from "@/domain/search";
import { DRAFTS_CHANGED, hasDraft, loadDraft } from "./note-draft";

// The library's three shelves, numbered in lowercase roman, the same on the desktop and the phone.
export const SHELVES = [
  { status: "reading", label: "Reading" },
  { status: "want", label: "Want to read" },
  { status: "read", label: "Read" },
] as const satisfies readonly { status: Status; label: string }[];

const NUMERALS = ["i", "ii", "iii"];

// A shelf's small-caps label over its ink rule: "i. reading", "iii. read · 11". The numeral is the
// shelf's place, so a screen reader hears only the name. Read carries its count.
export function ShelfLabel({ as: Tag = "h2", index, label, count, id, ...rest }: {
  as?: "h1" | "h2";
  index: number;
  label: string;
  count?: number;
  id: string;
  className?: string;
  ref?: React.Ref<HTMLHeadingElement>;
  tabIndex?: number;
}) {
  return (
    <Tag id={id} {...rest} className={`caps border-b border-ink pb-1.5 text-[14px] leading-tight font-medium tracking-[2px] outline-none lg:text-[15px] ${rest.className ?? ""}`}>
      <span aria-hidden>{NUMERALS[index]}. </span>
      {label}
      {count !== undefined && ` · ${count}`}
    </Tag>
  );
}

// Read shows its latest few, and Want to read does once it is longer; Reading always shows everything.
export const SHELF_LIMIT = 8;

const expandedKey = "marginalia:shelf-expanded";
function loadExpanded(): Status[] {
  try {
    return JSON.parse(localStorage.getItem(expandedKey) ?? "[]");
  } catch {
    return [];
  }
}

// Which shelves show everything. "and N more" opens one for good on this device; `reveal` opens one
// only until the page is left, to bring back a row the reader came from.
export function useExpandedShelves() {
  const [remembered, setRemembered] = useState<Status[]>([]);
  const [revealed, setRevealed] = useState<Status[]>([]);
  useEffect(() => setRemembered(loadExpanded()), []);
  const expand = useCallback((status: Status) => {
    setRemembered((r) => {
      const next = r.includes(status) ? r : [...r, status];
      try {
        localStorage.setItem(expandedKey, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);
  const reveal = useCallback((statuses: Status[]) => setRevealed((r) => [...new Set([...r, ...statuses])]), []);
  const shown = useCallback(
    (status: Status, rows: LibraryItem[]) =>
      status === "reading" || rows.length <= SHELF_LIMIT || remembered.includes(status) || revealed.includes(status) ? rows : rows.slice(0, SHELF_LIMIT),
    [remembered, revealed],
  );
  return { shown, expand, reveal };
}

// "and 7 more": reveals the rest of the shelf, and moves focus to the first Book it brought in.
export function MoreBooks({ count, firstHidden, onExpand }: { count: number; firstHidden: string; onExpand: () => void }) {
  return (
    <button
      type="button"
      onClick={() => {
        onExpand();
        requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-book-id="${firstHidden}"]`)?.focus());
      }}
      className="-mb-2 min-h-11 text-left text-[14px] text-ink-2 italic underline decoration-transparent underline-offset-4 transition-colors duration-150 hover:text-ink hover:decoration-rule lg:min-h-0 lg:py-1.5 lg:text-[15px]"
    >
      and {count} more
    </button>
  );
}

// Which Books have an unsent draft Note, and the page it is on if one is given; kept up to date as
// drafts change in this tab.
export function useDrafts(items: LibraryItem[]) {
  const [drafts, setDrafts] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    const read = () => {
      const found = new Map<string, string>();
      for (const i of items) if (hasDraft(i.bookId)) found.set(i.bookId, loadDraft(i.bookId).page.trim());
      setDrafts(found);
    };
    read();
    window.addEventListener(DRAFTS_CHANGED, read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener(DRAFTS_CHANGED, read);
      window.removeEventListener("storage", read);
    };
  }, [items]);
  return drafts;
}

// A Reading Book's waiting Note, in the accent: "Draft note, p. 214".
export function DraftLine({ page, className = "" }: { page: string; className?: string }) {
  return <span className={`block text-accent ${className}`}>Draft note{page && `, p. ${page}`}</span>;
}

// Finish dates as the reader's shelf gives them: "3 Oct" on a row, "3 October" in the Book's panel.
// In UTC, so the server and the browser agree.
export const shortDate = (at: number) => new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
export const longDate = (at: number) => new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });

// The empty library, on either screen.
export function EmptyShelves() {
  return <p className="pt-2 text-[20px] text-ink-2 italic lg:text-[22px]">Your shelves are waiting.</p>;
}
