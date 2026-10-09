import { expect, test } from "@playwright/test";

// The #59 spike's pages, removed with it by #63. Nothing here reaches Google or Cloudflare.

test("the Google spike starts a sign-in at Google with a state cookie, and a return without that cookie says so", async ({ page, request }) => {
  await page.goto("/spike/google");
  await expect(page.getByText("Not signed in with Google.")).toBeVisible();
  await expect(page.getByText("This page is open in a browser tab.")).toBeVisible();

  const start = await request.get("/spike/google/start", { maxRedirects: 0 });
  const google = new URL(start.headers().location);
  expect(google.origin).toBe("https://accounts.google.com");
  expect(google.searchParams.get("redirect_uri")).toBe("http://localhost:3100/spike/google/callback");
  expect(start.headers()["set-cookie"]).toContain(`spike_google_state=${google.searchParams.get("state")}`);

  await page.goto("/spike/google/callback?code=c&state=s");
  await expect(page.getByText(/finished outside the window it began in/)).toBeVisible();
});

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("the spike pages are behind the password gate", async ({ page }) => {
    await page.goto("/spike/turnstile");
    await expect(page).toHaveURL(/\/login\?next=%2Fspike%2Fturnstile$/);
  });
});
