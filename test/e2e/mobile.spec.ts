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
const finishLine = (page: Page) => page.getByText("Connections are being found; they’ll gather below, and in the graph on a larger screen.");
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

// Open Library played here: works whose title starts with what is typed, none of them in the library.
const CATALOG = ["Piranesi", "Austerlitz", "The Peregrine"].map((title, i) => ({
  workKey: `/works/OL${i}W`,
  title,
  authors: ["A. Author"],
  firstPublishedYear: 2000 + i,
  editionCount: 10,
  coverId: null,
  subjects: [],
  coverUrl: null,
  libraryStatus: null,
  libraryBookId: null,
  lookalike: null,
}));
const answerSearch = (page: Page) =>
  page.route("**/api/search?**", (route) => {
    const q = new URL(route.request().url()).searchParams.get("q")!.toLowerCase();
    return route.fulfill({ json: CATALOG.filter((w) => w.title.toLowerCase().startsWith(q)) });
  });
const addScreen = (page: Page) => page.getByRole("dialog", { name: "Add a Book" });
const searchbox = (page: Page) => page.getByRole("searchbox", { name: "Search by title and author" });
const selectedText = (page: Page) => searchbox(page).evaluate((el: HTMLInputElement) => el.value.slice(el.selectionStart!, el.selectionEnd!));

test("Add adds a Book in one tap, stays open with the search selected for the next, and Undo takes one back out", async ({ page }) => {
  await answerSearch(page);
  const add = page.getByRole("button", { name: "Add a Book" });
  await add.click();
  await expect(searchbox(page)).toBeFocused();

  await searchbox(page).fill("Piranesi");
  await addScreen(page).getByRole("group", { name: "Add Piranesi" }).getByRole("button", { name: "Reading" }).click();
  await expect(addScreen(page).getByText("Added · Reading")).toBeVisible();
  await expect(searchbox(page)).toBeFocused();
  expect(await selectedText(page)).toBe("Piranesi");

  // Typing goes over the selected search, and the next Book is one tap too.
  await page.keyboard.type("Austerlitz");
  await addScreen(page).getByRole("group", { name: "Add Austerlitz" }).getByRole("button", { name: "Already read" }).click();
  await expect(addScreen(page).getByText("Added · Already read")).toBeVisible();
  await expect(addScreen(page).getByText("1 Book finding Connections")).toBeVisible();
  expect(await selectedText(page)).toBe("Austerlitz");

  await addScreen(page).getByRole("button", { name: "Undo adding Austerlitz" }).click();
  await expect(addScreen(page).getByRole("group", { name: "Add Austerlitz" })).toBeVisible();
  await expect(addScreen(page).getByText("1 Book finding Connections")).toHaveCount(0);
  await expect(searchbox(page)).toBeFocused();

  // An empty search shows what this visit added, each still undoable.
  await searchbox(page).fill("");
  const addedSoFar = addScreen(page).getByRole("region", { name: "Added so far" });
  await expect(addedSoFar.getByRole("listitem")).toHaveCount(1);
  await expect(addedSoFar.getByRole("listitem")).toContainText("PiranesiA. AuthorAdded · Reading");
  await expect(addedSoFar.getByRole("button", { name: "Undo adding Piranesi" })).toBeVisible();

  await searchbox(page).fill("The Peregrine");
  await addScreen(page).getByRole("group", { name: "Add The Peregrine" }).getByRole("button", { name: "Want to read" }).click();
  await expect(addScreen(page).getByText("Added · Want to read")).toBeVisible();

  // Done opens the sections that were added to, so every new Book is on show.
  await addScreen(page).getByRole("button", { name: "Done" }).click();
  await expect(addScreen(page)).toHaveCount(0);
  await expect(add).toBeFocused();
  await expect(shelf(page).getByRole("button", { name: /^Piranesi/ })).toBeVisible();
  await expect(shelf(page).getByRole("button", { name: "Want to read 2" })).toHaveAttribute("aria-expanded", "true");
  await expect(shelf(page).getByRole("button", { name: /^The Peregrine/ })).toBeVisible();
  await expect(shelf(page).getByRole("button", { name: "Read 6" })).toHaveAttribute("aria-expanded", "false");
});

test("Add is a URL too: back closes it, to the button that opened it", async ({ page }) => {
  const add = page.getByRole("button", { name: "Add a Book" });
  await add.click();
  await expect(page).toHaveURL(/\?add$/);
  await page.goBack();
  await expect(addScreen(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);
  await expect(add).toBeFocused();
});

test("Escape clears a search first, and then closes Add", async ({ page }) => {
  await answerSearch(page);
  const add = page.getByRole("button", { name: "Add a Book" });
  await add.click();
  await searchbox(page).fill("Piranesi");
  await page.keyboard.press("Escape");
  await expect(searchbox(page)).toHaveValue("");
  await expect(addScreen(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(addScreen(page)).toHaveCount(0);
  await expect(add).toBeFocused();
});

test("a Book search can't find is added by hand, past a lookalike warning, and can be undone", async ({ page }) => {
  await page.route("**/api/search?**", (route) => route.fulfill({ json: [] }));
  await page.getByRole("button", { name: "Add a Book" }).click();
  await searchbox(page).fill("stoner: a novel");
  await addScreen(page).getByRole("button", { name: "Add it by hand" }).click();
  const form = addScreen(page).getByRole("form", { name: "Add a book by hand" });
  await form.getByLabel("Author").fill("john williams");
  await expect(form.getByText("already in your library. Reading it again? Start a new read-through from there instead.")).toBeVisible();

  await form.getByRole("button", { name: "Want to read" }).click();
  const addedSoFar = addScreen(page).getByRole("region", { name: "Added so far" });
  await expect(addedSoFar.getByRole("listitem")).toContainText("stoner: a noveljohn williams · Manual BookAdded · Want to read");
  await expect(searchbox(page)).toBeFocused();
  await addedSoFar.getByRole("button", { name: "Undo adding stoner: a novel" }).click();
  await expect(addedSoFar).toHaveCount(0);
  await addScreen(page).getByRole("button", { name: "Done" }).click();
  await expect(shelf(page).getByRole("button", { name: "Want to read 1" })).toBeVisible();
});

test("a lookalike's title opens that Book, and back returns to Add as it was", async ({ page }) => {
  await answerSearch(page);
  await page.getByRole("button", { name: "Add a Book" }).click();
  await searchbox(page).fill("Piranesi");
  await addScreen(page).getByRole("group", { name: "Add Piranesi" }).getByRole("button", { name: "Reading" }).click();
  await expect(addScreen(page).getByText("Added · Reading")).toBeVisible();

  await searchbox(page).fill("stoner: a novel");
  await addScreen(page).getByRole("button", { name: "Add it by hand" }).click();
  const form = addScreen(page).getByRole("form", { name: "Add a book by hand" });
  await form.getByLabel("Author").fill("john williams");
  await form.getByRole("button", { name: "Stoner" }).click();
  await expect(page.getByRole("heading", { level: 2 })).toHaveText("Stoner");

  // Back, by gesture or by the screen's own link, finds the form and this visit's adds where they were.
  await page.goBack();
  await expect(form.getByLabel("Author")).toHaveValue("john williams");
  await form.getByRole("button", { name: "Stoner" }).click();
  await page.getByRole("button", { name: "Back to Add a Book" }).click();
  await expect(form.getByLabel("Author")).toHaveValue("john williams");
  await searchbox(page).fill("");
  await expect(addScreen(page).getByRole("region", { name: "Added so far" }).getByRole("button", { name: "Undo adding Piranesi" })).toBeVisible();

  await addScreen(page).getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Reading");
  await expect(page).toHaveURL(/\/$/);
});

test("Enter in the hand-add form moves to the next field rather than adding the Book", async ({ page }) => {
  await page.route("**/api/search?**", (route) => route.fulfill({ json: [] }));
  await page.getByRole("button", { name: "Add a Book" }).click();
  await searchbox(page).fill("Kitchen Notes");
  await addScreen(page).getByRole("button", { name: "Add it by hand" }).click();
  const form = addScreen(page).getByRole("form", { name: "Add a book by hand" });

  await form.getByLabel("Title").focus();
  await page.keyboard.press("Enter");
  await expect(form.getByLabel("Author")).toBeFocused();
  await page.keyboard.type("June Ash");
  // The last field puts the keyboard away; the Book waits for a Status.
  await page.keyboard.press("Enter");
  await expect(form.getByLabel("Author")).not.toBeFocused();
  await expect(form).toBeVisible();
  await expect(addScreen(page).getByRole("region", { name: "Added so far" })).toHaveCount(0);
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

test("the Book screen is a URL, and browser back returns to the shelf where it was", async ({ page }) => {
  await shelf(page).getByRole("button", { name: "Read 6" }).click();
  const stoner = shelf(page).getByRole("button", { name: /^Stoner/ });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const scrollY = await page.evaluate(() => window.scrollY);
  expect(scrollY).toBeGreaterThan(0);
  await stoner.click();
  await expect(page.getByRole("heading", { level: 2 })).toHaveText("Stoner");
  await expect(page).toHaveURL(/\?book=/);

  await page.goBack();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Reading");
  await expect(page).toHaveURL(/\/$/);
  await expect(shelf(page).getByRole("button", { name: /^Stoner/ })).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);

  // The URL opens the Book screen on its own, and its way out goes to the shelf.
  await page.goForward();
  await expect(page.getByRole("heading", { level: 2 })).toHaveText("Stoner");
  await page.reload();
  await expect(page.getByRole("heading", { level: 2 })).toHaveText("Stoner");
  await page.getByRole("button", { name: "Back to library" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Reading");
});

test("the Book screen lists its Connections as text, and a title opens that Book", async ({ page }) => {
  await shelf(page).getByRole("button", { name: "Read 6" }).click();
  await shelf(page).getByRole("button", { name: /^Stoner/ }).click();
  await expect(page.getByRole("heading", { level: 2 })).toHaveText("Stoner");
  await expect(status(page).getByRole("button", { name: "Read", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(connections(page).getByText("Why Stoner meets The Remains of the Day.")).toBeVisible();

  await connections(page).getByRole("button", { name: "The Remains of the Day", exact: true }).click();
  await expect(page.getByRole("heading", { level: 2 })).toHaveText("The Remains of the Day");

  // Following a Connection takes the Book's place, so back still leads to the shelf.
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Reading");
});
