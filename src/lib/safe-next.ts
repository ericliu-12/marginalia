// Where sign-in returns to: only a path on this site, never `//host` or `/\host`, which browsers treat
// as another origin.
export function safeNext(next: unknown): string {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}
