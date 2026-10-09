import { createHmac } from "node:crypto";
import { issueToken, SESSION_COOKIE } from "../../src/lib/session";

// The e2e server's gate. Not real secrets: the e2e server only ever runs on this machine.
export const E2E_PASSWORD = "e2e-password";
export const E2E_SESSION_SECRET = "e2e-session-secret-at-least-32-characters";

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

// Better Auth's session cookie, signed as Better Auth signs it (BETTER_AUTH_SECRET is the e2e secret).
const readerCookie = (reader: Reader) =>
  cookie("better-auth.session_token", encodeURIComponent(`${reader.token}.${createHmac("sha256", E2E_SESSION_SECRET).update(reader.token).digest("base64")}`));

// Past the password gate, with no Reader signed in: the sign-in specs start here.
export const pastTheGate = () => ({ cookies: [cookie(SESSION_COOKIE, issueToken(E2E_SESSION_SECRET))], origins: [] });

// A Reader signed in, but not past the password gate: the gate's own spec starts here.
export const behindTheGate = (reader: Reader = READER_A) => ({ cookies: [readerCookie(reader)], origins: [] });

// Every spec starts signed in as Reader A, past the gate; the sign-in specs clear it.
export const signedIn = (reader: Reader = READER_A) => ({ cookies: [...pastTheGate().cookies, readerCookie(reader)], origins: [] });
