// The address Railway's edge saw. The edge replaces any X-Forwarded-For a client sends and puts the
// client first; later entries are Railway's own hops (the last one, read at first, was a Railway
// address, not the client's). X-Real-IP can carry a CDN's address instead, so it is only the fallback.
// From the password gate's sign-in limit (#43); Better Auth's rate limits use it too (#65).
export function clientAddress(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip") || "unknown";
}
