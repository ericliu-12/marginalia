"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { Lookalike } from "@/domain/lookalike";
import type { SearchResult, Status } from "@/domain/search";
import { addBookAction, addManualBookAction, findLookalikeAction } from "./actions";
import { field } from "./book-panel";
import { Cover } from "./cover";
import { quietLink } from "./quiet-link";

const LABELS: Record<Status, string> = { want: "Want to read", reading: "Reading", read: "Already read" };
const DEBOUNCE_MS = 300;

type Phase = "idle" | "loading" | "done" | "error";

const addButton =
  "rounded-[3px] border border-ink/70 px-2.5 py-2.5 lg:py-1 font-sans text-[0.8rem] font-medium text-ink transition-colors duration-150 hover:bg-ink hover:text-paper disabled:border-rule disabled:text-ink-3 disabled:hover:bg-transparent disabled:hover:text-ink-3";

// `removed` is set anew each time a Book is removed elsewhere: search says so until the reader types,
// fetches the results again, and takes focus back. `onOpenBook` opens a Book already in the library.
export function SearchPane({
  onClose,
  removed,
  onOpenBook,
}: {
  onClose: () => void;
  removed: { title: string } | null;
  onOpenBook: (bookId: string) => void;
}) {
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [notice, setNotice] = useState<{ added: boolean; title: string } | null>(null);
  // The title the reader is adding by hand, while the form is open.
  const [manual, setManual] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    setNotice(removed && { added: false, title: removed.title });
  }, [removed]);

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
  }, [query, retry, removed]);

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
            setManual(null);
          }}
          placeholder="Title and author"
          autoComplete="off"
          className="w-full rounded-[3px] border border-rule bg-paper px-3 py-2.5 font-sans text-[0.95rem] text-ink placeholder:text-ink-3 focus-visible:border-thematic focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-thematic/30"
        />
      </div>

      <p role="status" className="px-6 font-sans text-sm text-ink-2 empty:hidden">
        {notice && (
          <span className="mb-3 block">
            {notice.added ? "Added " : "Removed "}
            <i className="font-serif text-[0.95rem]">{notice.title}</i> {notice.added ? "to" : "from"} your library.
          </span>
        )}
      </p>
      <p aria-live="polite" className="sr-only">{phase === "done" ? `${results.length} results` : ""}</p>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-8">
        {manual !== null ? (
          <ManualBookForm
            initialTitle={manual}
            onOpenBook={onOpenBook}
            onCancel={() => {
              setManual(null);
              inputRef.current?.focus();
            }}
            onAdded={(title) => {
              setManual(null);
              setNotice({ added: true, title });
              inputRef.current?.focus();
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
                <button type="button" onClick={() => setRetry((n) => n + 1)} className="underline underline-offset-2">
                  Try again
                </button>
              </p>
            )}
            {phase === "done" && results.length === 0 && (
              <>
                <p className="text-ink-2 italic">No match for “{query.trim()}”. Check the spelling, or try the title alone.</p>
                <p className="mt-3 font-sans text-sm text-ink-2">
                  Not on Open Library?{" "}
                  <button type="button" onClick={() => setManual(query.trim())} className={quietLink}>
                    Add it by hand
                  </button>
                </p>
              </>
            )}
            {results.length > 0 && phase !== "idle" && phase !== "error" && (
              <>
                <ul aria-busy={phase === "loading"} className={`divide-y divide-rule/60 transition-opacity ${phase === "loading" ? "opacity-60" : ""}`}>
                  {results.map((r) => (
                    <Result key={r.workKey} result={r} onAdded={markAdded} onOpenBook={onOpenBook} />
                  ))}
                </ul>
                <p className="border-t border-rule/60 pt-4 font-sans text-sm text-ink-2">
                  Not the book you mean?{" "}
                  <button type="button" onClick={() => setManual(query.trim())} className={quietLink}>
                    Add it by hand
                  </button>
                </p>
              </>
            )}
          </>
        )}
      </div>
      <p className="border-t border-rule px-6 py-3 font-sans text-xs text-ink-3">
        Results from{" "}
        <a href="https://openlibrary.org" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-ink">
          Open Library
        </a>
      </p>
    </aside>
  );
}

function Result({
  result: r,
  onAdded,
  onOpenBook,
}: {
  result: SearchResult;
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
        {r.lookalike && !r.libraryStatus && <LookalikeNote lookalike={r.lookalike} onOpenBook={onOpenBook} />}
        <div className="mt-2.5 min-h-8">
          {r.libraryStatus ? (
            <p ref={statusRef} tabIndex={-1} className="font-sans text-sm text-ink-2 outline-none">
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className="mr-1.5 inline text-context"><path d="M2 6.5l2.5 2.5L10 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              In your library · {LABELS[r.libraryStatus]}
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Add ${r.title}`}>
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

// Advisory, never blocking: the Book looks like one already in the library, which is where a re-read
// belongs. The title opens it.
function LookalikeNote({ lookalike, onOpenBook, className = "mt-1.5" }: { lookalike: Lookalike; onOpenBook: (bookId: string) => void; className?: string }) {
  return (
    <p className={`${className} max-w-[40ch] font-sans text-[0.8rem] leading-normal text-ink-2`}>
      Looks like{" "}
      <button
        type="button"
        onClick={() => onOpenBook(lookalike.bookId)}
        className="font-serif text-[0.9rem] italic underline decoration-rule underline-offset-4 transition-colors hover:decoration-ink"
      >
        {lookalike.title}
      </button>
      , already in your library. Reading it again? Start a new read-through from there instead.
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

type ManualDraft = { title: string; author: string; coverUrl: string; description: string };

// A Manual Book: title and author, then the cover and description as quiet reveals, added with the
// same Status choices as a search result.
function ManualBookForm({
  initialTitle,
  onAdded,
  onCancel,
  onOpenBook,
}: {
  initialTitle: string;
  onAdded: (title: string) => void;
  onCancel: () => void;
  onOpenBook: (bookId: string) => void;
}) {
  const [draft, setDraft] = useState<ManualDraft>({ title: initialTitle, author: "", coverUrl: "", description: "" });
  const [showCover, setShowCover] = useState(false);
  const [showDescription, setShowDescription] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<Status | null>(null);
  const [pending, start] = useTransition();
  const titleRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const lookalike = useLookalike(draft.title, draft.author);

  useEffect(() => titleRef.current?.focus(), []);

  function change(patch: Partial<ManualDraft>) {
    setDraft((d) => ({ ...d, ...patch }));
    setError(null);
  }

  function add(status: Status) {
    if (!draft.title.trim() || !draft.author.trim()) return setError("A title and an author are needed.");
    if (draft.coverUrl.trim() && !/^https?:\/\/\S+$/i.test(draft.coverUrl.trim())) {
      return setError("The cover should be a web address beginning with http:// or https://.");
    }
    setError(null);
    setAdding(status);
    start(async () => {
      const res = await addManualBookAction(draft, status);
      if (res.ok) onAdded(draft.title.trim());
      else setError("Couldn’t add this book. Try again.");
    });
  }

  return (
    <form
      aria-labelledby="manual-heading"
      onSubmit={(e) => {
        e.preventDefault();
        const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        add((submitter?.value as Status) || "want");
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <h3 id="manual-heading" className="text-[1.05rem] leading-snug font-medium">
        Add a book by hand
      </h3>
      <p className="mt-0.5 max-w-[38ch] font-sans text-sm text-ink-2">Only you will see it, and you can change it later.</p>

      <label htmlFor="manual-title" className="mt-4 block font-sans text-[0.8rem] font-medium text-ink-2">
        Title
      </label>
      <input ref={titleRef} id="manual-title" value={draft.title} onChange={(e) => change({ title: e.target.value })} autoComplete="off" className={`${field} mt-1`} />
      <label htmlFor="manual-author" className="mt-3 block font-sans text-[0.8rem] font-medium text-ink-2">
        Author
      </label>
      <input id="manual-author" value={draft.author} onChange={(e) => change({ author: e.target.value })} autoComplete="off" className={`${field} mt-1`} />

      {showCover && (
        <>
          <label htmlFor="manual-cover" className="mt-3 block font-sans text-[0.8rem] font-medium text-ink-2">
            Cover image address
          </label>
          <input
            ref={coverRef}
            id="manual-cover"
            type="url"
            inputMode="url"
            placeholder="https://"
            value={draft.coverUrl}
            onChange={(e) => change({ coverUrl: e.target.value })}
            autoComplete="off"
            className={`${field} mt-1 font-sans text-[0.95rem]`}
          />
        </>
      )}
      {showDescription && (
        <>
          <label htmlFor="manual-description" className="mt-3 block font-sans text-[0.8rem] font-medium text-ink-2">
            Description
          </label>
          <textarea
            ref={descriptionRef}
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
                requestAnimationFrame(() => coverRef.current?.focus());
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
                requestAnimationFrame(() => descriptionRef.current?.focus());
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
        <p role="alert" className="mt-2 font-sans text-sm text-contrast">
          {error}
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Add to your library as">
          {(Object.keys(LABELS) as Status[]).map((s) => (
            <button key={s} type="submit" value={s} disabled={pending} className={addButton}>
              {pending && adding === s ? "Adding…" : LABELS[s]}
            </button>
          ))}
        </div>
        <button type="button" onClick={onCancel} disabled={pending} className={quietLink}>
          Cancel
        </button>
      </div>
    </form>
  );
}
