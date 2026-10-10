import { expect, test } from "@playwright/test";
import { seedLibrary } from "./database";
import { signedOut } from "./session";

// Signed out: real sign-in is the only gate (#69).
test.use({ storageState: signedOut() });

test.beforeEach(async () => {
  await seedLibrary();
});

test("a signed-out visit goes to sign-in, and comes back to the page after", async ({ page }) => {
  await page.goto("/graph");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fgraph$/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByLabel("Email")).toBeVisible();
});

test("Server Functions and the search API refuse a request without the session", async ({ request }) => {
  expect((await request.get("/api/search?q=stoner", { maxRedirects: 0 })).status()).toBe(401);
  expect((await request.post("/", { maxRedirects: 0, headers: { "Next-Action": "x" } })).status()).toBe(401);
});

test("the manifest, icons and favicon load signed out, for adding to the home screen, and the page reaches under the notch", async ({ page, request }) => {
  const manifest = await request.get("/manifest.webmanifest", { maxRedirects: 0 });
  expect(manifest.status()).toBe(200);
  expect(await manifest.json()).toMatchObject({ name: "Marginalia", display: "standalone", background_color: "#f3ecdd", start_url: "/" });
  for (const path of ["/apple-icon.png", "/icon.png", "/favicon.ico", "/icons/192.png", "/icons/512.png", "/icons/maskable-512.png"]) {
    expect((await request.get(path, { maxRedirects: 0 })).status(), path).toBe(200);
  }
  await page.goto("/sign-in");
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute("content", /viewport-fit=cover/);
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
});
