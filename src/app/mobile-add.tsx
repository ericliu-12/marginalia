"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { LibraryItem } from "@/domain/library";
import type { SearchResult, Status } from "@/domain/search";
import { addBookAction, removeFromLibraryAction } from "./client-actions";
import { EMPTY_BOOK, type BookDraft } from "./book-draft";
import { FindingIndicator } from "./connections";
import { Cover } from "./cover";
import { quietLink } from "./quiet-link";
import { addButton, addChoices, LABELS, LookalikeNote, ManualBookForm, useBookSearch } from "./search-pane";
import { useVisibleViewport } from "./use-visible-viewport";
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

// The phone's Add a Book: full screen over the shelf, for adding several Books in a row. Each result
// goes in with one tap as Want to read, Reading or Already read; search stays open with its text
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
  const [manualOpen, setManualOpen] = useState(false);
  const [manualDraft, setManualDraft] = useState<BookDraft | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const view = useVisibleViewport();
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
      // Fitted to what the keyboard leaves visible, as the Note sheet is, so the heading and search stay in view.
      style={view ? { top: view.top, height: view.height } : { top: 0, height: "100dvh" }}
      onAnimationEnd={(e) => e.target === e.currentTarget && setRisen(true)}
      className="fixed inset-x-0 z-10 flex flex-col bg-paper motion-safe:animate-sheet-up"
    >
      <div className="mx-auto w-full max-w-[40rem] flex-none px-6 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex min-h-11 items-center justify-between">
          <h2 id="mobile-add-heading" className="text-[1.75rem] leading-tight font-medium">
            Add a Book
          </h2>
          <button type="button" onClick={onDone} className="-mr-3 min-h-11 px-3 font-sans text-[0.95rem] font-medium text-ink transition-colors active:text-ink-2">
            Done
          </button>
        </div>
        <label htmlFor="book-search" className="sr-only">
          Search by title and author
        </label>
        <input
          ref={inputRef}
          id="book-search"
          type="search"
          enterKeyHint="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setManualOpen(false);
          }}
          placeholder="Title and author"
          autoComplete="off"
          autoCapitalize="off"
          className={`mt-3 min-h-12 w-full rounded-[3px] border border-edge bg-paper-2 px-3 ${risen ? "" : "motion-safe:caret-transparent"} font-sans text-base text-ink placeholder:text-ink-3 focus-visible:border-thematic focus-visible:ring-2 focus-visible:ring-thematic/30 focus-visible:outline-none`}
        />
        <FindingIndicator initial={finding} paused={paused} className="mt-2 min-h-5" />
      </div>

      <p aria-live="polite" className="sr-only">
        {said}
      </p>
      <p aria-live="polite" className="sr-only">
        {phase === "done" && !manualOpen ? `${results.length} results` : ""}
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto max-w-[40rem] px-6 pb-[max(2rem,env(safe-area-inset-bottom))]">
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
              <section aria-labelledby="added-so-far" className="pt-5">
                <h3 id="added-so-far" className="border-b border-rule pb-2 text-[1.05rem] leading-snug font-medium">
                  Added so far
                </h3>
                <ul className="divide-y divide-rule/60">
                  {added.map((a) => (
                    <li key={a.bookId} className="flex gap-4 py-3">
                      <Cover title={a.title} url={a.coverUrl} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[1.05rem] leading-snug font-medium">{a.title}</p>
                        <p className="font-sans text-sm text-ink-2">
                          {a.byline}
                          {!a.workKey && (
                            <span className="font-serif text-ink-3 italic">
                              {a.byline && " · "}Manual Book
                            </span>
                          )}
                        </p>
                        <AddedLine entry={a} onUndone={onUndone} onTap={ready} />
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ) : (
              <p className="max-w-[34ch] pt-5 text-ink-2 italic">
                Search by title; add the author to narrow it. Each Book goes in with one tap, and search stays open for the next.
              </p>
            )
          ) : (
            <>
              {phase === "loading" && results.length === 0 && <p className="pt-5 text-ink-2 italic">Searching…</p>}
              {phase === "error" && (
                <p className="pt-5">
                  <span className="text-contrast">Search is unavailable right now.</span>{" "}
                  <button type="button" onClick={retry} className={`${hitArea} whitespace-nowrap underline underline-offset-2`}>
                    Try again
                  </button>
                </p>
              )}
              {phase === "done" && results.length === 0 && (
                <>
                  <p className="pt-5 text-ink-2 italic">No match for “{q}”. Check the spelling, or try the title alone.</p>
                  <p className="mt-1 font-sans text-sm text-ink-2">
                    Not on Open Library? <AddByHand onOpen={openManual} />
                  </p>
                </>
              )}
              {results.length > 0 && phase !== "idle" && phase !== "error" && (
                <>
                  <ul aria-busy={phase === "loading"} className={`divide-y divide-rule/60 transition-opacity ${phase === "loading" ? "opacity-60" : ""}`}>
                    {results.map((r, i) => {
                      const inLibrary = inLibraryNow(r);
                      return (
                        <AddResult
                          key={r.workKey}
                          result={r}
                          added={added.find((a) => a.workKey === r.workKey)}
                          inLibrary={inLibrary}
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
                  <p className="border-t border-rule/60 pt-2 font-sans text-sm text-ink-2">
                    Not the book you mean? <AddByHand onOpen={openManual} />
                  </p>
                </>
              )}
              <p className="mt-6 font-sans text-xs text-ink-3">
                Results from{" "}
                <a href="https://openlibrary.org" target="_blank" rel="noreferrer" className={`${hitArea} underline underline-offset-2`}>
                  Open Library
                </a>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );

  function openManual() {
    setManualDraft((d) => d ?? { ...EMPTY_BOOK, title: q });
    setManualOpen(true);
  }
}

// A touch target past the line a link sits in, without spacing the text out.
const hitArea = "relative after:absolute after:-inset-x-1 after:-inset-y-3.5 after:content-['']";

function AddByHand({ onOpen }: { onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className={quietLink}>
      Add it by hand
    </button>
  );
}

// One search result: its three choices, or what became of it.
function AddResult({
  result: r,
  added,
  inLibrary,
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

  const meta = [r.authors.join(", "), r.firstPublishedYear].filter(Boolean).join(" · ");
  return (
    <li className="py-4">
      <div className="flex gap-4">
        <Cover title={r.title} url={r.coverUrl} />
        <div className="min-w-0 flex-1">
          <p className="text-[1.05rem] leading-snug font-medium">{r.title}</p>
          {meta && <p className="font-sans text-sm text-ink-2">{meta}</p>}
          {r.lookalike && !inLibrary && !added && <LookalikeNote lookalike={r.lookalike} again={lookalikeAgain} onOpenBook={onOpenBook} />}
        </div>
      </div>
      {/* The full width under the Book, so each choice reads on one line. */}
      <div className="mt-3">
        {added ? (
          <AddedLine entry={added} onUndone={onUndone} onTap={onTap} />
        ) : inLibrary ? (
          <p className="flex min-h-11 items-center justify-between gap-3 font-sans text-sm text-ink-2">
            <span>
              {check}In your library · {LABELS[inLibrary]}
            </span>
            {r.libraryBookId && (
              <button type="button" onClick={() => onOpenBook(r.libraryBookId!)} aria-label={`Open ${r.title}`} className={`${quietLink} -mr-2 px-2`}>
                Open
              </button>
            )}
          </p>
        ) : duplicate ? (
          // Until the search, fetched again, gives its Status.
          <p className="flex min-h-11 items-center font-sans text-sm text-ink-2">{check}In your library</p>
        ) : (
          <div className={addChoices} role="group" aria-label={`Add ${r.title}`}>
            {(Object.keys(LABELS) as Status[]).map((s) => (
              <button key={s} type="button" disabled={pending} onMouseDown={keepFocus} onClick={() => add(s)} className={addButton}>
                {pending && adding === s ? "Adding…" : LABELS[s]}
              </button>
            ))}
          </div>
        )}
        {failed && adding && (
          <p className="mt-1.5 font-sans text-sm">
            <span className="text-contrast">Couldn’t add this book.</span>{" "}
            <button type="button" onMouseDown={keepFocus} onClick={() => add(adding)} className={`${hitArea} whitespace-nowrap text-ink underline underline-offset-2`}>
              Try again
            </button>
          </p>
        )}
      </div>
    </li>
  );
}

// "Added · Reading" and its Undo, which takes the Book back out of the library as Remove would.
function AddedLine({ entry, onUndone, onTap }: { entry: Added; onUndone: (entry: Added) => void; onTap: () => void }) {
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);
  return (
    <>
      <p className="flex min-h-11 items-center justify-between gap-3 font-sans text-sm text-ink">
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
          className={`${quietLink} -mr-2 px-2`}
        >
          {pending ? "Undoing…" : "Undo"}
        </button>
      </p>
      {failed && <p className="font-sans text-sm text-contrast">Couldn’t undo. Try again.</p>}
    </>
  );
}
