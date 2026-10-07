import { expect, test, type Page } from "@playwright/test";
import { seedLibrary, type Title } from "./database";

// The Follow trail in the graph view, on the seeded chain Stoner → The Remains of the Day → Never Let
// Me Go → Beloved → The Plague → Candide.

test.beforeEach(async ({ page }) => {
  await seedLibrary();
  await page.goto("/graph");
  await expect(page.locator("canvas")).toBeVisible();
  // The graph fits itself to the screen on its first frame.
  await page.waitForTimeout(500);
});

const heading = (page: Page) => page.getByRole("heading", { level: 2 });
const trail = (page: Page) => page.getByRole("navigation", { name: "Trail" });
const crumbs = (page: Page) => trail(page).getByRole("listitem");

// Opens a Book the way a keyboard reader does, from the list behind the canvas.
async function choose(page: Page, title: Title) {
  await page.getByRole("navigation", { name: "Books in the graph" }).getByRole("button", { name: new RegExp(`^${title}, `) }).focus();
  await page.keyboard.press("Enter");
  await expect(heading(page)).toHaveText(title);
}

async function follow(page: Page, title: Title) {
  await page.getByRole("region", { name: "Connections" }).getByRole("button", { name: title, exact: true }).click();
  await expect(heading(page)).toHaveText(title);
}

// The graph as drawn, for comparing camera positions.
const snapshot = (page: Page) => page.evaluate(() => document.querySelector("canvas")!.toDataURL());

test("following a Connection builds a trail; a crumb, or following a Book on it, rewinds it", async ({ page }) => {
  await choose(page, "Stoner");
  await expect(trail(page)).toHaveCount(0);

  await follow(page, "The Remains of the Day");
  await expect(crumbs(page)).toHaveText(["Stoner", "The Remains of the Day"]);
  await expect(heading(page)).toBeFocused();
  await follow(page, "Never Let Me Go");
  await expect(crumbs(page)).toHaveText(["Stoner", "The Remains of the Day", "Never Let Me Go"]);
  await expect(crumbs(page).last().locator("[aria-current=location]")).toHaveText("Never Let Me Go");

  await trail(page).getByRole("button", { name: "The Remains of the Day" }).click();
  await expect(heading(page)).toHaveText("The Remains of the Day");
  await expect(crumbs(page)).toHaveText(["Stoner", "The Remains of the Day"]);

  await follow(page, "Stoner");
  await expect(trail(page)).toHaveCount(0);
  await expect(page.locator("p[role=status].sr-only")).toHaveText("Back to Stoner on your trail");
});

test("Clear ends the trail and stays on the Book", async ({ page }) => {
  await choose(page, "Stoner");
  await follow(page, "The Remains of the Day");
  await trail(page).getByRole("button", { name: "Clear trail" }).click();
  await expect(trail(page)).toHaveCount(0);
  await expect(heading(page)).toHaveText("The Remains of the Day");
  await expect(heading(page)).toBeFocused();
});

test("choosing a Book in the graph starts a fresh trail", async ({ page }) => {
  await choose(page, "Stoner");
  await follow(page, "The Remains of the Day");
  await choose(page, "Beloved");
  await expect(trail(page)).toHaveCount(0);
  await follow(page, "The Plague");
  await expect(crumbs(page)).toHaveText(["Beloved", "The Plague"]);
});

test("a long trail folds its middle until opened", async ({ page }) => {
  await choose(page, "Stoner");
  for (const t of ["The Remains of the Day", "Never Let Me Go", "Beloved", "The Plague", "Candide"] as const) await follow(page, t);
  await expect(crumbs(page)).toHaveText(["Stoner", /…\s*The Plague/, "Candide"]);

  await trail(page).getByRole("button", { name: "Show 3 more on the trail" }).click();
  await expect(crumbs(page)).toHaveText(["Stoner", "The Remains of the Day", "Never Let Me Go", "Beloved", "The Plague", "Candide"]);
  await expect(trail(page).getByRole("button", { name: "The Remains of the Day" })).toBeFocused();
});

test("following from a Connection starts the trail at its other Book", async ({ page }) => {
  // The Plague–Candide Connection is the only one drawn in the Contrast colour: click the middle of it.
  const at = await page.evaluate(() => {
    const canvas = document.querySelector("canvas")!;
    const { data, width, height } = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
    const hits: { x: number; y: number }[] = [];
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (Math.abs(data[i] - 0xa8) < 16 && Math.abs(data[i + 1] - 0x43) < 16 && Math.abs(data[i + 2] - 0x2f) < 16) hits.push({ x, y });
      }
    const [first, last] = [hits.reduce((p, q) => (q.x < p.x ? q : p)), hits.reduce((p, q) => (q.x > p.x ? q : p))];
    const box = canvas.getBoundingClientRect();
    const scale = canvas.width / box.width;
    return { x: box.left + (first.x + last.x) / 2 / scale, y: box.top + (first.y + last.y) / 2 / scale };
  });
  // The canvas works out what is under the pointer a moment after it is drawn: hover until the cursor
  // says the Connection is there, then click.
  await page.mouse.move(at.x, at.y);
  await expect.poll(() => page.evaluate(() => document.querySelector<HTMLElement>("canvas")!.closest<HTMLElement>("[aria-hidden]")!.style.cursor)).toBe("pointer");
  await page.mouse.click(at.x, at.y);

  const panel = page.getByRole("complementary", { name: "Connection" });
  await expect(panel.getByRole("heading", { level: 2 })).toHaveText(/^(The Plague\s*and\s*Candide|Candide\s*and\s*The Plague)$/);
  await panel.getByRole("button", { name: "Candide" }).click();
  await expect(heading(page)).toHaveText("Candide");
  await expect(crumbs(page)).toHaveText(["The Plague", "Candide"]);
});

test("Escape ends the trail and puts the camera back", async ({ page }) => {
  const atRest = await snapshot(page);
  await choose(page, "Stoner");
  await follow(page, "The Remains of the Day");
  await follow(page, "Never Let Me Go");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("complementary")).toHaveCount(0);
  // Focus went back to the list item, which rings its Book; let it go, and let the camera glide home.
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  await page.waitForTimeout(1000);

  // The glide lands within a pixel or so: compare what is drawn, allowing for anti-aliasing.
  const differing = await page.evaluate(
    async ([a, b]) => {
      const load = (src: string) =>
        new Promise<HTMLImageElement>((r) => {
          const img = new Image();
          img.onload = () => r(img);
          img.src = src;
        });
      const [x, y] = await Promise.all([load(a), load(b)]);
      const ctx = new OffscreenCanvas(x.width, x.height).getContext("2d")!;
      ctx.drawImage(x, 0, 0);
      const p = ctx.getImageData(0, 0, x.width, x.height).data;
      ctx.clearRect(0, 0, x.width, x.height);
      ctx.drawImage(y, 0, 0);
      const q = ctx.getImageData(0, 0, x.width, x.height).data;
      let drawn = 0;
      let off = 0;
      for (let i = 3; i < p.length; i += 4) {
        if (p[i] > 128 || q[i] > 128) drawn++;
        if (Math.abs(p[i] - q[i]) > 128) off++;
      }
      return off / drawn;
    },
    [atRest, await snapshot(page)],
  );
  expect(differing).toBeLessThan(0.25);
});
