import { expect, test, type Page } from "@playwright/test";
import { seedLargeLibrary, seedSmallLibrary } from "./database";

// A large graph thins its detail by zoom and fogs its edges, with hints for Clusters out of view (#156);
// a small one is drawn whole, as before. The canvas says how many Book labels it draws (more than half
// there) and whether detail is on, since labels are canvas text.

const LARGE = 120;
const canvas = (page: Page) => page.locator("[data-withheld]");
const labelled = async (page: Page) => Number(await canvas(page).getAttribute("data-labelled"));
const shownHints = (page: Page) => page.locator("[data-cluster-hint][data-shown]");

async function openGraph(page: Page) {
  await page.goto("/graph");
  await expect(page.locator("canvas")).toBeVisible();
  await expect(canvas(page)).toHaveAttribute("data-labelled", /\d+/);
  // The first view is fitted once the canvas has its size.
  await page.waitForTimeout(600);
}

// Wheel steps over the middle of the canvas: in (negative) or out, then time for the detail to ease.
async function zoom(page: Page, steps: number) {
  const box = (await page.locator("canvas").boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2);
  for (let i = 0; i < Math.abs(steps); i++) {
    await page.mouse.wheel(0, Math.sign(steps) * 120);
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(400);
}

// Two fingers spreading at (x, y) on the phone's graph, by the DevTools protocol (a phone has no
// wheel): zooms in by about `factor`.
async function pinch(page: Page, factor: number, x: number, y: number) {
  const cdp = await page.context().newCDPSession(page);
  const at = (d: number) => [{ x, y: y - d / 2, id: 0 }, { x, y: y + d / 2, id: 1 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at(50) });
  for (let i = 1; i <= 20; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: at(50 + (50 * (factor - 1) * i) / 20) });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(600);
}

// Two frames, so whatever a change does at once has been drawn.
const frames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

// The camera: d3-zoom keeps its transform on the canvas.
const camera = (page: Page) => page.evaluate(() => ({ ...(document.querySelector("canvas") as unknown as { __zoom: { k: number; x: number; y: number } }).__zoom }));

// Whether a Cluster's name is placed on screen.
const nameShown = (page: Page, id: string) =>
  page.evaluate((id) => {
    const el = document.querySelector<HTMLElement>(`[data-cluster-name="${id}"]`)!;
    const r = el.getBoundingClientRect();
    return el.style.visibility === "visible" && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight;
  }, id);

test.describe("a large graph", () => {
  test.beforeEach(async () => {
    await seedLargeLibrary(LARGE);
  });

  test("shows more Book titles as the reader zooms in, and fewer zoomed out", async ({ page }) => {
    await openGraph(page);
    await expect(canvas(page)).toHaveAttribute("data-detail", "on");
    await expect(page.getByText("Zoom in for more.")).toBeVisible();
    const fitted = await labelled(page);
    // Fitted, a large graph reads as Clusters first: fewer than half its Books are labelled.
    expect(fitted).toBeLessThan(LARGE / 2);

    // Not so far that most of the graph leaves the view.
    await zoom(page, -3);
    await expect.poll(() => labelled(page)).toBeGreaterThan(fitted);
    await page.screenshot({ path: test.info().outputPath("zoomed-in.png") });

    await zoom(page, 11);
    await expect.poll(() => labelled(page)).toBeLessThan(fitted);
    // The Cluster names still show, zoomed out.
    await expect(page.locator("[data-cluster-name]").filter({ visible: true }).first()).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("zoomed-out.png") });
  });

  test("a chosen Book keeps its label and its Connections' labels, however far out", async ({ page }) => {
    await openGraph(page);
    await zoom(page, 12);
    const far = await labelled(page);
    // The best-connected Book, from the keyboard list.
    const books = page.getByRole("navigation", { name: "Books in the graph" }).getByRole("button");
    const counts = await books.evaluateAll((els) => els.map((el) => Number(el.textContent!.match(/, (\d+) connection/)![1])));
    const hub = books.nth(counts.indexOf(Math.max(...counts)));
    await hub.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("complementary", { name: /^Notes on / })).toBeVisible();
    await expect.poll(() => labelled(page)).toBeGreaterThan(Math.max(far, 3));
    // Nothing points away from a selection.
    await expect(shownHints(page)).toHaveCount(0);
  });

  test("a hint at the edge names a Cluster out of view, and choosing it glides there", async ({ page }) => {
    await openGraph(page);
    await expect(shownHints(page)).toHaveCount(0);
    await zoom(page, -10);
    await expect(shownHints(page).first()).toBeVisible();
    const hint = shownHints(page).first();
    const id = (await hint.getAttribute("data-cluster-hint"))!;
    expect(await nameShown(page, id)).toBe(false);
    const before = await camera(page);
    await hint.click();
    await expect.poll(() => nameShown(page, id)).toBe(true);
    await expect(page.locator(`[data-cluster-hint="${id}"]`)).not.toHaveAttribute("data-shown");
    // Framed: zoomed out if the Cluster needs the room, never further in.
    expect((await camera(page)).k).toBeLessThanOrEqual(before.k + 1e-9);
  });

  test("the keyboard reaching a Cluster or Book out of view brings it into view", async ({ page }) => {
    await openGraph(page);
    await zoom(page, -10);
    const hint = shownHints(page).first();
    await expect(hint).toBeVisible();
    const id = (await hint.getAttribute("data-cluster-hint"))!;
    const name = (await hint.textContent())!.trim();
    const before = await camera(page);
    await page.getByRole("navigation", { name: "Clusters in the graph" }).getByRole("button", { name: `${name}, ` }).focus();
    await expect.poll(() => nameShown(page, id)).toBe(true);
    expect((await camera(page)).k).toBeLessThanOrEqual(before.k + 1e-9);

    // Books in turn, until one out of view moves the camera to it; reached again, it stays put.
    await zoom(page, -4);
    const books = page.getByRole("navigation", { name: "Books in the graph" }).getByRole("button");
    let moved = -1;
    for (let i = 0; i < 20 && moved < 0; i++) {
      const at = await camera(page);
      await books.nth(i).focus();
      await page.waitForTimeout(800);
      const now = await camera(page);
      if (now.x !== at.x || now.y !== at.y) {
        expect(now.k).toBeLessThanOrEqual(at.k + 1e-9);
        moved = i;
      }
    }
    expect(moved).toBeGreaterThanOrEqual(0);
    const there = await camera(page);
    await books.nth(moved).blur();
    await books.nth(moved).focus();
    await page.waitForTimeout(800);
    expect(await camera(page)).toEqual(there);
  });

  test("with less motion, a hint moves the view and the detail changes at once", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openGraph(page);
    await zoom(page, -10);
    const settled = await labelled(page);
    await page.waitForTimeout(300);
    expect(await labelled(page)).toBe(settled);
    const hint = shownHints(page).first();
    const id = (await hint.getAttribute("data-cluster-hint"))!;
    await hint.click();
    await frames(page);
    expect(await nameShown(page, id)).toBe(true);

    // The keyboard reaching one out of view jumps there too: from the same view again.
    await openGraph(page);
    await zoom(page, -10);
    const next = shownHints(page).first();
    const other = (await next.getAttribute("data-cluster-hint"))!;
    const name = (await next.textContent())!.trim();
    await page.getByRole("navigation", { name: "Clusters in the graph" }).getByRole("button", { name: `${name}, ` }).focus();
    await frames(page);
    expect(await nameShown(page, other)).toBe(true);
  });
});

test.describe("a large graph on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test.beforeEach(async () => {
    await seedLargeLibrary(LARGE);
  });

  test("shows at most three hints, clear of the switch and the legend, each with a full finger's target", async ({ page }) => {
    await openGraph(page);
    await expect(canvas(page)).toHaveAttribute("data-detail", "on");
    await page.screenshot({ path: test.info().outputPath("phone-fitted.png") });
    // Into the lower left, so whole Clusters leave the top of the view.
    await pinch(page, 5, 110, 600);
    await expect(shownHints(page).first()).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("phone-zoomed-in.png") });
    const boxes = await shownHints(page).evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON() as DOMRect));
    expect(boxes.length).toBeLessThanOrEqual(3);
    const header = (await page.getByRole("navigation", { name: "Views" }).boundingBox())!;
    const legend = (await page.locator("footer").boundingBox())!;
    for (const [i, b] of boxes.entries()) {
      // The target reaches 12px past the plate each way, and stays clear of both.
      expect(b.top - 12).toBeGreaterThanOrEqual(header.y + header.height);
      expect(b.bottom + 12).toBeLessThanOrEqual(legend.y);
      expect(b.bottom - b.top + 24).toBeGreaterThanOrEqual(44);
      for (const c of boxes.slice(i + 1)) expect(b.right <= c.left || c.right <= b.left || b.bottom <= c.top || c.bottom <= b.top).toBe(true);
    }
    // A tap just above the plate still reaches it.
    const hint = shownHints(page).first();
    const id = (await hint.getAttribute("data-cluster-hint"))!;
    const b = boxes[0];
    await page.touchscreen.tap(b.left + (b.right - b.left) / 2, b.top - 8);
    await expect.poll(() => nameShown(page, id)).toBe(true);
  });
});

test("a small graph is drawn whole at every zoom, with no hints", async ({ page }) => {
  const titles = ["Stoner", "Middlemarch", "Beloved", "The Plague", "Candide", "Persuasion", "Ulysses", "Emma", "Gilead", "Housekeeping"];
  await seedSmallLibrary(titles, [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [0, 9]]);
  await openGraph(page);
  await expect(canvas(page)).toHaveAttribute("data-detail", "off");
  // A small graph shows no more for zooming in, so the legend doesn't say so.
  await expect(page.getByText("Thicker lines are stronger connections.", { exact: false })).toBeVisible();
  await expect(page.getByText("Zoom in for more.", { exact: false })).toHaveCount(0);
  const fitted = await labelled(page);
  expect(fitted).toBe(titles.length);
  await zoom(page, -6);
  await expect(shownHints(page)).toHaveCount(0);
  await zoom(page, 14);
  await expect(shownHints(page)).toHaveCount(0);
  // Every label the room allows still shows, however far out; none is thinned.
  expect(await labelled(page)).toBeGreaterThan(0);
});
