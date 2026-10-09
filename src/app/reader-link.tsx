"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { quietLink } from "./quiet-link";

// Beside the wordmark, since the home-screen app has no address bar: Sign in without a Reader session,
// Sign out with one. #67's account page replaces it.
export function ReaderLink({ signedIn, className = "" }: { signedIn: boolean; className?: string }) {
  const pathname = usePathname();
  const [pending, setPending] = useState(false);

  if (!signedIn)
    return (
      <Link href={pathname === "/" ? "/sign-in" : `/sign-in?next=${encodeURIComponent(pathname)}`} className={`${quietLink} ${className}`}>
        Sign in
      </Link>
    );

  async function signOut() {
    setPending(true);
    const res = await fetch("/api/auth/sign-out", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => null);
    if (res?.ok) return window.location.assign("/sign-in");
    setPending(false);
  }
  return (
    <button type="button" onClick={signOut} disabled={pending} className={`${quietLink} ${className}`}>
      Sign out
    </button>
  );
}
