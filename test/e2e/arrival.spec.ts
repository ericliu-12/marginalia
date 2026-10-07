import { expect, test, type Page } from "@playwright/test";
import { finishBook, LIBRARY, readerId, seedLibrary, settleGraph, wantBook } from "./database";

// The arrival: a Book finished since the graph last showed lands, its panel opens, and its Connections
// draw in one by one. Each test opens the graph once first, so it has something to remember.

test.beforeEach(async () => {
  await seedLibrary();
});

const heading = (page: Page) => page.getByRole("heading", { level: 2 });
// The canvas holds back each Connection until it draws in; it says how many are still to come.
const withheld = (page: Page) => page.locator("[data-withheld]");

async function openGraph(page: Page) {
  await page.goto("/graph");
  await expect(page.getByRole("navigation", { name: "Books in the graph" }).getByRole("button")).toHaveCount(6);
}

test("nothing arrives on a first visit", async ({ page }) => {
  await finishBook("Housekeeping", ["Stoner"]);
  await page.goto("/graph");
  await expect(page.getByRole("navigation", { name: "Books in the graph" }).getByRole("button")).toHaveCount(7);
  await expect(heading(page)).toHaveCount(0);
});

test("a newly finished Book lands, opens with its words, and its Connections draw in one by one", async ({ page }) => {
  await openGraph(page);
  await finishBook("Housekeeping", ["Stoner", "Never Let Me Go"]);
  await page.reload();

  await expect(heading(page)).toHaveText("Housekeeping");
  await expect(page.getByText("You just finished this. Here is where it sits among your earlier reading.")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Housekeeping is now in your graph" })).toBeAttached();
  // The panel's rows wait for their lines: the strongest, then the next.
  const rows = page.getByRole("region", { name: "Connections" }).getByRole("listitem");
  await expect(withheld(page)).toHaveAttribute("data-withheld", "2");
  await expect(rows).toHaveCount(0);
  await expect(withheld(page)).toHaveAttribute("data-withheld", "1", { timeout: 3_000 });
  await expect(rows).toHaveCount(1);
  await expect(withheld(page)).toHaveAttribute("data-withheld", "0", { timeout: 3_000 });
  await expect(rows).toHaveCount(2);

  // The words belong to the arrival: once the panel closes, they are gone.
  await page.keyboard.press("Escape");
  await expect(heading(page)).toHaveCount(0);
});

test("a Book marked finished straight from Want to read was just finished", async ({ page }) => {
  await openGraph(page);
  await wantBook("Housekeeping");
  await page.goto("/");
  const row = page.getByRole("listitem").filter({ hasText: "Housekeeping" });
  await row.hover();
  await row.getByRole("button", { name: "Mark finished" }).click();
  // The row moves at once; the finish has landed once its Connections are being found.
  await expect(page.getByText("1 Book finding Connections")).toBeVisible();

  await page.goto("/graph");
  await expect(heading(page)).toHaveText("Housekeeping");
  await expect(page.getByText("You just finished this.", { exact: false })).toBeVisible();
});

test("a Book added as already read, with no dates, is new in the graph rather than just finished", async ({ page }) => {
  await openGraph(page);
  await finishBook("Housekeeping", ["Stoner"], undefined, true);
  await page.reload();

  await expect(heading(page)).toHaveText("Housekeeping");
  await expect(page.getByText("New in your graph. Here is where it sits among your earlier reading.")).toBeVisible();
  await expect(page.getByText("You just finished this.")).toHaveCount(0);
});

test("the graph remembers what it showed under the reader's own id", async ({ page }) => {
  await openGraph(page);
  const remembered = await page.evaluate((key) => localStorage.getItem(key), `marginalia:graph-shown:${await readerId()}`);
  expect(JSON.parse(remembered!)).toHaveLength(LIBRARY.length);
});

test("a Book with no Connections arrives calmly", async ({ page }) => {
  await openGraph(page);
  await finishBook("Housekeeping");
  await page.reload();

  await expect(heading(page)).toHaveText("Housekeeping");
  await expect(page.getByText("You just finished this.", { exact: true })).toBeVisible();
  await expect(page.getByText("No Connections yet.")).toBeVisible();
});

test("in a burst, new Books simply appear", async ({ page }) => {
  await openGraph(page);
  for (const [i, title] of ["Gilead", "Home", "Lila", "Jack"].entries()) await finishBook(title, ["Stoner"], { x: i, y: 1.4 });
  await page.reload();

  await expect(page.getByRole("navigation", { name: "Books in the graph" }).getByRole("button")).toHaveCount(10);
  await expect(heading(page)).toHaveCount(0);
  await expect(withheld(page)).toHaveAttribute("data-withheld", "0");
});

test("a visit on a small screen, with no graph to show it, leaves the arrival for the next one", async ({ page }) => {
  await openGraph(page);
  await finishBook("Housekeeping", ["Stoner"]);
  await page.setViewportSize({ width: 800, height: 900 });
  await page.reload();
  await expect(page.getByText("The graph needs a larger screen.")).toBeVisible();

  // Away from the graph first: widening it in place would play the arrival there and then.
  await page.goto("/");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/graph");
  await expect(heading(page)).toHaveText("Housekeeping");
});

test("an arrival waits while a panel is open, and comes on the next visit", async ({ page }) => {
  await openGraph(page);
  await page.getByRole("navigation", { name: "Books in the graph" }).getByRole("button", { name: /^Stoner, / }).focus();
  await page.keyboard.press("Enter");
  // A dismissal sends the graph off to settle; it fetches again, with Stoner's panel still open.
  const connections = page.getByRole("region", { name: "Connections" });
  await connections.getByRole("button", { name: "Dismiss" }).click();
  await connections.getByRole("button", { name: "Yes, dismiss" }).click();
  await finishBook("Housekeeping", ["Never Let Me Go"]);
  await settleGraph();
  await expect(page.getByRole("navigation", { name: "Books in the graph" }).getByRole("button")).toHaveCount(7, { timeout: 10_000 });
  await expect(heading(page)).toHaveText("Stoner");

  await page.reload();
  await expect(heading(page)).toHaveText("Housekeeping");
});

test("with reduced motion, the arrival opens at once and its Connections show together", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openGraph(page);
  await finishBook("Housekeeping", ["Stoner", "Never Let Me Go"]);
  await page.reload();

  await expect(heading(page)).toHaveText("Housekeeping");
  await expect(page.getByText("You just finished this. Here is where it sits among your earlier reading.")).toBeVisible();
  await expect(withheld(page)).toHaveAttribute("data-withheld", "0");
});
