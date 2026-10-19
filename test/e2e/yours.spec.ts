import { expect, test, type Page } from "@playwright/test";
import { UNTYPED_COLOR } from "../../src/app/graph/graph-style";
import { clickLine } from "./line-click";
import { bookIdOf, connectByHand, finishBook, seedLargeLibrary, seedLibrary, titleOf } from "./database";

// Manual Connections on the graph and the phone sheet (#175): labelled "yours", first, never "New", and
// drawn as strong lines at every zoom. The untyped ones are found on the canvas by the neutral edge,
// which nothing else is drawn in.

const books = (page: Page) => page.getByRole("navigation", { name: "Books in the graph" });

async function openGraph(page: Page) {
  await page.goto("/graph");
  await expect(page.locator("canvas")).toBeVisible();
  // The first view is fitted once the canvas has its size.
  await page.waitForTimeout(600);
}

test.describe("on the desktop graph", () => {
  test.beforeEach(async () => {
    await seedLibrary();
  });

  test("clicking a Manual Connection's line shows its card: yours, the reason, no Dismiss", async ({ page }) => {
    await connectByHand(await bookIdOf("Stoner"), await bookIdOf("Candide"), "Both read the winter my father was ill.");
    await openGraph(page);
    await clickLine(page, UNTYPED_COLOR);

    const panel = page.getByRole("complementary", { name: "Connection" });
    await expect(panel.getByRole("heading", { level: 2 })).toContainText("Stoner");
    await expect(panel.getByRole("heading", { level: 2 })).toContainText("Candide");
    await expect(panel.getByText("yours", { exact: true })).toBeVisible();
    await expect(panel.getByText("Both read the winter my father was ill.")).toBeVisible();
    await expect(panel.getByRole("button", { name: /^Dismiss/ })).toHaveCount(0);
  });

  test("an arriving Book's own Connection is not marked New, and comes first", async ({ page }) => {
    await openGraph(page);
    await finishBook("Housekeeping", ["Stoner"]);
    await connectByHand(await bookIdOf("Housekeeping"), await bookIdOf("Candide"), "Lent to me by the same friend.", "context");
    await page.reload();

    await expect(page.getByRole("heading", { level: 2 })).toHaveText("Housekeeping");
    await expect(page.locator("[data-withheld]")).toHaveAttribute("data-withheld", "0", { timeout: 5_000 });
    const rows = page.getByRole("region", { name: "Connections" }).getByRole("listitem");
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText("Context · yours");
    await expect(rows.first()).not.toContainText("New");
    await expect(rows.nth(1)).toContainText("Thematic · Strong · New");
    await expect(page.getByText("Your first connection")).toHaveCount(0);
  });
});

test.describe("on the phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test.beforeEach(async () => {
    await seedLibrary();
  });

  test("the sheet lists yours first, newest first, labelled yours, then the judge's after Show more", async ({ page }) => {
    const stoner = await bookIdOf("Stoner");
    await connectByHand(stoner, await bookIdOf("Candide"), "Oldest.", "contrast");
    await connectByHand(stoner, await bookIdOf("Beloved"), "Middle.");
    await connectByHand(stoner, await bookIdOf("The Plague"), "Newest.", "thematic");
    await openGraph(page);
    await books(page).getByRole("button", { name: /^Stoner, / }).focus();
    await page.keyboard.press("Enter");

    const sheet = page.getByRole("region");
    await expect(sheet.getByRole("heading", { level: 2 })).toHaveText("Stoner");
    const rows = sheet.getByRole("list", { name: "Connections" }).getByRole("listitem");
    await expect(rows).toHaveCount(3);
    await expect(rows).toContainText(["Thematic · yours", "yours", "Contrast · yours"]);
    await expect(rows.nth(1)).toContainText("Beloved: Middle.");
    await expect(rows.nth(1).locator("p").first()).toHaveText("yours");
    await sheet.getByRole("button", { name: "Show 1 more" }).tap();
    await expect(rows.nth(3)).toContainText("Thematic · Strong");
    await expect(rows.nth(3)).toContainText("The Remains of the Day: Why Stoner meets The Remains of the Day.");
  });
});

test.describe("a large graph", () => {
  test("a Manual Connection shows faintly zoomed out, and fully once one of its Books is chosen", async ({ page }) => {
    await seedLargeLibrary(120);
    // Two Books in different Clusters.
    const [a, b] = ["00000000-0000-4000-9000-000000000001", "00000000-0000-4000-9000-000000000002"];
    await connectByHand(a, b, "Both on the night train.");
    await openGraph(page);
    const canvas = page.locator("[data-withheld]");
    await expect(canvas).toHaveAttribute("data-detail", "on");
    // Zoomed out, to where only strong lines show, and faintly; the canvas says how much of each
    // Manual Connection it draws.
    const box = (await page.locator("canvas").boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2);
    for (let i = 0; i < 4; i++) {
      await page.mouse.wheel(0, 120);
      await page.waitForTimeout(40);
    }
    await page.mouse.move(2, box.y + box.height / 2);
    await page.waitForTimeout(400);
    const shown = async () => Number(await canvas.getAttribute("data-yours"));
    await expect.poll(shown).toBeGreaterThanOrEqual(0.3);
    expect(await shown()).toBeLessThan(0.5);

    const title = await titleOf(a);
    await books(page).getByRole("button", { name: new RegExp(`^${title}, `) }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("complementary", { name: `Notes on ${title}` })).toBeVisible();
    await expect.poll(shown).toBe(1);
  });
});
