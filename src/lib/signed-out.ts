// Where sign-in returns to: only a path on this site, never `//host` or `/\host`, which browsers treat
// as another origin.
export function safeNext(next: unknown): string {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}

// Sign-in, coming back to `from` (a path and query) after; the library needs no `next`.
export function signInPath(from: string): string {
  return from === "/" ? "/sign-in" : `/sign-in?${new URLSearchParams({ next: from })}`;
}

// The proxy's whole answer to a Server Function or API call without a live session (a 401 in plain
// text). Next's client hands that text to the Server Function's caller as the error's message.
export const SIGNED_OUT = "Signed out.";
