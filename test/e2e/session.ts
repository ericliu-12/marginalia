import { createHmac } from "node:crypto";

// The e2e server's BETTER_AUTH_SECRET. Not a real secret: the e2e server only ever runs on this machine.
export const E2E_AUTH_SECRET = "e2e-auth-secret-at-least-32-characters";

// The e2e Readers, seeded with a session each before every test (see seedReaders). A is every spec's
// Reader; B is the second Reader, who must see none of A's.
export const READER_A = { id: "00000000-0000-4000-8000-00000000000a", email: "reader@marginalia.local", token: "e2e-reader-a-session" };
export const READER_B = { id: "00000000-0000-4000-8000-00000000000b", email: "second@marginalia.local", token: "e2e-reader-b-session" };
export type Reader = typeof READER_A;

const cookie = (name: string, value: string) => ({
  name,
  value,
  domain: "localhost",
  path: "/",
  expires: -1,
  httpOnly: true,
  secure: false,
  sameSite: "Lax" as const,
});

// Better Auth's session cookie, signed as Better Auth signs it (with the e2e BETTER_AUTH_SECRET).
const readerCookie = (reader: Reader) =>
  cookie("better-auth.session_token", encodeURIComponent(`${reader.token}.${createHmac("sha256", E2E_AUTH_SECRET).update(reader.token).digest("base64")}`));

// No Reader signed in: the sign-in specs start here.
export const signedOut = () => ({ cookies: [], origins: [] });

// Every spec starts signed in as Reader A; the sign-in specs clear it.
export const signedIn = (reader: Reader = READER_A) => ({ cookies: [readerCookie(reader)], origins: [] });
