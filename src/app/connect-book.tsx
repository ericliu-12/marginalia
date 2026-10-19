"use client";

import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { ConnectCandidate, ConnectionType } from "@/domain/connections";
import { field } from "./book-panel";
import { connectBooksAction, editConnectionAction, getConnectCandidatesAction } from "./client-actions";
import { quietLink } from "./quiet-link";
import { resultMeta, resultTitle, searchInput, searchLabel } from "./search-pane";

// As the domain's REASON_MAX: a Manual Connection's reason is one line of at most this many characters.
const REASON_MAX = 200;
// "N left" shows once this few remain.
const REASON_WARN = 20;
// How many matches the search lists at once; typing more narrows it.
const SHOWN = 8;

const TYPES: { type: ConnectionType; label: string; hue: string }[] = [
  { type: "thematic", label: "Thematic", hue: "text-thematic" },
  { type: "contrast", label: "Contrast", hue: "text-contrast" },
  { type: "context", label: "Context", hue: "text-context" },
];
const STRENGTH_LABEL = { strong: "Strong", moderate: "Moderate", weak: "Weak" } as const;

// Lowercase and without accents, so "garcia" finds "García".
const folded = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

// Every word typed is in the title or an author. Before anything is typed, every Book matches, most
// recently finished first.
function matches(candidates: ConnectCandidate[], query: string) {
  const words = folded(query).split(/\s+/).filter(Boolean);
  if (!words.length) return candidates;
  return candidates.filter((c) => {
    const text = folded(`${c.title} ${c.authors.join(" ")}`);
    return words.every((w) => text.includes(w));
  });
}

// A Manual Connection being edited: its Books stay; its type and reason can change. `otherTitle` names
// the other Book where nothing around the form does.
export type Editing = { connectionId: string; otherTitle?: string; type: ConnectionType | null; reason: string };

// The Book panel's "Connect a book", open in place under the connections: search the reader's other
// Finished Books, choose one, perhaps a type, and say why. Escape or Cancel closes it; connecting hands
// the new Connection to the section. Given `editing`, the same form edits one of the reader's own in place
// of its card, the other Book fixed, and saves it.
export function ConnectBookForm({
  bookId,
  editing,
  onDone,
  onCancel,
}: {
  bookId: string;
  editing?: Editing;
  onDone: (connectionId: string, otherTitle: string) => void;
  onCancel: () => void;
}) {
  const [candidates, setCandidates] = useState<ConnectCandidate[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<ConnectCandidate | null>(
    editing ? { bookId: "", title: editing.otherTitle ?? "", authors: [], replaces: null } : null,
  );
  const [type, setType] = useState<ConnectionType | null>(editing?.type ?? null);
  const [reason, setReason] = useState(editing?.reason ?? "");
  const [error, setError] = useState<"reason" | "failed" | null>(null);
  const [pending, setPending] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const resultsRef = useRef<HTMLUListElement>(null);
  const isEditing = !!editing;
  const id = editing ? `edit-${editing.connectionId}` : `connect-${bookId}`;

  useEffect(() => {
    const reasonField = reasonRef.current;
    // Editing starts at the end of what the reader wrote.
    if (reasonField) {
      reasonField.focus({ preventScroll: true });
      reasonField.setSelectionRange(reasonField.value.length, reasonField.value.length);
    } else searchRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    let live = true;
    if (!isEditing && !loadFailed)
      getConnectCandidatesAction(bookId)
        .catch(() => null)
        .then((res) => {
          if (!live) return;
          if (res) setCandidates(res);
          else setLoadFailed(true);
        });
    return () => {
      live = false;
    };
  }, [bookId, loadFailed, isEditing]);

  const found = candidates ? matches(candidates, query) : [];

  // Opened at the panel's foot, it glides into view as it opens and as a Book is chosen, and keeps its
  // matches in view as they come, at once: one glide per keystroke would cut the last one short.
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    formRef.current?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
  }, [chosen]);
  const shownCount = Math.min(found.length, SHOWN);
  useEffect(() => {
    if (shownCount) formRef.current?.scrollIntoView({ block: "nearest" });
  }, [shownCount]);

  // Chosen and on to the reason in the same tap, so a phone keeps its keyboard up.
  function choose(c: ConnectCandidate) {
    flushSync(() => {
      setChosen(c);
      setType(c.replaces?.type ?? null);
      setError(null);
    });
    reasonRef.current?.focus({ preventScroll: true });
  }

  function change() {
    flushSync(() => setChosen(null));
    searchRef.current?.focus();
  }

  function submit() {
    if (!chosen) {
      if (found.length) choose(found[0]);
      return;
    }
    if (!reason.trim()) {
      setError("reason");
      reasonRef.current?.focus();
      return;
    }
    setError(null);
    setPending(true);
    const saved = editing
      ? editConnectionAction(editing.connectionId, { type, reason }).then((res) => (res.ok ? { ok: true as const, id: editing.connectionId } : { ok: false as const }))
      : connectBooksAction({ bookId, otherBookId: chosen.bookId, type, reason });
    saved
      .catch(() => ({ ok: false as const }))
      .then((res) => {
        setPending(false);
        if (res.ok) onDone(res.id, chosen.title);
        else setError("failed");
      });
  }

  // Arrow keys move between the search and its matches.
  function onResultsKey(e: React.KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = [...(resultsRef.current?.querySelectorAll("button") ?? [])];
    if (!items.length) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === "ArrowDown" ? at + 1 : at - 1;
    if (next < 0) searchRef.current?.focus();
    else items[Math.min(next, items.length - 1)].focus();
  }

  const left = REASON_MAX - [...reason].length;
  const label = `${searchLabel} pb-0.5`;

  return (
    <form
      ref={formRef}
      aria-label={editing ? "Edit the connection" : "Connect a book"}
      className="mt-3 border-t border-rule-3 pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        // As in Add, Escape clears a search before it closes.
        if (!chosen && query && !editing) setQuery("");
        else onCancel();
      }}
    >
      {chosen ? (
        <div>
          {/* Editing, the other Book is fixed: to connect a different one, the reader deletes this and makes a new one. */}
          {chosen.title && (
            <>
              <p className={label}>connect with</p>
              <div className="flex flex-wrap items-baseline gap-x-4">
                <p className="text-[18px] leading-tight italic">{chosen.title}</p>
                {chosen.authors.length > 0 && <p className={`order-last w-full ${resultMeta}`}>{chosen.authors.join(", ")}</p>}
                {!editing && (
                  <button type="button" onClick={change} disabled={pending} aria-label="Change the book" className={quietLink}>
                    Change
                  </button>
                )}
              </div>
            </>
          )}
          {chosen.replaces && (
            // The judge's reason is on its card just above, so only which one is named here.
            <p className="mt-2 text-[15px] leading-snug text-ink-2">
              Replaces the{" "}
              <span className={`caps text-[12px] tracking-[1.2px] ${TYPES.find((t) => t.type === chosen.replaces!.type)!.hue}`}>
                {TYPES.find((t) => t.type === chosen.replaces!.type)!.label} · {STRENGTH_LABEL[chosen.replaces.strength]}
              </span>{" "}
              connection.
            </p>
          )}

          <fieldset className={chosen.title ? "mt-4" : undefined}>
            <legend className={label}>type, if you like</legend>
            <div className="mt-1 flex gap-2">
              {TYPES.map((t) => (
                <button
                  key={t.type}
                  type="button"
                  aria-pressed={type === t.type}
                  onClick={() => setType(type === t.type ? null : t.type)}
                  disabled={pending}
                  className="min-h-12 flex-1 border border-edge bg-paper text-[15px] text-ink transition-colors duration-150 hover:border-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-thematic aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-paper lg:min-h-11"
                >
                  {t.label}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="mt-4">
            <div className="flex items-baseline justify-between gap-3">
              <label htmlFor={`${id}-reason`} className={label}>
                why they belong together
              </label>
              {left <= REASON_WARN && (
                <span id={`${id}-left`} className="text-[0.8rem] text-ink-3 tabular-nums">
                  {left} left
                </span>
              )}
            </div>
            {/* One line as stored: Enter connects rather than breaking it, and the field grows to show it all. */}
            <textarea
              ref={reasonRef}
              id={`${id}-reason`}
              rows={1}
              value={reason}
              maxLength={REASON_MAX}
              autoComplete="off"
              enterKeyHint="done"
              onChange={(e) => {
                setReason(e.target.value.replace(/[\r\n]+/g, " "));
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                submit();
              }}
              aria-invalid={error === "reason" || undefined}
              aria-describedby={[left <= REASON_WARN && `${id}-left`, error && `${id}-error`].filter(Boolean).join(" ") || undefined}
              className={`${field} mt-1 block resize-none text-[17px] leading-normal field-sizing-content aria-invalid:border-contrast`}
            />
          </div>
        </div>
      ) : (
        <div onKeyDown={onResultsKey}>
          <label htmlFor={`${id}-search`} className={searchLabel}>
            connect with
          </label>
          <input
            ref={searchRef}
            id={`${id}-search`}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Title or author"
            autoComplete="off"
            enterKeyHint="go"
            aria-controls={found.length ? `${id}-results` : undefined}
            className={`mt-1 ${searchInput}`}
          />
          {loadFailed ? (
            <p role="alert" className="pt-2 text-sm text-contrast">
              Couldn’t load your books.{" "}
              <button type="button" onClick={() => setLoadFailed(false)} className="min-h-11 underline underline-offset-2 lg:min-h-0">
                Try again
              </button>
            </p>
          ) : (
            <>
              <p role="status" className="pt-2 text-ink-2 italic empty:hidden">
                {!query.trim() ? "" : !candidates ? "Looking…" : found.length === 0 ? "No finished book matches." : ""}
              </p>
              {found.length > 0 && (
                <ul id={`${id}-results`} aria-label="Matching books" ref={resultsRef} className="divide-y divide-rule-3">
                  {found.slice(0, SHOWN).map((c) => (
                    <li key={c.bookId}>
                      <button
                        type="button"
                        onClick={() => choose(c)}
                        className="-mx-2 block min-h-11 w-[calc(100%+1rem)] px-2 py-2.5 text-left transition-colors duration-150 hover:bg-paper-3 focus-visible:bg-paper-3 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-thematic"
                      >
                        <span className={`block ${resultTitle}`}>{c.title}</span>
                        {c.authors.length > 0 && <span className={`block ${resultMeta}`}>{c.authors.join(", ")}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {found.length > SHOWN && <p className="pt-2 text-[15px] text-ink-2 italic">And {found.length - SHOWN} more. Keep typing to narrow them.</p>}
            </>
          )}
        </div>
      )}

      {error && (
        <p id={`${id}-error`} role="alert" className="mt-2 text-sm text-contrast">
          {error === "reason"
            ? "Write why they belong together."
            : editing
              ? "Couldn’t save. Your words are kept here."
              : "Couldn’t connect them. Your words are kept here."}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1">
        {chosen && (
          <button type="submit" disabled={pending} className="min-h-11 bg-ink px-[18px] text-[16px] text-paper italic transition-colors hover:bg-ink-2 disabled:bg-ink-3">
            {editing ? (pending ? "Saving…" : "Save") : pending ? "Connecting…" : "Connect"}
          </button>
        )}
        <button type="button" onClick={onCancel} disabled={pending} className={quietLink}>
          Cancel
        </button>
      </div>
    </form>
  );
}
