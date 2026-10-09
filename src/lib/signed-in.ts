import { cookies, headers } from "next/headers";
import { appAuth } from "./auth";
import { gate, SESSION_COOKIE, verifyToken } from "./session";

export async function hasSession(): Promise<boolean> {
  const g = gate();
  if (g.kind === "open") return true;
  return g.kind === "on" && verifyToken((await cookies()).get(SESSION_COOKIE)?.value, g.secret) !== null;
}

// Every Server Function checks for itself: the proxy's matcher is not the only line.
export async function requireSession() {
  if (!(await hasSession())) throw new Error("Not signed in.");
}

// Whether a Reader is signed in with Better Auth, apart from the password gate above.
export async function hasReaderSession(): Promise<boolean> {
  return Boolean(await appAuth().api.getSession({ headers: await headers() }));
}
