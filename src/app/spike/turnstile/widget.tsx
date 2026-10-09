"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { verifyTurnstile } from "./actions";

type Turnstile = { render: (el: HTMLElement, options: { sitekey: string; callback: (token: string) => void; "error-callback": (code: string) => void }) => void };

export function TurnstileWidget({ siteKey }: { siteKey: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [token, setToken] = useState("");
  const [widgetError, setWidgetError] = useState("");
  const [result, action, pending] = useActionState(verifyTurnstile, null);

  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.onload = () =>
      (window as unknown as { turnstile: Turnstile }).turnstile.render(box.current!, {
        sitekey: siteKey,
        callback: setToken,
        "error-callback": (code) => setWidgetError(`The widget reported error ${code}.`),
      });
    script.onerror = () => setWidgetError("The widget’s script didn’t load.");
    document.head.append(script);
    return () => script.remove();
  }, [siteKey]);

  return (
    <form action={action} className="mt-6">
      <div ref={box} className="min-h-[65px]" />
      <input type="hidden" name="token" value={token} />
      <p className="mt-2 font-sans text-sm text-ink-2">{token ? "The widget gave a token." : "Waiting for the widget…"}</p>
      {widgetError && <p className="mt-2 font-sans text-sm text-contrast">{widgetError}</p>}
      <button
        type="submit"
        disabled={!token || pending}
        className="mt-4 min-h-11 w-full rounded-[3px] bg-ink px-4 font-sans text-sm font-medium text-paper hover:bg-ink-2 disabled:opacity-60"
      >
        {pending ? "Checking…" : "Check with Cloudflare"}
      </button>
      {result && (
        <p role="status" className="mt-2 font-sans text-sm">
          {result.passed ? "Passed: Cloudflare accepted the token." : `Failed${result.detail ? `: ${result.detail}` : ""}.`}
        </p>
      )}
    </form>
  );
}
