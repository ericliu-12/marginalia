import { expect, test, type Page } from "@playwright/test";
import { UNTYPED_COLOR } from "../../src/app/graph/graph-style";
import { bookIdOf, connectByHand, connectionBetween, refreshWithJudge, seedLibrary, settleGraph } from "./database";

// Editing and deleting the reader's own Connections (#176), on the seeded chain with one made by hand:
// Stoner and Candide, untyped. The graph job is played by hand, so the graph re-settles when told.

const REASON = "Both read the winter my father was ill.";

test.beforeEach(async () => {
  await seedLibrary();
  await connectByHand(await bookIdOf("Stoner"), await bookIdOf("Candide"), REASON);
});

const books = (page: Page) => page.getByRole("navigation", { name: "Books in the graph" });
const connections = (page: Page) => page.getByRole("region", { name: "Connections" });
const form = (page: Page) => page.getByRole("form", { name: "Edit the connection" });
const reason = (page: Page) => form(page).getByRole("textbox", { name: "why they belong together" });
const cards = (page: Page) => connections(page).getByRole("listitem").filter({ has: page.getByRole("button", { name: /./ }) });
const yours = (page: Page) => cards(page).filter({ hasText: "Candide" });

async function openStonerInLibrary(page: Page) {
  await page.goto("/");
  await page.getByRole("main").getByRole("button", { name: "Stoner", exact: true }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Stoner" })).toBeVisible();
}

test("your card has Edit and Delete where the judge's has Dismiss", async ({ page }) => {
  await openStonerInLibrary(page);
  await expect(cards(page)).toHaveCount(2);
  await expect(yours(page).getByRole("button", { name: "Edit the connection to Candide" })).toBeVisible();
  await expect(yours(page).getByRole("button", { name: "Delete the connection to Candide" })).toBeVisible();
  await expect(yours(page).getByRole("button", { name: /^Dismiss/ })).toHaveCount(0);
  const judged = cards(page).filter({ hasText: "The Remains of the Day" });
  await expect(judged.getByRole("button", { name: /^Dismiss/ })).toBeVisible();
  await expect(judged.getByRole("button", { name: /^(Edit|Delete)/ })).toHaveCount(0);
});

test("editing the reason saves it in place and keeps the type", async ({ page }) => {
  await openStonerInLibrary(page);
  await yours(page).getByRole("button", { name: "Edit the connection to Candide" }).click();
  // The form stands in for the card, the other book fixed, what the reader wrote filled in.
  await expect(form(page).getByText("Candide", { exact: true })).toBeVisible();
  await expect(form(page).getByRole("button", { name: "Change the book" })).toHaveCount(0);
  await expect(reason(page)).toBeFocused();
  await expect(reason(page)).toHaveValue(REASON);
  for (const t of ["Thematic", "Contrast", "Context"]) await expect(form(page).getByRole("button", { name: t })).toHaveAttribute("aria-pressed", "false");

  // Required, as when connecting.
  await reason(page).fill("  ");
  await form(page).getByRole("button", { name: "Save" }).click();
  await expect(form(page).getByRole("alert")).toHaveText("Write why they belong together.");

  await reason(page).fill("Both read the winter the river froze.");
  await page.keyboard.press("Enter");
  await expect(form(page)).toHaveCount(0);
  await expect(yours(page)).toContainText("Candide: Both read the winter the river froze.");
  await expect(yours(page)).toContainText("yours");
  await expect(connections(page).getByRole("status").filter({ hasText: "Connection to Candide saved." })).toBeAttached();
  await expect(yours(page).getByRole("button", { name: "Edit the connection to Candide" })).toBeFocused();
  expect(await connectionBetween("Stoner", "Candide")).toMatchObject({ explanation: "Both read the winter the river froze.", type: null });
});

test("editing the type relabels the card; Cancel and Escape leave it as it was", async ({ page }) => {
  await openStonerInLibrary(page);
  const edit = yours(page).getByRole("button", { name: "Edit the connection to Candide" });
  await edit.click();
  await reason(page).fill("Something else.");
  await page.keyboard.press("Escape");
  await expect(form(page)).toHaveCount(0);
  await expect(edit).toBeFocused();
  await expect(yours(page)).toContainText(REASON);

  await edit.click();
  await expect(reason(page)).toHaveValue(REASON);
  await form(page).getByRole("button", { name: "Contrast" }).click();
  await form(page).getByRole("button", { name: "Save" }).click();
  await expect(yours(page)).toContainText("Contrast · yours");
  expect(await connectionBetween("Stoner", "Candide")).toMatchObject({ type: "contrast", explanation: REASON });

  // And back to untyped: choosing the chosen one again clears it.
  await edit.click();
  await expect(form(page).getByRole("button", { name: "Contrast" })).toHaveAttribute("aria-pressed", "true");
  await form(page).getByRole("button", { name: "Contrast" }).click();
  await form(page).getByRole("button", { name: "Cancel" }).click();
  await expect(yours(page)).toContainText("Contrast · yours");
});

test("a failed save keeps the reader's words", async ({ page }) => {
  await openStonerInLibrary(page);
  await yours(page).getByRole("button", { name: "Edit the connection to Candide" }).click();
  await reason(page).fill("Kept, whatever happens.");
  await page.route("**/*", (route) => (route.request().method() === "POST" && route.request().headers()["next-action"] ? route.abort() : route.fallback()));
  await form(page).getByRole("button", { name: "Save" }).click();
  await expect(form(page).getByRole("alert")).toHaveText("Couldn’t save. Your words are kept here.");
  await expect(reason(page)).toHaveValue("Kept, whatever happens.");
});

test("deleting asks first, keeps none of the reader's words, the judge never connects the pair again, and the reader can", async ({ page }) => {
  await openStonerInLibrary(page);
  await yours(page).getByRole("button", { name: "Delete the connection to Candide" }).click();
  await expect(connections(page).getByText("Delete this connection? Your reason goes with it.")).toBeVisible();
  await expect(connections(page).getByRole("button", { name: "Keep" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(yours(page).getByRole("button", { name: "Delete the connection to Candide" })).toBeFocused();

  await yours(page).getByRole("button", { name: "Delete the connection to Candide" }).click();
  await connections(page).getByRole("button", { name: "Yes, delete" }).click();
  await expect(yours(page)).toHaveCount(0);
  await expect(connections(page).getByRole("status").filter({ hasText: "Connection to Candide deleted." })).toBeAttached();
  await expect(connections(page).getByRole("heading", { name: "Connections" })).toBeFocused();
  expect(await connectionBetween("Stoner", "Candide")).toMatchObject({ madeBy: "reader", explanation: "", type: null, dismissedAt: expect.any(Date) });

  // A Refresh of either Book never shows the judge the pair.
  expect(await refreshWithJudge("Stoner")).not.toContain("Candide");
  expect(await refreshWithJudge("Candide")).not.toContain("Stoner");
  expect(await connectionBetween("Stoner", "Candide")).toMatchObject({ madeBy: "reader", explanation: "", dismissedAt: expect.any(Date) });

  // The reader connects it again by hand.
  await page.reload();
  await page.getByRole("main").getByRole("button", { name: "Stoner", exact: true }).click();
  await expect(yours(page)).toHaveCount(0);
  await connections(page).getByRole("button", { name: "Connect a book" }).click();
  const connect = page.getByRole("form", { name: "Connect a book" });
  await page.keyboard.type("candide");
  await connect.getByRole("button", { name: /^Candide/ }).click();
  await connect.getByRole("textbox", { name: "why they belong together" }).fill("Again, after all.");
  await connect.getByRole("button", { name: "Connect" }).click();
  await expect(yours(page)).toContainText("Candide: Again, after all.");
  expect(await connectionBetween("Stoner", "Candide")).toMatchObject({ madeBy: "reader", explanation: "Again, after all.", dismissedAt: null });
});

// The canvas's pixels in the untyped line's edge, in CSS pixels on the page (as in yours.spec.ts).
function edgePixels(page: Page) {
  const edge = [1, 3, 5].map((i) => parseInt(UNTYPED_COLOR.slice(i, i + 2), 16));
  return page.locator("canvas").evaluate((canvas: HTMLCanvasElement, edge) => {
    const { data, width } = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
    const box = canvas.getBoundingClientRect();
    const scale = canvas.width / box.width;
    const hits: { x: number; y: number }[] = [];
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] / 255 < 0.1) continue;
      if ([0, 1, 2].every((k) => Math.abs(data[i + k] - edge[k]) <= 8)) {
        const p = i / 4;
        hits.push({ x: box.left + (p % width) / scale, y: box.top + Math.floor(p / width) / scale });
      }
    }
    return hits;
  }, edge);
}

test("the graph's connection panel edits and deletes your own, and its line leaves once the graph re-settles", async ({ page }) => {
  await page.goto("/graph");
  await expect(page.locator("canvas")).toBeVisible();
  await page.waitForTimeout(600);
  const hits = await edgePixels(page);
  expect(hits.length).toBeGreaterThan(100);
  const [left, right] = [hits.reduce((p, q) => (q.x < p.x ? q : p)), hits.reduce((p, q) => (q.x > p.x ? q : p))];
  // Near Stoner's end: the middle of the line crosses the chain's.
  const at = { x: left.x + (right.x - left.x) * 0.15, y: left.y + (right.y - left.y) * 0.15 };
  await page.mouse.move(at.x, at.y);
  await expect.poll(() => page.evaluate(() => document.querySelector<HTMLElement>("canvas")!.closest<HTMLElement>("[aria-hidden]")!.style.cursor)).toBe("pointer");
  await page.mouse.click(at.x, at.y);

  const panel = page.getByRole("complementary", { name: "Connection" });
  await expect(panel.getByRole("heading", { level: 2 })).toContainText("Candide");
  await expect(panel.getByRole("button", { name: "Dismiss" })).toHaveCount(0);

  await panel.getByRole("button", { name: "Edit" }).click();
  await expect(reason(page)).toBeFocused();
  await form(page).getByRole("button", { name: "Thematic" }).click();
  await reason(page).fill("The same winter.");
  await form(page).getByRole("button", { name: "Save" }).click();
  await expect(panel.getByText("The same winter.")).toBeVisible();
  await expect(panel.getByText("Thematic · yours")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Edit" })).toBeFocused();

  await panel.getByRole("button", { name: "Delete" }).click();
  await expect(panel.getByRole("button", { name: "Keep" })).toBeFocused();
  await panel.getByRole("button", { name: "Yes, delete" }).click();
  await expect(panel.getByText("This connection is no longer in your graph.")).toBeFocused();
  await expect(panel.getByRole("status").filter({ hasText: /^Connection between (Stoner and Candide|Candide and Stoner) deleted\.$/ })).toBeAttached();

  await settleGraph();
  await expect(books(page).getByRole("button", { name: "Stoner, 1 connection" })).toBeAttached();
});

test.describe("on the phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("the Book screen edits and deletes with 44px targets", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("main").getByRole("button", { name: /^Stoner/ }).click();
    for (const name of ["Edit the connection to Candide", "Delete the connection to Candide"]) {
      const box = await yours(page).getByRole("button", { name }).boundingBox();
      expect(box!.height, name).toBeGreaterThanOrEqual(44);
      expect(box!.width, name).toBeGreaterThanOrEqual(44);
    }
    await yours(page).getByRole("button", { name: "Edit the connection to Candide" }).click();
    for (const name of ["Thematic", "Contrast", "Context", "Save", "Cancel"]) {
      const box = await form(page).getByRole("button", { name, exact: true }).boundingBox();
      expect(box!.height, name).toBeGreaterThanOrEqual(44);
      expect(box!.width, name).toBeGreaterThanOrEqual(44);
    }
    await reason(page).fill("Ghosts, both.");
    await form(page).getByRole("button", { name: "Save" }).click();
    await expect(yours(page)).toContainText("Candide: Ghosts, both.");

    await yours(page).getByRole("button", { name: "Delete the connection to Candide" }).click();
    for (const name of ["Yes, delete", "Keep"]) {
      const box = await connections(page).getByRole("button", { name }).boundingBox();
      expect(box!.height, name).toBeGreaterThanOrEqual(44);
    }
    await connections(page).getByRole("button", { name: "Yes, delete" }).click();
    await expect(yours(page)).toHaveCount(0);
  });
});
