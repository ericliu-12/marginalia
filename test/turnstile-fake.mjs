// Cloudflare's siteverify, answered in the e2e server itself (`node --import ./test/turnstile-fake.mjs`, see
// playwright.config.ts), so asking for a sign-in code never waits on Cloudflare's network: when that was
// slow or unreachable, Better Auth's captcha check failed with a 500 and every sign-in test in that
// window found no code. It answers as the e2e secret, Cloudflare's always-passing test secret, would:
// every token passes. The widget's script is faked in the browser (test/e2e/turnstile.ts).
const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  if (url !== SITEVERIFY) return realFetch(input, init);
  return Promise.resolve(Response.json({ success: true, "error-codes": [], hostname: "localhost", challenge_ts: new Date().toISOString() }));
};
