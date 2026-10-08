"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { Lookalike } from "@/domain/lookalike";
import type { SearchResult, Status } from "@/domain/search";
import { addBookAction, addManualBookAction, findLookalikeAction } from "./actions";
import { field } from "./book-panel";
import { CO_AUTHOR_HINT, EMPTY_BOOK, draftError, invalidProps, withScheme, type BookDraft, type DraftError } from "./book-draft";
import { Cover } from "./cover";
import { quietLink } from "./quiet-link";

export const LABELS: Record<Status, string> = { want: "Want to read", reading: "Reading", read: "Already read" };
const DEBOUNCE_MS = 300;

type Phase = "idle" | "loading" | "done" | "error";

// On a phone the three choices share the row equally, at a full touch target.
export const addButton =
  "min-h-11 rounded-[3px] border border-ink/70 px-1.5 py-2 max-lg:leading-tight lg:min-h-0 lg:px-2.5 lg:py-1 font-sans text-[0.8rem] font-medium text-ink transition-colors duration-150 hover:bg-ink hover:text-paper max-lg:active:bg-paper-3 disabled:border-rule disabled:text-ink-3 disabled:hover:bg-transparent disabled:hover:text-ink-3";
export const addChoices = "grid grid-cols-[1fr_1fr_1.15fr] gap-1.5 lg:flex lg:flex-wrap";

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
    <aside id="add-a-book" aria-label="Add a book" onKeyDown={(e) => e.key === "Escape" && onClose()} className="flex h-full min-h-0 flex-col bg-paper-2">
      <div className="flex items-center justify-between px-6 pt-6 pb-3">
        <h2 className="text-[1.35rem] leading-tight font-medium">Search</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close search"
          className="-mr-3 rounded p-[14px] text-ink-2 lg:-mr-2 lg:p-2 transition-colors hover:bg-paper-3 hover:text-ink"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
            <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="px-6 pb-4">
        <label htmlFor="book-search" className="sr-only">
          Search by title and author
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
          placeholder="Title and author"
          autoComplete="off"
          className="w-full rounded-[3px] border border-rule bg-paper px-3 py-2.5 font-sans text-[0.95rem] text-ink placeholder:text-ink-3 focus-visible:border-thematic focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-thematic/30"
        />
      </div>

      <p role="status" className="px-6 font-sans text-sm text-ink-2 empty:hidden">
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
                Removed <i className="font-serif text-[0.95rem]">{notice.title}</i> from your library.
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
              <p className="text-ink-2 italic">Search by title; add the author to narrow it.</p>
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
              <>
                <p className="text-ink-2 italic">No match for “{query.trim()}”. Check the spelling, or try the title alone.</p>
                <p className="mt-3 font-sans text-sm text-ink-2">
                  Not on Open Library?{" "}
                  <button type="button" onClick={openManual} className={quietLink}>
                    Add it by hand
                  </button>
                </p>
              </>
            )}
            {results.length > 0 && phase !== "idle" && phase !== "error" && (
              <>
                <ul aria-busy={phase === "loading"} className={`divide-y divide-rule/60 transition-opacity ${phase === "loading" ? "opacity-60" : ""}`}>
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
                <p className="border-t border-rule/60 pt-4 font-sans text-sm text-ink-2">
                  Not the book you mean?{" "}
                  <button type="button" onClick={openManual} className={quietLink}>
                    Add it by hand
                  </button>
                </p>
              </>
            )}
          </>
        )}
      </div>
      {!manualOpen && (
        <p className="border-t border-rule px-6 py-3 font-sans text-xs text-ink-3">
          Results from{" "}
          <a href="https://openlibrary.org" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-ink">
            Open Library
          </a>
        </p>
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
      const res = await addBookAction(r, status);
      if (res.ok) {
        onAdded(r.workKey, status);
        setAdded(true);
      }
      else if (res.reason === "duplicate") setError("Already in your library.");
      else setError("Couldn’t add this book. Try again.");
    });
  }

  const meta = [r.authors.join(", "), r.firstPublishedYear].filter(Boolean).join(" · ");

  return (
    <li className="flex gap-4 py-4">
      <Cover title={r.title} url={r.coverUrl} />
      <div className="min-w-0 flex-1">
        <p className="text-[1.05rem] leading-snug font-medium">{r.title}</p>
        {meta && <p className="font-sans text-sm text-ink-2">{meta}</p>}
        {r.lookalike && !r.libraryStatus && <LookalikeNote lookalike={r.lookalike} again={lookalikeAgain} onOpenBook={onOpenBook} />}
        <div className="mt-2.5 min-h-8">
          {r.libraryStatus ? (
            <p ref={statusRef} tabIndex={-1} className="font-sans text-sm text-ink-2 outline-none">
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
                  className={addButton}
                >
                  {pending && adding === s ? "Adding…" : LABELS[s]}
                </button>
              ))}
            </div>
          )}
          {error && <p className="mt-1.5 font-sans text-sm text-contrast">{error}</p>}
        </div>
      </div>
    </li>
  );
}

// A Book's title as a way to open it, set in the serif italic titles take inside sans text. Its touch
// target reaches past the line it sits in, without spacing the text out.
export const bookTitleLink =
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
    <p className={`${className} max-w-[40ch] font-sans text-[0.8rem] leading-normal text-ink`}>
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
// closes it with the draft kept (`onClose(false)`); Cancel discards it.
export function ManualBookForm({
  draft,
  onChange,
  onAdded,
  onClose,
  onOpenBook,
}: {
  draft: BookDraft;
  onChange: (draft: BookDraft) => void;
  onAdded: (title: string, bookId: string, status: Status) => void;
  onClose: (discard: boolean) => void;
  onOpenBook: (bookId: string) => void;
}) {
  const [showCover, setShowCover] = useState(!!draft.coverUrl);
  const [showDescription, setShowDescription] = useState(!!draft.description);
  const [error, setError] = useState<DraftError | null>(null);
  const [adding, setAdding] = useState<Status | null>(null);
  const [pending, start] = useTransition();
  const refs = {
    title: useRef<HTMLInputElement>(null),
    author: useRef<HTMLInputElement>(null),
    coverUrl: useRef<HTMLInputElement>(null),
    description: useRef<HTMLTextAreaElement>(null),
  };
  const lookalike = useLookalike(draft.title, draft.author);

  // Into the first field still empty: the title usually comes from the search.
  useEffect(() => (draft.title.trim() ? refs.author : refs.title).current?.focus(), []); // eslint-disable-line react-hooks/exhaustive-deps

  function change(patch: Partial<BookDraft>) {
    onChange({ ...draft, ...patch });
    setError(null);
  }

  function add(status: Status) {
    const problem = draftError(draft, true);
    if (problem) {
      setError(problem);
      if (problem.field) refs[problem.field].current?.focus();
      return;
    }
    setError(null);
    setAdding(status);
    start(async () => {
      const res = await addManualBookAction({ ...draft, coverUrl: withScheme(draft.coverUrl) }, status);
      if (res.ok) onAdded(draft.title.trim(), res.bookId, status);
      else setError({ field: null, message: "Couldn’t add this book. Try again." });
    });
  }

  const label = "mt-3 block font-sans text-[0.8rem] font-medium text-ink-2";
  const input = `${field} mt-1 font-sans text-[0.95rem]`;
  const errorId = "manual-error";
  return (
    <form
      noValidate
      aria-labelledby="manual-heading"
      onSubmit={(e) => {
        e.preventDefault();
        const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        add((submitter?.value as Status) || "want");
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose(false);
        }
      }}
    >
      <h3 id="manual-heading" className="text-[1.05rem] leading-snug font-medium">
        Add a book by hand
      </h3>
      <p className="mt-0.5 max-w-[38ch] font-sans text-sm text-ink-2">It stays in your library alone, and you can change it later.</p>

      <label htmlFor="manual-title" className={label}>
        Title
      </label>
      <input ref={refs.title} id="manual-title" value={draft.title} onChange={(e) => change({ title: e.target.value })} autoComplete="off" {...invalidProps(error, "title", errorId)} className={input} />
      <label htmlFor="manual-author" className={label}>
        Author
      </label>
      <input ref={refs.author} id="manual-author" value={draft.author} onChange={(e) => change({ author: e.target.value })} autoComplete="off" {...invalidProps(error, "author", errorId, "manual-author-hint")} className={input} />
      <p id="manual-author-hint" className="mt-1 font-sans text-[0.8rem] text-ink-3">
        {CO_AUTHOR_HINT}
      </p>

      {showCover && (
        <>
          <label htmlFor="manual-cover" className={label}>
            Cover image address
          </label>
          <input
            ref={refs.coverUrl}
            id="manual-cover"
            type="url"
            inputMode="url"
            placeholder="https://"
            value={draft.coverUrl}
            onChange={(e) => change({ coverUrl: e.target.value })}
            autoComplete="off"
            {...invalidProps(error, "coverUrl", errorId)}
            className={input}
          />
        </>
      )}
      {showDescription && (
        <>
          <label htmlFor="manual-description" className={label}>
            Description
          </label>
          <textarea
            ref={refs.description}
            id="manual-description"
            rows={4}
            value={draft.description}
            onChange={(e) => change({ description: e.target.value })}
            placeholder="What it’s about, from the jacket or in your words. It helps Marginalia know the book."
            className={`${field} mt-1 resize-y`}
          />
        </>
      )}
      {(!showCover || !showDescription) && (
        <div className="mt-2 flex flex-wrap gap-x-5">
          {!showCover && (
            <button
              type="button"
              onClick={() => {
                setShowCover(true);
                requestAnimationFrame(() => refs.coverUrl.current?.focus());
              }}
              className={quietLink}
            >
              Add a cover
            </button>
          )}
          {!showDescription && (
            <button
              type="button"
              onClick={() => {
                setShowDescription(true);
                requestAnimationFrame(() => refs.description.current?.focus());
              }}
              className={quietLink}
            >
              Add a description
            </button>
          )}
        </div>
      )}

      <div aria-live="polite">{lookalike && <LookalikeNote lookalike={lookalike} onOpenBook={onOpenBook} className="mt-4" />}</div>
      {error && (
        <p id={errorId} role="alert" className="mt-2 font-sans text-sm text-contrast">
          {error.message}
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
        <div className={`${addChoices} max-lg:w-full`} role="group" aria-label="Add to your library as">
          {(Object.keys(LABELS) as Status[]).map((s) => (
            <button key={s} type="submit" value={s} disabled={pending} className={addButton}>
              {pending && adding === s ? "Adding…" : LABELS[s]}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => onClose(true)} disabled={pending} className={quietLink}>
          Cancel
        </button>
      </div>
    </form>
  );
}
