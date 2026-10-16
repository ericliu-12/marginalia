import { expect, test, type Page } from "@playwright/test";
import { addCluster, finishBook, seedLibrary } from "./database";
import { READER_B, signedIn } from "./session";

// The library's shelves (#136): numbered, Read showing its latest 8 until "and N more" shows the rest
// for good on this device, a finished Book's Cluster and finish date, and its Notes as numbered sidenotes.

test.beforeEach(async () => {
  await seedLibrary();
});

const library = (page: Page) => page.getByRole("main");
const shelf = (page: Page, name: string) => library(page).getByRole("region", { name, exact: true });

test("Read shows its latest 8; 'and N more' shows the rest, and stays shown", async ({ page }) => {
  for (const title of ["Austerlitz", "Piranesi", "Gilead", "Middlemarch"]) await finishBook(title);
  await page.goto("/");
  const read = shelf(page, "Read · 10");
  await expect(read.getByRole("listitem")).toHaveCount(8);
  // Stoner, finished first, is past the latest 8.
  await expect(read.getByRole("button", { name: "Stoner", exact: true })).toHaveCount(0);

  await read.getByRole("button", { name: "and 2 more" }).click();
  await expect(read.getByRole("listitem")).toHaveCount(10);
  await expect(read.getByRole("button", { name: "The Remains of the Day", exact: true })).toBeFocused();

  await page.reload();
  await expect(shelf(page, "Read · 10").getByRole("listitem")).toHaveCount(10);
});

test("a finished Book's panel names its Cluster and finish date, and numbers its Notes", async ({ page }) => {
  await addCluster(["Beloved", "The Plague", "Candide"], { name: "Grief faced together", description: "Each asks who grieves with whom." }, 1);
  await page.goto("/");
  // The row says which Cluster, for a reader who can't see its dot.
  await expect(shelf(page, "Read · 6").getByRole("listitem").filter({ hasText: "Candide" })).toContainText(", in Grief faced together");

  await library(page).getByRole("button", { name: "Candide", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Notes on Candide" });
  await expect(panel.getByText("Voltaire · Finished 6 January")).toBeVisible();
  await expect(panel.getByText("in Grief faced together")).toBeVisible();

  // Oldest first: a Note keeps its number.
  const notes = panel.getByRole("region", { name: "Notes" }).getByRole("listitem");
  for (const body of ["Optimism, tested.", "The garden at the end."]) {
    await panel.getByRole("textbox", { name: "Write a Note" }).fill(body);
    await panel.getByRole("button", { name: "Save Note" }).click();
    await expect(notes.filter({ hasText: body })).toBeVisible();
  }
  await expect(notes).toHaveText([/^1Optimism, tested\./, /^2The garden at the end\./]);
});

test("the Book's panel reads About, then Notes, then Connections", async ({ page }) => {
  await page.goto("/");
  await library(page).getByRole("button", { name: "Candide", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Notes on Candide" });
  const top = async (name: string) => (await panel.getByRole("heading", { name, exact: true }).boundingBox())!.y;
  await expect(panel.getByRole("heading", { name: "Connections", exact: true })).toBeVisible();
  const [about, notes, connections] = [await top("About this Book"), await top("Notes"), await top("Connections")];
  expect(about).toBeLessThan(notes);
  expect(notes).toBeLessThan(connections);
});

test("a row's Status moves take the author and date's place on hover and focus, never over them", async ({ page }) => {
  await page.goto("/");
  const row = shelf(page, "Read · 6").getByRole("listitem").filter({ hasText: "Candide" });
  const author = row.getByText("Voltaire");
  const date = row.getByText("6 Jan");
  const moves = row.getByRole("group", { name: "Change status of Candide" });
  await expect(author).toHaveCSS("opacity", "1");
  await expect(moves).toHaveCSS("opacity", "0");

  await row.hover();
  await expect(moves).toHaveCSS("opacity", "1");
  await expect(author).toHaveCSS("opacity", "0");
  await expect(date).toHaveCSS("opacity", "0");

  await page.mouse.move(0, 0);
  await expect(author).toHaveCSS("opacity", "1");
  await row.getByRole("button", { name: "Candide", exact: true }).focus();
  await expect(moves).toHaveCSS("opacity", "1");
  await expect(author).toHaveCSS("opacity", "0");

  // Under reduced motion the swap is instant.
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(parseFloat(await author.evaluate((e) => getComputedStyle(e).transitionDuration))).toBeLessThan(0.001);
});

test.describe("an empty library", () => {
  test.use({ storageState: signedIn(READER_B) });

  test("says the shelves are waiting", async ({ page }) => {
    await page.goto("/");
    await expect(library(page).getByText("Your shelves are waiting.")).toBeVisible();
  });
});
