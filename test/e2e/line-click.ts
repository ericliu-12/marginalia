import { expect, type Page } from "@playwright/test";

// How far, in CSS pixels, a point on a line keeps from anything else drawn: another line, a Book's dot,
// a label. Wider than the canvas's pick tolerance, so the pointer can only be over this line.
const CLEAR = 14;

// A point on the line drawn in `color` (#rrggbb, drawn in nothing else) with nothing else on the canvas
// within CLEAR of it, nearest the line's middle; in CSS pixels on the page. Null when there is none.
function clearPointOn(page: Page, color: string) {
  const want = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  return page.locator("canvas").evaluate(
    (canvas: HTMLCanvasElement, { want, clear }) => {
      const { data, width, height } = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
      const box = canvas.getBoundingClientRect();
      const scale = canvas.width / box.width;
      // The canvas is transparent: paper shows through where nothing is drawn. Its own pixels keep their
      // colour as they fade at the line's edges, give or take rounding.
      const alpha = (i: number) => data[i * 4 + 3] / 255;
      const ours = (i: number, tolerance: number) => [0, 1, 2].every((k) => Math.abs(data[i * 4 + k] - want[k]) <= tolerance);
      const line: number[] = [];
      for (let i = 0; i < width * height; i++) if (alpha(i) >= 0.95 && ours(i, 3)) line.push(i);
      if (!line.length) return null;
      const [first, last] = [line[0], line[line.length - 1]];
      const middle = { x: ((first % width) + (last % width)) / 2, y: (Math.floor(first / width) + Math.floor(last / width)) / 2 };
      const r = Math.ceil(clear * scale);
      const isClear = (cx: number, cy: number) => {
        for (let y = cy - r; y <= cy + r; y++)
          for (let x = cx - r; x <= cx + r; x++) {
            if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
            if (x < 0 || y < 0 || x >= width || y >= height) return false;
            const i = y * width + x;
            if (alpha(i) >= 0.05 && !ours(i, alpha(i) >= 0.5 ? 8 : 40)) return false;
          }
        return true;
      };
      const byMiddle = line
        .map((i) => ({ x: i % width, y: Math.floor(i / width) }))
        .sort((p, q) => Math.hypot(p.x - middle.x, p.y - middle.y) - Math.hypot(q.x - middle.x, q.y - middle.y));
      for (const p of byMiddle) {
        const at = { x: box.left + p.x / scale, y: box.top + p.y / scale };
        if (document.elementFromPoint(at.x, at.y) !== canvas) continue;
        if (isClear(p.x, p.y)) return { x: Math.round(at.x), y: Math.round(at.y) };
      }
      return null;
    },
    { want, clear: CLEAR },
  );
}

// Clicks the line drawn in `color` where nothing else is near it, once the graph has stopped moving (the
// same point found twice running), hovering until the canvas says a Connection is under the pointer.
export async function clickLine(page: Page, color: string) {
  let at: { x: number; y: number } | null = null;
  await expect
    .poll(async () => {
      const before = at;
      at = await clearPointOn(page, color);
      return !!at && !!before && at.x === before.x && at.y === before.y;
    }, { intervals: [200] })
    .toBe(true);
  const { x, y } = at!;
  await page.mouse.move(x, y);
  await expect.poll(() => page.evaluate(() => document.querySelector<HTMLElement>("canvas")!.closest<HTMLElement>("[aria-hidden]")!.style.cursor)).toBe("pointer");
  await page.mouse.click(x, y);
}
