import { expect, test, type Page } from "@playwright/test";
import { addNoteThatGaveUp, seedLibrary } from "./database";

// Dismiss and Refresh in the Book panel, on the seeded chain where Stoner's one Connection is The
// Remains of the Day. No worker runs, so a Refresh stays queued.

test.beforeEach(async ({ page }) => {
  await seedLibrary();
  await page.goto("/graph");
  await expect(page.locator("canvas")).toBeVisible();
});

const books = (page: Page) => page.getByRole("navigation", { name: "Books in the graph" });
const connections = (page: Page) => page.getByRole("region", { name: "Connections" });

async function openStoner(page: Page) {
  await books(page).getByRole("button", { name: /^Stoner, / }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 2 })).toHaveText("Stoner");
}

test("a dismissed Connection leaves the Book panel and the graph, and stays gone", async ({ page }) => {
  await openStoner(page);
  await connections(page).getByRole("button", { name: "Dismiss" }).click();
  await expect(connections(page).getByRole("button", { name: "Keep" })).toBeFocused();
  await connections(page).getByRole("button", { name: "Yes, dismiss" }).click();

  await expect(connections(page).getByRole("button", { name: "The Remains of the Day", exact: true })).toHaveCount(0);
  await expect(connections(page).getByText("No Connections yet.")).toBeVisible();
  await expect(connections(page).getByRole("heading", { name: "Connections" })).toBeFocused();
  await expect(books(page).getByRole("button", { name: "Stoner, 0 Connections" })).toBeAttached();

  await page.reload();
  await expect(books(page).getByRole("button", { name: "Stoner, 0 Connections" })).toBeAttached();
});

test("Escape keeps a Connection, puts focus back on Dismiss and leaves the panel open", async ({ page }) => {
  await openStoner(page);
  await connections(page).getByRole("button", { name: "Dismiss" }).click();
  await expect(connections(page).getByRole("button", { name: "Keep" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(connections(page).getByRole("button", { name: "Dismiss" })).toBeFocused();
  await expect(page.getByRole("heading", { level: 2 })).toHaveText("Stoner");
  await expect(connections(page).getByRole("button", { name: "The Remains of the Day", exact: true })).toBeVisible();
});

test("Refresh connections queues a run, and the panel shows it finding Connections", async ({ page }) => {
  await openStoner(page);
  await connections(page).getByRole("button", { name: "Refresh connections" }).click();
  await expect(connections(page).getByText("Finding Connections…")).toBeVisible();
  await expect(connections(page).getByRole("button", { name: "Refresh connections" })).toHaveCount(0);
  await expect(connections(page).getByRole("button", { name: "The Remains of the Day", exact: true })).toBeVisible();
});

test("a Note that gave up on its vector is named above Refresh, which tries it again", async ({ page }) => {
  await addNoteThatGaveUp("Stoner", "A quiet life of work.");
  await openStoner(page);
  const leftOut = connections(page).getByText("Connections can’t draw on one of your notes yet. Refresh to try again.");
  await expect(leftOut).toBeVisible();
  await connections(page).getByRole("button", { name: "Refresh connections" }).click();
  await expect(connections(page).getByText("Finding Connections…")).toBeVisible();
  await expect(leftOut).toHaveCount(0);
});
