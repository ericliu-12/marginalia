import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { addNoteThatGaveUp, seedLibrary } from "./database";
import { clearOutbox, codeSentTo } from "./mail";
import { READER_A, signedOut } from "./session";

// The account page (#67), reached from Account beside the wordmark, since the home-screen app has no
// address bar: the Reader's export, and Sign out.

let address = 0;
test.beforeEach(async ({ page }) => {
  // Its own address per test, so Better Auth's limit on codes a minute doesn't reach the next test.
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `203.0.113.${100 + ++address}` });
  await seedLibrary();
  await clearOutbox();
});

test("Account opens the account page, whose export downloads the Reader's Notes as JSON", async ({ page }) => {
  await addNoteThatGaveUp("Stoner", "Quiet failure, kept quietly.");
  await page.goto("/");
  await page.getByRole("link", { name: "Account" }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole("heading", { name: "Account", level: 1 })).toBeVisible();
  await expect(page.getByText(`Signed in as ${READER_A.email}`)).toBeVisible();
  await expect(page.getByRole("contentinfo").getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
  await expect(page.getByRole("contentinfo").getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");

  // An export that fails says so, and can be tried again.
  await page.route("**/api/export", (route) => route.fulfill({ status: 500 }), { times: 1 });
  await page.getByRole("link", { name: "Download export" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Couldn’t prepare your export." })).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Try again" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^marginalia-export-\d{4}-\d{2}-\d{2}\.json$/);
  const data = JSON.parse(await readFile((await download.path())!, "utf8"));
  const stoner = data.libraryEntries.find((e: { book: { title: string } }) => e.book.title === "Stoner");
  expect(stoner.notes.map((n: { text: string }) => n.text)).toEqual(["Quiet failure, kept quietly."]);
});

test("Sign out ends the session, and the library then asks the Reader to sign in", async ({ page, context }) => {
  await page.goto("/account");
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

test("the graph's wordmark row carries Account", async ({ page }) => {
  await page.goto("/graph");
  await page.getByRole("link", { name: "Account" }).click();
  await expect(page).toHaveURL(/\/account$/);
});

test.describe("signed out", () => {
  test.use({ storageState: signedOut() });

  test("the account page goes to sign-in and comes back; the export is refused", async ({ page, request }) => {
    expect((await request.get("/api/export")).status()).toBe(401);
    await page.goto("/account");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Faccount$/);
    await page.getByLabel("Email").fill(READER_A.email);
    await page.getByRole("button", { name: "Send code" }).click();
    await page.getByLabel("Code").fill(await codeSentTo(READER_A.email));
    await expect(page).toHaveURL(/\/account$/);
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  });
});

test.describe("on the phone", () => {
  test.use({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });

  test("the shelf's wordmark row carries Account, and Sign out works from the page", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Account" }).tap();
    await expect(page).toHaveURL(/\/account$/);
    await page.getByRole("button", { name: "Sign out" }).tap();
    await expect(page).toHaveURL(/\/sign-in$/);
  });
});
