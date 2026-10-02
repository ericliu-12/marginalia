"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { SearchResult, Status } from "@/domain/search";
import { addBookAction } from "./actions";
import { Cover } from "./cover";

const LABELS: Record<Status, string> = { want: "Want to read", reading: "Reading", read: "Already read" };
const DEBOUNCE_MS = 300;

type Phase = "idle" | "loading" | "done" | "error";

export function SearchPane({ onClose }: { onClose: () => void }) {
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

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
  }, [query, retry]);

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
          className="-mr-2 rounded p-2 text-ink-2 transition-colors hover:bg-paper-3 hover:text-ink"
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
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Title and author"
          autoComplete="off"
          className="w-full rounded-[3px] border border-rule bg-paper px-3 py-2.5 font-sans text-[0.95rem] text-ink placeholder:text-ink-3 focus-visible:border-thematic focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-thematic/30"
        />
      </div>

      <p aria-live="polite" className="sr-only">{phase === "done" ? `${results.length} results` : ""}</p>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-8">
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
          <p className="text-ink-2 italic">No match for “{query.trim()}”. Check the spelling, or try the title alone.</p>
        )}
        {results.length > 0 && phase !== "idle" && phase !== "error" && (
          <ul aria-busy={phase === "loading"} className={`divide-y divide-rule/60 transition-opacity ${phase === "loading" ? "opacity-60" : ""}`}>
            {results.map((r) => (
              <Result key={r.workKey} result={r} onAdded={markAdded} />
            ))}
          </ul>
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

function Result({ result: r, onAdded }: { result: SearchResult; onAdded: (key: string, s: Status) => void }) {
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
                  className="rounded-[3px] border border-ink/70 px-2.5 py-2.5 lg:py-1 font-sans text-[0.8rem] font-medium text-ink transition-colors duration-150 hover:bg-ink hover:text-paper disabled:border-rule disabled:text-ink-3 disabled:hover:bg-transparent disabled:hover:text-ink-3"
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
