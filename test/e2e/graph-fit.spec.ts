import { expect, test } from "@playwright/test";
import { seedSmallLibrary } from "./database";

// The graph's first view fills the desktop canvas: laid out wide by the worker, then fitted with room
// for its labels, not left small in the middle. Read from the canvas's own pixels.

const TITLES = [
  "Stoner", "Middlemarch", "Beloved", "The Plague", "Candide", "Persuasion", "Ulysses", "Emma",
  "The Remains of the Day", "Never Let Me Go", "Gilead", "Housekeeping", "Austerlitz", "Mrs Dalloway",
];
const LINKED: [number, number][] = [
  [0, 1], [0, 2], [1, 2], [1, 3], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [4, 6], [2, 5],
  [7, 8], [8, 9], [9, 10], [10, 11], [8, 10], [11, 12], [12, 13], [11, 13], [3, 9],
];

test("the graph first fills the canvas, across and down, its labels inside it", async ({ page }) => {
  await seedSmallLibrary(TITLES, LINKED);
  await page.goto("/graph");
  await expect(page.locator("canvas")).toBeVisible();
  // The graph fits itself to the screen on its first frame.
  await page.waitForTimeout(500);

  // The box around the Books' dots (solid ink a few pixels across), and around all the ink.
  const drawn = await page.locator("canvas").evaluate((c: HTMLCanvasElement) => {
    const s = c.width / c.clientWidth;
    const { data, width } = c.getContext("2d")!.getImageData(0, 0, c.width, c.height);
    const ink = (x: number, y: number) => {
      const i = (Math.round(y * s) * width + Math.round(x * s)) * 4;
      return data[i + 3] > 200 && data[i] < 80 && data[i + 1] < 80 && data[i + 2] < 80;
    };
    const solid = (x: number, y: number) => [-3, 0, 3].every((dx) => [-3, 0, 3].every((dy) => ink(x + dx, y + dy)));
    const dots = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    const all = { ...dots };
    for (let y = 4; y < c.clientHeight - 4; y += 2) {
      for (let x = 4; x < c.clientWidth - 4; x += 2) {
        if (!ink(x, y)) continue;
        Object.assign(all, { x0: Math.min(all.x0, x), y0: Math.min(all.y0, y), x1: Math.max(all.x1, x), y1: Math.max(all.y1, y) });
        if (solid(x, y)) Object.assign(dots, { x0: Math.min(dots.x0, x), y0: Math.min(dots.y0, y), x1: Math.max(dots.x1, x), y1: Math.max(dots.y1, y) });
      }
    }
    return { width: c.clientWidth, height: c.clientHeight, dots, all };
  });

  expect((drawn.dots.x1 - drawn.dots.x0) / drawn.width).toBeGreaterThan(0.6);
  expect((drawn.dots.y1 - drawn.dots.y0) / drawn.height).toBeGreaterThan(0.4);
  // Nothing drawn runs off the canvas's sides.
  expect(drawn.all.x0).toBeGreaterThan(8);
  expect(drawn.all.x1).toBeLessThan(drawn.width - 8);
  await page.screenshot({ path: test.info().outputPath("graph-fit.png") });
});
