"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { SearchResult, Status } from "@/domain/search";
import { addBookAction, removeFromLibraryAction } from "./actions";
import { EMPTY_BOOK, type BookDraft } from "./book-draft";
import { FindingIndicator } from "./connections";
import { Cover } from "./cover";
import { quietLink } from "./quiet-link";
import { addButton, addChoices, LABELS, LookalikeNote, ManualBookForm, useBookSearch } from "./search-pane";

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
// selected, so the next Book is typed straight over it. Every add can be undone until Done.
export function MobileAdd({ finding, onDone, onOpenBook }: { finding: number; onDone: () => void; onOpenBook: (bookId: string) => void }) {
  const [query, setQuery] = useState("");
  const { results, phase, retry } = useBookSearch(query);
  // Newest first. Undone ones leave; their search results then offer the choices again, whatever the
  // search said when it was fetched (`undone`).
  const [added, setAdded] = useState<Added[]>([]);
  const [undone, setUndone] = useState<Set<string>>(new Set());
  const [said, setSaid] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [manualDraft, setManualDraft] = useState<BookDraft | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  function ready() {
    inputRef.current?.focus();
    inputRef.current?.select();
  }

  function onAdded(entry: Added) {
    setAdded((a) => [entry, ...a]);
    setSaid(`Added ${entry.title} as ${LABELS[entry.status]}.`);
    ready();
  }
  function onUndone(entry: Added) {
    setAdded((a) => a.filter((x) => x.bookId !== entry.bookId));
    if (entry.workKey) setUndone((u) => new Set(u).add(entry.workKey!));
    setSaid(`Took ${entry.title} back out of your library.`);
    ready();
  }

  function closeManual(discard: boolean) {
    setManualOpen(false);
    if (discard) setManualDraft(null);
    inputRef.current?.focus();
  }

  const q = query.trim();
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="mobile-add-heading"
      onKeyDown={(e) => e.key === "Escape" && onDone()}
      className="fixed inset-0 z-10 flex flex-col bg-paper motion-safe:animate-sheet-up"
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
          // The results are already there; Enter puts the keyboard away to show them.
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          placeholder="Title and author"
          autoComplete="off"
          autoCapitalize="off"
          className="mt-3 min-h-12 w-full rounded-[3px] border border-rule bg-paper-2 px-3 font-sans text-base text-ink placeholder:text-ink-3 focus-visible:border-thematic focus-visible:ring-2 focus-visible:ring-thematic/30 focus-visible:outline-none"
        />
        <FindingIndicator initial={finding} className="mt-2 min-h-5" />
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
                        {a.byline && <p className="font-sans text-sm text-ink-2">{a.byline}</p>}
                        <AddedLine entry={a} onUndone={onUndone} />
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
                <p className="pt-5 text-contrast">
                  Search is unavailable right now.{" "}
                  <button type="button" onClick={retry} className="min-h-11 underline underline-offset-2">
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
                      const inLibrary = undone.has(r.workKey) ? null : r.libraryStatus;
                      return (
                        <AddResult
                          key={r.workKey}
                          result={r}
                          added={added.find((a) => a.workKey === r.workKey)}
                          inLibrary={inLibrary}
                          lookalikeAgain={!!r.lookalike && results.slice(0, i).some((p) => !p.libraryStatus && p.lookalike?.bookId === r.lookalike!.bookId)}
                          onAdded={onAdded}
                          onUndone={onUndone}
                          onOpenBook={onOpenBook}
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
                <a href="https://openlibrary.org" target="_blank" rel="noreferrer" className="underline underline-offset-2">
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
}: {
  result: SearchResult;
  added: Added | undefined;
  inLibrary: Status | null;
  lookalikeAgain: boolean;
  onAdded: (entry: Added) => void;
  onUndone: (entry: Added) => void;
  onOpenBook: (bookId: string) => void;
}) {
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);

  function add(status: Status) {
    setError(null);
    setAdding(status);
    start(async () => {
      const res = await addBookAction(r, status);
      if (res.ok) onAdded({ bookId: res.bookId, workKey: r.workKey, title: r.title, byline: r.authors.join(", "), coverUrl: r.coverUrl, status });
      else if (res.reason === "duplicate") setError("Already in your library.");
      else setError("Couldn’t add this book. Try again.");
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
            <AddedLine entry={added} onUndone={onUndone} />
          ) : inLibrary ? (
            <p className="flex min-h-11 items-center font-sans text-sm text-ink-2">
              {check}In your library · {LABELS[inLibrary]}
            </p>
          ) : (
            <div className={addChoices} role="group" aria-label={`Add ${r.title}`}>
              {(Object.keys(LABELS) as Status[]).map((s) => (
                <button key={s} type="button" disabled={pending} onMouseDown={keepFocus} onClick={() => add(s)} className={addButton}>
                  {pending && adding === s ? "Adding…" : LABELS[s]}
                </button>
              ))}
            </div>
          )}
        {error && <p className="mt-1.5 font-sans text-sm text-contrast">{error}</p>}
      </div>
    </li>
  );
}

// "Added · Reading" and its Undo, which takes the Book back out of the library as Remove would.
function AddedLine({ entry, onUndone }: { entry: Added; onUndone: (entry: Added) => void }) {
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);
  return (
    <>
      <p className="flex min-h-11 items-center justify-between gap-3 font-sans text-sm text-ink-2">
        <span>
          {check}Added · {LABELS[entry.status]}
        </span>
        <button
          type="button"
          disabled={pending}
          onMouseDown={keepFocus}
          onClick={() => {
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
