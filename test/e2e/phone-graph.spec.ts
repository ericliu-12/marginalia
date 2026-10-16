import { expect, test, type Page } from "@playwright/test";
import { addCluster, finishBook, seedLibrary } from "./database";

// The graph on a phone (#141): the Shelf / Graph switch, a tap that chooses a Book (or a Cluster by its
// name) and raises its sheet, and the ways back to the whole graph. Dots and bare paper are found from
// the canvas's own pixels.

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test.beforeEach(async () => {
  await seedLibrary();
});

const sheet = (page: Page) => page.getByRole("region");
const views = (page: Page) => page.getByRole("navigation", { name: "Views" });
const wholeGraph = (page: Page) => page.getByRole("button", { name: "Whole graph" });

async function openGraph(page: Page) {
  await page.goto("/graph");
  await expect(page.locator("canvas")).toBeVisible();
  // The first view is fitted once the canvas has its size.
  await page.waitForTimeout(600);
}

// Where the canvas shows between the header and the legend (or sheet): the centres of Books' dots, and
// a spot of bare paper with nothing drawn within 40px.
async function canvasSpots(page: Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector("canvas")!;
    const box = canvas.getBoundingClientRect();
    const s = canvas.width / box.width;
    const { data, width, height } = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
    const alpha = (x: number, y: number) => {
      const [px, py] = [Math.round(x * s), Math.round(y * s)];
      return px < 0 || py < 0 || px >= width || py >= height ? 0 : data[(py * width + px) * 4 + 3];
    };
    const ink = (x: number, y: number) => {
      const i = (Math.round(y * s) * width + Math.round(x * s)) * 4;
      return data[i + 3] > 200 && data[i] < 60 && data[i + 1] < 60 && data[i + 2] < 60;
    };
    const chrome = [...document.querySelectorAll("[data-graph-chrome]")].map((el) => el.getBoundingClientRect());
    const top = Math.max(...chrome.filter((r) => r.top <= 0).map((r) => r.bottom));
    const bottom = Math.min(...chrome.filter((r) => r.top > 0).map((r) => r.top));
    const dots: { x: number; y: number }[] = [];
    let paper: { x: number; y: number } | null = null;
    for (let y = top + 4; y < bottom - 4; y += 2)
      for (let x = 4; x < box.width - 4; x += 2) {
        // A dot: solid ink 6px across, which no stroke of a label is.
        if ([-3, 0, 3].every((dx) => [-3, 0, 3].every((dy) => ink(x + dx, y + dy))) && !dots.some((d) => Math.hypot(d.x - x, d.y - y) < 12)) dots.push({ x, y });
        if (!paper && y > top + 40 && y < bottom - 40 && x > 40 && x < box.width - 40) {
          let clear = true;
          for (let r = 0; r <= 40 && clear; r += 4) for (let k = 0; k < 16 && clear; k++) clear = alpha(x + Math.cos(k) * r, y + Math.sin(k) * r) < 8;
          if (clear) paper = { x, y };
        }
      }
    return { dots: dots.map((d) => ({ x: box.left + d.x, y: box.top + d.y })), paper: paper && { x: box.left + paper.x, y: box.top + paper.y } };
  });
}

test("the switch goes from the shelf to the graph and back, at the same place on both", async ({ page }) => {
  await page.goto("/");
  await expect(views(page).getByText("Shelf")).toHaveAttribute("aria-current", "page");
  const at = (await views(page).boundingBox())!.y;
  await views(page).getByRole("link", { name: "Graph" }).tap();
  await expect(page).toHaveURL(/\/graph$/);
  await expect(views(page).getByText("Graph")).toHaveAttribute("aria-current", "page");
  expect((await views(page).boundingBox())!.y).toBe(at);
  await expect(page.getByText("Tap a book or a cluster’s name. Pinch to zoom.")).toBeVisible();
  await expect(page.getByRole("list", { name: "Connection types" })).toHaveText(/thematic\s*contrast\s*context/);
  await views(page).getByRole("link", { name: "Shelf" }).tap();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Reading" })).toBeVisible();
});

test("a tap beside a small dot chooses its Book and raises its sheet; a tap on bare paper lets go", async ({ page }) => {
  await openGraph(page);
  const { dots, paper } = await canvasSpots(page);
  expect(dots.length).toBeGreaterThan(0);
  // Off the dot, within the 44px target around it.
  await page.touchscreen.tap(dots[0].x + 15, dots[0].y);
  await expect(sheet(page)).toBeVisible();
  await expect(sheet(page).getByRole("heading", { level: 2 })).toHaveText(/Stoner|The Remains of the Day|Never Let Me Go|Beloved|The Plague|Candide/);
  await expect(wholeGraph(page)).toBeVisible();
  await expect(views(page)).toHaveCount(0);

  await page.waitForTimeout(900);
  const after = await canvasSpots(page);
  expect(paper ?? after.paper).not.toBeNull();
  await page.touchscreen.tap(after.paper!.x, after.paper!.y);
  await expect(sheet(page)).toHaveCount(0);
  await expect(views(page)).toBeVisible();
});

test("the sheet shows a Book's author, Connections with their types, and the rest on request; Whole graph goes back", async ({ page }) => {
  await finishBook("Housekeeping", ["Stoner", "Beloved", "The Plague", "Candide"], { x: 2.5, y: 1.2 });
  await openGraph(page);
  await page.getByRole("navigation", { name: "Books in the graph" }).getByRole("button", { name: /^Housekeeping, / }).focus();
  await page.keyboard.press("Enter");

  await expect(sheet(page).getByRole("heading", { level: 2 })).toHaveText("Housekeeping");
  await expect(sheet(page).getByRole("heading", { level: 2 })).toBeFocused();
  await expect(sheet(page).getByText("A. Writer · 4 connections")).toBeVisible();
  await expect(sheet(page).getByRole("link", { name: "Open book" })).toHaveAttribute("href", /\/\?book=.+&from=graph/);
  const connections = sheet(page).getByRole("list", { name: "Connections" }).getByRole("listitem");
  await expect(connections).toHaveCount(3);
  await expect(connections.first()).toContainText("Thematic · Strong");
  await expect(connections.first()).toContainText(/Why Housekeeping meets /);
  await sheet(page).getByRole("button", { name: "Show 1 more" }).tap();
  await expect(connections).toHaveCount(4);

  // Another Book in the sheet chooses it on the graph.
  await sheet(page).getByRole("button", { name: "Stoner" }).tap();
  await expect(sheet(page).getByRole("heading", { level: 2 })).toHaveText("Stoner");

  await wholeGraph(page).tap();
  await expect(sheet(page)).toHaveCount(0);
  await expect(views(page).getByText("Graph")).toHaveAttribute("aria-current", "page");
  await expect(page).toHaveURL(/\/graph$/);
});

test("back lets go of the chosen Book rather than leaving the graph", async ({ page }) => {
  await openGraph(page);
  await page.getByRole("navigation", { name: "Books in the graph" }).getByRole("button", { name: /^Beloved, / }).focus();
  await page.keyboard.press("Enter");
  await expect(sheet(page)).toBeVisible();
  await page.goBack();
  await expect(sheet(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/graph$/);
  await expect(page.locator("canvas")).toBeVisible();
});

test("choosing one Book after another is one step in history: one back lets go, the next leaves the graph", async ({ page }) => {
  await page.goto("/");
  await views(page).getByRole("link", { name: "Graph" }).tap();
  await expect(page).toHaveURL(/\/graph$/);
  await expect(page.locator("canvas")).toBeVisible();
  for (const title of ["Beloved", "Stoner", "Candide"]) {
    await page.getByRole("navigation", { name: "Books in the graph" }).getByRole("button", { name: new RegExp(`^${title}, `) }).focus();
    await page.keyboard.press("Enter");
    await expect(sheet(page).getByRole("heading", { level: 2 })).toHaveText(title);
  }
  await page.goBack();
  await expect(sheet(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/graph$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Reading" })).toBeVisible();
});

test("Open book shows the Book screen, whose back returns to the graph", async ({ page }) => {
  await openGraph(page);
  await page.getByRole("navigation", { name: "Books in the graph" }).getByRole("button", { name: /^Beloved, / }).focus();
  await page.keyboard.press("Enter");
  await sheet(page).getByRole("link", { name: "Open book" }).tap();
  await expect(page.getByRole("heading", { level: 2, name: "Beloved" })).toBeVisible();
  await page.getByRole("button", { name: "Back to the graph" }).tap();
  await expect(page).toHaveURL(/\/graph(\?chosen)?$/);
  await expect(page.locator("canvas")).toBeVisible();
});

test("a tap on a Cluster's name chooses the Cluster and lists its Books; Escape lets go", async ({ page }) => {
  await addCluster(["Stoner", "The Remains of the Day", "Never Let Me Go"], { name: "Lives held in check", description: "Each follows a life spent keeping to a part." });
  await openGraph(page);
  const name = page.locator("[data-cluster-name]");
  await expect(name).toBeVisible();
  const box = (await name.boundingBox())!;
  // Its target reaches 44px tall, past its plate.
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height + 8);
  await expect(sheet(page).getByRole("heading", { level: 2 })).toHaveText("Lives held in check");
  await expect(sheet(page).getByText("cluster of 3 books")).toBeVisible();
  await expect(sheet(page).getByRole("list", { name: "Books in this cluster" }).getByRole("listitem")).toHaveCount(3);
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toHaveCount(0);
});
