import { expect, test, type Page } from "@playwright/test";
import { addNoteThatGaveUp, seedLibrary } from "./database";

// The desktop library fits the window: the page itself never scrolls past it, whatever is open beside
// the library, and opening or closing Add leaves the library where it was.

test.beforeEach(async () => {
  await seedLibrary();
  // Stoner's panel runs long; Candide's is short.
  for (let i = 0; i < 12; i++) await addNoteThatGaveUp("Stoner", `A long Note on Stoner, ${i}. `.repeat(20));
});

const library = (page: Page) => page.getByRole("main");
const pageScrolls = (page: Page) => page.evaluate(() => document.documentElement.scrollHeight > innerHeight);

for (const size of [
  { width: 1440, height: 900 },
  { width: 1024, height: 600 },
  { width: 1280, height: 1400 },
]) {
  test(`at ${size.width}×${size.height} the page doesn't scroll past an open Book; a long one scrolls inside its panel`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto("/");
    expect(await pageScrolls(page)).toBe(false);

    await library(page).getByRole("button", { name: "Stoner", exact: true }).click();
    const stoner = page.getByRole("complementary", { name: "Notes on Stoner" });
    await expect(stoner.getByText("A long Note on Stoner, 11.").first()).toBeVisible();
    expect(await pageScrolls(page)).toBe(false);
    const panelScrolls = await stoner.evaluate((panel) => [...panel.querySelectorAll("div")].some((d) => getComputedStyle(d).overflowY === "auto" && d.scrollHeight > d.clientHeight));
    expect(panelScrolls).toBe(true);

    await library(page).getByRole("button", { name: "Candide", exact: true }).click();
    await expect(page.getByRole("complementary", { name: "Notes on Candide" })).toBeVisible();
    expect(await pageScrolls(page)).toBe(false);
  });
}

test("the library stays put as Add closes and opens", async ({ page }) => {
  await page.goto("/");
  const firstRow = library(page).getByRole("listitem").first();
  const top = async () => (await firstRow.boundingBox())!.y;
  const before = await top();

  await page.getByRole("button", { name: "Close search" }).click();
  await expect(page.getByRole("complementary", { name: "Add a book" })).toBeHidden();
  expect(await top()).toBe(before);

  await page.getByRole("button", { name: "Add a book" }).click();
  await expect(page.getByRole("complementary", { name: "Add a book" })).toBeVisible();
  expect(await top()).toBe(before);
});
