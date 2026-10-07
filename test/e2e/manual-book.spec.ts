import { expect, test, type Page } from "@playwright/test";
import { manualBook, seedLibrary } from "./database";

// Adding a Book by hand when search finds nothing, the lookalike warning on the way, and editing a
// Book's title and author. Search is answered here, so Open Library is never asked.

const searchFindsNothing = (page: Page) => page.route("**/api/search?**", (route) => route.fulfill({ json: [] }));
const searchPane = (page: Page) => page.getByRole("complementary", { name: "Add a book" });
const library = (page: Page) => page.getByRole("main");
const panelHeading = (page: Page) => page.getByRole("complementary", { name: /^Notes on / }).getByRole("heading", { level: 2 });

async function openManualForm(page: Page, query: string) {
  await searchFindsNothing(page);
  await page.goto("/");
  await page.getByRole("searchbox", { name: "Search by title and author" }).fill(query);
  await searchPane(page).getByRole("button", { name: "Add it by hand" }).click();
  return searchPane(page).getByRole("form", { name: "Add a book by hand" });
}

test("a Book search can't find is added by hand, and lands in the library", async ({ page }) => {
  await seedLibrary();
  const form = await openManualForm(page, "Notes from a Kitchen");

  await expect(form.getByLabel("Title")).toHaveValue("Notes from a Kitchen");
  await form.getByLabel("Author").fill("June Ash");
  await form.getByRole("button", { name: "Add a description" }).click();
  await form.getByLabel("Description").fill("A year of cooking through grief.");
  await form.getByRole("button", { name: "Want to read" }).click();

  await expect(searchPane(page).getByText("Added Notes from a Kitchen to your library.")).toBeVisible();
  await expect(library(page).getByRole("region", { name: /^Want to read/ }).getByRole("button", { name: "Notes from a Kitchen", exact: true })).toBeVisible();
});

test("a Book that looks like one in the library is flagged, links to it, and can still be added", async ({ page }) => {
  await seedLibrary();
  const form = await openManualForm(page, "stoner: a novel");
  await form.getByLabel("Author").fill("john williams");

  const warning = form.getByText("already in your library. Reading it again? Start a new read-through from there instead.");
  await expect(warning).toBeVisible();
  await expect(form.getByRole("button", { name: "Already read" })).toBeEnabled();

  await form.getByRole("button", { name: "Stoner" }).click();
  await expect(panelHeading(page)).toHaveText("Stoner");
});

test("a shared Book's title and author change for the reader alone, and go back when cleared", async ({ page }) => {
  await seedLibrary();
  await page.goto("/");
  await library(page).getByRole("button", { name: "Stoner", exact: true }).click();
  await page.getByRole("button", { name: "Edit title or author" }).click();

  const form = page.getByRole("form", { name: "Edit Stoner" });
  await expect(form.getByText("Changes how this book appears for you alone.", { exact: false })).toBeVisible();
  await expect(form.getByLabel("Description")).toHaveCount(0);
  await form.getByLabel("Title").fill("Stoner (NYRB)");
  await form.getByRole("button", { name: "Save changes" }).click();

  await expect(panelHeading(page)).toHaveText("Stoner (NYRB)");
  await expect(library(page).getByRole("button", { name: "Stoner (NYRB)", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Edit title or author" }).click();
  await page.getByRole("form", { name: "Edit Stoner (NYRB)" }).getByLabel("Title").fill("");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(panelHeading(page)).toHaveText("Stoner");
});

test("a Manual Book is edited itself, and a new description reads up on it again", async ({ page }) => {
  await seedLibrary();
  await manualBook("Kitchen Notes", "June Ash", "Recipes.");
  await page.goto("/");
  await library(page).getByRole("button", { name: "Kitchen Notes", exact: true }).click();
  await expect(page.getByText("Marginalia doesn’t know this book well.")).toBeVisible();

  await page.getByRole("button", { name: "Edit details" }).click();
  const form = page.getByRole("form", { name: "Edit Kitchen Notes" });
  await expect(form.getByLabel("Description")).toHaveValue("Recipes.");
  await form.getByLabel("Description").fill("A year of cooking through grief, one recipe at a time.");
  await form.getByRole("button", { name: "Save changes" }).click();

  await expect(page.getByText("Getting to know this book…")).toBeVisible();
  await page.getByRole("button", { name: "Edit details" }).click();
  await expect(page.getByLabel("Description")).toHaveValue("A year of cooking through grief, one recipe at a time.");
});
