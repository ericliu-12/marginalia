import { expect, test, type Page } from "@playwright/test";
import { seedSmallLibrary } from "./database";

// The graph with no Finished Books, then one, then a few: it invites, it waits, it never fakes a Connection.

const books = (page: Page) => page.getByRole("navigation", { name: "Books in the graph" }).getByRole("button");
const legend = (page: Page) => page.getByRole("list", { name: "Connection types" });

test("with no Finished Books, the graph invites both ways in and shows no Books", async ({ page }) => {
  await seedSmallLibrary([]);
  await page.goto("/graph");

  await expect(page.getByText("Your graph begins with a finished Book.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Go to your library" })).toHaveAttribute("href", "/");
  await expect(books(page)).toHaveCount(0);
  await expect(legend(page)).toHaveCount(0);

  // Adding Books already read starts in the library's search.
  await page.getByRole("link", { name: "Add books you’ve read" }).click();
  await expect(page.getByRole("searchbox", { name: "Search by title and author" })).toBeFocused();
});

test("a first Book waits for Connections, with its themes shown as themes", async ({ page }) => {
  await seedSmallLibrary(["Stoner: A Novel"], [], ["quiet failure", "work"]);
  await page.goto("/graph");

  await expect(books(page)).toHaveCount(1);
  await expect(page.getByText("Themes of Stoner: quiet failure · work")).toBeVisible();
  await expect(page.getByText("Connections appear as you finish more Books.")).toBeVisible();
  await expect(legend(page)).toHaveCount(0);
});

test("a few Books show without the first Book's words, and the legend comes with their first Connection", async ({ page }) => {
  await seedSmallLibrary(["Stoner", "The Remains of the Day"]);
  await page.goto("/graph");
  await expect(books(page)).toHaveCount(2);
  await expect(page.getByText("Connections appear as you finish more Books.")).toHaveCount(0);
  await expect(legend(page)).toHaveCount(0);

  await seedSmallLibrary(["Stoner", "The Remains of the Day", "Never Let Me Go"], [[0, 1]]);
  await page.reload();
  await expect(books(page)).toHaveCount(3);
  await expect(legend(page)).toBeVisible();
});

test("a Book with no Connections says so in its panel", async ({ page }) => {
  await seedSmallLibrary(["Stoner", "The Remains of the Day", "Never Let Me Go"], [[0, 1]]);
  await page.goto("/graph");
  await books(page).filter({ hasText: "Never Let Me Go, 0 Connections" }).focus();
  await page.keyboard.press("Enter");

  await expect(page.getByRole("heading", { level: 2 })).toHaveText("Never Let Me Go");
  const connections = page.getByRole("region", { name: "Connections" });
  await expect(connections.getByText("No Connections yet.")).toBeVisible();
  await expect(connections.getByRole("button", { name: "Refresh connections" })).toBeVisible();
});
