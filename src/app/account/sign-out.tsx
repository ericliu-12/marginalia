"use client";

import { useState } from "react";
import { quietLink } from "../quiet-link";

export function SignOut() {
  const [state, setState] = useState<"idle" | "pending" | "failed">("idle");

  async function signOut() {
    setState("pending");
    const res = await fetch("/api/auth/sign-out", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => null);
    if (res?.ok) return window.location.assign("/sign-in");
    setState("failed");
  }
  return (
    <div className="mt-3 flex flex-wrap items-baseline gap-x-4">
      <button type="button" onClick={signOut} disabled={state === "pending"} className={`${quietLink} inline-flex items-center`}>
        {state === "pending" ? "Signing out…" : state === "failed" ? "Try again" : "Sign out"}
      </button>
      <p role="status" className="font-sans text-[0.8rem] text-contrast">
        {state === "failed" ? "Couldn’t sign out. Check your connection and try again." : ""}
      </p>
    </div>
  );
}
