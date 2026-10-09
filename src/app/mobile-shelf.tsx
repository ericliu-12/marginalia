"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { LibraryItem } from "@/domain/library";
import type { Status } from "@/domain/search";
import { BookPanel } from "./book-panel";
import { FindingIndicator } from "./connections";
import { Cover } from "./cover";
import { MobileAdd } from "./mobile-add";
import { hasDraft } from "./note-draft";
import { focusNote, NoteSheet } from "./note-sheet";
import { quietLink } from "./quiet-link";

const SECTIONS = [
  { status: "want", label: "Want to read" },
  { status: "read", label: "Read" },
] as const;

const pen = (
  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
    <path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 013 3L8 19z M14.5 6.5l3 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// How long the "Note saved" line stays.
const SAVED_MS = 8000;

const chevron = (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className="shrink-0">
    <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// The library on a phone: the Reading shelf is home, with Want to read and Read folded away below.
// A row opens its Book screen; "Add a Book" stays pinned at the bottom. There is no graph here.
// The pen on a Reading row opens the Note sheet for that Book over the shelf.
// The Book screen is a URL (/?book=<id>), and so are Add (/?add) and the Note sheet (/?note=<id>), so the
// phone's back gesture returns to the screen before.
export function MobileShelf({ items, finding, paused }: { items: LibraryItem[]; finding: number; paused: string | null }) {
  const params = useSearchParams();
  const bookId = params.get("book");
  const adding = !bookId && params.has("add");
  // The sheet opens inside the pen's tap, before the URL says so (`opening`), to focus its text there.
  const [opening, setOpening] = useState<string | null>(null);
  const noteParam = params.get("note");
  if (opening && noteParam === opening) setOpening(null);
  const noteBook = bookId || adding ? undefined : items.find((i) => i.bookId === (opening ?? noteParam));
  const noteBodyRef = useRef<HTMLTextAreaElement>(null);
  // The quiet "Note saved" line: it is said once the sheet has gone (`justSaved` holds it till then, so
  // it isn't spoken from behind the inert shelf), and it goes with the next move or after a while.
  const [saved, setSaved] = useState<{ bookId: string; title: string } | null>(null);
  const justSaved = useRef<{ bookId: string; title: string } | null>(null);
  const savedRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (!saved) return;
    const timer = setInterval(() => {
      // Not while the reader is on its Open link.
      if (!savedRef.current?.contains(document.activeElement)) setSaved(null);
    }, SAVED_MS);
    return () => clearInterval(timer);
  }, [saved]);
  // Which Books have an unsent draft, read again whenever a sheet or a Book screen opens or closes.
  const [drafts, setDrafts] = useState<Set<string>>(new Set());
  useEffect(() => {
    setDrafts(new Set(items.filter((i) => hasDraft(i.bookId)).map((i) => i.bookId)));
  }, [items, noteBook, bookId]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  // Where the shelf was when a Book opened, to come back to: its scroll and the row that opened it.
  const back = useRef<{ scrollY: number; bookId: string } | null>(null);
  // Where the shelf was when Add opened, and the Statuses of what it added, for when it closes.
  const addScroll = useRef(0);
  const addedTo = useRef<Status[]>([]);
  const noteAdded = useCallback((statuses: Status[]) => {
    addedTo.current = statuses;
  }, []);
  // How many screens were pushed above the shelf, so back from one is history's back. A screen opened
  // from its URL has none beneath it and goes to the shelf. (Not history.state: Next rewrites it.)
  const depth = useRef(0);
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
    setSaved(null);
    if (!book && !adding) back.current = { scrollY: window.scrollY, bookId: id };
    if (book) {
      window.history.replaceState(null, "", `?book=${id}`);
    } else {
      depth.current++;
      window.history.pushState(null, "", `?book=${id}`);
    }
    window.scrollTo(0, 0);
  }

  function openNote(id: string) {
    setSaved(null);
    depth.current++;
    window.history.pushState(null, "", `?note=${id}`);
    flushSync(() => setOpening(id));
    focusNote(noteBodyRef.current);
  }

  function openAdd() {
    setSaved(null);
    addScroll.current = window.scrollY;
    depth.current++;
    window.history.pushState(null, "", "?add");
  }

  function goBack() {
    if (depth.current > 0) {
      depth.current--;
      window.history.back();
    } else {
      window.history.replaceState(null, "", "/");
    }
  }
  // The back gesture leaves screens without goBack: back on the shelf none are pushed, on Add at most Add.
  useEffect(() => {
    const onPop = () => {
      const p = new URLSearchParams(window.location.search);
      depth.current = Math.min(depth.current, p.has("book") ? 2 : p.has("add") || p.has("note") ? 1 : 0);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

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

  // Closing the sheet, however it closes, returns to the pen that opened it.
  const noteFor = useRef<string | null>(null);
  useEffect(() => {
    if (noteBook) noteFor.current = noteBook.bookId;
    else if (noteFor.current) {
      setSaved(justSaved.current);
      justSaved.current = null;
      document.querySelector<HTMLElement>(`[data-note-for="${noteFor.current}"]`)?.focus();
      noteFor.current = null;
    }
  }, [noteBook]);

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
          <main inert={adding || !!noteBook} className="mx-auto max-w-[40rem] px-6 pt-[max(1.25rem,env(safe-area-inset-top))] pb-36">
            <div className="flex min-h-11 items-baseline gap-4">
              <p className="text-[1.75rem] leading-none font-medium tracking-[-0.01em] italic">Marginalia</p>
              <FindingIndicator initial={finding} paused={paused} />
            </div>
            <h1 ref={headingRef} tabIndex={-1} className="mt-6 text-[2rem] leading-tight font-medium outline-none">Reading</h1>
            {reading.length > 0 ? (
              <Rows items={reading} drafts={drafts} onOpen={openBook} onNote={openNote} />
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
                  {expanded && <Rows items={rows} drafts={drafts} onOpen={openBook} />}
                </section>
              );
            })}
          </main>
          <div inert={adding || !!noteBook} className="fixed inset-x-0 bottom-0 bg-linear-to-t from-paper from-60% to-paper/0 pt-8">
            <div className="mx-auto max-w-[40rem] px-6 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <p ref={savedRef} role="status" className="mb-1 flex min-h-11 items-center gap-x-4 font-sans text-sm text-ink-2 empty:hidden">
                {saved && (
                  <>
                    <span className="min-w-0 truncate">
                      Note saved on <i className="font-serif text-[0.95rem] text-ink">{saved.title}</i>
                    </span>
                    <button type="button" onClick={() => openBook(saved.bookId)} className={`${quietLink} shrink-0`}>
                      Open
                    </button>
                  </>
                )}
              </p>
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
      {noteBook && (
        <NoteSheet
          item={noteBook}
          bodyRef={noteBodyRef}
          onClose={goBack}
          onSaved={() => {
            justSaved.current = { bookId: noteBook.bookId, title: noteBook.title };
            goBack();
          }}
        />
      )}
      {addKept && <MobileAdd items={items} finding={finding} paused={paused} hidden={!adding} onDone={goBack} onOpenBook={openBook} onAddedChange={noteAdded} />}
    </>
  );
}

function Rows({
  items,
  drafts,
  onOpen,
  onNote,
}: {
  items: LibraryItem[];
  drafts: Set<string>;
  onOpen: (bookId: string) => void;
  onNote?: (bookId: string) => void;
}) {
  return (
    <ul className="mt-2 divide-y divide-rule/60">
      {items.map((item) => {
        const draft = drafts.has(item.bookId);
        return (
          <li key={item.bookId} className="flex items-center gap-1">
            <button
              type="button"
              data-book-id={item.bookId}
              onClick={() => onOpen(item.bookId)}
              className="flex min-w-0 flex-1 items-center gap-4 py-3 text-left transition-colors duration-150 active:bg-paper-3/60"
            >
              <Cover title={item.title} url={item.coverUrl} />
              <span className="min-w-0 flex-1">
                <span className="block text-[1.05rem] leading-snug font-medium text-balance">{item.title}</span>
                {(item.authors.length > 0 || item.reReading || draft) && (
                  <span className="block font-sans text-sm text-ink-2">
                    {item.authors.join(", ")}
                    {[item.reReading && "Re-reading", draft && "Draft note"].filter(Boolean).map((tag, i) => (
                      <span key={i} className="font-serif text-ink-3 italic">
                        {(item.authors.length > 0 || i > 0) && " · "}
                        {tag}
                      </span>
                    ))}
                  </span>
                )}
              </span>
              {!onNote && <span className="text-ink-3">{chevron}</span>}
            </button>
            {onNote && (
              <button
                type="button"
                data-note-for={item.bookId}
                aria-label={`Write a note on ${item.title}`}
                onClick={() => onNote(item.bookId)}
                className="-mr-3 grid size-12 shrink-0 place-items-center rounded-[3px] text-ink-2 transition-colors duration-150 active:bg-paper-3"
              >
                {pen}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
