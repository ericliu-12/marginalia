"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { CONFIRM_DELETE, signInPath } from "@/lib/signed-out";
import { field } from "../book-panel";

// The quiet button in rust: a hairline that fills with rust on hover, 44px tall on touch.
const dangerButton =
  "inline-flex min-h-11 items-center rounded-[3px] border border-contrast px-3 font-sans text-[0.8rem] font-medium text-contrast transition-colors duration-150 hover:bg-contrast hover:text-paper active:bg-contrast active:text-paper disabled:border-contrast/40 disabled:text-ink-3 disabled:hover:bg-transparent lg:min-h-9";
const quietButton =
  "inline-flex min-h-11 items-center rounded-[3px] border border-ink/70 px-3 font-sans text-[0.8rem] font-medium text-ink transition-colors duration-150 hover:bg-ink hover:text-paper active:bg-ink-2 active:text-paper disabled:border-rule disabled:text-ink-3 disabled:hover:bg-transparent lg:min-h-9";

// Delete your account (#68): once the Reader types `delete`, and only from a session signed in within the
// day. An older one signs in again first, coming back here.
export function DeleteAccount({ fresh: freshAtLoad }: { fresh: boolean }) {
  const [fresh, setFresh] = useState(freshAtLoad);
  const [typed, setTyped] = useState("");
  const [state, setState] = useState<"idle" | "pending" | "failed">("idle");
  const confirmed = typed.trim().toLowerCase() === CONFIRM_DELETE;
  // Turned stale on deleting: the form is gone, so focus goes to what replaces it.
  const turnedStale = useRef(false);
  const signInAgainButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!fresh && turnedStale.current) signInAgainButton.current?.focus();
  }, [fresh]);

  async function signInAgain() {
    setState("pending");
    const res = await fetch("/api/auth/sign-out", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => null);
    if (res?.ok) return window.location.assign(signInPath("/account#delete-account"));
    setState("failed");
  }

  async function onDelete(e: FormEvent) {
    e.preventDefault();
    if (!confirmed || state === "pending") return;
    setState("pending");
    const res = await fetch("/api/auth/delete-user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: CONFIRM_DELETE }),
    }).catch(() => null);
    if (res?.ok) return window.location.assign("/sign-in?deleted");
    if (res?.status === 401) return window.location.assign(signInPath("/account#delete-account"));
    // Left open past the day since signing in.
    const code = res?.status === 400 ? ((await res.json().catch(() => null)) as { code?: string } | null)?.code : undefined;
    if (code === "SESSION_EXPIRED") {
      turnedStale.current = true;
      setFresh(false);
      return setState("idle");
    }
    setState("failed");
  }

  const failed = fresh ? "Couldn’t delete your account. Check your connection and try again." : "Couldn’t sign you out. Check your connection and try again.";
  const message = (
    <p id="delete-message" role="status" className="mt-2 min-h-5 font-sans text-[0.8rem] text-pretty text-contrast">
      {state === "failed" && failed}
      {state === "pending" && fresh && <span className="sr-only">Deleting your account…</span>}
    </p>
  );

  if (!fresh)
    return (
      <>
        <p id="delete-stale" className="text-ink-2">
          To delete your account, sign in again first: it’s been more than a day since you last did. This signs you out here, then brings
          you back to this page.
        </p>
        <div className="mt-5">
          <button
            ref={signInAgainButton}
            type="button"
            onClick={signInAgain}
            disabled={state === "pending"}
            aria-describedby="delete-stale delete-message"
            className={quietButton}
          >
            {state === "pending" ? "Signing out…" : state === "failed" ? "Try again" : "Sign in again"}
          </button>
          {message}
        </div>
      </>
    );

  return (
    <form onSubmit={onDelete} noValidate className="mt-5">
      <label htmlFor="confirm-delete" className="block font-sans text-[0.8rem] font-medium text-ink-2">
        Type <span className="text-ink">delete</span> to confirm
      </label>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
        <input
          id="confirm-delete"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="done"
          aria-describedby="delete-message"
          className={`${field} max-w-[12rem] font-sans text-[0.95rem] lg:h-9 lg:py-0`}
        />
        {/* Not disabled while pending, so focus stays on it; a second press does nothing. */}
        <button type="submit" disabled={!confirmed} aria-describedby="delete-message" className={dangerButton}>
          {state === "pending" ? "Deleting…" : state === "failed" ? "Try again" : "Delete account"}
        </button>
      </div>
      {message}
    </form>
  );
}
