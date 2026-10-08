"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { LibraryItem } from "@/domain/library";
import type { Status } from "@/domain/search";
import { BookPanel } from "./book-panel";
import { FindingIndicator } from "./connections";
import { Cover } from "./cover";
import { MobileAdd } from "./mobile-add";

const SECTIONS = [
  { status: "want", label: "Want to read" },
  { status: "read", label: "Read" },
] as const;

const chevron = (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className="shrink-0">
    <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// The library on a phone: the Reading shelf is home, with Want to read and Read folded away below.
// A row opens its Book screen; "Add a Book" stays pinned at the bottom. There is no graph here.
// The Book screen is a URL (/?book=<id>), and so is Add (/?add), so the phone's back gesture returns to
// the screen before.
export function MobileShelf({ items, finding }: { items: LibraryItem[]; finding: number }) {
  const params = useSearchParams();
  const bookId = params.get("book");
  const adding = !bookId && params.has("add");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  // Where the shelf was when a Book opened, to come back to: its scroll and the row that opened it.
  const back = useRef<{ scrollY: number; bookId: string } | null>(null);
  // Where the shelf was when Add opened, and the Statuses of what it added, for when it closes.
  const addScroll = useRef(0);
  const addedTo = useRef<Status[]>([]);
  const noteAdded = useCallback((statuses: Status[]) => {
    addedTo.current = statuses;
  }, []);
  const addRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const book = items.find((i) => i.bookId === bookId);

  // Add stays mounted, hidden, behind a Book opened from it, so back returns to the same visit.
  const [addKept, setAddKept] = useState(adding);
  if (adding && !addKept) setAddKept(true);
  if (!adding && !book && addKept) setAddKept(false);

  // From the shelf or from Add a Book is a new history entry; from another Book's Connection it takes
  // that Book's place, so back leads to where the first Book was opened.
  function openBook(id: string) {
    if (!book && !adding) back.current = { scrollY: window.scrollY, bookId: id };
    if (book) window.history.replaceState(window.history.state?.[PUSHED] ? pushedState() : null, "", `?book=${id}`);
    else window.history.pushState(pushedState(), "", `?book=${id}`);
    window.scrollTo(0, 0);
  }

  function openAdd() {
    addScroll.current = window.scrollY;
    window.history.pushState(pushedState(), "", "?add");
  }

  // An entry pushed from the screen before goes back to it; one opened from its URL has none, so it goes
  // to the shelf.
  function goBack() {
    if (window.history.state?.[PUSHED]) window.history.back();
    else window.history.replaceState(null, "", "/");
  }

  useLayoutEffect(() => {
    if (book || !back.current) return;
    const { scrollY, bookId: from } = back.current;
    // A Book moved off Reading comes back to its section open, so its row is there to return to.
    const status = items.find((i) => i.bookId === from)?.status;
    if (status && status !== "reading" && !open[status]) {
      setOpen((o) => ({ ...o, [status]: true }));
      return;
    }
    back.current = null;
    window.scrollTo(0, scrollY);
    // A removed Book has no row to return to; the shelf's heading is the nearest stable place.
    (document.querySelector<HTMLElement>(`[data-book-id="${from}"]`) ?? headingRef.current)?.focus();
  }, [book, items, open]);

  // Leaving Add, by Done or back, returns to the button that opened it, with the sections that were
  // added to open.
  const wasAdding = useRef(adding);
  useEffect(() => {
    if (wasAdding.current && !adding && !book) {
      const filed = addedTo.current.filter((s) => s !== "reading");
      addedTo.current = [];
      if (filed.length) setOpen((o) => ({ ...o, ...Object.fromEntries(filed.map((s) => [s, true])) }));
      window.scrollTo(0, addScroll.current);
      addRef.current?.focus();
    }
    wasAdding.current = adding;
  }, [adding, book]);

  const reading = items.filter((i) => i.status === "reading");
  return (
    <>
      {book ? (
        <main className="mx-auto max-w-[40rem] pt-[env(safe-area-inset-top)]">
          <BookPanel
            key={book.bookId}
            variant="screen"
            item={book}
            backLabel={addKept ? "Back to Add a Book" : "Back to library"}
            onBack={goBack}
            onRemoved={goBack}
            onOpenBook={openBook}
          />
        </main>
      ) : (
        <>
          <main inert={adding} className="mx-auto max-w-[40rem] px-6 pt-[max(1.25rem,env(safe-area-inset-top))] pb-36">
            <div className="flex min-h-11 items-baseline gap-4">
              <p className="text-[1.75rem] leading-none font-medium tracking-[-0.01em] italic">Marginalia</p>
              <FindingIndicator initial={finding} />
            </div>
            <h1 ref={headingRef} tabIndex={-1} className="mt-6 text-[2rem] leading-tight font-medium outline-none">Reading</h1>
            {reading.length > 0 ? (
              <Rows items={reading} onOpen={openBook} />
            ) : (
              <p className="mt-3 max-w-[32ch] text-lg text-ink-2 italic">
                {items.length === 0
                  ? "Your library is empty. Add a Book to begin."
                  : "Nothing in progress. Add a Book you’re reading, or start one from Want to read."}
              </p>
            )}
            {SECTIONS.map(({ status, label }) => {
              const rows = items.filter((i) => i.status === status);
              if (rows.length === 0) return null;
              const expanded = !!open[status];
              return (
                <section key={status} aria-labelledby={`shelf-${status}`} className="mt-10">
                  <h2 id={`shelf-${status}`} className="border-b border-rule text-[1.35rem] leading-tight font-medium">
                    <button
                      type="button"
                      aria-expanded={expanded}
                      onClick={() => setOpen((o) => ({ ...o, [status]: !expanded }))}
                      className="flex min-h-12 w-full items-center gap-2.5 text-left"
                    >
                      <span className={`text-ink-3 transition-transform duration-200 ease-out-expo ${expanded ? "rotate-90" : ""}`}>{chevron}</span>
                      {label}
                      <span className="font-sans text-sm font-normal text-ink-3">{rows.length}</span>
                    </button>
                  </h2>
                  {expanded && <Rows items={rows} onOpen={openBook} />}
                </section>
              );
            })}
          </main>
          <div inert={adding} className="fixed inset-x-0 bottom-0 bg-linear-to-t from-paper from-60% to-paper/0 pt-8">
            <div className="mx-auto max-w-[40rem] px-6 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <button
                ref={addRef}
                type="button"
                aria-expanded={adding}
                onClick={openAdd}
                className="flex min-h-12 w-full items-center justify-center gap-2 rounded-[3px] bg-ink font-sans text-[0.95rem] font-medium text-paper transition-colors active:bg-ink-2"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
                  <path d="M7 1.5v11M1.5 7h11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                Add a Book
              </button>
            </div>
          </div>
        </>
      )}
      {addKept && <MobileAdd finding={finding} hidden={!adding} onDone={goBack} onOpenBook={openBook} onAddedChange={noteAdded} />}
    </>
  );
}

// Marks a history entry as pushed from the screen before it, so going back is going there. A new object
// each time: Next writes its own fields into the one it is given.
const PUSHED = "marginaliaPushed";
const pushedState = () => ({ [PUSHED]: true });

function Rows({ items, onOpen }: { items: LibraryItem[]; onOpen: (bookId: string) => void }) {
  return (
    <ul className="mt-2 divide-y divide-rule/60">
      {items.map((item) => (
        <li key={item.bookId}>
          <button
            type="button"
            data-book-id={item.bookId}
            onClick={() => onOpen(item.bookId)}
            className="flex w-full items-center gap-4 py-3 text-left transition-colors duration-150 active:bg-paper-3/60"
          >
            <Cover title={item.title} url={item.coverUrl} />
            <span className="min-w-0 flex-1">
              <span className="block text-[1.05rem] leading-snug font-medium text-balance">{item.title}</span>
              {(item.authors.length > 0 || item.reReading) && (
                <span className="block font-sans text-sm text-ink-2">
                  {item.authors.join(", ")}
                  {item.reReading && (
                    <span className="font-serif text-ink-3 italic">
                      {item.authors.length > 0 && " · "}Re-reading
                    </span>
                  )}
                </span>
              )}
            </span>
            <span className="text-ink-3">{chevron}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
