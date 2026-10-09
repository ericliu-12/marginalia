import { expect, test, type Page } from "@playwright/test";
import { markFinding, overBudget, readingBook, seedLibrary } from "./database";

// Past this month's spending limit, background work waits, and the quiet line by the wordmark says so in
// place of the Books finding Connections. No worker runs here; the line reads what the worker would.

const now = new Date();
const resumesOn = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toLocaleDateString("en-GB", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});
const line = (page: Page) => page.getByRole("status").filter({ hasText: /\S/ });

test.beforeEach(async () => {
  await seedLibrary();
  await markFinding("Stoner");
});

test("the library and the graph say spending is paused, and when it resumes, instead of the Books finding Connections", async ({ page }) => {
  await page.goto("/");
  await expect(line(page)).toHaveText("1 Book finding Connections");

  await overBudget();
  await page.reload();
  await expect(line(page)).toHaveText(`Spending limit reached · resumes ${resumesOn}`);
  await page.goto("/graph");
  await expect(line(page)).toHaveText(`Spending limit reached · resumes ${resumesOn}`);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });

  test("the shelf and Add say it too", async ({ page }) => {
    await overBudget();
    await page.goto("/");
    const shelfLine = page.getByRole("main").getByRole("status");
    await expect(shelfLine).toHaveText(`Spending limit reached · resumes ${resumesOn}`);
    // Too long to sit beside the wordmark, it drops under it on one line rather than wrapping.
    expect((await shelfLine.boundingBox())!.height).toBeLessThan(30);
    await page.getByRole("button", { name: "Add a Book" }).click();
    await expect(page.getByRole("dialog", { name: "Add a Book" }).getByRole("status")).toHaveText(`Spending limit reached · resumes ${resumesOn}`);
  });

  test("finishing a Book says its Connections are paused until the month turns", async ({ page }) => {
    await readingBook("Middlemarch");
    await overBudget();
    await page.goto("/");
    await page.getByRole("main").getByRole("button", { name: /^Middlemarch/ }).click();
    await page.getByRole("group", { name: /^Status of / }).getByRole("button", { name: "Read", exact: true }).click();
    await expect(page.getByText(`Finished. Connections paused until ${resumesOn}; then they’ll gather below, and in the graph on a larger screen.`)).toBeVisible();
  });
});
