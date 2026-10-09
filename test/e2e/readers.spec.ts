import { randomUUID } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { bookIdOf, seedLibrary } from "./database";
import { catalog } from "./open-library";
import { READER_B, signedIn } from "./session";

// Two Readers, each in their own browser: A (the seeded library) adds a Book and a Note; B sees none of
// it, nor any of A's library, anywhere. Search goes through the server, to the e2e Open Library.

const AUSTERLITZ = { workKey: "/works/OL5W", title: "Austerlitz", authors: ["W. G. Sebald"], firstPublishedYear: 2001, editionCount: 30, coverId: null, subjects: [] };
const NOTE = "The waiting rooms of Liverpool Street.";
const phone = { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true };

test.beforeEach(async () => {
  await seedLibrary();
  await catalog([AUSTERLITZ]);
});

const asReaderB = (browser: Browser, options = {}) => browser.newContext({ storageState: signedIn(READER_B), ...options });
const searchbox = (page: Page) => page.getByRole("searchbox", { name: "Search by title and author" });

test("A's Book and Note stay A's: B's shelf, Book screen, graph and search show none of them", async ({ browser }) => {
  // A, on the phone: adds Austerlitz from search as Reading, and writes a Note on it.
  const a = await (await browser.newContext({ storageState: signedIn(), ...phone })).newPage();
  await a.goto("/");
  await a.getByRole("button", { name: "Add a Book" }).click();
  await searchbox(a).fill("Austerlitz");
  const add = a.getByRole("dialog", { name: "Add a Book" });
  await add.getByRole("group", { name: "Add Austerlitz" }).getByRole("button", { name: "Reading" }).click();
  await expect(add.getByText("Added · Reading")).toBeVisible();
  await add.getByRole("button", { name: "Done" }).click();
  await a.getByRole("button", { name: "Write a note on Austerlitz" }).click();
  await a.getByRole("dialog", { name: "Note on Austerlitz" }).getByRole("textbox", { name: "New note" }).fill(NOTE);
  await a.getByRole("dialog", { name: "Note on Austerlitz" }).getByRole("button", { name: "Save note" }).click();
  await expect(a.getByRole("status").filter({ hasText: "Note saved on Austerlitz" })).toBeVisible();

  // A's own Book screen shows them, as stored from the server's Open Library.
  const id = await bookIdOf("Austerlitz");
  await a.goto(`/?book=${id}`);
  await expect(a.getByRole("heading", { level: 2 })).toHaveText("Austerlitz");
  await expect(a.getByText("W. G. Sebald")).toBeVisible();
  await expect(a.getByText(NOTE)).toBeVisible();

  // B, on the phone: an empty shelf, and A's Book screen is a Book B doesn't have, as a made-up id is.
  const bPhone = await (await asReaderB(browser, phone)).newPage();
  await bPhone.goto("/");
  await expect(bPhone.getByRole("heading", { level: 1 })).toHaveText("Reading");
  for (const title of ["Austerlitz", "Stoner", "Beloved"]) await expect(bPhone.getByText(title)).toHaveCount(0);
  for (const bookId of [id, randomUUID()]) {
    await bPhone.goto(`/?book=${bookId}`);
    await expect(bPhone.getByRole("heading", { level: 1 })).toHaveText("Reading");
    await expect(bPhone.getByRole("heading", { level: 2 })).toHaveCount(0);
    await expect(bPhone.getByText("Austerlitz")).toHaveCount(0);
    await expect(bPhone.getByText(NOTE)).toHaveCount(0);
  }

  // B, at a desk: search finds the work, but not as in B's library; the graph has none of A's Books.
  const b = await (await asReaderB(browser)).newPage();
  await b.goto("/");
  await searchbox(b).fill("Austerlitz");
  await expect(b.getByRole("group", { name: "Add Austerlitz" }).getByRole("button", { name: "Reading" })).toBeVisible();
  await expect(b.getByText(NOTE)).toHaveCount(0);
  await b.goto("/graph");
  await expect(b.getByText("Your graph begins with a finished Book.", { exact: false })).toBeVisible();
  for (const title of ["Austerlitz", "Stoner", "Beloved"]) await expect(b.getByText(title)).toHaveCount(0);
});
