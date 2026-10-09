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

test("what is done on a Book's screen shows back in Add: a new Status, and a removed Book drops out of Added so far", async ({ page }) => {
  await answerSearch(page);
  await page.getByRole("button", { name: "Add a Book" }).click();
  await searchbox(page).fill("Piranesi");
  await addScreen(page).getByRole("group", { name: "Add Piranesi" }).getByRole("button", { name: "Reading" }).click();
  await expect(addScreen(page).getByText("Added · Reading")).toBeVisible();

  // A hand-added lookalike of the Book just added is the way to its screen.
  const toPiranesi = async () => {
    await searchbox(page).fill("Piranesi: a novel");
    await addScreen(page).getByRole("button", { name: "Add it by hand" }).click();
    const form = addScreen(page).getByRole("form", { name: "Add a book by hand" });
    await form.getByLabel("Author").fill("A. Author");
    await form.getByRole("button", { name: "Piranesi", exact: true }).click();
    await expect(page.getByRole("heading", { level: 2 })).toHaveText("Piranesi");
  };
  const addedSoFar = addScreen(page).getByRole("region", { name: "Added so far" });

  await toPiranesi();
  await status(page).getByRole("button", { name: "Read", exact: true }).click();
  await expect(status(page).getByRole("button", { name: "Read", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Back to Add a Book" }).click();
  await searchbox(page).fill("");
  await expect(addedSoFar.getByText("Added · Already read")).toBeVisible();

  await toPiranesi();
  await page.getByRole("button", { name: "Remove from library" }).click();
  await page.getByRole("button", { name: "Yes, remove" }).click();
  await expect(addScreen(page)).toBeVisible();
  await searchbox(page).fill("");
  await expect(addedSoFar).toHaveCount(0);
  await expect(addScreen(page).getByText("Search by title; add the author to narrow it.", { exact: false })).toBeVisible();
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

const sheet = (page: Page) => page.getByRole("dialog", { name: /^Note on / });
const noteText = (page: Page) => sheet(page).getByRole("textbox", { name: "New note" });
const pen = (page: Page, title: string) => page.getByRole("button", { name: `Write a note on ${title}` });

test("the pen on a Reading row opens a Note sheet with its text focused inside the tap, and saving stays on the shelf", async ({ page }) => {
  await expect(pen(page, "Middlemarch")).toBeVisible();
  // A phone raises its keyboard only for a focus made inside the tap itself, so the text must be focused
  // by the time the click returns.
  const focused = await pen(page, "Middlemarch").evaluate((el: HTMLElement) => {
    el.click();
    return document.activeElement?.getAttribute("placeholder");
  });
  expect(focused).toBe("What are you thinking?");
  await expect(sheet(page)).toHaveAccessibleName("Note on Middlemarch");
  await expect(page).toHaveURL(/\?note=/);

  // A passage alone isn't a Note yet; the reader's own line goes with it.
  await sheet(page).getByRole("button", { name: "Add a quote" }).click();
  await expect(sheet(page).getByLabel("Quoted passage")).toBeFocused();
  await page.keyboard.type("A finely-touched spirit");
  await sheet(page).getByRole("button", { name: "Save note" }).click();
  await expect(sheet(page).getByRole("alert")).toHaveText("Add a line of your own to go with the passage.");
  await noteText(page).fill("Dorothea wants it to be true.");

  // A page revealed by mistake can be taken away again.
  await sheet(page).getByRole("button", { name: "Add a page" }).click();
  await expect(sheet(page).getByLabel("Page", { exact: true })).toBeFocused();
  await sheet(page).getByRole("button", { name: "Remove page" }).click();
  await expect(sheet(page).getByLabel("Page", { exact: true })).toHaveCount(0);
  await expect(noteText(page)).toBeFocused();
  await sheet(page).getByRole("button", { name: "Save note" }).click();

  await expect(sheet(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("status").filter({ hasText: "Note saved on Middlemarch" })).toBeVisible();
  await expect(pen(page, "Middlemarch")).toBeFocused();
  await expect(shelf(page).getByText("Draft note")).toHaveCount(0);

  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.getByRole("heading", { level: 2 })).toHaveText("Middlemarch");
  await expect(page.getByRole("listitem").filter({ hasText: "Dorothea wants it to be true." })).toContainText("“A finely-touched spirit”");
});

test("a Note's draft survives closing the sheet, back, a refresh and another Book's sheet", async ({ page }) => {
  await readingBook("Piranesi");
  await page.reload();

  await pen(page, "Middlemarch").click();
  await page.keyboard.type("Half a thought");
  await sheet(page).getByRole("button", { name: "Close" }).click();
  await expect(sheet(page)).toHaveCount(0);
  await expect(pen(page, "Middlemarch")).toBeFocused();
  await expect(shelf(page).getByRole("button", { name: /^Middlemarch/ })).toContainText("Draft note");

  // Back closes it too, and a refresh with it open brings it back as it was.
  await pen(page, "Middlemarch").click();
  await expect(noteText(page)).toHaveValue("Half a thought");
  await page.goBack();
  await expect(sheet(page)).toHaveCount(0);
  await pen(page, "Middlemarch").click();
  await page.keyboard.type(", and the rest");
  await page.reload();
  await expect(noteText(page)).toHaveValue("Half a thought, and the rest");
  await expect(page.locator("[data-book-id]").filter({ hasText: "Middlemarch" })).toContainText("Draft note");
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);

  // Each Book keeps its own.
  await pen(page, "Piranesi").click();
  await expect(noteText(page)).toHaveValue("");
  await page.keyboard.type("The House is kind");
  await sheet(page).locator("..").locator("[aria-hidden]").first().click({ position: { x: 10, y: 10 } });
  await expect(sheet(page)).toHaveCount(0);
  await pen(page, "Middlemarch").click();
  await expect(noteText(page)).toHaveValue("Half a thought, and the rest");
  await page.goBack();

  // The Book screen writes on the same draft.
  await shelf(page).getByRole("button", { name: /^Piranesi/ }).click();
  await expect(page.getByRole("textbox", { name: "New note" })).toHaveValue("The House is kind");
});

test("a Note that fails to save stays in the sheet with a quiet way to try again", async ({ page }) => {
  // Server actions go out as POSTs carrying a Next-Action header; drop them, as a lost signal would.
  const offline = (route: import("@playwright/test").Route) =>
    route.request().method() === "POST" && route.request().headers()["next-action"] ? route.abort() : route.fallback();
  await page.route("**/*", offline);

  await pen(page, "Middlemarch").click();
  await page.keyboard.type("Written on the train");
  await sheet(page).getByRole("button", { name: "Save note" }).click();
  await expect(sheet(page).getByRole("alert")).toHaveText("Couldn’t save. Your note is kept here.");
  await expect(noteText(page)).toHaveValue("Written on the train");
  await expect(sheet(page).getByRole("button", { name: "Save note" })).toHaveCount(0);

  await page.unroute("**/*", offline);
  await sheet(page).getByRole("button", { name: "Try again" }).click();
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "Note saved on Middlemarch" })).toBeVisible();
});

test("the Note sheet rides on top of the on-screen keyboard", async ({ page }) => {
  // Playwright has no on-screen keyboard; this stands in for the visual viewport a phone shrinks to.
  await page.addInitScript(() => {
    // The page's own size until a keyboard is "raised".
    let raised: { height: number; offsetTop: number } | null = null;
    const fake = Object.assign(new EventTarget(), { offsetLeft: 0, pageTop: 0, pageLeft: 0, scale: 1 });
    Object.defineProperties(fake, {
      width: { get: () => document.documentElement.clientWidth },
      height: { get: () => raised?.height ?? document.documentElement.clientHeight },
      offsetTop: { get: () => raised?.offsetTop ?? 0 },
    });
    Object.defineProperty(window, "visualViewport", { configurable: true, get: () => fake });
    (window as unknown as { keyboard: (height: number, offsetTop?: number) => void }).keyboard = (height, offsetTop = 0) => {
      raised = { height, offsetTop };
      fake.dispatchEvent(new Event("resize"));
    };
  });
  await page.reload();
  await pen(page, "Middlemarch").click();
  const bottom = async () => {
    const box = (await sheet(page).boundingBox())!;
    return box.y + box.height;
  };
  await expect.poll(bottom).toBeCloseTo(915, 0);

  await page.evaluate(() => (window as unknown as { keyboard: (h: number, t?: number) => void }).keyboard(480));
  await expect.poll(bottom).toBeCloseTo(480, 0);
  // iOS may also scroll the page under the keyboard; the sheet follows what is visible.
  await page.evaluate(() => (window as unknown as { keyboard: (h: number, t?: number) => void }).keyboard(480, 120));
  await expect.poll(bottom).toBeCloseTo(600, 0);
  expect((await sheet(page).boundingBox())!.y).toBeGreaterThanOrEqual(120);
});

test("a save that hangs gives up after a while, and trying again with more written saves one Note, as written last", async ({ page }) => {
  await page.clock.install();
  await page.reload();
  // The first save hangs, as on a phone that has lost its signal mid-request, until it is let go.
  const held: import("@playwright/test").Route[] = [];
  await page.route("**/*", (route) =>
    route.request().method() === "POST" && route.request().headers()["next-action"] && held.length === 0 ? void held.push(route) : route.fallback(),
  );

  await pen(page, "Middlemarch").click();
  await page.keyboard.type("Written in a tunnel");
  await sheet(page).getByRole("button", { name: "Save note" }).click();
  await expect(sheet(page).getByRole("button", { name: "Saving…" })).toBeVisible();
  await page.clock.fastForward(16_000);
  await expect(sheet(page).getByRole("alert")).toHaveText("Couldn’t save. Your note is kept here.");
  await expect(noteText(page)).toHaveValue("Written in a tunnel");

  // The reader writes on (which clears the message) and saves again; then the first save gets through after all.
  await noteText(page).press("End");
  await page.keyboard.type(", and out of it");
  await expect(sheet(page).getByRole("alert")).toHaveCount(0);
  await sheet(page).getByRole("button", { name: "Save note" }).click();
  await held[0].fallback();
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "Note saved on Middlemarch" })).toBeVisible();

  await shelf(page).getByRole("button", { name: /^Middlemarch/ }).click();
  const notes = page.getByRole("listitem").filter({ hasText: "Written in a tunnel" });
  await expect(notes).toHaveCount(1);
  await expect(notes).toContainText("Written in a tunnel, and out of it");
});

test("the Note saved line goes with the next move, or after a while", async ({ page }) => {
  await page.clock.install();
  await page.reload();
  const savedLine = page.getByRole("status").filter({ hasText: "Note saved on Middlemarch" });
  const writeOne = async (text: string) => {
    await pen(page, "Middlemarch").click();
    await page.keyboard.type(text);
    await sheet(page).getByRole("button", { name: "Save note" }).click();
    await expect(savedLine).toBeVisible();
  };

  await writeOne("First thought");
  await shelf(page).getByRole("button", { name: /^Middlemarch/ }).click();
  await page.getByRole("button", { name: "Back to library" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Reading");
  await expect(savedLine).toHaveCount(0);

  await writeOne("Second thought");
  await page.clock.fastForward(9_000);
  await expect(savedLine).toHaveCount(0);
});
