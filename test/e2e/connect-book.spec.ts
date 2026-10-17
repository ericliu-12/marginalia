import { expect, test, type Page } from "@playwright/test";
import { UNTYPED_COLOR } from "../../src/app/graph/graph-style";
import { seedLibrary, settleGraph } from "./database";

// "Connect a book" in the Book panel (#178), on the seeded chain where Stoner's one Connection is the
// judge's, to The Remains of the Day. The graph job is played by hand, so the graph re-settles when told.

test.beforeEach(async () => {
  await seedLibrary();
});

const books = (page: Page) => page.getByRole("navigation", { name: "Books in the graph" });
const connections = (page: Page) => page.getByRole("region", { name: "Connections" });
const form = (page: Page) => page.getByRole("form", { name: "Connect a book" });
const cards = (page: Page) => connections(page).getByRole("listitem").filter({ has: page.getByRole("button", { name: /./ }) });

async function openStonerInGraph(page: Page) {
  await page.goto("/graph");
  await expect(page.locator("canvas")).toBeVisible();
  await books(page).getByRole("button", { name: /^Stoner, / }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 2 })).toHaveText("Stoner");
}

// Picks the other Book from the form's search.
async function choose(page: Page, query: string, title: string) {
  await connections(page).getByRole("button", { name: "Connect a book" }).click();
  await expect(form(page).getByRole("searchbox", { name: "connect with" })).toBeFocused();
  await page.keyboard.type(query);
  await form(page).getByRole("button", { name: new RegExp(`^${title}`) }).click();
  await expect(form(page).getByText(title, { exact: true })).toBeVisible();
}

// How many of the canvas's pixels are the untyped line's neutral edge, laid over the paper.
function edgePixels(page: Page) {
  const edge = [1, 3, 5].map((i) => parseInt(UNTYPED_COLOR.slice(i, i + 2), 16));
  return page.locator("canvas").evaluate((canvas: HTMLCanvasElement, edge) => {
    const { data } = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3] / 255;
      if (a < 0.95) continue;
      if ([0, 1, 2].every((k) => Math.abs(data[i + k] - edge[k]) <= 3)) n++;
    }
    return n;
  }, edge);
}

test("connecting two Books puts yours first, says so, and draws its line on the graph in the edge", async ({ page }) => {
  await openStonerInGraph(page);
  await page.waitForTimeout(600);
  const before = await edgePixels(page);

  await choose(page, "volt", "Candide");
  await expect(form(page).getByText(/^Replaces:/)).toHaveCount(0);
  await expect(form(page).getByRole("textbox", { name: "why they belong together" })).toBeFocused();
  await page.keyboard.type("Both read the winter my father was ill.");
  await form(page).getByRole("button", { name: "Connect" }).click();

  await expect(form(page)).toHaveCount(0);
  await expect(cards(page)).toHaveCount(2);
  await expect(cards(page).first()).toContainText("yours");
  await expect(cards(page).first()).toContainText("Candide: Both read the winter my father was ill.");
  // Your own card has no Dismiss; the judge's still does.
  await expect(cards(page).first().getByRole("button", { name: /^Dismiss/ })).toHaveCount(0);
  await expect(connections(page).getByRole("status").filter({ hasText: "Connected to Candide" })).toBeAttached();
  await expect(connections(page).getByRole("heading", { name: "Connections" })).toBeFocused();
  await expect(connections(page).getByText("Your first connection")).toHaveCount(0);

  await settleGraph();
  await expect(books(page).getByRole("button", { name: "Stoner, 2 connections" })).toBeAttached();
  await page.keyboard.press("Escape");
  await page.mouse.move(2, 450);
  await expect.poll(async () => (await edgePixels(page)) - before, { timeout: 5000 }).toBeGreaterThan(100);
});

test("connecting a pair the judge connected replaces its connection, its type chosen first", async ({ page }) => {
  await openStonerInGraph(page);
  await choose(page, "remains", "The Remains of the Day");
  await expect(form(page).getByText("Replaces: Thematic · Strong — Why Stoner meets The Remains of the Day.")).toBeVisible();
  const thematic = form(page).getByRole("button", { name: "Thematic" });
  await expect(thematic).toHaveAttribute("aria-pressed", "true");
  // Choosing it again clears it; choosing it once more picks it back.
  await thematic.click();
  await expect(thematic).toHaveAttribute("aria-pressed", "false");
  await thematic.click();
  await form(page).getByRole("textbox", { name: "why they belong together" }).fill("Two men who kept to their posts.");
  await page.keyboard.press("Enter");

  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page).first()).toContainText("Thematic · yours");
  await expect(cards(page).first()).toContainText("The Remains of the Day: Two men who kept to their posts.");
  await expect(connections(page).getByText("Why Stoner meets The Remains of the Day.")).toHaveCount(0);
});

test("the search leaves out this Book and the ones already connected by hand", async ({ page }) => {
  await openStonerInGraph(page);
  await choose(page, "remains", "The Remains of the Day");
  await form(page).getByRole("textbox", { name: "why they belong together" }).fill("Kept to their posts.");
  await form(page).getByRole("button", { name: "Connect" }).click();
  await expect(cards(page)).toHaveCount(1);

  await connections(page).getByRole("button", { name: "Connect a book" }).click();
  const search = form(page).getByRole("searchbox", { name: "connect with" });
  await search.fill("stoner");
  await expect(form(page).getByText("No finished book matches.")).toBeVisible();
  await search.fill("remains");
  await expect(form(page).getByText("No finished book matches.")).toBeVisible();
  // By author too, accents aside.
  await search.fill("ishiguro");
  await expect(form(page).getByRole("button", { name: /^Never Let Me Go/ })).toBeVisible();
  await expect(form(page).getByRole("button", { name: /^The Remains/ })).toHaveCount(0);

  // Escape clears the search first, then closes, and focus goes back to where it opened.
  await page.keyboard.press("Escape");
  await expect(search).toHaveValue("");
  await expect(form(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(form(page)).toHaveCount(0);
  await expect(connections(page).getByRole("button", { name: "Connect a book" })).toBeFocused();
  await expect(page.getByRole("heading", { level: 2 })).toHaveText("Stoner");
});

test("a reason is required, and holds to 200 characters, counting down the last 20", async ({ page }) => {
  await openStonerInGraph(page);
  await choose(page, "candide", "Candide");
  const reason = form(page).getByRole("textbox", { name: "why they belong together" });
  await form(page).getByRole("button", { name: "Connect" }).click();
  await expect(form(page).getByRole("alert")).toHaveText("Write why they belong together.");
  await expect(reason).toBeFocused();
  await expect(reason).toHaveAttribute("aria-invalid", "true");

  await reason.fill("x".repeat(179));
  await expect(form(page).getByRole("alert")).toHaveCount(0);
  await expect(form(page).getByText(/ left$/)).toHaveCount(0);
  await reason.fill("x".repeat(185));
  await expect(form(page).getByText("15 left")).toBeVisible();
  await reason.pressSequentially("y".repeat(30));
  await expect(reason).toHaveValue("x".repeat(185) + "y".repeat(15));
  await expect(form(page).getByText("0 left")).toBeVisible();

  // Change goes back to the search, keeping what was typed.
  await form(page).getByRole("button", { name: "Change the book" }).click();
  await expect(form(page).getByRole("searchbox", { name: "connect with" })).toHaveValue("candide");
});

test("the library's Book panel connects the same way", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("main").getByRole("button", { name: "Candide", exact: true }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Candide" })).toBeVisible();
  await choose(page, "williams", "Stoner");
  await form(page).getByRole("button", { name: "Context" }).click();
  await form(page).getByRole("textbox", { name: "why they belong together" }).fill("Both on the same shelf at my grandmother’s.");
  await form(page).getByRole("button", { name: "Connect" }).click();
  await expect(cards(page).first()).toContainText("Context · yours");
  await expect(cards(page).first()).toContainText("Stoner: Both on the same shelf at my grandmother’s.");
});

test.describe("on the phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("the Book screen connects the same way, with 44px targets", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("main").getByRole("button", { name: /^Stoner/ }).click();
    await expect(page.getByRole("complementary", { name: "Notes on Stoner" }).getByRole("heading", { level: 2 })).toHaveText("Stoner");
    await choose(page, "beloved", "Beloved");
    for (const name of ["Change the book", "Thematic", "Contrast", "Context", "Connect", "Cancel"]) {
      const box = await form(page).getByRole("button", { name, exact: true }).boundingBox();
      expect(box!.height, name).toBeGreaterThanOrEqual(44);
      expect(box!.width, name).toBeGreaterThanOrEqual(44);
    }
    await form(page).getByRole("textbox", { name: "why they belong together" }).fill("Ghosts, both.");
    await form(page).getByRole("button", { name: "Connect" }).click();
    await expect(cards(page).first()).toContainText("Beloved: Ghosts, both.");
  });
});
