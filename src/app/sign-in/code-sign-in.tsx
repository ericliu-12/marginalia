"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { field } from "../book-panel";
import { quietLink } from "../quiet-link";
import { useTurnstile } from "./turnstile";

// One code a minute per email (#65), so "Send a new code" rests for as long after each send.
const RESEND_AFTER_S = 60;
const CODE_LENGTH = 6;
const CODE_LASTS_MS = 5 * 60 * 1000;

const button =
  "mt-3 min-h-11 w-full rounded-[3px] bg-ink px-4 font-sans text-sm font-medium text-paper transition-colors hover:bg-ink-2 disabled:cursor-default disabled:hover:bg-ink";
// Google's sign-in branding: its own "G", unaltered, on a neutral outlined button.
const googleButton =
  "flex min-h-11 w-full items-center justify-center gap-3 rounded-[3px] border border-edge bg-paper-2 px-4 font-sans text-sm font-medium text-ink transition-colors hover:bg-paper-3 disabled:cursor-default disabled:text-ink-3 disabled:hover:bg-paper-2";
const label = "block font-sans text-[0.8rem] font-medium text-ink-2";
const quietText = "font-sans text-[0.8rem] text-ink-3";

// Relative paths only: the page's own origin is the site's, and nothing absolute is built here.
async function post(path: string, body: object, headers: Record<string, string> = {}): Promise<Response | null> {
  try {
    return await fetch(`/api/auth${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  } catch {
    return null;
  }
}

const UNREACHABLE = "Couldn’t reach Marginalia. Try again.";
// Better Auth's rate limit, the same for every email.
const TOO_MANY = "Too many tries. Wait a minute, then try again.";
// The limits on asking for codes (#65) can last up to an hour, so the server's own wait is given.
const tooManyCodes = (res: Response) => {
  const minutes = Math.min(60, Math.ceil(Number(res.headers.get("x-retry-after") || 60) / 60));
  const wait = minutes === 60 ? "an hour" : minutes > 1 ? `${minutes} minutes` : "a minute";
  return `Too many codes requested. Try again in ${wait}.`;
};
// Turnstile failed, or its script was blocked. Not "reload": the iPhone home-screen app can't.
const NOT_CHECKED = "Couldn’t check this browser. Try again, or continue with Google.";
// Resend refused or couldn't be reached (#70): its limits can last the day, so Google is the way in.
const NOT_SENT = "Couldn’t send a code just now. Continue with Google instead, or try again later.";
const BAD_EMAIL = "That doesn’t look like an email address.";
// The same whatever went wrong, so it never tells an invited email from another.
const GOOGLE_FAILED = "That didn’t sign you in. Try again, or sign in with an email code below.";
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

function GoogleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" className="size-[18px] shrink-0">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

// `callbackURL` is where Google returns the Reader, already absolute on the site's own address.
export function CodeSignIn({
  next,
  callbackURL,
  googleFailed,
  accountDeleted,
  turnstileSiteKey,
  openSignup,
}: {
  next: string;
  callbackURL: string;
  googleFailed: boolean;
  accountDeleted: boolean;
  turnstileSiteKey: string;
  // Anyone may sign up, so every email is sent a code and the reply needn't hedge.
  openSignup: boolean;
}) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  // `error` is about what was typed, and marks its field; `notice` is about the request (the check, the
  // limits, the connection), and leaves the field alone. One line shows either.
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  // Who the latest code went to: asking again for the same email while it lasts goes back to it.
  const [sentTo, setSentTo] = useState("");
  const [sentAt, setSentAt] = useState(0);
  const [now, setNow] = useState(0);
  const [resent, setResent] = useState(false);
  const [googlePending, setGooglePending] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);
  // Arrived from deleting their account (#68).
  const [deleted, setDeleted] = useState(false);
  const emailInput = useRef<HTMLInputElement>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  const codeForm = useRef<HTMLFormElement>(null);
  const turnstile = useTurnstile(turnstileSiteKey);

  // Set after the page loads, so the alert is a change a screen reader announces; and taken out of the
  // address, so a reload doesn't show it again.
  useEffect(() => {
    if (!googleFailed && !accountDeleted) return;
    if (googleFailed) setGoogleError(GOOGLE_FAILED);
    else setDeleted(true);
    const url = new URL(window.location.href);
    url.searchParams.delete("error");
    url.searchParams.delete("deleted");
    window.history.replaceState(null, "", url);
  }, [googleFailed, accountDeleted]);

  // Back from Google without signing in (Done on the iPhone's sheet, or the back button), the page may be
  // restored as it was left, still opening Google.
  useEffect(() => {
    const restored = (e: PageTransitionEvent) => e.persisted && setGooglePending(false);
    window.addEventListener("pageshow", restored);
    return () => window.removeEventListener("pageshow", restored);
  }, []);

  useEffect(() => {
    const saved = readSaved();
    if (!saved) return;
    setEmail(saved.email);
    setSentTo(saved.email);
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
  async function sendCode(address: string, setBusy: (busy: boolean) => void) {
    setBusy(true);
    setError(null);
    setNotice(null);
    const token = await turnstile.token().catch(() => null);
    if (!token) {
      setBusy(false);
      setNotice(NOT_CHECKED);
      return false;
    }
    const res = await post("/email-otp/send-verification-otp", { email: address, type: "sign-in" }, { "x-captcha-response": token });
    turnstile.used();
    setBusy(false);
    if (!res?.ok) {
      if (res?.status === 400) setError(BAD_EMAIL);
      else setNotice(res?.status === 429 ? tooManyCodes(res) : res?.status === 403 ? NOT_CHECKED : res?.status === 503 ? NOT_SENT : UNREACHABLE);
      return false;
    }
    const at = Date.now();
    setSentTo(address);
    setSentAt(at);
    setNow(at);
    writeSaved({ email: address, sentAt: at });
    return true;
  }

  // Better Auth answers with Google's address; the page goes there, and Google sends the Reader back.
  async function onGoogle() {
    if (googlePending) return;
    setGooglePending(true);
    setGoogleError(null);
    const res = await post("/sign-in/social", { provider: "google", callbackURL });
    const url = res?.ok ? ((await res.json()) as { url?: string }).url : undefined;
    if (url) return window.location.assign(url);
    setGooglePending(false);
    setGoogleError(res ? GOOGLE_FAILED : UNREACHABLE);
  }

  async function onEmail(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setGoogleError(null);
    const address = email.trim().toLowerCase();
    setEmail(address);
    if (!address) return (setError("Enter your email."), emailInput.current?.focus());
    if (!looksLikeEmail(address)) return (setError(BAD_EMAIL), emailInput.current?.select());
    // Back after "Use a different email" with the same one: its code is still good, so no new one is asked for.
    if (address === sentTo && Date.now() - sentAt < CODE_LASTS_MS) {
      writeSaved({ email: address, sentAt });
      setNow(Date.now());
      setError(null);
      setNotice(null);
      return setStep("code");
    }
    if (!(await sendCode(address, setPending))) return;
    setCode("");
    setResent(false);
    setStep("code");
  }

  async function onResend() {
    if (pending || resending || waitS > 0) return;
    if (await sendCode(email, setResending)) {
      setResent(true);
      setCode("");
      codeInput.current?.focus();
    }
  }

  function differentEmail() {
    writeSaved(null);
    setError(null);
    setNotice(null);
    setStep("email");
  }

  async function onCode(e?: FormEvent) {
    e?.preventDefault();
    if (pending) return;
    if (code.length !== CODE_LENGTH) return (setError(`The code is ${CODE_LENGTH} digits.`), codeInput.current?.focus());
    setPending(true);
    setError(null);
    setNotice(null);
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
      {error ?? notice}
    </p>
  );
  const wordmark = <h1 className="text-[1.75rem] leading-none font-medium tracking-[-0.01em] italic">Marginalia</h1>;

  if (step === "email")
    return (
      <form onSubmit={onEmail} noValidate className="w-full max-w-[19rem]">
        {wordmark}
        <p role="status" className={`text-[1.0625rem] leading-normal text-pretty text-ink-2 ${deleted ? "mt-8" : ""}`}>
          {deleted ? "Your account has been deleted." : null}
        </p>
        <p id="google-message" role="alert" className="mt-8 min-h-5 font-sans text-sm text-pretty text-contrast">
          {googleError}
        </p>
        <button type="button" onClick={onGoogle} disabled={googlePending} aria-describedby={googleError ? "google-message" : undefined} className={`${googleButton} mt-2`}>
          <GoogleMark />
          {googlePending ? "Opening Google…" : "Continue with Google"}
        </button>
        <div className="mt-8 flex items-center gap-3" aria-hidden="true">
          <span className="h-px flex-1 bg-rule" />
          <span className={quietText}>or</span>
          <span className="h-px flex-1 bg-rule" />
        </div>
        <label htmlFor="email" className={`${label} mt-6`}>
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
            setNotice(null);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || notice ? "sign-in-message" : undefined}
          className={`${field} mt-1 font-sans text-[0.95rem]`}
        />
        {message}
        <div ref={turnstile.container} />
        <button type="submit" disabled={pending} className={button}>
          {pending ? "Sending…" : "Send code"}
        </button>
      </form>
    );

  return (
    <form ref={codeForm} onSubmit={onCode} noValidate className="w-full max-w-[19rem]">
      {wordmark}
      <p id="code-sent" className="mt-10 text-[1.0625rem] leading-normal text-pretty text-ink-2">
        {openSignup ? (
          <>
            A code is on its way to <span className="wrap-anywhere text-ink">{email}</span>. It lasts 5 minutes.
          </>
        ) : (
          <>
            If <span className="wrap-anywhere text-ink">{email}</span> can sign in here, a code is on its way. It lasts 5 minutes.
          </>
        )}
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
          setNotice(null);
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || notice ? "code-sent sign-in-message" : "code-sent"}
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
          <button type="button" onClick={onResend} disabled={pending || resending} className={quietLink}>
            {resending ? "Sending…" : "Send a new code"}
          </button>
        )}
      </div>
      <div ref={turnstile.container} />
      {/* Said once when a new code goes out, not with every tick of the countdown. */}
      <p aria-live="polite" className="sr-only">
        {resent ? "A new code is on its way." : ""}
      </p>
    </form>
  );
}
