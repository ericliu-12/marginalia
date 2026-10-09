import { issueToken, SESSION_COOKIE } from "../../src/lib/session";

// The e2e server's gate. Not real secrets: the e2e server only ever runs on this machine.
export const E2E_PASSWORD = "e2e-password";
export const E2E_SESSION_SECRET = "e2e-session-secret-at-least-32-characters";

// Every spec starts signed in, as the reader would be; the sign-in spec clears it.
export const signedIn = () => ({
  cookies: [
    {
      name: SESSION_COOKIE,
      value: issueToken(E2E_SESSION_SECRET),
      domain: "localhost",
      path: "/",
      expires: -1,
      httpOnly: true,
      secure: false,
      sameSite: "Lax" as const,
    },
  ],
  origins: [],
});
