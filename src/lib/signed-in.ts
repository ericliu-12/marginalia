import { cookies, headers } from "next/headers";
import { appAuth } from "./auth";
import { gate, SESSION_COOKIE, verifyToken } from "./session";

export async function hasSession(): Promise<boolean> {
  const g = gate();
  if (g.kind === "open") return true;
  return g.kind === "on" && verifyToken((await cookies()).get(SESSION_COOKIE)?.value, g.secret) !== null;
}

// The Reader signed in with Better Auth, apart from the password gate above; null without one.
export async function signedInReader(): Promise<string | null> {
  return (await appAuth().api.getSession({ headers: await headers() }))?.user.id ?? null;
}

// Every Server Function and API route acts as the Reader this returns, and refuses a request without
// one: the proxy's matcher is not the only line.
export async function requireReader(): Promise<string> {
  const id = (await hasSession()) ? await signedInReader() : null;
  if (!id) throw new Error("Not signed in.");
  return id;
}
