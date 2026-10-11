import { expect, test, type Page } from "@playwright/test";
import { seedLibrary } from "./database";
import { clearOutbox, codeSentTo, outbox, SEND_TIMEOUT } from "./mail";
import { READER_A, signedOut } from "./session";
import { TURNSTILE_FAILS, TURNSTILE_PASSES, TURNSTILE_TEST_TOKEN } from "./turnstile";
import { E2E_PORT } from "../worktree";

// Signing in with an email code (#60). The server's mailer writes to a file
// the test reads the code from.

test.use({ storageState: signedOut() });

const SITE = `http://localhost:${E2E_PORT}`;
const SESSION_COOKIE = "better-auth.session_token";

let address = 0;
test.beforeEach(async ({ page }) => {
  // Its own address per test, so Better Auth's limit on codes a minute doesn't reach the next test.
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `203.0.113.${++address}` });
  await seedLibrary();
  await clearOutbox();
});

const sendCodeTo = async (page: Page, email: string) => {
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByRole("button", { name: "Sending…" })).toHaveCount(0, { timeout: SEND_TIMEOUT });
};
const reply = (page: Page) => page.getByText(/can sign in here, a code is on its way/);

test("a Reader signs in with the code emailed to them and returns to the page they wanted", async ({ page, context }) => {
  await page.goto("/sign-in?next=%2Fgraph");
  await sendCodeTo(page, ` ${READER_A.email.toUpperCase()} `);
  await expect(reply(page)).toHaveText(`If ${READER_A.email} can sign in here, a code is on its way. It lasts 5 minutes.`);
  await expect(page.getByLabel("Code")).toHaveAttribute("autocomplete", "one-time-code");
  await expect(page.getByText(/^You can send a new code in \d+s$/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Send a new code" })).toHaveCount(0);

  // Back from Mail after the home-screen app reloaded: still at the code, for the same email.
  await page.reload();
  await expect(reply(page)).toContainText(READER_A.email);

  // Six digits sign in by themselves, as when the phone fills the code in.
  await page.getByLabel("Code").fill(await codeSentTo(READER_A.email));
  await expect(page).toHaveURL(/\/graph$/);
  expect((await context.cookies()).map((c) => c.name)).toContain(SESSION_COOKIE);

  await page.goto("/sign-in");
  await expect(page).toHaveURL(/\/$/);
});

test("an email that may not sign in gets the same reply, and no email is sent to it", async ({ page }) => {
  await page.goto("/sign-in");
  await sendCodeTo(page, "stranger@example.com");
  await expect(reply(page)).toHaveText("If stranger@example.com can sign in here, a code is on its way. It lasts 5 minutes.");

  // A Reader's code sent after it is the only email in the outbox.
  await page.getByRole("button", { name: "Use a different email" }).click();
  await expect(page.getByLabel("Email")).toHaveValue("stranger@example.com");
  await sendCodeTo(page, READER_A.email);
  await codeSentTo(READER_A.email);
  expect((await outbox()).map((m) => m.to)).toEqual([READER_A.email]);
});

test("a wrong code says so and is selected to be typed over", async ({ page }) => {
  await page.goto("/sign-in");
  await sendCodeTo(page, READER_A.email);
  const code = await codeSentTo(READER_A.email);
  await page.getByLabel("Code").fill(code === "000000" ? "111111" : "000000");
  await expect(page.locator("#sign-in-message")).toHaveText("That code didn’t work. Check it, or wait to send a new one.");
  await expect(page.getByLabel("Code")).toBeFocused();
  await page.getByLabel("Code").fill(code);
  await expect(page).toHaveURL(/\/$/);
});

// Abuse protection (#65). The server's Turnstile key always passes; for the failing key, the sign-in page
// reaches the browser with Cloudflare's always-failing site key in its place.
test("with Turnstile's failing key, the form says so and sends nothing", async ({ page }) => {
  await page.route("/sign-in", async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, body: (await res.text()).replaceAll(TURNSTILE_PASSES, TURNSTILE_FAILS) });
  });
  await page.goto("/sign-in");
  await sendCodeTo(page, READER_A.email);
  await expect(page.locator("#sign-in-message")).toHaveText("Couldn’t check this browser. Try again, or continue with Google.");
  await expect(reply(page)).toHaveCount(0);
  expect(await outbox()).toEqual([]);
});

// The server's reply when Resend refuses in open mode (#70); the e2e server is allowlist-only, so it's faked.
test("when no code could be sent, the form says so and points to Google", async ({ page }) => {
  await page.route("/api/auth/email-otp/send-verification-otp", (route) =>
    route.fulfill({ status: 503, json: { code: "CODE_NOT_SENT", message: "Could not send a sign-in code." } }),
  );
  await page.goto("/sign-in");
  await sendCodeTo(page, READER_A.email);
  await expect(page.locator("#sign-in-message")).toHaveText("Couldn’t send a code just now. Continue with Google instead, or try again later.");
  await expect(reply(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeEnabled();
});

test("the same email again goes back to its code, and a second code for it within a minute is refused, saying how long to wait", async ({ page, context }) => {
  await page.goto("/sign-in");
  await sendCodeTo(page, READER_A.email);
  await expect(reply(page)).toBeVisible();
  await page.getByRole("button", { name: "Use a different email" }).click();
  await sendCodeTo(page, READER_A.email);
  await expect(reply(page)).toBeVisible();

  // Another tab knows nothing of that code, so it asks for one, and is refused.
  const other = await context.newPage();
  await other.goto("/sign-in");
  await sendCodeTo(other, READER_A.email);
  await expect(other.locator("#sign-in-message")).toHaveText("Too many codes requested. Try again in a minute.");
  await expect(other.getByLabel("Email")).not.toHaveAttribute("aria-invalid");
  expect((await outbox()).map((m) => m.to)).toEqual([READER_A.email]);
});

// As behind Railway's proxy: the server is reached at one address while Host and the forwarded headers
// name another. Anything absolute built from the request would land on 127.0.0.1 or the Host, not the site.
test.describe("with a Host and forwarded headers that don't match the server's address", () => {
  const headers = (host: string) => ({ host, "x-forwarded-host": host, "x-forwarded-proto": "https", "x-forwarded-for": "198.51.100.7" });
  const direct = (path: string) => `http://127.0.0.1:${E2E_PORT}${path}`;
  const absoluteOffSite = (location: string | undefined) => Boolean(location && /^[a-z]+:/i.test(location) && !location.startsWith(`${SITE}/`));

  test("the Railway host is sent to BETTER_AUTH_URL with a 308, path and query kept", async ({ request }) => {
    for (const path of ["/", "/graph?book=1", "/sign-in"]) {
      const res = await request.get(direct(path), { headers: headers("web-production-fd25da.up.railway.app"), maxRedirects: 0 });
      expect(res.status(), path).toBe(308);
      expect(res.headers().location, path).toBe(`${SITE}${path}`);
    }
  });

  test("no redirect or cookie is built from the request's address", async ({ playwright }) => {
    const visitor = await playwright.request.newContext({ extraHTTPHeaders: headers("inkmarginalia.example") });
    const toSignIn = await visitor.get(direct("/graph"), { maxRedirects: 0 });
    expect(toSignIn.status()).toBe(307);
    expect(toSignIn.headers().location).toBe(`${SITE}/sign-in?next=%2Fgraph`);
    await visitor.dispose();

    const browser = await playwright.request.newContext();
    const send = await browser.post(direct("/api/auth/email-otp/send-verification-otp"), {
      headers: { ...headers("inkmarginalia.example"), origin: SITE, "x-captcha-response": TURNSTILE_TEST_TOKEN },
      data: { email: READER_A.email, type: "sign-in" },
    });
    expect(send.status()).toBe(200);
    const signIn = await browser.post(direct("/api/auth/sign-in/email-otp"), {
      headers: { ...headers("inkmarginalia.example"), origin: SITE },
      data: { email: READER_A.email, otp: await codeSentTo(READER_A.email) },
    });
    expect(signIn.status()).toBe(200);
    expect(absoluteOffSite(signIn.headers().location)).toBe(false);
    const cookie = signIn.headersArray().find((h) => h.name.toLowerCase() === "set-cookie" && h.value.startsWith(SESSION_COOKIE));
    expect(cookie?.value).toBeDefined();
    expect(cookie!.value).not.toMatch(/domain=/i);

    // Google is told to return to the site, and a return it can't match goes back to the site's sign-in page.
    const google = await browser.post(direct("/api/auth/sign-in/social"), {
      headers: { ...headers("inkmarginalia.example"), origin: SITE },
      data: { provider: "google", callbackURL: `${SITE}/` },
    });
    expect(new URL((await google.json()).url).searchParams.get("redirect_uri")).toBe(`${SITE}/api/auth/callback/google`);
    const back = await browser.get(direct("/api/auth/callback/google?code=code&state=forged"), { headers: headers("inkmarginalia.example"), maxRedirects: 0 });
    expect(back.headers().location).toMatch(new RegExp(`^${SITE}/sign-in\\?error=`));
    await browser.dispose();
  });
});
