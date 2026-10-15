import { expect, test, type Page } from "@playwright/test";
import { seedLibrary, wantBook } from "./database";

// Motion stays quiet: under reduced motion nothing slides, and the graph stops drawing once a
// selection's fade is over.

// Records every animation seen running that moves something (a transform, for longer than an instant).
async function watchMoves(page: Page) {
  await page.addInitScript(() => {
    const seen: string[] = ((window as unknown as { __moves: string[] }).__moves = []);
    const look = () => {
      for (const a of document.getAnimations()) {
        const effect = a.effect as KeyframeEffect | null;
        if (a.playState !== "running" || !effect || Number(effect.getTiming().duration) <= 1) continue;
        if (effect.getKeyframes().some((k) => typeof k.transform === "string" && k.transform !== "none")) seen.push((a as CSSAnimation).animationName ?? a.id);
      }
      requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  });
}
const moves = (page: Page) => page.evaluate(() => (window as unknown as { __moves: string[] }).__moves);

async function startReadingGilead(page: Page) {
  await page.goto("/");
  const row = page.getByRole("main").getByRole("listitem").filter({ hasText: "Gilead" });
  await row.hover();
  await row.getByRole("button", { name: "Start reading: Gilead" }).click();
  await expect(page.getByRole("main").getByRole("region", { name: /^Reading/ }).getByRole("button", { name: "Gilead", exact: true })).toBeVisible();
  // The row's move, and the panel opening.
  await page.getByRole("main").getByRole("button", { name: "Gilead", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Gilead", level: 2 })).toBeVisible();
  await page.waitForTimeout(400);
}

test.beforeEach(async ({ page }) => {
  await seedLibrary();
  await wantBook("Gilead");
  await watchMoves(page);
});

test("a Status move glides the row to its shelf, and the panel slides in", async ({ page }) => {
  await startReadingGilead(page);
  expect(await moves(page)).toEqual(expect.arrayContaining(["row-move", "panel-in"]));
});

test("under reduced motion, no transform runs", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await startReadingGilead(page);
  expect(await moves(page)).toEqual([]);
});

test("the graph stops drawing once a selection has faded in", async ({ page }) => {
  // Counts the canvas's frames: force-graph clears the canvas each time it draws.
  await page.addInitScript(() => {
    const w = window as unknown as { __frames: number };
    w.__frames = 0;
    const clear = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      w.__frames++;
      return clear.apply(this, args);
    };
  });
  const frames = () => page.evaluate(() => (window as unknown as { __frames: number }).__frames);
  await page.goto("/graph");
  await expect(page.locator("canvas")).toBeVisible();
  const stoner = page.getByRole("navigation", { name: "Books in the graph" }).getByRole("button", { name: /^Stoner,/ });
  await stoner.focus();
  await stoner.press("Enter");
  await expect(page.getByRole("heading", { name: "Stoner", level: 2 })).toBeVisible();
  // Past the camera's glide and the fade.
  await page.waitForTimeout(1500);
  const settled = await frames();
  await page.waitForTimeout(1000);
  expect(await frames()).toBe(settled);
});
