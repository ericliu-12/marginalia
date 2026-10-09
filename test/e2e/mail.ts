import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "@playwright/test";
import type { Mail } from "../../src/lib/mailer";
import { perWorktree } from "../worktree";

// The e2e server's mailer writes each email here (MAIL_OUTBOX_FILE) instead of sending it.
export const E2E_OUTBOX = join(tmpdir(), `${perWorktree("marginalia-e2e-outbox", "-")}.jsonl`);

export const clearOutbox = () => writeFile(E2E_OUTBOX, "");

export async function outbox(): Promise<Mail[]> {
  const text = await readFile(E2E_OUTBOX, "utf8").catch(() => "");
  return text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

// The code in the latest email to `to`. Sending isn't awaited by the server, so this waits for it.
export async function codeSentTo(to: string): Promise<string> {
  let code: string | undefined;
  await expect
    .poll(async () => (code = (await outbox()).findLast((m) => m.to === to)?.text.match(/\b\d{6}\b/)?.[0]), { message: `a code sent to ${to}` })
    .toBeTruthy();
  return code!;
}
