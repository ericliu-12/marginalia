"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { LibraryItem } from "@/domain/library";
import type { SearchResult, Status } from "@/domain/search";
import { addBookAction, removeFromLibraryAction } from "./client-actions";
import { EMPTY_BOOK, type BookDraft } from "./book-draft";
import { FindingIndicator } from "./connections";
import { Cover } from "./cover";
import {
  AddByHand,
  addButton,
  addChoices,
  LABELS,
  LookalikeNote,
  ManualBookForm,
  resultMeta,
  resultMetaOf,
  resultTitle,
  searchInput,
  searchLabel,
  useBookSearch,
} from "./search-pane";
import { useScrollLock, useVisibleViewport } from "./use-visible-viewport";
import type { Pause } from "@/domain/spend";

// A Book added while Add is open: it can be undone until Done. `workKey` is null for one added by hand.
type Added = { bookId: string; workKey: string | null; title: string; byline: string; coverUrl: string | null; status: Status };

// Tapping a choice or Undo leaves focus in the search, so the phone's keyboard stays up for the next Book.
const keepFocus = (e: React.MouseEvent) => e.preventDefault();

const check = (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className="mr-1.5 inline text-context">
    <path d="M2 6.5l2.5 2.5L10 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// The phone's Add a Book: full screen over the shelf, for adding several Books in a row. The chosen
// result (the first, until another is tapped) opens in place on its three choices, Want to read,
// Reading or Finished, and goes in with one tap; search stays open with its text
// selected, so the next Book is typed straight over it. Every add can be undone until Done. A Book
// opened from here `hidden`s it, keeping the visit for back to return to; what was done there to the
// Books added (`items`, the library) shows here. `onAddedChange` hears the Statuses of what is added,
// newest first.
export function MobileAdd({
  items,
  finding,
  paused,
  hidden,
  onDone,
  onOpenBook,
  onAddedChange,
}: {
  items: LibraryItem[];
  finding: number;
  paused: Pause | null;
  hidden: boolean;
  onDone: () => void;
  onOpenBook: (bookId: string) => void;
  onAddedChange: (statuses: Status[]) => void;
}) {
  const [query, setQuery] = useState("");
  const { results, phase, retry } = useBookSearch(query);
  // Newest first. Undone ones leave; their search results then offer the choices again, whatever the
  // search said when it was fetched (`undone`).
  const [adds, setAdds] = useState<Added[]>([]);
  const [undone, setUndone] = useState<Set<string>>(new Set());
  // Each add as the library has it now: its Status there, and gone once a Book seen in the library has
  // left it (removed on its own screen). One just added may not have reached `items` yet.
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const entries = new Map(items.map((i) => [i.bookId, i]));
  const added = adds.flatMap((a) => {
    const entry = entries.get(a.bookId);
    if (entry) return [{ ...a, status: entry.status }];
    return seen.has(a.bookId) ? [] : [a];
  });
  useEffect(() => {
    const arrived = adds.filter((a) => !seen.has(a.bookId) && items.some((i) => i.bookId === a.bookId));
    if (arrived.length) setSeen((s) => new Set([...s, ...arrived.map((a) => a.bookId)]));
  }, [adds, items, seen]);
  const [said, setSaid] = useState("");
  // The result tapped open, or the one just added (or undone): until one is, a new search opens the
  // first that still offers its choices. After an add, none is open until the next is chosen.
  const [picked, setPicked] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualDraft, setManualDraft] = useState<BookDraft | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const view = useVisibleViewport();
  useScrollLock(!hidden);
  // Until Add has risen, the search's caret is hidden: iOS draws it apart from the page, so it lags and
  // jitters behind the moving field. Without motion there is no rise, and the caret shows at once.
  const [risen, setRisen] = useState(false);

  // Back from a Book opened here, the results are fetched again, so each says what the library holds now.
  const wasHidden = useRef(hidden);
  useEffect(() => {
    if (hidden) setRisen(false);
    else inputRef.current?.focus({ preventScroll: true });
    if (wasHidden.current && !hidden) retry();
    wasHidden.current = hidden;
  }, [hidden]); // eslint-disable-line react-hooks/exhaustive-deps
  const statuses = added.map((a) => a.status).join();
  useEffect(() => {
    onAddedChange(statuses ? (statuses.split(",") as Status[]) : []);
  }, [statuses, onAddedChange]);

  // Called in the tap itself as well as after it lands: iOS raises the keyboard only for focus given
  // during a gesture. Never scrolled to: iOS would scroll the page under Add to reach the search while
  // Add is still rising, leaving it pushed up behind the keyboard.
  function ready() {
    inputRef.current?.focus({ preventScroll: true });
    inputRef.current?.select();
  }

  function onAdded(entry: Added) {
    setAdds((a) => [entry, ...a]);
    setPicked(entry.workKey);
    setSaid(`Added ${entry.title} as ${LABELS[entry.status]}.`);
    ready();
  }
  function onUndone(entry: Added) {
    setAdds((a) => a.filter((x) => x.bookId !== entry.bookId));
    if (entry.workKey) setUndone((u) => new Set(u).add(entry.workKey!));
    setSaid(`Took ${entry.title} back out of your library.`);
    ready();
  }

  function closeManual(discard: boolean) {
    setManualOpen(false);
    if (discard) setManualDraft(null);
    inputRef.current?.focus({ preventScroll: true });
  }

  // What became of a result on this visit: added (and not undone), or already in the library.
  const inLibraryNow = (r: SearchResult) => (undone.has(r.workKey) ? null : r.libraryStatus);
  const offersChoices = (r: SearchResult) => !inLibraryNow(r) && !added.some((a) => a.workKey === r.workKey);
  const open = picked ? results.find((r) => r.workKey === picked && offersChoices(r)) : results.find(offersChoices);

  const q = query.trim();
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="mobile-add-heading"
      hidden={hidden}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        // In a search with text in it, Escape clears the search, as the field does on its own; then it closes Add.
        if (e.target === inputRef.current && query) setQuery("");
        else onDone();
      }}
      // Covers the whole page, so no strip of the shelf shows above the keyboard; inside, it is fitted to
      // what the keyboard leaves visible, as the Note sheet is, so the heading and search stay in view.
      style={view ? { paddingTop: view.top, paddingBottom: view.bottom } : undefined}
      onAnimationEnd={(e) => e.target === e.currentTarget && setRisen(true)}
      className="fixed inset-0 z-10 flex flex-col bg-paper motion-safe:animate-sheet-up"
    >
      <div className="mx-auto w-full max-w-[40rem] flex-none px-5 pt-[max(0.5rem,env(safe-area-inset-top))]">
        {/* Cancel only until something is added: after that, closing keeps what was added, so it is Done. */}
        <div className="grid min-h-11 grid-cols-[1fr_auto_1fr] items-center">
          {added.length === 0 && (
            <button type="button" onClick={onDone} className="-ml-3 min-h-11 justify-self-start px-3 text-[16px] text-ink-2 transition-colors active:text-ink">
              Cancel
            </button>
          )}
          <h2 id="mobile-add-heading" className="caps col-start-2 text-[17px] leading-tight font-medium tracking-[1.6px]">
            Add a Book
          </h2>
          <button type="button" onClick={onDone} className="-mr-3 min-h-11 justify-self-end px-3 text-[16px] text-accent transition-colors active:text-accent-deep">
            Done
          </button>
        </div>
        <label htmlFor="book-search" className={`${searchLabel} mt-3`}>
          Title or author
        </label>
        <input
          ref={inputRef}
          id="book-search"
          type="search"
          enterKeyHint="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPicked(null);
            setManualOpen(false);
          }}
          autoComplete="off"
          autoCapitalize="off"
          className={`mt-1 ${searchInput} ${risen ? "" : "motion-safe:caret-transparent"}`}
        />
        <FindingIndicator initial={finding} paused={paused} className="mt-2 min-h-5 text-[15px]" />
      </div>

      <p aria-live="polite" className="sr-only">
        {said}
      </p>
      <p aria-live="polite" className="sr-only">
        {phase === "done" && !manualOpen ? `${results.length} results` : ""}
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto max-w-[40rem] px-5 pb-6">
          {manualOpen && manualDraft ? (
            <div className="pt-4">
              <ManualBookForm
                draft={manualDraft}
                onChange={setManualDraft}
                onOpenBook={onOpenBook}
                onClose={closeManual}
                enterMovesOn
                onChoose={ready}
                onAdded={(title, bookId, status) => {
                  const byline = manualDraft.author.trim();
                  closeManual(true);
                  // The search that found nothing is done with; Added so far now leads with this Book.
                  setQuery("");
                  onAdded({ bookId, workKey: null, title, byline, coverUrl: null, status });
                }}
              />
            </div>
          ) : !q ? (
            added.length > 0 ? (
              <section aria-labelledby="added-so-far" className="pt-3">
                <h3 id="added-so-far" className="caps border-b border-ink pb-1.5 text-[14px] leading-tight font-medium tracking-[2px]">
                  Added so far
                </h3>
                <ul className="divide-y divide-rule-3">
                  {added.map((a) => (
                    <li key={a.bookId} className="pt-3">
                      <p className={resultTitle}>{a.title}</p>
                      <p className={resultMeta}>
                        {a.byline}
                        {!a.workKey && (
                          <span className="text-ink-3 normal-case italic [font-variant-caps:normal]">
                            {a.byline && " · "}Manual Book
                          </span>
                        )}
                      </p>
                      <AddedLine entry={a} onUndone={onUndone} onTap={ready} />
                    </li>
                  ))}
                </ul>
              </section>
            ) : (
              <p className="max-w-[34ch] pt-3 text-ink-2 italic">
                Search by title; add the author to narrow it.
              </p>
            )
          ) : (
            <>
              {phase === "loading" && results.length === 0 && <p className="pt-3 text-ink-2 italic">Searching…</p>}
              {phase === "error" && (
                <p className="pt-5">
                  <span className="text-contrast">Search is unavailable right now.</span>{" "}
                  <button type="button" onClick={retry} className={`${hitArea} whitespace-nowrap underline underline-offset-2`}>
                    Try again
                  </button>
                </p>
              )}
              {phase === "done" && results.length === 0 && (
                <p className="pt-3 text-ink-2 italic">No match for “{q}”. Check the spelling, or try the title alone.</p>
              )}
              {results.length > 0 && phase !== "idle" && phase !== "error" && (
                <ul aria-busy={phase === "loading"} className={`-mx-3 transition-opacity ${phase === "loading" ? "opacity-60" : ""}`}>
                    {results.map((r, i) => {
                      const inLibrary = inLibraryNow(r);
                      return (
                        <AddResult
                          key={r.workKey}
                          result={r}
                          added={added.find((a) => a.workKey === r.workKey)}
                          inLibrary={inLibrary}
                          open={r === open}
                          onPick={() => setPicked(r.workKey)}
                          // The full note shows on the first result still offering its choices; later ones point back to it.
                          lookalikeAgain={!!r.lookalike && results.slice(0, i).some((p) => offersChoices(p) && p.lookalike?.bookId === r.lookalike!.bookId)}
                          onAdded={onAdded}
                          onUndone={onUndone}
                          onOpenBook={onOpenBook}
                          onDuplicate={() => {
                            // Added elsewhere meanwhile: the search, fetched again, says how.
                            setUndone((u) => new Set([...u].filter((k) => k !== r.workKey)));
                            retry();
                          }}
                          onTap={ready}
                        />
                      );
                    })}
                </ul>
              )}
              <p className="mt-6 text-[13px] text-ink-3">
                Results from{" "}
                <a href="https://openlibrary.org" target="_blank" rel="noreferrer" className={`${hitArea} underline underline-offset-2`}>
                  Open Library
                </a>
              </p>
            </>
          )}
        </div>
      </div>
      {!(manualOpen && manualDraft) && (
        <AddByHand onOpen={openManual} className="mx-auto w-full max-w-[40rem] flex-none border-t border-rule-2 px-5 pb-[max(0.25rem,env(safe-area-inset-bottom))] text-center" />
      )}
    </div>
  );

  function openManual() {
    setManualDraft((d) => d ?? { ...EMPTY_BOOK, title: q });
    setManualOpen(true);
  }
}

// Undo and Open beside what became of a result: quiet, but at the line's size, so they read as the way back.
const sideAction =
  "-mr-2 min-h-11 min-w-11 px-2 text-[15px] text-ink-2 underline decoration-ink-3 underline-offset-4 transition-colors duration-150 hover:text-ink hover:decoration-ink disabled:text-ink-3";

// A touch target past the line a link sits in, without spacing the text out.
const hitArea = "relative after:absolute after:-inset-x-1 after:-inset-y-3.5 after:content-['']";

// One search result, and what became of it on this visit. While it offers its choices it is a row to
// tap open; `open`, it lies on the selected ground with an accent edge, its three choices showing.
function AddResult({
  result: r,
  added,
  inLibrary,
  open,
  onPick,
  lookalikeAgain,
  onAdded,
  onUndone,
  onOpenBook,
  onDuplicate,
  onTap,
}: {
  result: SearchResult;
  added: Added | undefined;
  inLibrary: Status | null;
  open: boolean;
  onPick: () => void;
  lookalikeAgain: boolean;
  onAdded: (entry: Added) => void;
  onUndone: (entry: Added) => void;
  onOpenBook: (bookId: string) => void;
  onDuplicate: () => void;
  onTap: () => void;
}) {
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState<Status | null>(null);
  const [failed, setFailed] = useState(false);
  // Added meanwhile somewhere else, so the choices give way.
  const [duplicate, setDuplicate] = useState(false);

  function add(status: Status) {
    onTap();
    setFailed(false);
    setAdding(status);
    start(async () => {
      const res = await addBookAction(r.workKey, status);
      if (res.ok) onAdded({ bookId: res.bookId, workKey: r.workKey, title: r.title, byline: r.authors.join(", "), coverUrl: r.coverUrl, status });
      else if (res.reason === "duplicate") {
        setDuplicate(true);
        onDuplicate();
      } else setFailed(true);
    });
  }

  const meta = resultMetaOf(r);
  const offers = !added && !inLibrary && !duplicate;
  const book = (
    <>
      <Cover title={r.title} url={r.coverUrl} />
      <span className="min-w-0 flex-1">
        <span className={`block ${resultTitle}`}>{r.title}</span>
        {meta && <span className={`block ${resultMeta}`}>{meta}</span>}
      </span>
    </>
  );
  return (
    <li className={`px-3 py-3.5 ${open ? "border-l-2 border-accent bg-paper-3 pl-[10px]" : "border-b border-rule-3"}`}>
      {offers ? (
        // Tapping a row opens it without taking focus from the search, so the keyboard stays up.
        <button type="button" aria-expanded={open} onMouseDown={keepFocus} onClick={onPick} className="flex w-full gap-3 text-left">
          {book}
        </button>
      ) : (
        <div className="flex gap-3">{book}</div>
      )}
      {r.lookalike && offers && <LookalikeNote lookalike={r.lookalike} again={lookalikeAgain} onOpenBook={onOpenBook} className="mt-2 ml-14" />}
      {added ? (
        <AddedLine entry={added} onUndone={onUndone} onTap={onTap} />
      ) : inLibrary ? (
        <p className="mt-1 flex min-h-11 items-center justify-between gap-3 text-[15px] text-ink-2">
          <span>
            {check}In your library · {LABELS[inLibrary]}
          </span>
          {r.libraryBookId && (
            <button type="button" onClick={() => onOpenBook(r.libraryBookId!)} aria-label={`Open ${r.title}`} className={sideAction}>
              Open
            </button>
          )}
        </p>
      ) : duplicate ? (
        // Until the search, fetched again, gives its Status.
        <p className="mt-1 flex min-h-11 items-center text-[15px] text-ink-2">{check}In your library</p>
      ) : (
        open && (
          <div className="mt-3">
            <p aria-hidden className="caps mb-2 text-[13px] tracking-[1.4px] text-ink-2">
              Add to
            </p>
            {/* The full width under the Book, so each choice reads large. */}
            <div className={addChoices} role="group" aria-label={`Add ${r.title}`}>
              {(Object.keys(LABELS) as Status[]).map((s) => (
                <button key={s} type="button" disabled={pending} onMouseDown={keepFocus} onClick={() => add(s)} className={addButton(pending && adding === s)}>
                  {pending && adding === s ? "Adding…" : LABELS[s]}
                </button>
              ))}
            </div>
          </div>
        )
      )}
      {failed && adding && (
        <p className="mt-1.5 text-[15px]">
          <span className="text-contrast">Couldn’t add this book.</span>{" "}
          <button type="button" onMouseDown={keepFocus} onClick={() => add(adding)} className={`${hitArea} whitespace-nowrap text-ink underline underline-offset-2`}>
            Try again
          </button>
        </p>
      )}
    </li>
  );
}

// "Added · Reading" and its Undo, which takes the Book back out of the library as Remove would.
function AddedLine({ entry, onUndone, onTap }: { entry: Added; onUndone: (entry: Added) => void; onTap: () => void }) {
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);
  return (
    <>
      <p className="mt-1 flex min-h-11 items-center justify-between gap-3 text-[15px] text-ink">
        <span>
          {check}Added · {LABELS[entry.status]}
        </span>
        <button
          type="button"
          disabled={pending}
          onMouseDown={keepFocus}
          onClick={() => {
            onTap();
            setFailed(false);
            start(async () => {
              if ((await removeFromLibraryAction(entry.bookId)).ok) onUndone(entry);
              else setFailed(true);
            });
          }}
          aria-label={`Undo adding ${entry.title}`}
          className={sideAction}
        >
          {pending ? "Undoing…" : "Undo"}
        </button>
      </p>
      {failed && <p className="text-[15px] text-contrast">Couldn’t undo. Try again.</p>}
    </>
  );
}
