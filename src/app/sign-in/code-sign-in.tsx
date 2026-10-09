"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { field } from "../book-panel";
import { quietLink } from "../quiet-link";

// One code a minute per email (#65), so "Send a new code" rests for as long after each send.
const RESEND_AFTER_S = 60;
const CODE_LENGTH = 6;
const CODE_LASTS_MS = 5 * 60 * 1000;

const button =
  "mt-3 min-h-11 w-full rounded-[3px] bg-ink px-4 font-sans text-sm font-medium text-paper transition-colors hover:bg-ink-2 disabled:cursor-default disabled:hover:bg-ink";
const label = "block font-sans text-[0.8rem] font-medium text-ink-2";
const quietText = "font-sans text-[0.8rem] text-ink-3";

// Relative paths only: the page's own origin is the site's, and nothing absolute is built here.
async function post(path: string, body: object): Promise<Response | null> {
  try {
    return await fetch(`/api/auth${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    return null;
  }
}

const UNREACHABLE = "Couldn’t reach Marginalia. Try again.";
// Better Auth's rate limit, the same for every email.
const TOO_MANY = "Too many tries. Wait a minute, then try again.";
const looksLikeEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

// The email and when its code was sent, never the code: the iPhone home-screen app may reload while the
// reader is in Mail, and should come back to the code step. Storage can be unavailable; then it just doesn't.
const SAVED = "marginalia:sign-in";
type Saved = { email: string; sentAt: number };
function readSaved(): Saved | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(SAVED) ?? "null") as Saved | null;
    return saved && Date.now() - saved.sentAt < CODE_LASTS_MS ? saved : null;
  } catch {
    return null;
  }
}
function writeSaved(saved: Saved | null) {
  try {
    if (saved) sessionStorage.setItem(SAVED, JSON.stringify(saved));
    else sessionStorage.removeItem(SAVED);
  } catch {}
}

export function CodeSignIn({ next }: { next: string }) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentAt, setSentAt] = useState(0);
  const [now, setNow] = useState(0);
  const [resent, setResent] = useState(false);
  const emailInput = useRef<HTMLInputElement>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  const codeForm = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const saved = readSaved();
    if (!saved) return;
    setEmail(saved.email);
    setSentAt(saved.sentAt);
    setNow(Date.now());
    setStep("code");
  }, []);

  const waitS = Math.max(0, RESEND_AFTER_S - Math.floor((now - sentAt) / 1000));
  useEffect(() => {
    if (step !== "code" || waitS === 0) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [step, waitS]);

  // The same reply whatever the email: the server sends a code only if it may sign in.
  async function sendCode(address: string) {
    setPending(true);
    setError(null);
    const res = await post("/email-otp/send-verification-otp", { email: address, type: "sign-in" });
    setPending(false);
    if (!res?.ok) {
      setError(res?.status === 400 ? "That doesn’t look like an email address." : res?.status === 429 ? TOO_MANY : UNREACHABLE);
      return false;
    }
    const at = Date.now();
    setSentAt(at);
    setNow(at);
    writeSaved({ email: address, sentAt: at });
    return true;
  }

  async function onEmail(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    const address = email.trim().toLowerCase();
    setEmail(address);
    if (!address) return (setError("Enter your email."), emailInput.current?.focus());
    if (!looksLikeEmail(address)) return (setError("That doesn’t look like an email address."), emailInput.current?.select());
    if (!(await sendCode(address))) return emailInput.current?.select();
    setCode("");
    setResent(false);
    setStep("code");
  }

  async function onResend() {
    if (pending || waitS > 0) return;
    if (await sendCode(email)) {
      setResent(true);
      setCode("");
      codeInput.current?.focus();
    }
  }

  function differentEmail() {
    writeSaved(null);
    setError(null);
    setStep("email");
  }

  async function onCode(e?: FormEvent) {
    e?.preventDefault();
    if (pending) return;
    if (code.length !== CODE_LENGTH) return (setError(`The code is ${CODE_LENGTH} digits.`), codeInput.current?.focus());
    setPending(true);
    setError(null);
    const res = await post("/sign-in/email-otp", { email, otp: code });
    if (res?.ok) {
      writeSaved(null);
      return window.location.assign(next);
    }
    setPending(false);
    // Wrong, expired or used up all read alike, so the reply never tells an invited email from another.
    if (!res) return setError(UNREACHABLE);
    if (res.status === 429) return setError(TOO_MANY);
    setError(`That code didn’t work. Check it, or ${waitS > 0 ? "wait to send" : "send"} a new one.`);
  }

  // Typed, pasted or filled from the keyboard's suggestion: six digits sign in at once.
  useEffect(() => {
    if (step === "code" && code.length === CODE_LENGTH && !error) codeForm.current?.requestSubmit();
  }, [step, code, error]);

  useEffect(() => {
    if (step === "code") codeInput.current?.focus();
    else emailInput.current?.select();
    // Only on a change of step: a failed try selects its own field below.
  }, [step]);
  useEffect(() => {
    if (error && step === "code" && code.length === CODE_LENGTH) codeInput.current?.select();
  }, [error, step, code.length]);

  const message = (
    <p id="sign-in-message" role="alert" className="mt-2 min-h-5 font-sans text-sm text-pretty text-contrast">
      {error}
    </p>
  );
  const wordmark = <h1 className="text-[1.75rem] leading-none font-medium tracking-[-0.01em] italic">Marginalia</h1>;

  if (step === "email")
    return (
      <form onSubmit={onEmail} noValidate className="w-full max-w-[19rem]">
        {wordmark}
        <label htmlFor="email" className={`${label} mt-10`}>
          Email
        </label>
        <input
          ref={emailInput}
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="send"
          autoFocus
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setError(null);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "sign-in-message" : undefined}
          className={`${field} mt-1 font-sans text-[0.95rem]`}
        />
        {message}
        <button type="submit" disabled={pending} className={button}>
          {pending ? "Sending…" : "Send code"}
        </button>
      </form>
    );

  return (
    <form ref={codeForm} onSubmit={onCode} noValidate className="w-full max-w-[19rem]">
      {wordmark}
      <p id="code-sent" className="mt-10 text-[1.0625rem] leading-normal text-pretty text-ink-2">
        If <span className="wrap-anywhere text-ink">{email}</span> can sign in here, a code is on its way. It lasts 5 minutes.
      </p>
      <button type="button" onClick={differentEmail} className={`${quietLink} mt-2 text-left`}>
        Use a different email
      </button>
      <label htmlFor="code" className={`${label} mt-6`}>
        6-digit code
      </label>
      <input
        ref={codeInput}
        id="code"
        name="code"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={CODE_LENGTH}
        enterKeyHint="go"
        value={code}
        onChange={(e) => {
          setCode(e.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH));
          setError(null);
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "code-sent sign-in-message" : "code-sent"}
        className={`${field} mt-1 font-sans text-[1.0625rem] tracking-[0.3em] tabular-nums`}
      />
      {message}
      <button type="submit" disabled={pending} className={button}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
      <p className={`${quietText} mt-4`}>No email? Check spam, or send a new code.</p>
      {/* Holds the link's touch height while the countdown shows, so nothing moves when it ends. */}
      <div className="mt-1 flex min-h-11 items-center lg:min-h-5">
        {waitS > 0 ? (
          <p className={`${quietText} tabular-nums`}>
            {resent ? "Sent. You can send another" : "You can send a new code"} in {waitS}s
          </p>
        ) : (
          <button type="button" onClick={onResend} disabled={pending} className={quietLink}>
            Send a new code
          </button>
        )}
      </div>
      {/* Said once when a new code goes out, not with every tick of the countdown. */}
      <p aria-live="polite" className="sr-only">
        {resent ? "A new code is on its way." : ""}
      </p>
    </form>
  );
}
