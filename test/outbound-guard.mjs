// Blocks fetch to the paid and real-user APIs, so a test that starts calling one fails with the host's
// name instead of spending money or emailing someone. Plain JavaScript so the e2e server can load it too
// (`node --import ./test/outbound-guard.mjs`, see playwright.config.ts); vitest loads it from test/setup.ts.
// It covers fetch only, which every client here uses (the Anthropic SDK, Voyage, Resend, Better Auth):
// not node:http or undici's own request.
import { appendFileSync } from "node:fs";

const GUARDED = [/^api\.anthropic\.com$/, /^api\.voyageai\.com$/, /^api\.resend\.com$/, /(^|\.)googleapis\.com$/, /^accounts\.google\.com$/];

// The e2e server also writes each blocked host here, so the run fails even when the app caught the error
// (test/e2e/outbound.ts).
const RECORD_FILE = process.env.OUTBOUND_GUARD_FILE;

const blocked = [];

// The host if `input` is a URL on a guarded host, otherwise null.
export function guardedHost(input) {
  let url;
  try {
    url = new URL(input instanceof Request ? input.url : String(input));
  } catch {
    return null;
  }
  return GUARDED.some((host) => host.test(url.hostname)) ? url.hostname : null;
}

// The hosts blocked since the last call, so a caller that swallowed the error can still fail.
export function takeBlockedRequests() {
  return blocked.splice(0);
}

export const blockedMessage = (hosts) =>
  `Blocked outbound request to ${[...new Set(hosts)].join(", ")}: tests must not call real APIs; pass a fake instead (test/outbound-guard.mjs)`;

const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const host = guardedHost(input);
  if (!host) return realFetch(input, init);
  blocked.push(host);
  if (RECORD_FILE) appendFileSync(RECORD_FILE, `${host}\n`);
  const error = new Error(blockedMessage([host]));
  console.error(error.message);
  return Promise.reject(error);
};
