import { expect, test, type Page } from "@playwright/test";
import { seedLibrary } from "./database";
import { E2E_PASSWORD } from "./session";

// Signed out: the private deploy's one password, and the limit on guessing it.
test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async () => {
  await seedLibrary();
});

const password = (page: Page) => page.getByLabel("Password");
const message = (page: Page) => page.locator("#sign-in-message");

test("a signed-out visit goes to sign-in, a wrong password says so and stays selected, and the right one returns to the page", async ({ page }) => {
  await page.goto("/graph");
  await expect(page).toHaveURL(/\/login\?next=%2Fgraph$/);
  await expect(page.getByRole("heading", { name: "Marginalia" })).toBeVisible();

  await password(page).fill("not it");
  await page.getByRole("button", { name: "Open" }).click();
  await expect(message(page)).toHaveText("That’s not the password.");
  await expect(password(page)).toBeFocused();
  await expect(password(page)).toHaveValue("not it");

  await password(page).fill(E2E_PASSWORD);
  await password(page).press("Enter");
  await expect(page).toHaveURL(/\/graph$/);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Marginalia" })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test("Server Functions and the search API refuse a request without the session", async ({ request }) => {
  expect((await request.get("/api/search?q=stoner", { maxRedirects: 0 })).status()).toBe(401);
  expect((await request.post("/", { maxRedirects: 0, headers: { "Next-Action": "x" } })).status()).toBe(401);
});

test("after five wrong passwords from one address, sign-in stops listening for a while", async ({ page }) => {
  // Its own address, so the lockout doesn't reach the other tests.
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "203.0.113.9" });
  await page.goto("/login");
  for (let i = 0; i < 5; i++) {
    await password(page).fill(`guess ${i}`);
    await page.getByRole("button", { name: "Open" }).click();
    await expect(message(page)).toHaveText("That’s not the password.");
    await expect(page.getByRole("button", { name: "Open" })).toBeEnabled();
  }
  await password(page).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Open" }).click();
  await expect(message(page)).toHaveText("Too many tries. Try again in 15 minutes.");
  await expect(page).toHaveURL(/\/login$/);
});
