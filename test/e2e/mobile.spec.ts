import { expect, test, type Page } from "@playwright/test";
import { readingBook, seedLibrary, wantBook } from "./database";

// The library at phone width: the Reading shelf, its folded sections, and the Book screen with its
// three-way Status control. The seeded chain is all Read; Middlemarch is being read for the first time.
// No worker runs, so a first finish leaves its Connections being found.

test.use({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });

test.beforeEach(async ({ page }) => {
  await seedLibrary();
  await readingBook("Middlemarch");
  await wantBook("Gilead");
  await page.goto("/");
});

const shelf = (page: Page) => page.getByRole("main");
const status = (page: Page) => page.getByRole("group", { name: /^Status of / });
const finishLine = (page: Page) => page.getByText("Connections are being found; they’ll appear in the graph on a larger screen.");
const connections = (page: Page) => page.getByRole("region", { name: "Connections" });

test("opens on the Reading shelf, with Want to read and Read folded away and no graph", async ({ page }) => {
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Reading");
  await expect(shelf(page).getByRole("button", { name: /^Middlemarch/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Graph" })).toHaveCount(0);

  const want = shelf(page).getByRole("button", { name: "Want to read 1" });
  await expect(want).toHaveAttribute("aria-expanded", "false");
  await expect(shelf(page).getByRole("button", { name: /^Gilead/ })).toHaveCount(0);
  await want.click();
  await expect(shelf(page).getByRole("button", { name: /^Gilead/ })).toBeVisible();
  await expect(shelf(page).getByRole("button", { name: "Read 6" })).toHaveAttribute("aria-expanded", "false");
});

test("Add a Book, pinned under the shelf, opens search full screen and closes back to it", async ({ page }) => {
  const add = page.getByRole("button", { name: "Add a Book" });
  await add.click();
  await expect(page.getByRole("searchbox", { name: "Search by title and author" })).toBeFocused();
  await page.getByRole("button", { name: "Close search" }).click();
  await expect(page.getByRole("searchbox")).toHaveCount(0);
  await expect(add).toBeFocused();
});

test("Read on the Book screen finishes the Book, and only the first finish shows the finish line", async ({ page }) => {
  await shelf(page).getByRole("button", { name: /^Middlemarch/ }).click();
  await expect(page.getByRole("heading", { level: 2 })).toHaveText("Middlemarch");
  await expect(status(page).getByRole("button", { name: "Reading" })).toHaveAttribute("aria-pressed", "true");

  await status(page).getByRole("button", { name: "Read", exact: true }).click();
  await expect(status(page).getByRole("button", { name: "Read", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(finishLine(page)).toBeVisible();
  await expect(connections(page).getByText("Finding Connections…")).toBeVisible();

  // Read again, then finished again: a second Read-through, so no finish line.
  await status(page).getByRole("button", { name: "Reading" }).click();
  await expect(finishLine(page)).toHaveCount(0);
  await expect(status(page).getByRole("button", { name: "Reading" })).toHaveAttribute("aria-pressed", "true");
  await status(page).getByRole("button", { name: "Read", exact: true }).click();
  await expect(status(page).getByRole("button", { name: "Read", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(status(page).locator("..")).toHaveAttribute("aria-busy", "false");
  await expect(page.getByRole("status").filter({ hasText: "Finished." })).toHaveCount(0);

  await page.getByRole("button", { name: "Back to library" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Reading");
  await expect(shelf(page).getByRole("button", { name: "Read 7" })).toHaveAttribute("aria-expanded", "true");
  await expect(shelf(page).getByRole("button", { name: /^Middlemarch/ })).toBeFocused();
  await expect(page.getByText("1 Book finding Connections")).toBeVisible();
});

test("the Book screen lists its Connections as text, and a title opens that Book", async ({ page }) => {
  await shelf(page).getByRole("button", { name: "Read 6" }).click();
  await shelf(page).getByRole("button", { name: /^Stoner/ }).click();
  await expect(page.getByRole("heading", { level: 2 })).toHaveText("Stoner");
  await expect(status(page).getByRole("button", { name: "Read", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(connections(page).getByText("Why Stoner meets The Remains of the Day.")).toBeVisible();

  await connections(page).getByRole("button", { name: "The Remains of the Day", exact: true }).click();
  await expect(page.getByRole("heading", { level: 2 })).toHaveText("The Remains of the Day");
});
