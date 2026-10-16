import { expect, test } from "@playwright/test";
import { seedLibrary } from "./database";

// An address with no page behind it (#139): a short line in Marginalia's voice, and the ways back.

test("an unknown address says the page isn't here, and leads back to the library and the graph", async ({ page }) => {
  await seedLibrary();
  const res = await page.goto("/no-such-page");
  expect(res?.status()).toBe(404);
  await expect(page).toHaveTitle("Not found · Marginalia");
  await expect(page.getByRole("heading", { level: 1, name: "This page isn’t here." })).toBeVisible();
  await expect(page.getByRole("link", { name: "The graph" })).toHaveAttribute("href", "/graph");

  await page.getByRole("link", { name: "Your library" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("link", { name: "Account" })).toBeVisible();
});
