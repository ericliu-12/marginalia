"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { Lookalike } from "@/domain/lookalike";
import type { SearchResult, Status } from "@/domain/search";
import { addBookAction, addManualBookAction, findLookalikeAction, goToSignIn } from "./client-actions";
import { BookDetailsForm } from "./book-panel";
import { EMPTY_BOOK, type BookDraft } from "./book-draft";
import { Cover } from "./cover";
import { quietLink } from "./quiet-link";

export const LABELS: Record<Status, string> = { want: "Want to read", reading: "Reading", read: "Read" };
const DEBOUNCE_MS = 300;

type Phase = "idle" | "loading" | "done" | "error";

// The Want to read / Reading / Read choices: on paper behind an edge, filling with ink when
// pointed at or `chosen` (the one being added). On a phone they share the row equally, large; on a
// desktop, where every result shows its choices, they rest quieter so the titles lead.
export const addButton = (chosen = false) =>
  `min-h-12 border px-1 text-[15px] leading-tight max-[359px]:px-0 max-[359px]:text-[14px] transition-colors duration-150 lg:min-h-9 lg:px-3 lg:text-[14px] ${
    chosen
      ? "border-ink bg-ink text-paper"
      : "border-edge bg-paper text-ink lg:border-rule lg:text-ink-2 hover:border-ink hover:bg-ink hover:text-paper active:border-ink active:bg-ink active:text-paper disabled:border-rule disabled:bg-paper disabled:text-ink-3"
  }`;
export const addChoices = "grid grid-cols-3 gap-1.5 max-[359px]:gap-1 lg:flex lg:flex-wrap";

// The search field: no box, a small-caps label above, the query in large serif on an ink underline,
// which turns thematic and thickens while focused.
export const searchLabel = "caps block text-[13px] tracking-[1.4px] text-ink-2";
export const searchInput =
  "w-full border-0 border-b-[1.5px] border-ink bg-transparent px-0.5 py-2.5 text-[19px] leading-tight text-ink placeholder:text-ink-3 focus-visible:border-thematic focus-visible:shadow-[0_1px_0_var(--color-thematic)] focus-visible:outline-none";
// A Book's title and its small-caps author and year, in a result.
export const resultTitle = "text-[17px] leading-[1.25] italic lg:text-[18px]";
export const resultMeta = "caps mt-0.5 text-[13px] tracking-[1px] text-ink-2 lg:text-[14px]";
export const resultMetaOf = (r: SearchResult) => [r.authors.join(", "), r.firstPublishedYear].filter(Boolean).join(" · ");

// "Can’t find it? Add it by hand": the way past search, under everything search shows.
export function AddByHand({ onOpen, className = "" }: { onOpen: () => void; className?: string }) {
  return (
    <p className={`text-[15px] text-ink-2 ${className}`}>
      Can’t find it?{" "}
      <button
        type="button"
        onClick={onOpen}
        className="min-h-11 italic text-ink underline decoration-rule underline-offset-4 transition-colors duration-150 hover:decoration-ink lg:min-h-0"
      >
        Add it by hand
      </button>
    </p>
  );
}

// `removed` is set anew each time a Book is removed elsewhere: search says so until the reader types,
// fetches the results again, and takes focus back. `onOpenBook` opens a Book in the library, which
// hides the pane (`hidden`); focus goes back where it was when the pane shows again.
export function SearchPane({
  onClose,
  removed,
  onOpenBook,
  hidden,
}: {
  onClose: () => void;
  removed: { title: string } | null;
  onOpenBook: (bookId: string) => void;
  hidden: boolean;
}) {
  const [query, setQuery] = useState("");
  const { results, setResults, phase, retry } = useBookSearch(query, removed);
  const [notice, setNotice] = useState<{ title: string; addedBookId?: string } | null>(null);
  // A Book being added by hand: the draft outlives the form, so searching again or Escape keeps it
  // for "Add it by hand" to bring back; Cancel discards it.
  const [manualOpen, setManualOpen] = useState(false);
  const [manualDraft, setManualDraft] = useState<BookDraft | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);

  function openBook(bookId: string) {
    returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    onOpenBook(bookId);
  }
  useEffect(() => {
    if (hidden || !returnTo.current) return;
    (returnTo.current.isConnected ? returnTo.current : inputRef.current)?.focus();
    returnTo.current = null;
  }, [hidden]);

  function openManual() {
    setManualDraft((d) => d ?? { ...EMPTY_BOOK, title: query.trim() });
    setManualOpen(true);
  }
  function closeManual(discard: boolean) {
    setManualOpen(false);
    if (discard) setManualDraft(null);
    inputRef.current?.focus();
  }

  useEffect(() => {
    inputRef.current?.focus();
    setNotice(removed && { title: removed.title });
  }, [removed]);

  // Statuses chosen in this pane override what the search response said.
  function markAdded(workKey: string, status: Status) {
    setResults((rs) => rs.map((r) => (r.workKey === workKey ? { ...r, libraryStatus: status } : r)));
  }

  return (
    <aside id="add-a-book" aria-label="Add a Book" onKeyDown={(e) => e.key === "Escape" && onClose()} className="flex h-full min-h-0 flex-col bg-paper-2">
      <div className="flex items-center justify-between px-6 pt-5 pb-2">
        <h2 className="caps text-[17px] leading-tight font-medium tracking-[1.6px]">Add a Book</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close search"
          className="-mr-2 p-2 text-ink-2 transition-colors hover:bg-paper-3 hover:text-ink"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
            <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="px-6 pb-4">
        <label htmlFor="book-search" className={searchLabel}>
          Title or author
        </label>
        <input
          ref={inputRef}
          id="book-search"
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setNotice(null);
            setManualOpen(false);
          }}
          autoComplete="off"
          className={`mt-1 ${searchInput}`}
        />
      </div>

      <p role="status" className="px-6 text-[15px] text-ink-2 empty:hidden">
        {notice && (
          <span className="mb-3 block">
            {notice.addedBookId ? (
              <>
                Added{" "}
                <button type="button" onClick={() => openBook(notice.addedBookId!)} className={bookTitleLink}>
                  {notice.title}
                </button>{" "}
                to your library.
              </>
            ) : (
              <>
                Removed <i>{notice.title}</i> from your library.
              </>
            )}
          </span>
        )}
      </p>
      <p aria-live="polite" className="sr-only">{phase === "done" && !manualOpen ? `${results.length} results` : ""}</p>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-8">
        {manualOpen && manualDraft ? (
          <ManualBookForm
            draft={manualDraft}
            onChange={setManualDraft}
            onOpenBook={openBook}
            onClose={closeManual}
            onAdded={(title, bookId) => {
              closeManual(true);
              // The search that found nothing is done with; what remains is the Book just added.
              setQuery("");
              setNotice({ title, addedBookId: bookId });
            }}
          />
        ) : (
          <>
            {phase === "idle" && (
              <p className="text-ink-2 italic">Search by title. Add the author to narrow it.</p>
            )}
            {phase === "loading" && results.length === 0 && <p className="text-ink-2 italic">Searching…</p>}
            {phase === "error" && (
              <p className="text-contrast">
                Search is unavailable right now.{" "}
                <button type="button" onClick={retry} className="underline underline-offset-2">
                  Try again
                </button>
              </p>
            )}
            {phase === "done" && results.length === 0 && (
              <p className="text-ink-2 italic">No match for “{query.trim()}”. Check the spelling, or try the title alone.</p>
            )}
            {results.length > 0 && phase !== "idle" && phase !== "error" && (
              <ul aria-busy={phase === "loading"} className={`divide-y divide-rule-3 transition-opacity ${phase === "loading" ? "opacity-60" : ""}`}>
                  {results.map((r, i) => (
                    <Result
                      key={r.workKey}
                      result={r}
                      // The full note goes on the first result like a given Book; later ones only point back.
                      lookalikeAgain={!!r.lookalike && results.slice(0, i).some((p) => !p.libraryStatus && p.lookalike?.bookId === r.lookalike!.bookId)}
                      onAdded={markAdded}
                      onOpenBook={openBook}
                    />
                  ))}
              </ul>
            )}
          </>
        )}
      </div>
      {!manualOpen && (
        <div className="flex items-baseline justify-between gap-4 border-t border-rule-2 px-6 py-3">
          <AddByHand onOpen={openManual} />
          <p className="text-[13px] text-ink-3">
            Results from{" "}
            <a href="https://openlibrary.org" target="_blank" rel="noreferrer" className="underline decoration-rule underline-offset-2 hover:text-ink hover:decoration-ink">
              Open Library
            </a>
          </p>
        </div>
      )}
    </aside>
  );
}

// Open Library searched as the reader types, once they pause. A change to `again` fetches the same
// query anew.
export function useBookSearch(query: string, again?: unknown) {
  const [retries, setRetries] = useState(0);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setPhase("idle");
      return;
    }
    setPhase("loading");
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        if (res.status === 401) return goToSignIn();
        if (!res.ok) throw new Error(String(res.status));
        setResults(await res.json());
        setPhase("done");
      } catch (err) {
        if ((err as Error).name !== "AbortError") setPhase("error");
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query, retries, again]);
  return { results, setResults, phase, retry: () => setRetries((n) => n + 1) };
}

function Result({
  result: r,
  lookalikeAgain,
  onAdded,
  onOpenBook,
}: {
  result: SearchResult;
  lookalikeAgain: boolean;
  onAdded: (key: string, s: Status) => void;
  onOpenBook: (bookId: string) => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<Status | null>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const [added, setAdded] = useState(false);
  useEffect(() => {
    if (added) statusRef.current?.focus();
  }, [added]);

  function add(status: Status) {
    setError(null);
    setAdding(status);
    start(async () => {
      const res = await addBookAction(r.workKey, status);
      if (res.ok) {
        onAdded(r.workKey, status);
        setAdded(true);
      }
      else if (res.reason === "duplicate") setError("Already in your library.");
      else setError("Couldn’t add this Book. Try again.");
    });
  }

  const meta = resultMetaOf(r);

  return (
    <li className="flex gap-4 py-4">
      <Cover title={r.title} url={r.coverUrl} />
      <div className="min-w-0 flex-1">
        <p className={resultTitle}>{r.title}</p>
        {meta && <p className={resultMeta}>{meta}</p>}
        {r.lookalike && !r.libraryStatus && <LookalikeNote lookalike={r.lookalike} again={lookalikeAgain} onOpenBook={onOpenBook} />}
        <div className="mt-2.5 min-h-8">
          {r.libraryStatus ? (
            <p ref={statusRef} tabIndex={-1} className="text-[15px] text-ink-2 outline-none">
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className="mr-1.5 inline text-context"><path d="M2 6.5l2.5 2.5L10 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              In your library · {LABELS[r.libraryStatus]}
            </p>
          ) : (
            <div className={addChoices} role="group" aria-label={`Add ${r.title}`}>
              {(Object.keys(LABELS) as Status[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={pending}
                  onClick={() => add(s)}
                  className={addButton(pending && adding === s)}
                >
                  {pending && adding === s ? "Adding…" : LABELS[s]}
                </button>
              ))}
            </div>
          )}
          {error && <p className="mt-1.5 text-[15px] text-contrast">{error}</p>}
        </div>
      </div>
    </li>
  );
}

// A Book's title as a way to open it, set in the serif italic titles take inside sans text. Its touch
// target reaches past the line it sits in, without spacing the text out.
const bookTitleLink =
  "relative font-serif text-[0.95rem] italic underline decoration-rule underline-offset-4 transition-colors hover:decoration-ink after:absolute after:-inset-x-1 after:-inset-y-3 after:content-[''] lg:after:hidden";

// Advisory, never blocking: the Book looks like one already in the library, which is where a re-read
// belongs (its panel can start one). The title opens it. Said in full once; `again` only points back.
export function LookalikeNote({
  lookalike,
  again = false,
  onOpenBook,
  className = "mt-1.5",
}: {
  lookalike: Lookalike;
  again?: boolean;
  onOpenBook: (bookId: string) => void;
  className?: string;
}) {
  const title = (
    <button type="button" onClick={() => onOpenBook(lookalike.bookId)} className={bookTitleLink}>
      {lookalike.title}
    </button>
  );
  return (
    <p className={`${className} max-w-[40ch] text-[0.8rem] leading-normal text-ink`}>
      {again ? (
        <span className="text-ink-2">Also like {title}, above.</span>
      ) : (
        <>
          Looks like {title}, already in your library.{" "}
          <span className="text-ink-2">Reading it again? Start a new read-through from there instead.</span>
        </>
      )}
    </p>
  );
}

// The reader's library checked against what they are typing, once they pause.
function useLookalike(title: string, author: string) {
  const [found, setFound] = useState<Lookalike | null>(null);
  useEffect(() => {
    if (!title.trim() || !author.trim()) return setFound(null);
    let live = true;
    const timer = setTimeout(() => findLookalikeAction(title, author).then((l) => live && setFound(l)), DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [title, author]);
  return found;
}

// A Manual Book: title and author, then the cover and description as quiet reveals, added with the
// same Status choices as a search result. Enter adds it as Want to read, the first choice. Escape
// closes it with the draft kept (`onClose(false)`); Cancel discards it. `enterMovesOn` is for the phone
// (see BookDetailsForm). `onChoose` hears a valid choice in the tap itself, before the add.
export function ManualBookForm({
  draft,
  onChange,
  onAdded,
  onClose,
  onOpenBook,
  enterMovesOn = false,
  onChoose,
}: {
  draft: BookDraft;
  onChange: (draft: BookDraft) => void;
  onAdded: (title: string, bookId: string, status: Status) => void;
  onClose: (discard: boolean) => void;
  onOpenBook: (bookId: string) => void;
  enterMovesOn?: boolean;
  onChoose?: () => void;
}) {
  const lookalike = useLookalike(draft.title, draft.author);
  const statusOf = (choice: string) => (choice as Status) || "want";

  return (
    <BookDetailsForm
      id="manual"
      errorId="manual-error"
      aria-labelledby="manual-heading"
      draft={draft}
      onChange={onChange}
      manual
      reveal
      // Into the first field still empty: the title usually comes from the search.
      focus={draft.title.trim() ? "author" : "title"}
      descriptionPlaceholder="What it’s about, from the jacket or in your words. It helps Marginalia know the Book."
      enterMovesOn={enterMovesOn}
      onSubmit={async (sent, choice) => {
        const status = statusOf(choice);
        onChoose?.();
        const res = await addManualBookAction(sent, status);
        if (!res.ok) return "Couldn’t add this Book. Try again.";
        onAdded(sent.title.trim(), res.bookId, status);
      }}
      onEscape={() => onClose(false)}
      intro={
        <>
          <h3 id="manual-heading" className="caps text-[15px] leading-snug font-medium tracking-[1.6px]">
            Add a Book by hand
          </h3>
          <p className="mt-1 max-w-[38ch] text-[15px] text-ink-2">It stays in your library alone, and you can change it later.</p>
        </>
      }
      note={<div aria-live="polite">{lookalike && <LookalikeNote lookalike={lookalike} onOpenBook={onOpenBook} className="mt-4" />}</div>}
      actions={(pending, choice) => (
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
          <div className={`${addChoices} max-lg:w-full`} role="group" aria-label="Add to your library as">
            {(Object.keys(LABELS) as Status[]).map((s) => (
              <button key={s} type="submit" value={s} disabled={pending} className={addButton(pending && statusOf(choice) === s)}>
                {pending && statusOf(choice) === s ? "Adding…" : LABELS[s]}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => onClose(true)} disabled={pending} className={quietLink}>
            Cancel
          </button>
        </div>
      )}
    />
  );
}
