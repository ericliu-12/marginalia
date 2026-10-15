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
  // This graph laid out from 300 different sets of Book ids fills 0.35–0.49 of the height (median 0.40),
  // and the seed's fixed ids give 0.41; the bar sits below all of them. A layout left small in the middle
  // fails the width check above (before #143 it filled 0.20–0.53 across).
  expect((drawn.dots.y1 - drawn.dots.y0) / drawn.height).toBeGreaterThan(0.33);
  // Nothing drawn runs off the canvas's sides.
  expect(drawn.all.x0).toBeGreaterThan(8);
  expect(drawn.all.x1).toBeLessThan(drawn.width - 8);
  await page.screenshot({ path: test.info().outputPath("graph-fit.png") });
});

test("Books with no Connections ring the connected ones, hollow and muted", async ({ page }) => {
  await seedSmallLibrary([...TITLES, "Giovanni's Room", "To the Lighthouse"], LINKED);
  await page.goto("/graph");
  await expect(page.locator("canvas")).toBeVisible();
  await page.waitForTimeout(500);

  // The box around pixels in ink tertiary (the hollow dots and their italic labels), and around the solid
  // ink dots.
  const drawn = await page.locator("canvas").evaluate((c: HTMLCanvasElement) => {
    const s = c.width / c.clientWidth;
    const { data, width } = c.getContext("2d")!.getImageData(0, 0, c.width, c.height);
    const px = (x: number, y: number) => {
      const i = (Math.round(y * s) * width + Math.round(x * s)) * 4;
      return [data[i], data[i + 1], data[i + 2], data[i + 3]];
    };
    const ink = (x: number, y: number) => {
      const [r, g, b, a] = px(x, y);
      return a > 200 && r < 80 && g < 80 && b < 80;
    };
    // #6e675d, give or take antialiasing.
    const muted = (x: number, y: number) => {
      const [r, g, b, a] = px(x, y);
      return a > 200 && Math.abs(r - 110) < 14 && Math.abs(g - 103) < 14 && Math.abs(b - 93) < 14;
    };
    const solid = (x: number, y: number) => [-3, 0, 3].every((dx) => [-3, 0, 3].every((dy) => ink(x + dx, y + dy)));
    const dots = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    const halo = { ...dots };
    let mutedPixels = 0;
    for (let y = 4; y < c.clientHeight - 4; y += 1) {
      for (let x = 4; x < c.clientWidth - 4; x += 1) {
        if (muted(x, y)) {
          mutedPixels++;
          Object.assign(halo, { x0: Math.min(halo.x0, x), y0: Math.min(halo.y0, y), x1: Math.max(halo.x1, x), y1: Math.max(halo.y1, y) });
        }
        if (solid(x, y)) Object.assign(dots, { x0: Math.min(dots.x0, x), y0: Math.min(dots.y0, y), x1: Math.max(dots.x1, x), y1: Math.max(dots.y1, y) });
      }
    }
    return { dots, halo, mutedPixels };
  });

  expect(drawn.mutedPixels).toBeGreaterThan(50);
  // The two sit on opposite sides of the connected Books, across or down: a ring, not a band beside them.
  const { dots, halo } = drawn;
  expect((halo.x0 < dots.x0 && halo.x1 > dots.x1) || (halo.y0 < dots.y0 && halo.y1 > dots.y1)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("graph-halo.png") });
});
