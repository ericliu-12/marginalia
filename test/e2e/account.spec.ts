import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { addNoteThatGaveUp, addSession, inviteEmail, isInvited, seedLibrary, signedInHoursAgo } from "./database";
import { clearOutbox, codeSentTo } from "./mail";
import { READER_A, READER_B, signedIn, signedOut } from "./session";

// The account page (#67), reached from Account beside the wordmark, since the home-screen app has no
// address bar: the Reader's export, Sign out, and Delete your account (#68).

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

test("Delete your account, once delete is typed, signs the Reader out everywhere; signing up again starts an empty library", async ({ page, browser }) => {
  await inviteEmail(READER_A.email);
  // A's phone, signed in on its own session.
  const phone = { ...READER_A, token: "e2e-reader-a-phone" };
  await addSession(phone);
  const other = await (await browser.newContext({ storageState: signedIn(phone) })).newPage();
  await other.goto("/account");
  await expect(other.getByText(`Signed in as ${READER_A.email}`)).toBeVisible();

  await page.goto("/account");
  const del = page.getByRole("region", { name: "Delete your account" });
  const button = del.getByRole("button", { name: "Delete account" });
  await expect(button).toBeDisabled();
  await del.getByLabel("Type delete to confirm").fill("delet");
  await expect(button).toBeDisabled();
  await del.getByLabel("Type delete to confirm").fill("delete");

  // A deletion that fails says so, deletes nothing, and can be tried again.
  await page.route("**/api/auth/delete-user", (route) => route.fulfill({ status: 500 }), { times: 1 });
  await button.click();
  await expect(del.getByRole("status")).toHaveText("Couldn’t delete your account. Check your connection and try again.");
  await del.getByRole("button", { name: "Try again" }).click();

  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByText("Your account has been deleted.")).toBeVisible();
  expect(await isInvited(READER_A.email)).toBe(false);
  await other.goto("/");
  await expect(other).toHaveURL(/\/sign-in$/);

  // Invited again, A signs in to an empty library.
  await inviteEmail(READER_A.email);
  await page.getByLabel("Email").fill(READER_A.email);
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("Code").fill(await codeSentTo(READER_A.email));
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("link", { name: "Account" })).toBeVisible();
  for (const title of ["Stoner", "Beloved"]) await expect(page.getByText(title)).toHaveCount(0);

  // B's library is as it was.
  const b = await (await browser.newContext({ storageState: signedIn(READER_B) })).newPage();
  await b.goto("/account");
  await expect(b.getByText(`Signed in as ${READER_B.email}`)).toBeVisible();
});

test("a Reader signed in more than a day ago signs in again before deleting, and comes back to it", async ({ page }) => {
  await signedInHoursAgo(READER_A, 25);
  await page.goto("/account");
  const del = page.getByRole("region", { name: "Delete your account" });
  await expect(del.getByText(/^To delete your account, sign in again first: .* This signs you out here, then brings you back to this page\.$/)).toBeVisible();
  await expect(del.getByLabel("Type delete to confirm")).toHaveCount(0);
  await del.getByRole("button", { name: "Sign in again" }).click();
  await expect(page).toHaveURL(/\/sign-in\?next=%2Faccount%23delete-account$/);
  await page.getByLabel("Email").fill(READER_A.email);
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("Code").fill(await codeSentTo(READER_A.email));
  await expect(page).toHaveURL(/\/account#delete-account$/);
  await expect(del.getByLabel("Type delete to confirm")).toBeVisible();
});

test("a page left open past the day asks the Reader to sign in again when they delete", async ({ page }) => {
  await page.goto("/account");
  await signedInHoursAgo(READER_A, 25);
  const del = page.getByRole("region", { name: "Delete your account" });
  await del.getByLabel("Type delete to confirm").fill("delete");
  await del.getByRole("button", { name: "Delete account" }).click();
  await expect(del.getByRole("button", { name: "Sign in again" })).toBeFocused();
  await page.goto("/account");
  await expect(page.getByText(`Signed in as ${READER_A.email}`)).toBeVisible();
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
