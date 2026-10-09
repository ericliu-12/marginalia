"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { field } from "../book-panel";
import { signInAction, type SignInState } from "./actions";

const message = (state: SignInState) =>
  state?.error === "wrong"
    ? "That’s not the password."
    : state?.error === "limited"
      ? `Too many tries. Try again in ${state.minutes} ${state.minutes === 1 ? "minute" : "minutes"}.`
      : null;

export function SignInForm({ next, unconfigured }: { next: string; unconfigured: boolean }) {
  const [state, action, pending] = useActionState(signInAction, unconfigured ? { error: "unconfigured" } : null);
  // Kept across a wrong try and selected, so a typo is fixed and a wrong guess typed over.
  const [password, setPassword] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (state && state.error !== "unconfigured") input.current?.select();
  }, [state]);
  const error = message(state);
  const closed = state?.error === "unconfigured";

  return (
    <form action={action} className="w-full max-w-[19rem]">
      <h1 className="text-[1.75rem] leading-none font-medium tracking-[-0.01em] italic">Marginalia</h1>
      <input type="hidden" name="next" value={next} />
      {/* For the password manager: iCloud Keychain saves and fills a password against a username. */}
      <input type="text" name="username" autoComplete="username" defaultValue="Marginalia" readOnly tabIndex={-1} aria-hidden className="sr-only" />
      <label htmlFor="password" className="mt-10 block font-sans text-[0.8rem] font-medium text-ink-2">
        Password
      </label>
      <input
        ref={input}
        id="password"
        name="password"
        type="password"
        autoComplete="current-password"
        enterKeyHint="go"
        required
        autoFocus
        disabled={closed}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || closed ? "sign-in-message" : undefined}
        className={`${field} mt-1 font-sans text-[0.95rem] disabled:opacity-60`}
      />
      <p id="sign-in-message" role="alert" className="mt-2 min-h-5 font-sans text-sm text-contrast">
        {closed ? "Sign-in isn’t set up on this server yet: it needs APP_PASSWORD, and a SESSION_SECRET of 32 characters or more." : error}
      </p>
      <button
        type="submit"
        disabled={pending || closed}
        className={`mt-3 min-h-11 w-full rounded-[3px] bg-ink px-4 font-sans text-sm font-medium text-paper transition-colors hover:bg-ink-2 disabled:cursor-default disabled:hover:bg-ink ${closed ? "opacity-60" : ""}`}
      >
        {pending ? "Opening…" : "Open"}
      </button>
    </form>
  );
}
