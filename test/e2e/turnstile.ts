// Cloudflare's Turnstile test keys (https://developers.cloudflare.com/turnstile/troubleshooting/testing/).
// The e2e server's secret accepts any token, so the widget is real and only the site key decides.
export const TURNSTILE_PASSES = "1x00000000000000000000AA";
export const TURNSTILE_FAILS = "2x00000000000000000000AB";
// The token a test site key gives, for a request sent without the widget.
export const TURNSTILE_TEST_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
