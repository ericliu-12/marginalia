import { expect, test } from "@playwright/test";
import { SEEDED_USER_EMAIL } from "../../src/db/seed";
import { seedLibrary } from "./database";
import { clearOutbox, codeSentTo } from "./mail";

// The home-screen app has no address bar, so the wordmark carries the way to /sign-in, and out again,
// until #67's account page. Past the password gate, as every spec starts.

let address = 0;
test.beforeEach(async ({ page }) => {
  // Its own address per test, so Better Auth's limit on codes a minute doesn't reach the next test.
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `203.0.113.${100 + ++address}` });
  await seedLibrary();
  await clearOutbox();
});

test("signed out, the library offers Sign in; signed in, Sign out, which ends the session", async ({ page, context }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);
  await page.getByRole("link", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);

  await page.getByLabel("Email").fill(SEEDED_USER_EMAIL);
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("Code").fill(await codeSentTo(SEEDED_USER_EMAIL));
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("link", { name: "Sign in" })).toHaveCount(0);

  // A sign-out that fails says so, and can be tried again.
  await page.route("**/api/auth/sign-out", (route) => route.fulfill({ status: 500 }), { times: 1 });
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Couldn’t sign out." })).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  expect((await context.cookies()).map((c) => c.name)).not.toContain("better-auth.session_token");
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
});

test("the graph's Sign in comes back to the graph", async ({ page }) => {
  await page.goto("/graph");
  await page.getByRole("link", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fgraph$/);
});

test.describe("on the phone", () => {
  test.use({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });

  test("the shelf's wordmark row carries Sign in", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Sign in" }).tap();
    await expect(page).toHaveURL(/\/sign-in$/);
  });
});
