import { expect, test, type Page } from "@playwright/test";
import { markFinding, seedSmallLibrary } from "./database";

// The graph with no Finished Books, then one, then a few: it invites, it waits, it never fakes a Connection.

const books = (page: Page) => page.getByRole("navigation", { name: "Books in the graph" }).getByRole("button");
const legend = (page: Page) => page.getByRole("list", { name: "Connection types" });

test("with no Finished Books, the graph says what will gather there, and shows no Books", async ({ page }) => {
  await seedSmallLibrary([]);
  await page.goto("/graph");

  await expect(page.getByText("Finish a book and its connections will gather here.")).toBeVisible();
  await expect(books(page)).toHaveCount(0);
  await expect(legend(page)).toHaveCount(0);

  // The library opens with its search ready for Books already read.
  await page.getByRole("link", { name: "Add a book" }).click();
  await expect(page.getByRole("searchbox", { name: "Title or author" })).toBeFocused();
});

test("a first Book waits for Connections, with its themes shown as themes", async ({ page }) => {
  await seedSmallLibrary(["Stoner: A Novel"], [], ["quiet failure", "work"]);
  await page.goto("/graph");

  await expect(books(page)).toHaveCount(1);
  await expect(page.getByText("Themes of Stoner: quiet failure · work")).toBeVisible();
  await expect(page.getByText("Connections appear as you finish more books.")).toBeVisible();
  await expect(legend(page)).toHaveCount(0);
});

test("until the first Connection, a few Books wait with the same words, and no first Book's themes", async ({ page }) => {
  await seedSmallLibrary(["Stoner", "The Remains of the Day"]);
  await page.goto("/graph");
  await expect(books(page)).toHaveCount(2);
  await expect(page.getByText("Connections appear as you finish more books.")).toBeVisible();
  await expect(page.getByText("Themes of", { exact: false })).toHaveCount(0);
  await expect(legend(page)).toHaveCount(0);

  // While any are being found, it says so instead.
  await markFinding("The Remains of the Day");
  await page.reload();
  await expect(page.locator("p").getByText("Finding connections…", { exact: true })).toBeVisible();
  await expect(page.getByText("Connections appear as you finish more books.")).toHaveCount(0);

  // The first Connection brings the legend in its place. Away first, so no check-in meets the reseeding.
  await page.goto("about:blank");
  await seedSmallLibrary(["Stoner", "The Remains of the Day", "Never Let Me Go"], [[0, 1]]);
  await page.goto("/graph");
  await expect(books(page)).toHaveCount(3);
  await expect(legend(page)).toBeVisible();
  await expect(page.getByText("Connections appear as you finish more books.")).toHaveCount(0);
});

test("a Book with no Connections says so in its panel", async ({ page }) => {
  await seedSmallLibrary(["Stoner", "The Remains of the Day", "Never Let Me Go"], [[0, 1]]);
  await page.goto("/graph");
  await books(page).filter({ hasText: "Never Let Me Go, 0 connections" }).focus();
  await page.keyboard.press("Enter");

  await expect(page.getByRole("heading", { level: 2 })).toHaveText("Never Let Me Go");
  const connections = page.getByRole("region", { name: "Connections" });
  await expect(connections.getByText("No connections yet.")).toBeVisible();
  await expect(connections.getByRole("button", { name: "Refresh connections" })).toBeVisible();
});
