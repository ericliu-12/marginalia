import { expect, test } from "@playwright/test";
import { seedLibrary } from "./database";
import { pastTheGate } from "./session";

// Continue with Google (#63), behind the password gate. Google itself is never reached: its sign-in page
// is answered here, and its return is checked by hand on the iPhone.

test.use({ storageState: pastTheGate() });

const SITE = "http://localhost:3100";

test.beforeEach(async () => {
  await seedLibrary();
});

test("Continue with Google goes to Google, which is told to return the Reader to the site's own callback", async ({ page }) => {
  await page.route("https://accounts.google.com/**", (route) => route.fulfill({ contentType: "text/html", body: "Google" }));
  await page.goto("/sign-in?next=%2Fgraph");
  await page.getByRole("button", { name: "Continue with Google" }).click();

  await expect(page).toHaveURL(/^https:\/\/accounts\.google\.com\//);
  const google = new URL(page.url());
  expect(google.searchParams.get("redirect_uri")).toBe(`${SITE}/api/auth/callback/google`);
  expect(google.searchParams.get("client_id")).toBe("e2e-no-calls");
});

test("a Google sign-in that fails comes back to the sign-in page with one neutral line, and the email code still works", async ({ page }) => {
  // A return Better Auth can't match to a sign-in it started, as any failure comes back.
  await page.goto("/api/auth/callback/google?code=code&state=forged");
  await expect(page.locator("#google-message")).toHaveText("That didn’t sign you in. Try again, or sign in with an email code below.");
  // Taken out of the address once shown, so a reload doesn't show it again.
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole("button", { name: "Send code" })).toBeEnabled();
});
