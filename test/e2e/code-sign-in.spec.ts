import { expect, test, type Page } from "@playwright/test";
import { SEEDED_USER_EMAIL } from "../../src/db/seed";
import { SESSION_COOKIE as GATE_COOKIE, issueToken } from "../../src/lib/session";
import { seedLibrary } from "./database";
import { clearOutbox, codeSentTo, outbox } from "./mail";
import { E2E_SESSION_SECRET } from "./session";

// Signing in with an email code (#60), behind the password gate (the default storage state passes it).
// The server's mailer writes to a file the test reads the code from.

const SITE = "http://localhost:3100";
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
};
const reply = (page: Page) => page.getByText(/can sign in here, a code is on its way/);

test("a Reader signs in with the code emailed to them and returns to the page they wanted", async ({ page, context }) => {
  await page.goto("/sign-in?next=%2Fgraph");
  await sendCodeTo(page, ` ${SEEDED_USER_EMAIL.toUpperCase()} `);
  await expect(reply(page)).toHaveText(`If ${SEEDED_USER_EMAIL} can sign in here, a code is on its way. It lasts 5 minutes.`);
  await expect(page.getByLabel("Code")).toHaveAttribute("autocomplete", "one-time-code");
  await expect(page.getByText(/^You can send a new code in \d+s$/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Send a new code" })).toHaveCount(0);

  // Back from Mail after the home-screen app reloaded: still at the code, for the same email.
  await page.reload();
  await expect(reply(page)).toContainText(SEEDED_USER_EMAIL);

  // Six digits sign in by themselves, as when the phone fills the code in.
  await page.getByLabel("Code").fill(await codeSentTo(SEEDED_USER_EMAIL));
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
  await sendCodeTo(page, SEEDED_USER_EMAIL);
  await codeSentTo(SEEDED_USER_EMAIL);
  expect((await outbox()).map((m) => m.to)).toEqual([SEEDED_USER_EMAIL]);
});

test("a wrong code says so and is selected to be typed over", async ({ page }) => {
  await page.goto("/sign-in");
  await sendCodeTo(page, SEEDED_USER_EMAIL);
  const code = await codeSentTo(SEEDED_USER_EMAIL);
  await page.getByLabel("Code").fill(code === "000000" ? "111111" : "000000");
  await expect(page.locator("#sign-in-message")).toHaveText("That code didn’t work. Check it, or wait to send a new one.");
  await expect(page.getByLabel("Code")).toBeFocused();
  await page.getByLabel("Code").fill(code);
  await expect(page).toHaveURL(/\/$/);
});

// As behind Railway's proxy: the server is reached at one address while Host and the forwarded headers
// name another. Anything absolute built from the request would land on 127.0.0.1 or the Host, not the site.
test.describe("with a Host and forwarded headers that don't match the server's address", () => {
  const headers = (host: string) => ({ host, "x-forwarded-host": host, "x-forwarded-proto": "https", "x-forwarded-for": "198.51.100.7" });
  const direct = (path: string) => `http://127.0.0.1:3100${path}`;
  const absoluteOffSite = (location: string | undefined) => Boolean(location && /^[a-z]+:/i.test(location) && !location.startsWith(`${SITE}/`));

  test("the Railway host is sent to BETTER_AUTH_URL with a 308, path and query kept", async ({ request }) => {
    for (const path of ["/", "/graph?book=1", "/sign-in", "/login"]) {
      const res = await request.get(direct(path), { headers: headers("web-production-fd25da.up.railway.app"), maxRedirects: 0 });
      expect(res.status(), path).toBe(308);
      expect(res.headers().location, path).toBe(`${SITE}${path}`);
    }
  });

  test("no redirect or cookie is built from the request's address", async ({ playwright }) => {
    const signedOut = await playwright.request.newContext({ extraHTTPHeaders: headers("inkmarginalia.example") });
    const gate = await signedOut.get(direct("/graph"), { maxRedirects: 0 });
    expect(gate.status()).toBe(307);
    expect(absoluteOffSite(gate.headers().location), gate.headers().location).toBe(false);
    await signedOut.dispose();

    // Past the password gate, as a browser on the site would be.
    const signedIn = await playwright.request.newContext({ extraHTTPHeaders: { cookie: `${GATE_COOKIE}=${issueToken(E2E_SESSION_SECRET)}` } });
    const send = await signedIn.post(direct("/api/auth/email-otp/send-verification-otp"), {
      headers: { ...headers("inkmarginalia.example"), origin: SITE },
      data: { email: SEEDED_USER_EMAIL, type: "sign-in" },
    });
    expect(send.status()).toBe(200);
    const signIn = await signedIn.post(direct("/api/auth/sign-in/email-otp"), {
      headers: { ...headers("inkmarginalia.example"), origin: SITE },
      data: { email: SEEDED_USER_EMAIL, otp: await codeSentTo(SEEDED_USER_EMAIL) },
    });
    expect(signIn.status()).toBe(200);
    expect(absoluteOffSite(signIn.headers().location)).toBe(false);
    const cookie = signIn.headersArray().find((h) => h.name.toLowerCase() === "set-cookie" && h.value.startsWith(SESSION_COOKIE));
    expect(cookie?.value).toBeDefined();
    expect(cookie!.value).not.toMatch(/domain=/i);
    await signedIn.dispose();
  });
});
