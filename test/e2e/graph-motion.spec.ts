import { expect, test, type Page } from "@playwright/test";
import { seedSmallLibrary } from "./database";

// The graph holds still until the reader drags a Book, and a dragged Book settles back to its place.
// Read from the canvas's own pixels, on a close-knit library laid out by the worker: Books near enough
// that the drag's simulation would push them apart if it ran on its own.

const TITLES = ["Stoner", "Middlemarch", "Beloved", "The Plague", "Candide", "Persuasion", "Ulysses", "Emma"];
const LINKED: [number, number][] = [[0, 1], [0, 2], [1, 2], [1, 3], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [4, 6], [2, 5]];

test.beforeEach(async ({ page }) => {
  await seedSmallLibrary(TITLES, LINKED);
  await page.goto("/graph");
  await expect(page.locator("canvas")).toBeVisible();
  // The graph fits itself to the screen on its first frame.
  await page.waitForTimeout(500);
});

const pixels = (page: Page) => page.locator("canvas").evaluate((c: HTMLCanvasElement) => c.toDataURL());

// Where the canvas is solid ink around a point (a Book's dot, not a line or a letter): within a few
// pixels of `at` (a drag settles each Book near its place, not on it), or anywhere, the first found.
const inkDots = (page: Page, at?: { x: number; y: number }) =>
  page.locator("canvas").evaluate((c: HTMLCanvasElement, at) => {
    const s = c.width / c.clientWidth;
    const { data, width } = c.getContext("2d")!.getImageData(0, 0, c.width, c.height);
    const ink = (x: number, y: number) => {
      const i = (Math.round(y * s) * width + Math.round(x * s)) * 4;
      return data[i + 3] > 200 && data[i] < 80 && data[i + 1] < 80 && data[i + 2] < 80;
    };
    const solid = (x: number, y: number) => [-3, 0, 3].every((dx) => [-3, 0, 3].every((dy) => ink(x + dx, y + dy)));
    const [x0, y0, x1, y1, step] = at ? [at.x - 4, at.y - 4, at.x + 4, at.y + 4, 1] : [150, 150, c.clientWidth - 150, c.clientHeight - 150, 4];
    for (let y = y0; y <= y1; y += step) for (let x = x0; x <= x1; x += step) if (solid(x, y)) return { x, y };
    return null;
  }, at);
const dotAt = async (page: Page, at: { x: number; y: number }) => (await inkDots(page, at)) !== null;

test("the graph holds still as it loads", async ({ page }) => {
  const settled = await pixels(page);
  await page.waitForTimeout(2500);
  expect(await pixels(page)).toBe(settled);
});

test("a dragged Book settles back to its place", async ({ page }) => {
  const home = (await inkDots(page))!;
  expect(home).not.toBeNull();
  await page.mouse.move(home.x, home.y);
  // Held only once the canvas knows the Book is under the pointer, or the drag pans the view instead.
  await expect(page.locator("[data-withheld]")).toHaveCSS("cursor", "pointer");
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(home.x + i * 12, home.y + i * 9);
  await page.mouse.up();
  await expect.poll(() => dotAt(page, home)).toBe(false);
  await expect.poll(() => dotAt(page, home), { timeout: 10_000 }).toBe(true);
});
