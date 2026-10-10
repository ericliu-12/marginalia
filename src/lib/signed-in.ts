import { headers } from "next/headers";
import { appAuth } from "./auth";

// The Reader signed in with Better Auth; null without one.
export async function signedInReader(): Promise<string | null> {
  return (await appAuth().api.getSession({ headers: await headers() }))?.user.id ?? null;
}

// Every Server Function and API route acts as the Reader this returns, and refuses a request without
// one: the proxy's matcher is not the only line.
export async function requireReader(): Promise<string> {
  const id = await signedInReader();
  if (!id) throw new Error("Not signed in.");
  return id;
}
