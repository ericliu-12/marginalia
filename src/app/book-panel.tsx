"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { LibraryItem } from "@/domain/library";
import type { EnrichmentView } from "@/domain/enrichment";
import type { Note } from "@/domain/notes";
import {
  addNoteAction,
  deleteNoteAction,
  getEnrichmentAction,
  listNotesAction,
  tryAgainAction,
  updateNoteAction,
} from "./actions";
import { ConnectionsSection } from "./connections";
import { Cover } from "./cover";

type Draft = { body: string; quote: string; page: string };
const EMPTY: Draft = { body: "", quote: "", page: "" };

// An unsent draft survives closing the panel and switching books. Storage may be unavailable.
const draftKey = (bookId: string) => `marginalia:note-draft:${bookId}`;
function loadDraft(bookId: string): Draft {
  try {
    return { ...EMPTY, ...JSON.parse(localStorage.getItem(draftKey(bookId)) ?? "{}") };
  } catch {
    return EMPTY;
  }
}
function saveDraft(bookId: string, draft: Draft) {
  try {
    if (draft.body || draft.quote || draft.page) localStorage.setItem(draftKey(bookId), JSON.stringify(draft));
    else localStorage.removeItem(draftKey(bookId));
  } catch {}
}

const quietLink =
  "min-h-11 font-sans text-[0.8rem] font-medium text-ink-3 underline decoration-rule underline-offset-4 transition-colors duration-150 hover:text-ink hover:decoration-ink disabled:text-ink-3/60 lg:min-h-0";

// The Book panel for one Library Entry. It does not assume where it lives: the library view docks it
// in the right pane and the graph view floats it over the canvas, so the host supplies the way out.
export function BookPanel({
  item,
  backLabel,
  onBack,
}: {
  item: LibraryItem;
  backLabel: string;
  onBack: () => void;
}) {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => headingRef.current?.focus(), [item.bookId]);

  useEffect(() => {
    let live = true;
    setNotes(null);
    setLoadFailed(false);
    listNotesAction(item.bookId).then((n) => {
      if (!live) return;
      if (n) setNotes(n);
      else setLoadFailed(true);
    });
    return () => {
      live = false;
    };
  }, [item.bookId, retry]);

  return (
    <aside aria-label={`Notes on ${item.title}`} onKeyDown={(e) => e.key === "Escape" && onBack()} className="flex h-full min-h-0 flex-col bg-paper-2">
      <div className="px-6 pt-5 pb-3">
        <button type="button" onClick={onBack} className={`${quietLink} -ml-0.5 flex items-center gap-1.5 no-underline`}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
            <path d="M8 2L4 6l4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {backLabel}
        </button>
      </div>
      <header className="flex items-start gap-4 border-b border-rule px-6 pb-5">
        <Cover title={item.title} url={item.coverUrl} />
        <div className="min-w-0">
          <h2 ref={headingRef} tabIndex={-1} className="text-[1.35rem] leading-tight font-medium outline-none">
            {item.title}
          </h2>
          {item.authors.length > 0 && <p className="font-sans text-sm text-ink-2">{item.authors.join(", ")}</p>}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-5 pb-10">
        <About key={`about-${item.bookId}`}bookId={item.bookId} noteCount={notes?.length ?? null} />
        <ConnectionsSection key={`connections-${item.bookId}`} bookId={item.bookId} />

        <NoteForm
          key={item.bookId}
          bookId={item.bookId}
          onSaved={(note) => setNotes((ns) => [note, ...(ns ?? [])])}
        />

        <h3 className="mt-9 border-b border-rule pb-2 text-[1.35rem] leading-tight font-medium">Notes</h3>
        {loadFailed && (
          <p role="alert" className="pt-4 text-contrast">
            Couldn’t load your notes.{" "}
            <button type="button" onClick={() => setRetry((n) => n + 1)} className="underline underline-offset-2">
              Try again
            </button>
          </p>
        )}
        {notes === null && !loadFailed && <p className="pt-4 text-ink-2 italic">Opening your notes…</p>}
        {notes?.length === 0 && (
          <p className="max-w-[34ch] pt-4 text-ink-2 italic">Nothing written yet. Whatever you’re thinking as you read belongs here.</p>
        )}
        {notes && notes.length > 0 && (
          <ul className="divide-y divide-rule/60">
            {notes.map((n) => (
              <NoteItem
                key={n.id}
                note={n}
                editing={editing === n.id}
                onEdit={() => setEditing(n.id)}
                onCancel={() => setEditing(null)}
                onChanged={(next) => {
                  setNotes((ns) => ns!.map((x) => (x.id === next.id ? next : x)));
                  setEditing(null);
                }}
                onDeleted={() => setNotes((ns) => ns!.filter((x) => x.id !== n.id))}
              />
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

// While the worker is still reading up on a Book, check back now and then.
const ENRICHMENT_POLL_MS = 4000;

// What Marginalia knows about the Book: its summary and themes, or a quiet line when it does not
// recognise the Book and the reader's Notes carry the weight instead.
function About({ bookId, noteCount }: { bookId: string; noteCount: number | null }) {
  const [enrichment, setEnrichment] = useState<EnrichmentView | null | undefined>(undefined);
  const [retryFailed, setRetryFailed] = useState(false);
  const [pending, start] = useTransition();

  const waiting = enrichment === undefined || enrichment === null || enrichment.status === "pending";
  useEffect(() => {
    let live = true;
    const load = () =>
      getEnrichmentAction(bookId).then((res) => {
        if (live && res) setEnrichment(res.enrichment);
      });
    load();
    if (!waiting) return () => void (live = false);
    const timer = setInterval(load, ENRICHMENT_POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [bookId, waiting]);

  function retry() {
    setRetryFailed(false);
    start(async () => {
      const res = await tryAgainAction(bookId);
      if (!res.ok) return setRetryFailed(true);
      setEnrichment((e) => (e ? { ...e, status: "pending" } : e));
    });
  }
  const again = (
    <button type="button" onClick={retry} disabled={pending} className={quietLink}>
      Try again
    </button>
  );

  let body;
  if (enrichment === undefined) return null;
  if (waiting) {
    // With no Enrichment started at all (null) nothing is coming, so offer the way to start it.
    body = (
      <p className="text-ink-2">
        <span className="italic">Getting to know this book…</span> {enrichment === null && again}
      </p>
    );
  } else if (enrichment.status === "failed") {
    body = (
      <p className="text-ink-2">
        <span className="italic">Couldn’t read up on this book just now.</span> {again}
      </p>
    );
  } else if (!enrichment.recognised) {
    body = (
      <div>
        <p className="text-ink-2 italic">Marginalia doesn’t know this book well.</p>
        <p className="mt-1 max-w-[40ch] text-ink-2">
          {noteCount === null
            ? ""
            : noteCount > 0
              ? "Your notes now shape its Connections."
              : "Add a few notes and they’ll shape its Connections."}
        </p>
        <div className="mt-1">{again}</div>
      </div>
    );
  } else {
    body = (
      <>
        <p>{enrichment.summary}</p>
        {enrichment.themes && enrichment.themes.length > 0 && (
          <p className="mt-2 font-sans text-[0.8rem] leading-relaxed text-ink-2">{enrichment.themes.join(" · ")}</p>
        )}
      </>
    );
  }

  return (
    <section aria-label="About this book" className="mb-8 border-b border-rule pb-6">
      {body}
      {retryFailed && (
        <p role="alert" className="mt-1 font-sans text-sm text-contrast">
          Couldn’t start that again. Try once more in a moment.
        </p>
      )}
    </section>
  );
}

const field =
  "w-full rounded-[3px] border border-rule bg-paper px-3 py-2.5 text-ink placeholder:text-ink-3 focus-visible:border-thematic focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-thematic/30";

function parsePage(raw: string): number | null | "invalid" {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isInteger(n) && n > 0 && n < 100000 ? n : "invalid";
}

// Text first; the quote and the page are quiet reveals. Used to write a new Note (draft kept) and to edit one.
type NoteFormProps = { onSaved?: (n: Note) => void; onCancel?: () => void } & (
  | { bookId: string; note?: undefined }
  | { note: Note; bookId?: undefined }
);

function NoteForm(props: NoteFormProps) {
  const { note, onSaved, onCancel } = props;
  const editing = !!note;
  const [draft, setDraft] = useState<Draft>(() =>
    props.note
      ? { body: props.note.body, quote: props.note.quote ?? "", page: props.note.page?.toString() ?? "" }
      : loadDraft(props.bookId),
  );
  const [showQuote, setShowQuote] = useState(!!draft.quote);
  const [showPage, setShowPage] = useState(!!draft.page);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const quoteRef = useRef<HTMLTextAreaElement>(null);
  const pageRef = useRef<HTMLInputElement>(null);
  const idPrefix = note ? `note-${note.id}` : "new-note";

  useEffect(() => {
    if (editing) bodyRef.current?.focus();
  }, [editing]);

  function change(patch: Partial<Draft>) {
    const next = { ...draft, ...patch };
    setDraft(next);
    setError(null);
    if (props.bookId) saveDraft(props.bookId, next);
  }

  function submit() {
    if (!draft.body.trim()) return setError("Write something first.");
    const page = parsePage(draft.page);
    if (page === "invalid") return setError("Page should be a whole number.");
    setError(null);
    start(async () => {
      const input = { body: draft.body, quote: draft.quote, page };
      const res = props.note ? await updateNoteAction(props.note.id, input) : await addNoteAction(props.bookId, input);
      if (!res.ok) return setError("Couldn’t save this note. Try again.");
      if (!editing) {
        setDraft(EMPTY);
        setShowQuote(false);
        setShowPage(false);
        if (props.bookId) saveDraft(props.bookId, EMPTY);
        bodyRef.current?.focus();
      }
      onSaved?.(res.note);
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          submit();
        } else if (e.key === "Escape" && editing) {
          e.stopPropagation();
          onCancel?.();
        }
      }}
      className={editing ? "py-4" : ""}
    >
      <label htmlFor={`${idPrefix}-body`} className="sr-only">
        {editing ? "Edit note" : "New note"}
      </label>
      <textarea
        ref={bodyRef}
        id={`${idPrefix}-body`}
        value={draft.body}
        onChange={(e) => change({ body: e.target.value })}
        placeholder="What are you thinking?"
        rows={editing ? 4 : 3}
        className={`${field} resize-y text-[1.0625rem] leading-normal`}
      />
      {showQuote && (
        <div className="mt-3">
          <label htmlFor={`${idPrefix}-quote`} className="font-sans text-[0.8rem] font-medium text-ink-2">
            Quoted passage
          </label>
          <textarea
            ref={quoteRef}
            id={`${idPrefix}-quote`}
            value={draft.quote}
            onChange={(e) => change({ quote: e.target.value })}
            rows={2}
            className={`${field} mt-1 resize-y italic`}
          />
        </div>
      )}
      {showPage && (
        <div className="mt-3">
          <label htmlFor={`${idPrefix}-page`} className="font-sans text-[0.8rem] font-medium text-ink-2">
            Page
          </label>
          <input
            ref={pageRef}
            id={`${idPrefix}-page`}
            inputMode="numeric"
            autoComplete="off"
            value={draft.page}
            onChange={(e) => change({ page: e.target.value })}
            className={`${field} mt-1 w-28 font-sans text-[0.95rem]`}
          />
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 font-sans text-sm text-contrast">
          {error}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1">
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 rounded-[3px] bg-ink px-4 py-2 font-sans text-sm font-medium text-paper transition-colors hover:bg-ink-2 disabled:bg-ink-3 lg:min-h-0"
        >
          {pending ? "Saving…" : editing ? "Save changes" : "Save note"}
        </button>
        {editing && (
          <button type="button" onClick={onCancel} disabled={pending} className={quietLink}>
            Cancel
          </button>
        )}
        {!showQuote && (
          <button
            type="button"
            onClick={() => {
              setShowQuote(true);
              requestAnimationFrame(() => quoteRef.current?.focus());
            }}
            className={quietLink}
          >
            Add a quote
          </button>
        )}
        {!showPage && (
          <button
            type="button"
            onClick={() => {
              setShowPage(true);
              requestAnimationFrame(() => pageRef.current?.focus());
            }}
            className={quietLink}
          >
            Add a page
          </button>
        )}
      </div>
    </form>
  );
}

function NoteItem({
  note,
  editing,
  onEdit,
  onCancel,
  onChanged,
  onDeleted,
}: {
  note: Note;
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onChanged: (n: Note) => void;
  onDeleted: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(false);
  const [pending, start] = useTransition();

  if (editing) {
    return (
      <li>
        <NoteForm note={note} onSaved={onChanged} onCancel={onCancel} />
      </li>
    );
  }

  function remove() {
    setError(false);
    start(async () => {
      const res = await deleteNoteAction(note.id);
      if (res.ok) onDeleted();
      else setError(true);
    });
  }

  return (
    <li aria-busy={pending} className="py-4">
      {note.quote && (
        <blockquote className="mb-2 text-ink-2 italic">
          “{note.quote}”
          {note.page != null && <span className="ml-2 font-sans text-xs text-ink-3 not-italic">p. {note.page}</span>}
        </blockquote>
      )}
      <p className="whitespace-pre-wrap">{note.body}</p>
      {!note.quote && note.page != null && <p className="mt-1 font-sans text-xs text-ink-3">p. {note.page}</p>}
      <div className="mt-1 flex flex-wrap items-center gap-x-5 gap-y-1">
        {confirming ? (
          <>
            <span className="font-sans text-[0.8rem] text-ink-2">Delete this note?</span>
            <button type="button" onClick={remove} disabled={pending} className={`${quietLink} text-contrast hover:text-contrast`}>
              {pending ? "Deleting…" : "Yes, delete"}
            </button>
            <button type="button" onClick={() => setConfirming(false)} disabled={pending} className={quietLink}>
              Keep
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={onEdit} className={quietLink}>
              Edit
            </button>
            <button type="button" onClick={() => setConfirming(true)} className={quietLink}>
              Delete
            </button>
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-1 font-sans text-sm text-contrast">
          Couldn’t delete this note. Try again.
        </p>
      )}
    </li>
  );
}
