"use server";

import { requireSession } from "@/lib/signed-in";

export type TurnstileResult = { passed: boolean; detail: string } | null;

// Spike for #59, removed by #63: Cloudflare's own check of the widget's token.
export async function verifyTurnstile(_previous: TurnstileResult, form: FormData): Promise<TurnstileResult> {
  await requireSession();
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY ?? "", response: String(form.get("token") ?? "") }),
  });
  const result = (await response.json()) as { success: boolean; "error-codes"?: string[] };
  return { passed: result.success, detail: result["error-codes"]?.join(", ") ?? "" };
}
