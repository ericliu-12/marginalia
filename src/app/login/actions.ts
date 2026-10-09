"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { gate, passwordMatches, safeNext, sessionCookie } from "@/lib/session";
import { clientAddress, signInLimit } from "@/lib/sign-in-limit";

export type SignInState = { error: "wrong" } | { error: "limited"; minutes: number } | { error: "unconfigured" } | null;

export async function signInAction(_previous: SignInState, form: FormData): Promise<SignInState> {
  const g = gate();
  if (g.kind !== "on") return { error: "unconfigured" };
  const address = clientAddress(await headers());
  const wait = signInLimit.retryAfterMs(address);
  if (wait > 0) return { error: "limited", minutes: Math.ceil(wait / 60_000) };
  if (!passwordMatches(String(form.get("password") ?? ""), g.password)) {
    signInLimit.failed(address);
    return { error: "wrong" };
  }
  signInLimit.succeeded(address);
  (await cookies()).set(sessionCookie(g.secret));
  redirect(safeNext(form.get("next")));
}
