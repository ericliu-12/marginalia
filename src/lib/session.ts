import { createHash, createHmac, timingSafeEqual } from "node:crypto";

// The private deploy's gate: one password (APP_PASSWORD) and a signed cookie that says it was given.
// Changing SESSION_SECRET signs every device out.
export const SESSION_COOKIE = "marginalia_session";
// Long-lived and renewed as the app is used, so the iPhone home-screen app (which keeps its own
// cookies, apart from Safari's) stays signed in. Set by the server, not by script, so Safari's
// seven-day cap on script-written storage doesn't apply.
const MAX_AGE_SECONDS = 90 * 24 * 60 * 60;
const RENEW_AFTER_SECONDS = 24 * 60 * 60;
const MIN_SECRET_LENGTH = 32;

// `open` only in development and tests with no password set; a production server missing either
// value, or with a short secret, is `closed` and lets no one in.
export type Gate = { kind: "open" } | { kind: "closed" } | { kind: "on"; password: string; secret: string };

export function gate(env: NodeJS.ProcessEnv = process.env): Gate {
  const password = env.APP_PASSWORD;
  const secret = env.SESSION_SECRET;
  if (password && secret && secret.length >= MIN_SECRET_LENGTH) return { kind: "on", password, secret };
  if (!password && !secret && env.NODE_ENV !== "production") return { kind: "open" };
  return { kind: "closed" };
}

const sign = (issuedAt: string, secret: string) => createHmac("sha256", secret).update(issuedAt).digest("base64url");
const same = (a: string, b: string) => {
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(a), digest(b));
};

export const passwordMatches = (given: string, password: string) => same(given, password);

export function issueToken(secret: string, now = Date.now()): string {
  const issuedAt = String(Math.floor(now / 1000));
  return `${issuedAt}.${sign(issuedAt, secret)}`;
}

// When the token was issued (seconds), or null when it is missing, forged or expired.
export function verifyToken(token: string | undefined, secret: string, now = Date.now()): number | null {
  const [issuedAt, mac] = token?.split(".") ?? [];
  if (!issuedAt || !mac || !same(mac, sign(issuedAt, secret))) return null;
  const issued = Number(issuedAt);
  const age = now / 1000 - issued;
  return Number.isInteger(issued) && age >= 0 && age < MAX_AGE_SECONDS ? issued : null;
}

export const shouldRenew = (issued: number, now = Date.now()) => now / 1000 - issued > RENEW_AFTER_SECONDS;

export const sessionCookie = (secret: string) => ({
  name: SESSION_COOKIE,
  value: issueToken(secret),
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: MAX_AGE_SECONDS,
});

// Only a path on this site: never `//host` or `/\host`, which browsers treat as another origin.
export function safeNext(next: unknown): string {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}
