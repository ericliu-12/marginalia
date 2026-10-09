"use client";

import { useState } from "react";
import { quietLink } from "./quiet-link";

// Beside the wordmark, since the home-screen app has no address bar: Sign out. #67's account page
// replaces it.
export function ReaderLink({ className = "" }: { className?: string }) {
  const [state, setState] = useState<"idle" | "pending" | "failed">("idle");

  async function signOut() {
    setState("pending");
    const res = await fetch("/api/auth/sign-out", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => null);
    if (res?.ok) return window.location.assign("/sign-in");
    setState("failed");
  }
  return (
    <span className={`flex items-baseline gap-2 ${className}`}>
      <span role="status" className="font-sans text-[0.8rem] text-contrast">
        {state === "failed" ? "Couldn’t sign out." : ""}
      </span>
      <button type="button" onClick={signOut} disabled={state === "pending"} className={quietLink}>
        {state === "pending" ? "Signing out…" : state === "failed" ? "Try again" : "Sign out"}
      </button>
    </span>
  );
}
