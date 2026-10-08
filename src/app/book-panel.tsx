"use client";

import { useCallback, useEffect, useOptimistic, useRef, useState, useTransition, type ReactNode } from "react";
import type { LibraryItem } from "@/domain/library";
import type { Status } from "@/domain/search";
import type { EnrichmentView } from "@/domain/enrichment";
import type { Note } from "@/domain/notes";
import {
  addNoteAction,
  changeStatusAction,
  deleteNoteAction,
  editBookAction,
  getEnrichmentAction,
  listNotesAction,
  removeFromLibraryAction,
  tryAgainAction,
  updateNoteAction,
} from "./actions";
import { CO_AUTHOR_HINT, draftError, invalidProps, withScheme, type BookDraft, type DraftError } from "./book-draft";
import { ConnectionsSection } from "./connections";
import { MOVES } from "./library-list";
import { useInlineConfirm } from "./use-inline-confirm";
import { POLL_MS, usePoll } from "./use-poll";
import { Cover } from "./cover";
import { dangerLink, quietLink } from "./quiet-link";

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

// The Book panel for one Library Entry. It does not assume where it lives: the library view docks it
// in the right pane, the graph view floats it over the canvas, and on a phone it is the whole Book
// screen (`screen`, with the three-way Status control), so the host supplies the way out, what a
// Connection's other Book opens, and anything it shows under the way out (the graph's trail).
export function BookPanel({
  item,
  backLabel,
  onBack,
  onRemoved,
  onOpenBook,
  crumbs,
  withheldConnections,
  variant = "panel",
}: {
  item: LibraryItem;
  backLabel: string;
  onBack: () => void;
  onRemoved: () => void;
  onOpenBook: (bookId: string) => void;
  crumbs?: ReactNode;
  // Connections the graph has yet to draw in, kept out of the list until it does.
  withheldConnections?: Set<string>;
  variant?: "panel" | "screen";
}) {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [editingBook, setEditingBook] = useState(false);
  // Saved edits: About starts over after one, as a Manual Book's Enrichment may be running again.
  const [edits, setEdits] = useState(0);
  const [saved, setSaved] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const notesHeadingRef = useRef<HTMLHeadingElement>(null);

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

  // Beside the title in the panel; on the Book screen, below the Status control that matters more there.
  const editLink = !editingBook && (
    <button
      type="button"
      onClick={() => {
        setSaved(false);
        setEditingBook(true);
      }}
      className={quietLink}
    >
      {item.manual ? "Edit details" : "Edit title or author"}
    </button>
  );

  return (
    <aside aria-label={`Notes on ${item.title}`} onKeyDown={(e) => e.key === "Escape" && onBack()} className={`flex h-full min-h-0 flex-col ${variant === "screen" ? "bg-paper" : "bg-paper-2"}`}>
      <div className="px-6 pt-5 pb-3">
        <button type="button" onClick={onBack} className={`${quietLink} -ml-0.5 flex items-center gap-1.5 no-underline`}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
            <path d="M8 2L4 6l4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {backLabel}
        </button>
      </div>
      {crumbs}
      <header className="border-b border-rule px-6 pb-5">
        <div className="flex items-start gap-4">
          <Cover title={item.title} url={item.coverUrl} />
          <div className="min-w-0">
            <h2 ref={headingRef} tabIndex={-1} className="text-[1.35rem] leading-tight font-medium outline-none">
              {item.title}
            </h2>
            {item.authors.length > 0 && <p className="font-sans text-sm text-ink-2">{item.authors.join(", ")}</p>}
            {variant === "panel" && <StatusMoves key={item.status} item={item} />}
            {variant === "panel" && editLink}
            <p role="status" className="font-sans text-sm text-ink-2 empty:hidden">
              {saved ? "Changes saved." : ""}
            </p>
          </div>
        </div>
        {variant === "screen" && <StatusControl item={item} />}
        {variant === "screen" && <div className="mt-2">{editLink}</div>}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-5 pb-10">
        {editingBook && (
          <EditBookForm
            item={item}
            onDone={(didSave) => {
              setEditingBook(false);
              if (didSave) {
                setEdits((n) => n + 1);
                setSaved(true);
              }
              headingRef.current?.focus();
            }}
          />
        )}
        <About key={`about-${item.bookId}-${edits}`} bookId={item.bookId} noteCount={notes?.length ?? null} />
        {/* Starts over when the Book becomes Finished, to show its Connections being found. */}
        <ConnectionsSection key={`connections-${item.bookId}-${item.finished}`} bookId={item.bookId} onOpenBook={onOpenBook} withheld={withheldConnections} />

        <NoteForm
          key={item.bookId}
          bookId={item.bookId}
          onSaved={(note) => setNotes((ns) => [note, ...(ns ?? [])])}
        />

        <h3 ref={notesHeadingRef} tabIndex={-1} className="mt-9 border-b border-rule pb-2 text-[1.35rem] leading-tight font-medium outline-none">
          Notes
        </h3>
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
                onDeleted={() => {
                  setNotes((ns) => ns!.filter((x) => x.id !== n.id));
                  // The deleted Note took focus with it; the Notes heading is the nearest stable place.
                  notesHeadingRef.current?.focus();
                }}
              />
            ))}
          </ul>
        )}

        <RemoveEntry key={`remove-${item.bookId}`} bookId={item.bookId} title={item.title} onRemoved={onRemoved} />
      </div>
    </aside>
  );
}

const STATUS_LABEL: Record<Status, string> = { want: "Want to read", reading: "Reading", read: "Read" };

// Where the Book stands, and the same one-click moves as its library row: "Read again" starts a new
// Read-through for a finished Book.
function StatusMoves({ item }: { item: LibraryItem }) {
  const [pending, start] = useTransition();
  const [moving, setMoving] = useState<Status | null>(null);
  const [error, setError] = useState(false);

  function move(to: Status) {
    setError(false);
    setMoving(to);
    start(async () => {
      const res = await changeStatusAction(item.bookId, to);
      if (!res.ok) setError(true);
    });
  }

  return (
    <div aria-busy={pending} className="mt-1.5">
      <div role="group" aria-label={`Status of ${item.title}`} className="flex flex-wrap items-baseline gap-x-4">
        <span className="font-sans text-sm text-ink-2">{item.reReading ? "Re-reading" : STATUS_LABEL[item.status]}</span>
        {MOVES[item.status].map(({ label, to }) => (
          <button key={to} type="button" disabled={pending} onClick={() => move(to)} className={quietLink}>
            {pending && moving === to ? "Moving…" : label}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="font-sans text-sm text-contrast">
          Couldn’t move this book. Try again.
        </p>
      )}
    </div>
  );
}

const STATUSES: Status[] = ["want", "reading", "read"];

// The Book screen's Status: one tap between all three, shown at once. Read records today as the finish
// date. When that completes the Book's first Read-through, the finish line says where its Connections
// will be; it goes when the Status moves on, and a later Read-through never brings it back.
function StatusControl({ item }: { item: LibraryItem }) {
  const [shown, show] = useOptimistic(item.status);
  const [pending, start] = useTransition();
  const [error, setError] = useState(false);
  const [finishLine, setFinishLine] = useState(false);

  function move(to: Status) {
    if (pending || to === shown) return;
    setError(false);
    // Only the move's own answer can bring the line back, so a later Read-through never flashes it.
    setFinishLine(false);
    start(async () => {
      show(to);
      const res = await changeStatusAction(item.bookId, to);
      if (!res.ok) return setError(true);
      if (to === "read") setFinishLine(res.firstCompletion);
    });
  }

  return (
    <div aria-busy={pending} className="mt-5">
      <div role="group" aria-label={`Status of ${item.title}`} className="grid grid-cols-3 gap-[3px] rounded-[3px] bg-paper-3 p-[3px]">
        {STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={shown === s}
            onClick={() => move(s)}
            className="min-h-11 rounded-[2px] font-sans text-sm font-medium text-ink-2 transition-[background-color,color,box-shadow] duration-200 ease-out-expo aria-pressed:bg-paper-2 aria-pressed:text-ink aria-pressed:shadow-[0_1px_2px_rgb(35_29_23/0.2)]"
          >
            {STATUS_LABEL[s]}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-2 font-sans text-sm text-contrast">
          Couldn’t move this book. Try again.
        </p>
      )}
      {/* Mounted throughout, so the line is announced when it appears. */}
      <p role="status" className="mt-4 rounded-[3px] bg-paper-3 px-4 py-3 leading-snug empty:hidden motion-safe:animate-draw-in">
        {finishLine && shown === "read" && (
          <>
            <span className="font-medium">Finished.</span> Connections are being found; they’ll appear in the graph on a larger screen.
          </>
        )}
      </p>
    </div>
  );
}

// Last in the panel and quiet, like deleting a Note: one text action, then an inline confirmation.
// Focus lands on Keep, the safe choice, and returns to the action when the reader keeps the Book.
function RemoveEntry({ bookId, title, onRemoved }: { bookId: string; title: string; onRemoved: () => void }) {
  const { confirming, pending, error, keepRef, triggerRef, ask, keep, confirm, onKeyDown } = useInlineConfirm(
    () => removeFromLibraryAction(bookId),
    onRemoved,
  );

  return (
    <div aria-busy={pending} className="mt-12 border-t border-rule pt-4">
      {confirming ? (
        <div onKeyDown={onKeyDown} className="flex flex-wrap items-center gap-x-5 gap-y-1">
          <p id={`remove-${bookId}`} className="w-full font-sans text-[0.8rem] text-ink-2">
            Remove <i className="font-serif text-[0.9rem]">{title}</i> from your library? Its notes, reading history and Connections go with it.
          </p>
          <button type="button" onClick={confirm} disabled={pending} aria-describedby={`remove-${bookId}`} className={dangerLink}>
            {pending ? "Removing…" : "Yes, remove"}
          </button>
          <button ref={keepRef} type="button" onClick={keep} disabled={pending} className={quietLink}>
            Keep
          </button>
        </div>
      ) : (
        <button ref={triggerRef} type="button" onClick={ask} className={quietLink}>
          Remove from library
        </button>
      )}
      {error && (
        <p role="alert" className="mt-1 font-sans text-sm text-contrast">
          Couldn’t remove this book. Try again.
        </p>
      )}
    </div>
  );
}

// The reader's own title and author for a shared Book, which change only what they see; a Manual Book
// is theirs, so its cover and description can change too. Sits at the top of the panel's body.
function EditBookForm({ item, onDone }: { item: LibraryItem; onDone: (saved: boolean) => void }) {
  const [draft, setDraft] = useState<BookDraft>({
    title: item.title,
    // A Manual Book's co-authors are written as they are split; a shared Book's author override is one name.
    author: item.authors.join(item.manual ? " and " : ", "),
    coverUrl: item.coverUrl ?? "",
    description: item.description ?? "",
  });
  const [error, setError] = useState<DraftError | null>(null);
  const [pending, start] = useTransition();
  const refs = {
    title: useRef<HTMLInputElement>(null),
    author: useRef<HTMLInputElement>(null),
    coverUrl: useRef<HTMLInputElement>(null),
    description: useRef<HTMLTextAreaElement>(null),
  };

  useEffect(() => refs.title.current?.focus(), []); // eslint-disable-line react-hooks/exhaustive-deps

  function change(patch: Partial<BookDraft>) {
    setDraft((d) => ({ ...d, ...patch }));
    setError(null);
  }

  function submit() {
    const problem = draftError(draft, item.manual);
    if (problem) {
      setError(problem);
      if (problem.field) refs[problem.field].current?.focus();
      return;
    }
    setError(null);
    start(async () => {
      const res = await editBookAction(item.bookId, { ...draft, coverUrl: withScheme(draft.coverUrl) });
      if (res.ok) onDone(true);
      else setError({ field: null, message: "Couldn’t save these changes. Try again." });
    });
  }

  const label = "mt-3 block font-sans text-[0.8rem] font-medium text-ink-2";
  const errorId = `edit-${item.bookId}-error`;
  return (
    <form
      noValidate
      aria-label={`Edit ${item.title}`}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onDone(false);
        }
      }}
      className="mb-8 border-b border-rule pb-6"
    >
      <p className="max-w-[40ch] font-sans text-sm text-ink-2">
        {item.manual
          ? "You added this book by hand, so it’s yours to change. A new title, author or description means reading up on it again."
          : `Changes how this book appears for you alone. Clear a field to go back to the original${item.original ? `, ${item.original.title} by ${item.original.authors.join(", ")}` : ""}.`}
      </p>
      <label htmlFor="edit-title" className={label}>
        Title
      </label>
      <input ref={refs.title} id="edit-title" value={draft.title} onChange={(e) => change({ title: e.target.value })} autoComplete="off" {...invalidProps(error, "title", errorId)} className={`${field} mt-1 font-sans text-[0.95rem]`} />
      <label htmlFor="edit-author" className={label}>
        Author
      </label>
      <input
        ref={refs.author}
        id="edit-author"
        value={draft.author}
        onChange={(e) => change({ author: e.target.value })}
        autoComplete="off"
        {...invalidProps(error, "author", errorId, item.manual ? "edit-author-hint" : undefined)}
        className={`${field} mt-1 font-sans text-[0.95rem]`}
      />
      {item.manual && (
        <p id="edit-author-hint" className="mt-1 font-sans text-[0.8rem] text-ink-3">
          {CO_AUTHOR_HINT}
        </p>
      )}
      {item.manual && (
        <>
          <label htmlFor="edit-cover" className={label}>
            Cover image address
          </label>
          <input
            ref={refs.coverUrl}
            id="edit-cover"
            type="url"
            inputMode="url"
            placeholder="https://"
            value={draft.coverUrl}
            onChange={(e) => change({ coverUrl: e.target.value })}
            autoComplete="off"
            {...invalidProps(error, "coverUrl", errorId)}
            className={`${field} mt-1 font-sans text-[0.95rem]`}
          />
          <label htmlFor="edit-description" className={label}>
            Description
          </label>
          <textarea
            ref={refs.description}
            id="edit-description"
            rows={4}
            value={draft.description}
            onChange={(e) => change({ description: e.target.value })}
            className={`${field} mt-1 resize-y`}
          />
        </>
      )}
      {error && (
        <p id={errorId} role="alert" className="mt-2 font-sans text-sm text-contrast">
          {error.message}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1">
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 rounded-[3px] bg-ink px-4 py-2 font-sans text-sm font-medium text-paper transition-colors hover:bg-ink-2 disabled:bg-ink-3 lg:min-h-0"
        >
          {pending ? "Saving…" : "Save changes"}
        </button>
        <button type="button" onClick={() => onDone(false)} disabled={pending} className={quietLink}>
          Cancel
        </button>
      </div>
    </form>
  );
}

// What Marginalia knows about the Book: its summary and themes, or a quiet line when it does not
// recognise the Book and the reader's Notes carry the weight instead.
function About({ bookId, noteCount }: { bookId: string; noteCount: number | null }) {
  const [enrichment, setEnrichment] = useState<EnrichmentView | null | undefined>(undefined);
  const [retryFailed, setRetryFailed] = useState(false);
  const [pending, start] = useTransition();

  // While the worker is still reading up on the Book, check back now and then.
  const waiting = enrichment === undefined || enrichment === null || enrichment.status === "pending";
  const load = useCallback(
    () =>
      getEnrichmentAction(bookId).then((res) => {
        if (res) setEnrichment(res.enrichment);
      }),
    [bookId],
  );
  usePoll(load, POLL_MS, waiting);

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

export const field =
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
  // As in removing a Book: focus lands on Keep, and returns to Delete when the reader keeps the Note.
  const { confirming, pending, error, keepRef, triggerRef, ask, keep, confirm, onKeyDown } = useInlineConfirm(
    () => deleteNoteAction(note.id),
    onDeleted,
  );

  if (editing) {
    return (
      <li>
        <NoteForm note={note} onSaved={onChanged} onCancel={onCancel} />
      </li>
    );
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
      <div onKeyDown={onKeyDown} className="mt-1 flex flex-wrap items-center gap-x-5 gap-y-1">
        {confirming ? (
          <>
            <span id={`delete-${note.id}`} className="font-sans text-[0.8rem] text-ink-2">Delete this note?</span>
            <button type="button" onClick={confirm} disabled={pending} aria-describedby={`delete-${note.id}`} className={dangerLink}>
              {pending ? "Deleting…" : "Yes, delete"}
            </button>
            <button ref={keepRef} type="button" onClick={keep} disabled={pending} className={quietLink}>
              Keep
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={onEdit} className={quietLink}>
              Edit
            </button>
            <button ref={triggerRef} type="button" onClick={ask} className={quietLink}>
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
