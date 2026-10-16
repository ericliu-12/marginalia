import { expect, test, type Page } from "@playwright/test";
import { CLUSTER_TINTS } from "../../src/app/cluster-tint";
import { WASH_ALPHA } from "../../src/app/graph/graph-style";
import { addCluster, seedLibrary } from "./database";

// A click inside a Cluster's wash chooses the Cluster (#48), found from the canvas's own pixels: a
// patch of paper the wash's tint lies on evenly, with no line, dot or label near it.

test.beforeEach(async () => {
  await seedLibrary();
});

const QUIET = { name: "Lives held in check", description: "Each follows a life spent keeping to a part." };
// Mauve: far from every Connection Type hue.
const WASH = 2;
const panel = (page: Page) => page.getByRole("complementary", { name: "Cluster" });
const heading = (page: Page) => page.getByRole("heading", { level: 2 });
const cursor = (page: Page) => page.evaluate(() => document.querySelector<HTMLElement>("[data-withheld]")!.style.cursor);

// The middle of a patch at least 9px across of one colour: the wash at its fullest, at this strength
// (or bare paper, at 0), on the canvas and under nothing else.
async function patch(page: Page, alpha: number) {
  // Off every wash first, so none is deepened under the pointer.
  await page.mouse.move(2, 450);
  const tint = [1, 3, 5].map((i) => parseInt(CLUSTER_TINTS[WASH].tint.slice(i, i + 2), 16));
  const paper = [0xfb, 0xf8, 0xf1];
  const want = paper.map((p, i) => Math.round(p * (1 - alpha) + tint[i] * alpha));
  return page.evaluate((want) => {
    const canvas = document.querySelector("canvas")!;
    const box = canvas.getBoundingClientRect();
    const s = canvas.width / box.width;
    const { data, width } = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
    // The canvas is transparent: paper shows through where nothing is drawn.
    const near = (x: number, y: number) => {
      const i = (Math.round(y * s) * width + Math.round(x * s)) * 4;
      const a = data[i + 3] / 255;
      return [0xfb, 0xf8, 0xf1].every((p, k) => Math.abs(p * (1 - a) + data[i + k] * a - want[k]) <= 4);
    };
    for (let y = 120; y < box.height - 120; y += 3)
      for (let x = 60; x < box.width - 60; x += 3) {
        if (![-4, 0, 4].every((dx) => [-4, 0, 4].every((dy) => near(x + dx, y + dy)))) continue;
        if (document.elementFromPoint(box.left + x, box.top + y) !== canvas) continue;
        return { x: box.left + x, y: box.top + y };
      }
    return null;
  }, want);
}

// Hovers until the canvas has worked out what is under the pointer, then clicks there.
async function clickAt(page: Page, at: { x: number; y: number }) {
  await page.mouse.move(at.x, at.y);
  await page.mouse.move(at.x + 1, at.y);
  await expect.poll(() => cursor(page)).toBe("pointer");
  await page.mouse.click(at.x + 1, at.y);
}

test("a click inside a wash chooses its Cluster, and a second click there lets it go", async ({ page }) => {
  await addCluster(["Stoner", "The Remains of the Day", "Never Let Me Go"], QUIET, WASH);
  await page.goto("/graph");
  await expect(page.locator("canvas")).toBeVisible();
  await page.waitForTimeout(500);

  const at = await patch(page, WASH_ALPHA.rest);
  expect(at).not.toBeNull();
  await clickAt(page, at!);
  await expect(panel(page).getByRole("heading", { level: 2 })).toHaveText(QUIET.name);

  // The view glides to the Cluster; its wash, deeper now, takes a second click.
  await page.waitForTimeout(900);
  const chosen = await patch(page, WASH_ALPHA.chosen);
  expect(chosen).not.toBeNull();
  await clickAt(page, chosen!);
  await expect(panel(page)).toHaveCount(0);
});

test("a click on bare paper, or Escape, still lets go of a Cluster", async ({ page }) => {
  await addCluster(["Stoner", "The Remains of the Day", "Never Let Me Go"], QUIET, WASH);
  await page.goto("/graph");
  await expect(page.locator("canvas")).toBeVisible();
  await page.waitForTimeout(500);

  const at = (await patch(page, WASH_ALPHA.rest))!;
  await clickAt(page, at);
  await expect(panel(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);

  await page.waitForTimeout(900);
  await clickAt(page, (await patch(page, WASH_ALPHA.rest))!);
  await expect(panel(page)).toBeVisible();
  await page.waitForTimeout(900);
  const bare = (await patch(page, 0))!;
  await page.mouse.move(bare.x, bare.y);
  await expect.poll(() => cursor(page)).toBe("");
  await page.mouse.click(bare.x, bare.y);
  await expect(panel(page)).toHaveCount(0);
});

test("a Book inside a wash is chosen before its Cluster", async ({ page }) => {
  await addCluster(["Stoner", "The Remains of the Day", "Never Let Me Go", "Beloved", "The Plague", "Candide"], QUIET, WASH);
  await page.goto("/graph");
  await expect(page.locator("canvas")).toBeVisible();
  await page.waitForTimeout(500);

  // A Book's dot: solid ink, with nothing over it.
  const dot = await page.locator("canvas").evaluate((c: HTMLCanvasElement) => {
    const s = c.width / c.clientWidth;
    const box = c.getBoundingClientRect();
    const { data, width } = c.getContext("2d")!.getImageData(0, 0, c.width, c.height);
    const ink = (x: number, y: number) => {
      const i = (Math.round(y * s) * width + Math.round(x * s)) * 4;
      return data[i + 3] > 200 && data[i] < 80 && data[i + 1] < 80 && data[i + 2] < 80;
    };
    for (let y = 150; y < c.clientHeight - 150; y += 2)
      for (let x = 150; x < c.clientWidth - 150; x += 2) {
        if (![-3, 0, 3].every((dx) => [-3, 0, 3].every((dy) => ink(x + dx, y + dy)))) continue;
        if (document.elementFromPoint(box.left + x, box.top + y) === c) return { x: box.left + x, y: box.top + y };
      }
    return null;
  });
  expect(dot).not.toBeNull();
  // The wash under the Book already shows the pointer: wait for the canvas to know the Book is there
  // (force-graph marks its canvas clickable over a Book or Connection only).
  await page.mouse.move(dot!.x, dot!.y);
  await page.mouse.move(dot!.x + 1, dot!.y);
  await expect(page.locator("canvas.clickable")).toHaveCount(1);
  await page.mouse.click(dot!.x + 1, dot!.y);
  await expect(heading(page)).not.toHaveText(QUIET.name);
  await expect(page.getByRole("complementary", { name: "Cluster" })).toHaveCount(0);
});
