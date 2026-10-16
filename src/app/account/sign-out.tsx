"use client";

import { useState } from "react";

export function SignOut() {
  const [state, setState] = useState<"idle" | "pending" | "failed">("idle");

  async function signOut() {
    setState("pending");
    const res = await fetch("/api/auth/sign-out", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => null);
    if (res?.ok) return window.location.assign("/sign-in");
    setState("failed");
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4">
      <button type="button" onClick={signOut} disabled={state === "pending"} className="inline-flex min-h-11 items-center text-[16px] text-ink-2 italic underline decoration-rule underline-offset-4 transition-colors duration-150 hover:text-ink hover:decoration-ink disabled:text-ink-3">
        {state === "pending" ? "Signing out…" : state === "failed" ? "Try again" : "Sign out"}
      </button>
      <p role="status" className="text-[15px] text-pretty text-contrast">
        {state === "failed" ? "Couldn’t sign out. Check your connection and try again." : ""}
      </p>
    </div>
  );
}
