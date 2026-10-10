import { expect, test } from "@playwright/test";
import { seedLibrary } from "./database";
import { clearOutbox, codeSentTo } from "./mail";
import { READER_A, signedOut } from "./session";

// The library and the graph are a signed-in Reader's. The home-screen app has no address bar, so the
// wordmark carries Sign out, until #67's account page.

let address = 0;
test.beforeEach(async ({ page }) => {
  // Its own address per test, so Better Auth's limit on codes a minute doesn't reach the next test.
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `203.0.113.${100 + ++address}` });
  await seedLibrary();
  await clearOutbox();
});

test("Sign out ends the session, and the library then asks the Reader to sign in", async ({ page, context }) => {
  await page.goto("/");
  // A sign-out that fails says so, and can be tried again.
  await page.route("**/api/auth/sign-out", (route) => route.fulfill({ status: 500 }), { times: 1 });
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Couldn’t sign out." })).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  expect((await context.cookies()).map((c) => c.name)).not.toContain("better-auth.session_token");
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in$/);
});

test.describe("signed out", () => {
  test.use({ storageState: signedOut() });

  test("the graph goes to sign-in, and signing in comes back to the graph", async ({ page }) => {
    await page.goto("/graph");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fgraph$/);
    await page.getByLabel("Email").fill(READER_A.email);
    await page.getByRole("button", { name: "Send code" }).click();
    await page.getByLabel("Code").fill(await codeSentTo(READER_A.email));
    await expect(page).toHaveURL(/\/graph$/);
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  });
});

test.describe("on the phone", () => {
  test.use({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });

  test("the shelf's wordmark row carries Sign out", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Sign out" }).tap();
    await expect(page).toHaveURL(/\/sign-in$/);
  });
});
