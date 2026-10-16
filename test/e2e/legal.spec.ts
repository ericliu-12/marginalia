import { expect, test } from "@playwright/test";
import { signedOut } from "./session";

// /privacy and /terms (#62): public, for Google's consent screen and anyone deciding whether to sign in.

test.describe("signed out", () => {
  test.use({ storageState: signedOut() });

  test("the privacy and terms pages load, each section can be linked to, and each page links to the other", async ({ page }) => {
    await page.goto("/privacy#services");
    await expect(page).toHaveURL(/\/privacy#services$/);
    await expect(page.getByRole("heading", { level: 1, name: "Privacy" })).toBeVisible();
    await expect(page.locator("#services")).toContainText("Cloudflare R2");
    await expect(page.locator("#backups")).toContainText("30 days");

    await page.getByRole("link", { name: "Terms", exact: true }).click();
    await expect(page).toHaveURL(/\/terms$/);
    await expect(page.getByRole("heading", { level: 1, name: "Terms" })).toBeVisible();
    await expect(page.locator("#law")).toContainText("New York");
  });

  test("pages describe Marginalia to search, link previews and the home screen", async ({ page, request }) => {
    const description = "A quiet place for the books you’ve read, your notes, and the connections between them.";
    await page.goto("/privacy");
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", description);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", "Marginalia");
    await expect(page.locator('meta[property="og:description"]')).toHaveAttribute("content", description);
    const manifest = await (await request.get("/manifest.webmanifest")).json();
    expect(manifest.description).toBe(description);
  });

  test("the sign-in page links to both", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByRole("link", { name: "Privacy" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Privacy" })).toBeVisible();
    await page.goBack();
    await page.getByRole("link", { name: "Terms" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Terms" })).toBeVisible();
  });
});
