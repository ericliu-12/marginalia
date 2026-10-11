// Blocks fetch to the paid and real-user APIs, so a test that starts calling one fails with the host's
// name instead of spending money or emailing someone. Plain JavaScript so the e2e server can load it too
// (`node --import ./test/outbound-guard.mjs`, see playwright.config.ts); vitest loads it from test/setup.ts.
const GUARDED = [/^api\.anthropic\.com$/, /^api\.voyageai\.com$/, /^api\.resend\.com$/, /(^|\.)googleapis\.com$/, /^accounts\.google\.com$/];

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

const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const host = guardedHost(input);
  if (!host) return realFetch(input, init);
  blocked.push(host);
  const error = new Error(`Blocked outbound request to ${host}: tests must not call real APIs; pass a fake instead (test/outbound-guard.mjs)`);
  console.error(error.message);
  return Promise.reject(error);
};
