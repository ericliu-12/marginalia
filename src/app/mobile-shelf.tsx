"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { LibraryItem } from "@/domain/library";
import type { Status } from "@/domain/search";
import { BookPanel } from "./book-panel";
import { FindingIndicator } from "./connections";
import { ClusterDot } from "./cluster-tint";
import { MobileAdd } from "./mobile-add";
import { focusNote, NoteSheet } from "./note-sheet";
import { quietLink } from "./quiet-link";
import { AccountLink } from "./account-link";
import { DraftLine, EmptyShelves, MoreBooks, SHELVES, ShelfLabel, shortDate, useDrafts, useExpandedShelves } from "./shelf";
import type { Pause } from "@/domain/spend";

const pen = (
  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
    <path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 013 3L8 19z M14.5 6.5l3 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// How long the "Note saved" line stays.
const SAVED_MS = 8000;

// The library on a phone: the three numbered shelves, Reading first. A row opens its Book screen;
// "Add a Book" stays pinned at the bottom. There is no graph here.
// The pen on a Reading row opens the Note sheet for that Book over the shelf.
// The Book screen is a URL (/?book=<id>), and so are Add (/?add) and the Note sheet (/?note=<id>), so the
// phone's back gesture returns to the screen before.
export function MobileShelf({ items, finding, paused }: { items: LibraryItem[]; finding: number; paused: Pause | null }) {
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
  const drafts = useDrafts(items);
  const { shown, expand, reveal } = useExpandedShelves();
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
    // A Book that has moved past where its shelf stops showing comes back with the shelf shown whole,
    // so its row is there to return to.
    const status = items.find((i) => i.bookId === from)?.status;
    if (status && !shown(status, items.filter((i) => i.status === status)).some((i) => i.bookId === from)) {
      reveal([status]);
      return;
    }
    back.current = null;
    window.scrollTo(0, scrollY);
    // A removed Book has no row to return to; the shelf's heading is the nearest stable place.
    (document.querySelector<HTMLElement>(`[data-book-id="${from}"]`) ?? headingRef.current)?.focus();
  }, [book, items, shown, reveal]);

  // Leaving Add, by Done or back, returns to the button that opened it, with the shelves that were
  // added to shown whole.
  const wasAdding = useRef(adding);
  useEffect(() => {
    if (wasAdding.current && !adding && !book) {
      const filed = addedTo.current.filter((s) => s !== "reading");
      addedTo.current = [];
      if (filed.length) reveal(filed);
      window.scrollTo(0, addScroll.current);
      addRef.current?.focus();
    }
    wasAdding.current = adding;
  }, [adding, book, reveal]);

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

  const shelves = SHELVES.map((sh) => ({ ...sh, rows: items.filter((i) => i.status === sh.status) })).filter((sh) => sh.status === "reading" || sh.rows.length > 0);
  return (
    <>
      {book ? (
        <main className="mx-auto max-w-[40rem] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
          <BookPanel
            key={book.bookId}
            variant="screen"
            item={book}
            backLabel={addKept ? "Back to Add a book" : "Back to library"}
            onBack={goBack}
            onRemoved={goBack}
            onOpenBook={openBook}
          />
        </main>
      ) : (
        <>
          <main inert={adding || !!noteBook} className="mx-auto max-w-[40rem] px-5 pt-[max(1.125rem,env(safe-area-inset-top))] pb-40">
            {/* A line too long to sit beside the wordmark drops under it whole, rather than wrapping, running
                under Account; it wraps only past the page's width (a 320px phone). Account stays at the end of the
                wordmark's row. */}
            <div className="flex items-baseline gap-x-4">
              <div className="flex min-h-11 flex-1 flex-wrap items-baseline gap-x-4 gap-y-1">
                <p className="text-[24px] leading-none italic">Marginalia</p>
                <FindingIndicator initial={finding} paused={paused} className="max-w-[calc(100vw-2.5rem)] shrink-0" />
              </div>
              <AccountLink />
            </div>
            {items.length === 0 ? (
              <>
                <h1 ref={headingRef} tabIndex={-1} className="sr-only">
                  Reading
                </h1>
                <div className="mt-8">
                  <EmptyShelves />
                </div>
              </>
            ) : (
              <div className="mt-5 flex flex-col gap-[22px]">
                {shelves.map(({ status, label, rows }, index) => {
                  const visible = shown(status, rows);
                  return (
                    <section key={status} aria-labelledby={`shelf-${status}`}>
                      <ShelfLabel
                        as={status === "reading" ? "h1" : "h2"}
                        ref={status === "reading" ? headingRef : undefined}
                        tabIndex={status === "reading" ? -1 : undefined}
                        id={`shelf-${status}`}
                        index={index}
                        label={label}
                        count={status === "read" ? rows.length : undefined}
                      />
                      {status === "reading" && rows.length === 0 ? (
                        <p className="mt-2.5 max-w-[32ch] text-ink-2 italic">Nothing in progress. Add a book you’re reading, or start one from Want to read.</p>
                      ) : (
                        <Rows items={visible} drafts={drafts} onOpen={openBook} onNote={status === "reading" ? openNote : undefined} />
                      )}
                      {visible.length < rows.length && (
                        <MoreBooks count={rows.length - visible.length} firstHidden={rows[visible.length].bookId} onExpand={() => expand(status)} />
                      )}
                    </section>
                  );
                })}
              </div>
            )}
          </main>
          <div inert={adding || !!noteBook} className="fixed inset-x-0 bottom-0 border-t border-rule-2 bg-paper pt-3">
            <div className="mx-auto max-w-[40rem] px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
              <p ref={savedRef} role="status" className="-mt-1 mb-1 flex min-h-11 items-center gap-x-4 text-sm text-ink-2 empty:hidden">
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
                className="flex min-h-12 w-full items-center justify-center bg-ink text-[17px] text-paper italic transition-colors active:bg-ink-2"
              >
                Add a book
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

// A shelf's rows, each opening its Book screen. Reading rows stack title, author and any draft Note,
// with the pen beside them; Want to read sets the author across from the title; Read leads with the
// Cluster's dot and ends with the finish date.
function Rows({
  items,
  drafts,
  onOpen,
  onNote,
}: {
  items: LibraryItem[];
  drafts: Map<string, string>;
  onOpen: (bookId: string) => void;
  onNote?: (bookId: string) => void;
}) {
  return (
    <ul className={onNote ? "mt-1.5" : "mt-1 divide-y divide-rule-3"}>
      {items.map((item) => {
        const draft = drafts.get(item.bookId);
        const author = item.authors.join(", ");
        const press = "min-w-0 flex-1 text-left transition-colors duration-150 active:bg-paper-3/60";
        if (onNote) {
          return (
            <li key={item.bookId} className="flex items-start gap-1">
              <button type="button" data-book-id={item.bookId} onClick={() => onOpen(item.bookId)} className={`${press} min-h-11 py-1.5`}>
                <span className="block text-[20px] leading-[1.2] text-balance italic">{item.title}</span>
                {author && <span className="caps block text-[13px] tracking-[1px] text-ink-2">{author}</span>}
                {item.reReading && <span className="block text-[14px] text-ink-3 italic">Re-reading</span>}
                {draft !== undefined && <DraftLine page={draft} className="mt-0.5 text-[14px]" />}
              </button>
              <button
                type="button"
                data-note-for={item.bookId}
                aria-label={`Write a note on ${item.title}`}
                onClick={() => onNote(item.bookId)}
                className="-mr-3 grid size-12 shrink-0 place-items-center text-ink-2 transition-colors duration-150 active:bg-paper-3"
              >
                {pen}
              </button>
            </li>
          );
        }
        const read = item.status === "read";
        return (
          <li key={item.bookId}>
            <button
              type="button"
              data-book-id={item.bookId}
              onClick={() => onOpen(item.bookId)}
              className={`${press} grid min-h-11 w-full items-baseline gap-x-2.5 py-2 ${read ? "grid-cols-[8px_minmax(0,1fr)_auto]" : "grid-cols-[minmax(0,1fr)_auto]"}`}
            >
              {read && <span className="text-[17px]">{item.cluster && <ClusterDot wash={item.cluster.wash} />}</span>}
              <span className="text-[17px] leading-[1.25] italic">
                {item.title}
                {item.cluster?.name && <span className="sr-only">, in {item.cluster.name}</span>}
              </span>
              {read ? (
                <span className="text-[13px] text-ink-2 tabular-nums">{item.finishedAt !== null && shortDate(item.finishedAt)}</span>
              ) : (
                <span className="caps max-w-[11rem] text-right text-[13px] leading-snug tracking-[1px] text-ink-2">{author}</span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
