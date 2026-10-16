import type { BrowserContext } from "@playwright/test";

// Cloudflare's Turnstile test keys (https://developers.cloudflare.com/turnstile/troubleshooting/testing/).
// The e2e server's secret accepts any token, so only the site key decides.
export const TURNSTILE_PASSES = "1x00000000000000000000AA";
export const TURNSTILE_FAILS = "2x00000000000000000000AB";
// The token a test site key gives, for a request sent without the widget.
export const TURNSTILE_TEST_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

// Turnstile's script, answered here rather than by Cloudflare, so a slow or unreachable Cloudflare can't
// fail a sign-in test. It behaves as the test keys do: the passing key gives the test token, the failing
// one calls the error callback, each a moment after render and again on reset. The server's siteverify
// is faked too (test/turnstile-fake.mjs).
const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js*";
const FAKE_TURNSTILE = `(() => {
  const widgets = new Map();
  let next = 0;
  const check = (id) => setTimeout(() => {
    const w = widgets.get(id);
    if (!w) return;
    if (w.sitekey === ${JSON.stringify(TURNSTILE_FAILS)}) w["error-callback"]?.();
    else w.callback?.(${JSON.stringify(TURNSTILE_TEST_TOKEN)});
  });
  window.turnstile = {
    render(el, options) {
      const id = String(++next);
      widgets.set(id, options);
      check(id);
      return id;
    },
    reset: check,
    remove: (id) => widgets.delete(id),
  };
})();`;

// Anything else of Cloudflare's is refused, so no test reaches it; the script's route, added last, is
// matched first.
export async function fakeTurnstile(context: BrowserContext) {
  await context.route("https://challenges.cloudflare.com/**", (route) => route.abort());
  await context.route(SCRIPT, (route) => route.fulfill({ contentType: "text/javascript", body: FAKE_TURNSTILE }));
}
