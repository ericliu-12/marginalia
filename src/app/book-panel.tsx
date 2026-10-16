"use client";

import { useCallback, useEffect, useOptimistic, useRef, useState, useTransition, type ReactNode, type RefObject } from "react";
import { flushSync } from "react-dom";
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
} from "./client-actions";
import { CO_AUTHOR_HINT, draftError, invalidProps, withScheme, type BookDraft, type DraftError } from "./book-draft";
import { ConnectionsSection, panelLabel } from "./connections";
import { MOVES } from "./library-list";
import { EMPTY, loadDraft, newNoteId, sameDraft, saveDraft, type Draft } from "./note-draft";
import { useInlineConfirm } from "./use-inline-confirm";
import { useStatusMove } from "./use-status-move";
import { POLL_MS, usePoll } from "./use-poll";
import { Cover } from "./cover";
import { dangerLink, quietLink } from "./quiet-link";
import { clusterTint } from "./cluster-tint";
import { longDate } from "./shelf";

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
  variant?: "panel" | "docked" | "screen";
}) {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [editingBook, setEditingBook] = useState(false);
  // Saved edits: About starts over after one, as a Manual Book's Enrichment may be running again.
  const [edits, setEdits] = useState(0);
  const [saved, setSaved] = useState(false);
  // The Note just written here, which inks in.
  const [written, setWritten] = useState<string | null>(null);
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

  const screen = variant === "screen";
  // Docked beside the library the panel sits on the ground, its right edge the page's; over the graph
  // it floats, raised; on a phone it is the screen, at the phone's gutter.
  const pad = variant === "docked" ? "pr-14 pl-8" : screen ? "px-5" : "px-6";
  const meta = [item.authors.join(", "), item.finished && item.finishedAt !== null && `Finished ${longDate(item.finishedAt)}`].filter(Boolean).join(" · ");
  // Oldest first, so a Note keeps its number and a new one is added at the end, beside the form.
  const inOrder = notes && [...notes].reverse();

  return (
    <aside aria-label={`Notes on ${item.title}`} onKeyDown={(e) => e.key === "Escape" && onBack()} className={`flex h-full min-h-0 flex-col ${variant === "panel" ? "bg-paper-2" : "bg-paper"}`}>
      <div className={`${pad} pt-4`}>
        <button type="button" onClick={onBack} className={`${quietLink} -ml-0.5 flex items-center gap-1.5 no-underline`}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
            <path d="M8 2L4 6l4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {backLabel}
        </button>
      </div>
      {crumbs}

      {/* Positioned, so what is placed absolutely inside (the Note field's hidden label) scrolls with it rather than
          against the page, where it would make the page taller than the screen. */}
      <div className={`relative min-h-0 flex-1 overflow-y-auto ${pad} pt-4 pb-10`}>
        <header>
          <Cover title={item.title} url={item.coverUrl} size="large" />
          <h2 ref={headingRef} tabIndex={-1} className="mt-5 text-[30px] leading-[1.1] font-medium text-balance italic outline-none">
            {item.title}
          </h2>
          {meta && <p className="caps mt-1.5 text-[15px] leading-snug tracking-[1.2px] text-ink-2">{meta}</p>}
          {item.cluster?.name && (
            <p className="mt-1 text-[15px] text-ink-2">
              in{" "}
              <i style={{ color: clusterTint(item.cluster.wash).name }}>{item.cluster.name}</i>
            </p>
          )}
          {!screen && <StatusMoves key={item.status} item={item} />}
          {!screen && editLink}
          <p role="status" className="text-[14px] text-ink-2 empty:hidden">
            {saved ? "Changes saved." : ""}
          </p>
          {screen && <StatusControl item={item} />}
          {screen && <div className="mt-2">{editLink}</div>}
        </header>

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

        {/* What the Book is about, then the reader's Notes, then where it connects. */}
        <About key={`about-${item.bookId}-${edits}`} bookId={item.bookId} noteCount={notes?.length ?? null} />
        <section aria-labelledby={`notes-${item.bookId}`} className="mt-7 border-t border-rule-2 pt-3.5">
          <h3 id={`notes-${item.bookId}`} ref={notesHeadingRef} tabIndex={-1} className={panelLabel}>
            Notes
          </h3>
          {loadFailed && (
            <p role="alert" className="pt-2 text-contrast">
              Couldn’t load your Notes.{" "}
              <button type="button" onClick={() => setRetry((n) => n + 1)} className="underline underline-offset-2">
                Try again
              </button>
            </p>
          )}
          {notes === null && !loadFailed && <p className="pt-2 text-ink-2 italic">Opening your Notes…</p>}
          {notes?.length === 0 && (
            <p className="max-w-[34ch] pt-2 text-ink-2 italic">Nothing written yet. Whatever you’re thinking as you read belongs here.</p>
          )}
          {inOrder && inOrder.length > 0 && (
            <ol className="mt-2 flex flex-col gap-4">
              {inOrder.map((n, i) => (
                <NoteItem
                  key={n.id}
                  number={i + 1}
                  note={n}
                  fresh={n.id === written}
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
            </ol>
          )}
          <div className="mt-3">
            <NoteForm
              key={item.bookId}
              bookId={item.bookId}
              onSaved={(note) => {
                setWritten(note.id);
                setNotes((ns) => [note, ...(ns ?? [])]);
              }}
            />
          </div>
        </section>

        {/* Starts over when the Book becomes Finished, to show its Connections being found. */}
        <ConnectionsSection key={`connections-${item.bookId}-${item.finished}`} bookId={item.bookId} onOpenBook={onOpenBook} withheld={withheldConnections} />

        <RemoveEntry key={`remove-${item.bookId}`} bookId={item.bookId} title={item.title} onRemoved={onRemoved} />
      </div>
    </aside>
  );
}

const STATUS_LABEL: Record<Status, string> = { want: "Want to read", reading: "Reading", read: "Read" };

// Where the Book stands, and the same one-click moves as its library row: "Read again" starts a new
// Read-through for a finished Book.
function StatusMoves({ item }: { item: LibraryItem }) {
  const { pending, moving, error, move } = useStatusMove(item.bookId);

  return (
    <div aria-busy={pending} className="mt-3">
      <div role="group" aria-label={`Status of ${item.title}`} className="flex flex-wrap items-baseline gap-x-4">
        <span className="text-[15px] text-ink-2 italic">{item.reReading ? "Re-reading" : STATUS_LABEL[item.status]}</span>
        {MOVES[item.status].map(({ label, to }) => (
          <button key={to} type="button" onClick={() => move(to)} className={quietLink}>
            {pending && moving === to ? "Moving…" : label}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-sm text-contrast">
          Couldn’t move this Book. Try again.
        </p>
      )}
    </div>
  );
}

const STATUSES: Status[] = ["want", "reading", "read"];

// The Book screen's Status: one tap between all three, shown at once. Read records today as the finish
// date. When that completes the Book's first Read-through, the finish line says where its Connections
// will be, or that they wait for the month's spending limit; it goes when the Status moves on, and a
// later Read-through never brings it back.
function StatusControl({ item }: { item: LibraryItem }) {
  const [shown, show] = useOptimistic(item.status);
  const [pending, start] = useTransition();
  const [error, setError] = useState(false);
  // Null, or the finish line: `paused` is the day Connections resume, when they wait for the spending limit.
  const [finishLine, setFinishLine] = useState<{ paused: string | null } | null>(null);
  // The latest move: only its answer may show the finish line or an error.
  const latest = useRef(0);

  function move(to: Status) {
    // A tap while a move is still saving goes through too: Next sends them in order, so the last one stands.
    if (to === shown) return;
    const id = ++latest.current;
    setError(false);
    // Only the move's own answer can bring the line back, so a later Read-through never flashes it.
    setFinishLine(null);
    start(async () => {
      show(to);
      const res = await changeStatusAction(item.bookId, to);
      if (id !== latest.current) return;
      if (!res.ok) return setError(true);
      if (to === "read" && res.firstCompletion) setFinishLine({ paused: res.paused });
    });
  }

  return (
    <div aria-busy={pending} className="mt-5">
      <div role="group" aria-label={`Status of ${item.title}`} className="grid grid-cols-3 gap-[3px] bg-paper-3 p-[3px]">
        {STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={shown === s}
            onClick={() => move(s)}
            className="min-h-11 rounded-[2px] text-sm font-medium text-ink-2 transition-[background-color,color,box-shadow] duration-200 ease-out-expo aria-pressed:bg-paper-2 aria-pressed:text-ink aria-pressed:shadow-[0_1px_2px_rgb(26_26_26/0.2)]"
          >
            {STATUS_LABEL[s]}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-contrast">
          Couldn’t move this Book. Try again.
        </p>
      )}
      {/* Mounted throughout, so the line is announced when it appears. */}
      <p role="status" className="mt-4 bg-paper-3 px-4 py-3 leading-snug empty:hidden motion-safe:animate-draw-in">
        {finishLine && shown === "read" && (
          <>
            <span className="font-medium">Finished.</span>{" "}
            {finishLine.paused
              ? `Connections are paused until ${finishLine.paused}. Then they’ll gather below, and in the graph on a larger screen.`
              : "Finding its Connections. They’ll gather below, and in the graph on a larger screen."}
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
          <p id={`remove-${bookId}`} className="w-full text-[0.8rem] text-ink-2">
            Remove <i className="font-serif text-[0.9rem]">{title}</i> from your library? Its Notes, reading history and Connections go with it.
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
        <p role="alert" className="mt-1 text-sm text-contrast">
          Couldn’t remove this Book. Try again.
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

  return (
    <BookDetailsForm
      id="edit"
      errorId={`edit-${item.bookId}-error`}
      aria-label={`Edit ${item.title}`}
      className="mt-6 border-t border-rule-2 pt-4"
      draft={draft}
      onChange={setDraft}
      manual={item.manual}
      onSubmit={async (sent) => {
        const res = await editBookAction(item.bookId, sent);
        if (!res.ok) return "Couldn’t save these changes. Try again.";
        onDone(true);
      }}
      onEscape={() => onDone(false)}
      intro={
        <p className="max-w-[40ch] text-sm text-ink-2">
          {item.manual
            ? "You added this Book by hand, so it’s yours to change. A new title, author or description means reading up on it again."
            : `Changes how this Book appears for you alone. Clear a field to go back to the original${item.original ? `, ${item.original.title} by ${item.original.authors.join(", ")}` : ""}.`}
        </p>
      }
      actions={(pending) => (
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1">
          <button
            type="submit"
            disabled={pending}
            className="min-h-11 bg-ink px-4 py-2 text-sm font-medium text-paper transition-colors hover:bg-ink-2 disabled:bg-ink-3 lg:min-h-0"
          >
            {pending ? "Saving…" : "Save changes"}
          </button>
          <button type="button" onClick={() => onDone(false)} disabled={pending} className={quietLink}>
            Cancel
          </button>
        </div>
      )}
    />
  );
}

// A Book's details as the reader types them, to add a Manual Book or to edit a Book. A `manual` Book
// needs a title and an author, its co-authors are kept apart by "and", and it has a cover and a
// description, which `reveal` keeps behind quiet links until asked for. Submitting checks the draft
// first and puts focus on the first field that is wrong; `onSubmit` then hears the draft as it is sent
// (a cover's "www." made a web address) and the submit button's value, and returns what to say if
// sending it failed. It starts within the submit itself (a transition runs its function at once), so
// what it does before its first await is still part of the reader's tap. Escape is `onEscape`'s. With `enterMovesOn` (the phone, whose keyboard has no
// Tab), Enter goes to the next field instead, and the last puts the keyboard away.
export function BookDetailsForm({
  id,
  errorId,
  draft,
  onChange,
  manual,
  reveal = false,
  focus = "title",
  descriptionPlaceholder,
  enterMovesOn = false,
  onSubmit,
  onEscape,
  intro,
  note,
  actions,
  ...form
}: {
  id: string;
  errorId: string;
  draft: BookDraft;
  onChange: (draft: BookDraft) => void;
  manual: boolean;
  reveal?: boolean;
  focus?: "title" | "author";
  descriptionPlaceholder?: string;
  enterMovesOn?: boolean;
  onSubmit: (draft: BookDraft, choice: string) => Promise<string | void>;
  onEscape: () => void;
  intro: ReactNode;
  note?: ReactNode;
  actions: (pending: boolean, choice: string) => ReactNode;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  className?: string;
}) {
  const [showCover, setShowCover] = useState(!reveal || !!draft.coverUrl);
  const [showDescription, setShowDescription] = useState(!reveal || !!draft.description);
  const [error, setError] = useState<DraftError | null>(null);
  const [choice, setChoice] = useState("");
  const [pending, start] = useTransition();
  const refs = {
    title: useRef<HTMLInputElement>(null),
    author: useRef<HTMLInputElement>(null),
    coverUrl: useRef<HTMLInputElement>(null),
    description: useRef<HTMLTextAreaElement>(null),
  };

  useEffect(() => refs[focus].current?.focus(), []); // eslint-disable-line react-hooks/exhaustive-deps

  function change(patch: Partial<BookDraft>) {
    onChange({ ...draft, ...patch });
    setError(null);
  }

  function submit(chosen: string) {
    const problem = draftError(draft, manual);
    if (problem) {
      setError(problem);
      if (problem.field) refs[problem.field].current?.focus();
      return;
    }
    setError(null);
    setChoice(chosen);
    start(async () => {
      const failure = await onSubmit({ ...draft, coverUrl: withScheme(draft.coverUrl) }, chosen);
      if (failure) setError({ field: null, message: failure });
    });
  }

  const label = "mt-3 block text-[0.8rem] font-medium text-ink-2";
  const input = `${field} mt-1 text-[0.95rem]`;
  return (
    <form
      noValidate
      {...form}
      onSubmit={(e) => {
        e.preventDefault();
        const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        submit(submitter?.value ?? "");
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onEscape();
        }
        if (enterMovesOn && e.key === "Enter" && e.target instanceof HTMLInputElement) {
          e.preventDefault();
          const fields = [refs.title, refs.author, refs.coverUrl].flatMap((r) => (r.current ? [r.current] : []));
          const next = fields[fields.indexOf(e.target) + 1];
          if (next) next.focus();
          else e.target.blur();
        }
      }}
    >
      {intro}
      <label htmlFor={`${id}-title`} className={label}>
        Title
      </label>
      <input ref={refs.title} id={`${id}-title`} enterKeyHint={enterMovesOn ? "next" : undefined} value={draft.title} onChange={(e) => change({ title: e.target.value })} autoComplete="off" {...invalidProps(error, "title", errorId)} className={input} />
      <label htmlFor={`${id}-author`} className={label}>
        Author
      </label>
      <input
        ref={refs.author}
        id={`${id}-author`}
        enterKeyHint={enterMovesOn ? (manual && showCover ? "next" : "done") : undefined}
        value={draft.author}
        onChange={(e) => change({ author: e.target.value })}
        autoComplete="off"
        {...invalidProps(error, "author", errorId, manual ? `${id}-author-hint` : undefined)}
        className={input}
      />
      {manual && (
        <p id={`${id}-author-hint`} className="mt-1 text-[0.8rem] text-ink-3">
          {CO_AUTHOR_HINT}
        </p>
      )}

      {manual && showCover && (
        <>
          <label htmlFor={`${id}-cover`} className={label}>
            Cover image address
          </label>
          <input
            ref={refs.coverUrl}
            id={`${id}-cover`}
            enterKeyHint={enterMovesOn ? "done" : undefined}
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
      {manual && showDescription && (
        <>
          <label htmlFor={`${id}-description`} className={label}>
            Description
          </label>
          <textarea
            ref={refs.description}
            id={`${id}-description`}
            rows={4}
            value={draft.description}
            onChange={(e) => change({ description: e.target.value })}
            placeholder={descriptionPlaceholder}
            className={`${field} mt-1 resize-y`}
          />
        </>
      )}
      {manual && (!showCover || !showDescription) && (
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

      {note}
      {error && (
        <p id={errorId} role="alert" className="mt-2 text-sm text-contrast">
          {error.message}
        </p>
      )}
      {actions(pending, choice)}
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
        <span className="italic">Getting to know this Book…</span> {enrichment === null && again}
      </p>
    );
  } else if (enrichment.status === "failed") {
    body = (
      <p className="text-ink-2">
        <span className="italic">Couldn’t read up on this Book.</span> {again}
      </p>
    );
  } else if (!enrichment.recognised) {
    body = (
      <div>
        <p className="text-ink-2 italic">Marginalia doesn’t know this Book well.</p>
        <p className="mt-1 max-w-[40ch] text-ink-2">
          {noteCount === null
            ? ""
            : noteCount > 0
              ? "Your Notes now shape its Connections."
              : "Add a few Notes and they’ll shape its Connections."}
        </p>
        <div className="mt-1">{again}</div>
      </div>
    );
  } else {
    body = (
      <>
        <p>{enrichment.summary}</p>
        {enrichment.themes && enrichment.themes.length > 0 && (
          <p className="caps mt-2 text-[14px] leading-relaxed tracking-[1px] text-ink-2">{enrichment.themes.join(" · ")}</p>
        )}
        {/* Google's terms ask for a link to the Book's page wherever its description is used (#42). */}
        {enrichment.googleBooksVolumeId && (
          <p className="mt-3 text-[0.8rem] text-ink-3">
            Drawn from the description on{" "}
            <a
              href={`https://books.google.com/books?id=${encodeURIComponent(enrichment.googleBooksVolumeId)}`}
              target="_blank"
              rel="noopener noreferrer"
              // Inline, so min-height can't reach 44px; padding grows the tap area without moving the line.
              className={`${quietLink} py-[13px] lg:py-0`}
            >
              Google Books
            </a>
          </p>
        )}
      </>
    );
  }

  return (
    <section aria-labelledby={`about-${bookId}`} className="mt-7 border-t border-rule-2 pt-3.5">
      <h3 id={`about-${bookId}`} className={`${panelLabel} mb-2`}>
        About this Book
      </h3>
      {body}
      {retryFailed && (
        <p role="alert" className="mt-1 text-sm text-contrast">
          Couldn’t start that again. Try once more in a moment.
        </p>
      )}
    </section>
  );
}

export const field =
  "w-full border border-edge bg-paper px-3 py-2.5 text-ink placeholder:text-ink-3 focus-visible:border-thematic focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-thematic/30";

function parsePage(raw: string): number | null | "invalid" {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isInteger(n) && n > 0 && n < 100000 ? n : "invalid";
}

// Text first; the quote and the page are quiet reveals. Used to write a new Note (draft kept) and to edit
// one. The phone's Note sheet (`sheet`) sets it as writing on the page itself, with Save full width;
// its host takes `bodyRef` to focus the text inside the tap that opens it.
type NoteFormProps = {
  onSaved?: (n: Note) => void;
  onCancel?: () => void;
  variant?: "panel" | "sheet";
  bodyRef?: RefObject<HTMLTextAreaElement | null>;
} & ({ bookId: string; note?: undefined } | { note: Note; bookId?: undefined });

// Tapping a reveal or Save leaves focus where it is, so a phone's keyboard stays up.
const keepFocus = (e: React.MouseEvent) => e.preventDefault();

// A save with no answer by now is shown as failed: a phone that has lost its signal can hang rather than fail.
const SAVE_TIMEOUT_MS = 15_000;

export function NoteForm(props: NoteFormProps) {
  const { note, onSaved, onCancel, variant = "panel" } = props;
  const editing = !!note;
  const sheet = variant === "sheet";
  const [draft, setDraft] = useState<Draft>(() =>
    props.note
      ? { body: props.note.body, quote: props.note.quote ?? "", page: props.note.page?.toString() ?? "" }
      : loadDraft(props.bookId),
  );
  // What is typed now, for a save that answers late.
  const latest = useRef(draft);
  const [showQuote, setShowQuote] = useState(!!draft.quote);
  const [showPage, setShowPage] = useState(!!draft.page);
  // A save that failed keeps everything typed, and Save becomes Try again.
  const [error, setError] = useState<{ message: string; retry: boolean } | null>(null);
  // Not a transition: a server action that hangs would keep it pending.
  const [pending, setPending] = useState(false);
  // The latest try at saving; an earlier one that answers late doesn't speak for it.
  const attempt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const ownBodyRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = props.bodyRef ?? ownBodyRef;
  const quoteRef = useRef<HTMLTextAreaElement>(null);
  const pageRef = useRef<HTMLInputElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);
  const idPrefix = note ? `note-${note.id}` : "new-note";

  useEffect(() => {
    if (editing) bodyRef.current?.focus();
  }, [editing, bodyRef]);

  useEffect(() => () => clearTimeout(timer.current), []);

  // With a phone's keyboard up, the message and the way to try again can sit below the sheet's fold.
  useEffect(() => {
    if (error?.retry) saveRef.current?.scrollIntoView({ block: "nearest" });
  }, [error]);

  function change(patch: Partial<Draft>) {
    const next = { ...draft, ...patch };
    setDraft(next);
    latest.current = next;
    setError(null);
    if (props.bookId) saveDraft(props.bookId, next);
  }

  // A try that saved what is typed now finishes the Note. One that saved what was typed before (it
  // answered late, after the reader typed on) changes nothing here: the next try lands on the same Note.
  // The stored draft is cleared only if it is still what was saved, as another form may have it now.
  function finish(saved: Note, sent: Draft) {
    if (props.bookId && sameDraft(loadDraft(props.bookId), sent)) saveDraft(props.bookId, EMPTY);
    if (latest.current !== sent) return;
    setError(null);
    if (!editing) {
      latest.current = EMPTY;
      // The sheet goes down with the words still on it.
      if (!sheet) {
        setDraft(EMPTY);
        setShowQuote(false);
        setShowPage(false);
        bodyRef.current?.focus();
      }
    }
    onSaved?.(saved);
  }

  function submit() {
    if (!draft.body.trim()) {
      const message = draft.quote.trim() ? "Add a line of your own to go with the passage." : "Write something first.";
      return setError({ message, retry: false });
    }
    const page = parsePage(draft.page);
    if (page === "invalid") return setError({ message: "Page should be a whole number.", retry: false });
    let sent = draft;
    if (props.bookId && !sent.id) {
      sent = { ...draft, id: newNoteId() };
      setDraft(sent);
      latest.current = sent;
      saveDraft(props.bookId, sent);
    }
    const mine = ++attempt.current;
    const failed = () => {
      if (attempt.current !== mine) return;
      clearTimeout(timer.current);
      setPending(false);
      setError({ message: "Couldn’t save. Your Note is kept here.", retry: true });
    };
    setError(null);
    setPending(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(failed, SAVE_TIMEOUT_MS);
    const input = { body: sent.body, quote: sent.quote, page };
    // Offline, the action itself rejects rather than answering.
    (props.note ? updateNoteAction(props.note.id, input) : addNoteAction(props.bookId, input, sent.id))
      .catch(() => ({ ok: false as const }))
      .then((res) => {
        if (!res.ok) return failed();
        if (attempt.current === mine) {
          clearTimeout(timer.current);
          setPending(false);
        }
        finish(res.note, sent);
      });
  }

  // Revealed and focused in the same tap, so a phone keeps its keyboard up for the new field.
  function reveal(show: (on: boolean) => void, ref: RefObject<HTMLElement | null>) {
    flushSync(() => show(true));
    ref.current?.focus();
  }

  // Taking a quote or page away clears it and goes back to the Note's text.
  function remove(patch: Partial<Draft>, show: (on: boolean) => void) {
    change(patch);
    show(false);
    bodyRef.current?.focus();
  }

  // Writing on the sheet's paper has no box; a keyboard's focus shows as a thematic hairline beneath.
  const sheetField = "w-full bg-transparent text-ink placeholder:text-ink-3 focus-visible:shadow-[0_1px_0_var(--color-thematic)] focus-visible:outline-none";
  const label = sheet ? "caps text-[14px] font-medium tracking-[1.5px] text-ink-2" : "text-[0.8rem] font-medium text-ink-2";
  const removeLink = (what: string, onClick: () => void) => (
    <button type="button" aria-label={`Remove ${what}`} onMouseDown={keepFocus} onClick={onClick} className={`${quietLink} shrink-0`}>
      Remove
    </button>
  );
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
    >
      {/* The panel's new Note is headed by its label, the accent's "Write a Note"; elsewhere the label is unseen. */}
      <label htmlFor={`${idPrefix}-body`} className={editing || sheet ? "sr-only" : "block pb-1.5 text-[15px] text-accent italic"}>
        {editing ? "Edit Note" : sheet ? "New Note" : "Write a Note"}
      </label>
      <textarea
        ref={bodyRef}
        id={`${idPrefix}-body`}
        value={draft.body}
        onChange={(e) => change({ body: e.target.value })}
        placeholder="What are you thinking?"
        rows={sheet ? 5 : editing ? 4 : 3}
        // In the sheet the text grows as it is written, and the sheet scrolls, rather than scrolling inside it.
        className={`${sheet ? `${sheetField} block min-h-[5lh] resize-none py-1.5 field-sizing-content` : `${field} resize-y`} text-[1.0625rem] leading-normal`}
      />
      {showQuote && (
        <div className={sheet ? "border-t border-rule pt-1" : "mt-3"}>
          <div className="flex items-center justify-between gap-3">
            <label htmlFor={`${idPrefix}-quote`} className={label}>
              Quoted passage
            </label>
            {removeLink("quote", () => remove({ quote: "" }, setShowQuote))}
          </div>
          <textarea
            ref={quoteRef}
            id={`${idPrefix}-quote`}
            value={draft.quote}
            onChange={(e) => change({ quote: e.target.value })}
            rows={sheet ? 3 : 2}
            placeholder={sheet ? "The passage, as written" : undefined}
            className={sheet ? `${sheetField} block min-h-[3lh] resize-none pb-1 text-ink-2 italic field-sizing-content` : `${field} mt-1 resize-y italic`}
          />
        </div>
      )}
      {showPage && (
        <div className={sheet ? "flex items-center gap-3 border-t border-rule" : "mt-3"}>
          <div className={sheet ? "contents" : "flex items-center justify-between gap-3"}>
            <label htmlFor={`${idPrefix}-page`} className={label}>
              Page
            </label>
            {!sheet && removeLink("page", () => remove({ page: "" }, setShowPage))}
          </div>
          <input
            ref={pageRef}
            id={`${idPrefix}-page`}
            inputMode="numeric"
            autoComplete="off"
            placeholder="e.g. 112"
            value={draft.page}
            onChange={(e) => change({ page: e.target.value })}
            className={sheet ? `${sheetField} min-h-11 min-w-0 flex-1 text-[0.95rem] tabular-nums` : `${field} mt-1 w-28 text-[0.95rem]`}
          />
          {sheet && removeLink("page", () => remove({ page: "" }, setShowPage))}
        </div>
      )}
      {error && (
        <p role="alert" className={`text-contrast ${sheet ? "border-t border-rule py-2.5 text-[15px]" : "mt-2 text-sm"}`}>
          {error.message}
        </p>
      )}
      <div className={sheet ? "flex flex-wrap items-center gap-x-5 border-t border-rule pt-1 empty:hidden" : "mt-3 flex flex-wrap items-center gap-x-5 gap-y-1"}>
        {!sheet && <SaveNote buttonRef={saveRef} pending={pending} retry={!!error?.retry} editing={editing} sheet={false} />}
        {editing && (
          <button type="button" onClick={onCancel} disabled={pending} className={quietLink}>
            Cancel
          </button>
        )}
        {!showQuote && (
          <button type="button" onMouseDown={keepFocus} onClick={() => reveal(setShowQuote, quoteRef)} className={quietLink}>
            Add a quote
          </button>
        )}
        {!showPage && (
          <button type="button" onMouseDown={keepFocus} onClick={() => reveal(setShowPage, pageRef)} className={quietLink}>
            Add a page
          </button>
        )}
      </div>
      {sheet && <SaveNote buttonRef={saveRef} pending={pending} retry={!!error?.retry} editing={false} sheet />}
    </form>
  );
}

function SaveNote({
  buttonRef,
  pending,
  retry,
  editing,
  sheet,
}: {
  buttonRef: RefObject<HTMLButtonElement | null>;
  pending: boolean;
  retry: boolean;
  editing: boolean;
  sheet: boolean;
}) {
  return (
    <button
      ref={buttonRef}
      type="submit"
      disabled={pending}
      onMouseDown={keepFocus}
      className={`bg-ink text-paper transition-colors hover:bg-ink-2 disabled:bg-ink-3 ${sheet ? "mt-2 min-h-12 w-full text-[17px] italic active:bg-ink-2" : "min-h-11 px-[18px] text-[16px] italic"}`}
    >
      {pending ? "Saving…" : retry ? "Try again" : editing ? "Save changes" : "Save Note"}
    </button>
  );

}

function NoteItem({
  number,
  note,
  fresh,
  editing,
  onEdit,
  onCancel,
  onChanged,
  onDeleted,
}: {
  number: number;
  note: Note;
  fresh: boolean;
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

  // A sidenote: its numeral in a narrow column, in the accent, beside the Note; under it the passage it
  // quotes, and the page.
  return (
    <li aria-busy={pending} className={`grid grid-cols-[18px_minmax(0,1fr)] gap-x-2 ${fresh ? "motion-safe:animate-ink-in" : ""}`}>
      <span aria-hidden className="pt-[3px] text-[13px] text-accent tabular-nums">
        {number}
      </span>
      {editing ? (
        <NoteForm note={note} onSaved={onChanged} onCancel={onCancel} />
      ) : (
        <div>
          <p className="text-[17px] leading-normal whitespace-pre-wrap">{note.body}</p>
          {note.quote && <blockquote className="mt-1.5 text-ink-2 italic">“{note.quote}”</blockquote>}
          {note.page != null && <p className="caps mt-0.5 text-[14px] tracking-[1px] text-ink-2">p. {note.page}</p>}
          <div onKeyDown={onKeyDown} className="mt-1 flex flex-wrap items-center gap-x-5 gap-y-1">
            {confirming ? (
              <>
                <span id={`delete-${note.id}`} className="text-[0.8rem] text-ink-2">Delete this Note?</span>
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
            <p role="alert" className="mt-1 text-sm text-contrast">
              Couldn’t delete this Note. Try again.
            </p>
          )}
        </div>
      )}
    </li>
  );
}
