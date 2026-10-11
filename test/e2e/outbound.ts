import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { blockedMessage } from "../outbound-guard.mjs";
import { perWorktree } from "../worktree";

// The e2e server's outbound guard writes each host it blocked here (OUTBOUND_GUARD_FILE).
export const E2E_BLOCKED = join(tmpdir(), `${perWorktree("marginalia-e2e-blocked", "-")}.txt`);

// Playwright's global setup: starts the run with nothing blocked, and fails it at the end if the server
// tried to call a guarded host, even where the app caught the error. Its log shows when.
export default async function outboundGuard() {
  await writeFile(E2E_BLOCKED, "");
  return async () => {
    const hosts = (await readFile(E2E_BLOCKED, "utf8")).split("\n").filter(Boolean);
    if (hosts.length) throw new Error(`The e2e server: ${blockedMessage(hosts)}`);
  };
}
