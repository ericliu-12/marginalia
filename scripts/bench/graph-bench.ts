// Graph benchmark: the #14 harness (prototype/graph-scale), pointed at the real graph view. Run it, and
// record its table on the ticket, after a change that could slow the graph down.
//
//   pnpm build && pnpm bench:graph [300,600,1000] [cpu throttle, e.g. 4]
//   BENCH_PHONE=1 pnpm bench:graph 300 4     (the phone's graph, at 390 by 844, by touch)
//
// For each size it takes the kept synthetic library of that many Finished Books (./kept-library.ts: about
// one Cluster per 20, 3 to 5 Connections each, 80% inside their Cluster with preferential attachment,
// 40% strong, laid out and clustered as the worker would, every Cluster named; seeded once, the same
// graph every run), serves the production build on it and drives installed Chrome, headed, at 1440 by
// 900 (see `run`). Each scenario is timed by its requestAnimationFrame intervals. A CPU throttle stands
// in for lower-end hardware. Local DATABASE_URL only; no outside calls.
import { chromium, type CDPSession, type Page } from "@playwright/test";
import { keptLibrary, readerCookie, serveLibrary } from "./kept-library";

const sizes = (process.argv[2] ?? "300,600,1000").split(",").map(Number);
const throttle = Number(process.argv[3] ?? 1);
// BENCH_PROFILE=<scenario> (pan, zoom, hub, drag or settle) also profiles that scenario and prints where
// its time went, by function. Build with `next build --no-mangling` so the names read.
const profile = process.env.BENCH_PROFILE;
// The phone's graph (#141): an iPhone-sized touch screen, where a finger pans and two pinch, and no
// Book is dragged.
const phone = process.env.BENCH_PHONE === "1";
const VIEWPORT = phone ? { width: 390, height: 844 } : { width: 1440, height: 900 };
const PORT = 3200;

// Frame intervals while `drive` runs, as frames per second, the median and 95th percentile in ms, and the
// worst; and the main thread's busy time (scripts, style, layout and paint) per frame, in ms, which
// shows the headroom a display's frame rate hides.
async function timed(page: Page, cdp: CDPSession, drive: () => Promise<void>) {
  await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __run: number };
    const run = (w.__run = (w.__run ?? 0) + 1);
    const frames: number[] = (w.__frames = []);
    let last = performance.now();
    const tick = (now: number) => {
      frames.push(now - last);
      last = now;
      if (w.__run === run) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const busy = async () => (await cdp.send("Performance.getMetrics")).metrics.find((m) => m.name === "TaskDuration")!.value;
  const before = await busy();
  const t0 = Date.now();
  await drive();
  const ms = Date.now() - t0;
  const t = (await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __run: number };
    w.__run++;
    return w.__frames.slice(2);
  })) as number[];
  const work = ((await busy()) - before) * 1000;
  t.sort((p, q) => p - q);
  const q = (x: number) => t[Math.min(t.length - 1, Math.floor(t.length * x))] ?? 0;
  return {
    fps: Math.round(t.length / (ms / 1000)),
    p50: +q(0.5).toFixed(1),
    p95: +q(0.95).toFixed(1),
    max: Math.round(t.at(-1) ?? 0),
    busy: +(work / Math.max(1, t.length)).toFixed(1),
  };
}

// A spot on the canvas with no ink near it (somewhere to pan from), and the centres of Books' dots
// nearest the middle (something to drag), nearest first, found from the canvas's own pixels.
async function spots(page: Page) {
  return page.evaluate(({ width: vw, height: vh }) => {
    const canvas = document.querySelector("canvas")!;
    const ctx = canvas.getContext("2d")!;
    const scale = canvas.width / canvas.clientWidth;
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const dark = (x: number, y: number) => {
      const i = (Math.round(y) * width + Math.round(x)) * 4;
      return data[i + 3] > 200 && data[i] < 80 && data[i + 1] < 80 && data[i + 2] < 80;
    };
    let empty = { x: vw / 2, y: vh / 2 };
    let best = -1;
    const dots: { x: number; y: number; d: number }[] = [];
    const edge = vw < 600 ? 40 : 140;
    for (let y = 160; y < vh - 160; y += 10) {
      for (let x = edge; x < Math.min(1000, vw - edge); x += 10) {
        const [px, py] = [x * scale, y * scale];
        let clear = 0;
        while (clear < 40 && ![0, 1, 2, 3, 4, 5, 6, 7].some((k) => dark(px + Math.cos(k) * clear * scale, py + Math.sin(k) * clear * scale))) clear++;
        if (clear > best && document.elementFromPoint(x, y) === canvas) [best, empty] = [clear, { x, y }];
        const solid = [-3, 0, 3].every((dx) => [-3, 0, 3].every((dy) => px + dx > 0 && px + dx < width && py + dy > 0 && py + dy < height && dark(px + dx, py + dy)));
        const d = Math.hypot(x - vw / 2, y - vh / 2);
        if (solid && document.elementFromPoint(x, y) === canvas && !dots.some((o) => Math.hypot(o.x - x, o.y - y) < 12)) dots.push({ x, y, d });
      }
    }
    return { empty, dots: dots.sort((p, q) => p.d - q.d).slice(0, 10) };
  }, VIEWPORT);
}

// A finger on the screen, by the DevTools protocol, so the page gets real touch events: one finger
// panning in a loop for 2.5s, or two pinching out and back in.
async function touchPan(page: Page, cdp: CDPSession) {
  const { empty } = await spots(page);
  const at = (i: number) => [{ x: empty.x + Math.sin(i / 10) * 120, y: empty.y + 40 + Math.cos(i / 10) * 40 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at(0) });
  const t0 = Date.now();
  for (let i = 1; Date.now() - t0 < 2500; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: at(i) });
    await page.waitForTimeout(8);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
async function pinch(page: Page, cdp: CDPSession) {
  const { empty } = await spots(page);
  for (const [from, to] of [[30, 150], [150, 30]]) {
    const at = (d: number) => [{ x: empty.x, y: empty.y - d / 2, id: 0 }, { x: empty.x, y: empty.y + d / 2, id: 1 }];
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at(from) });
    for (let i = 1; i <= 40; i++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: at(from + ((to - from) * i) / 40) });
      await page.waitForTimeout(25);
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }
}

// The phone's scenarios: a pan, a pinch out and in, and a pan with the best-connected Book chosen (its
// sheet up).
async function runPhone(page: Page, cdp: CDPSession, hub: string, n: number) {
  const out: Record<string, Awaited<ReturnType<typeof timed>>> = {};
  out.pan = await profiled(cdp, "pan", () => timed(page, cdp, () => touchPan(page, cdp)));
  out.zoom = await profiled(cdp, "zoom", () => timed(page, cdp, () => pinch(page, cdp)));
  await page.getByRole("navigation", { name: "Books in the graph" }).getByRole("button", { name: `${hub}, ` }).first().focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `scripts/bench/out/phone-graph-${n}-hub.png` });
  out.hub = await profiled(cdp, "hub", () => timed(page, cdp, () => touchPan(page, cdp)));
  return out;
}

// Where a scenario's time went, by function: self time, most first.
async function profiled(cdp: CDPSession, name: string, measure: () => ReturnType<typeof timed>) {
  if (profile !== name) return measure();
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.start");
  const result = await measure();
  const { profile: p } = await cdp.send("Profiler.stop");
  const self = new Map<string, number>();
  const dt = new Map(p.nodes.map((n) => [n.id, 0]));
  p.samples!.forEach((id, i) => dt.set(id, dt.get(id)! + (p.timeDeltas![i] ?? 0)));
  for (const n of p.nodes) {
    const { functionName, url, lineNumber, columnNumber } = n.callFrame;
    const key = `${functionName || "(anonymous)"} ${url.split("/").at(-1)}:${lineNumber}:${columnNumber}`;
    self.set(key, (self.get(key) ?? 0) + dt.get(n.id)! / 1000);
  }
  const total = [...self.values()].reduce((a, b) => a + b, 0);
  console.log(`${name} profile, ${Math.round(total)} ms sampled; self time:`);
  for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${v.toFixed(0).padStart(6)} ms  ${k}`);
  return result;
}

// Each scenario in turn: a pan, a zoom in and out, a pan with the best-connected Book chosen from the
// keyboard list (its panel open), then, with nothing chosen, a Book dragged and the settling after.
async function run(page: Page, cdp: CDPSession, hub: string, n: number) {
  const out: Record<string, Awaited<ReturnType<typeof timed>>> = {};
  const pan = async () => {
    const { empty } = await spots(page);
    await page.mouse.move(empty.x, empty.y);
    await page.mouse.down();
    const t0 = Date.now();
    for (let i = 0; Date.now() - t0 < 2500; i++) {
      await page.mouse.move(empty.x + Math.sin(i / 10) * 120, empty.y + 40 + Math.cos(i / 10) * 40);
      await page.waitForTimeout(8);
    }
    await page.mouse.up();
  };
  out.pan = await profiled(cdp, "pan", () => timed(page, cdp, pan));
  out.zoom = await profiled(cdp, "zoom", () =>
    timed(page, cdp, async () => {
      const { empty } = await spots(page);
      await page.mouse.move(empty.x, empty.y);
      for (const dy of [-120, 120]) {
        for (let i = 0; i < 40; i++) {
          await page.mouse.wheel(0, dy);
          await page.waitForTimeout(25);
        }
      }
    }),
  );
  // Its 40 steps in stop at the deepest zoom and its 40 out don't, so it leaves the graph a speck: the
  // rest start from the first view again.
  await page.reload();
  await page.locator("canvas").waitFor();
  await page.waitForTimeout(2500);
  await page.getByRole("navigation", { name: "Books in the graph" }).getByRole("button", { name: `${hub}, ` }).first().focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `scripts/bench/out/graph-${n}-hub.png` });
  out.hub = await profiled(cdp, "hub", () => timed(page, cdp, pan));
  // Back to the whole graph; the camera glides home, slowly under a throttle.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(3000);
  // The first of those dots force-graph finds a Book under (a spot it reads as a dot may be ink it
  // doesn't hit: under a name's edge, say).
  const { dots } = await spots(page);
  let dot = dots[0] ?? { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
  for (const at of dots) {
    await page.mouse.move(at.x - 20, at.y - 20);
    await page.mouse.move(at.x, at.y, { steps: 10 });
    await page.waitForTimeout(900);
    if (await page.locator("canvas.clickable").count()) {
      dot = at;
      break;
    }
  }
  out.drag = await profiled(cdp, "drag", () =>
    timed(page, cdp, async () => {
      await page.mouse.move(dot.x, dot.y);
      await page.mouse.down();
      const t0 = Date.now();
      for (let i = 0; Date.now() - t0 < 2500; i++) {
        await page.mouse.move(dot.x + Math.sin(i / 8) * 80, dot.y + Math.cos(i / 8) * 80);
        await page.waitForTimeout(8);
      }
      // force-graph marks its canvas while a Book is held.
      if (!(await page.locator("canvas.grabbable").count())) console.error(`The drag at ${n} Books missed: no Book was held.`);
      await page.mouse.up();
    }),
  );
  // Settling after the drag, as the simulation brings every Book home.
  out.settle = await profiled(cdp, "settle", () => timed(page, cdp, () => page.waitForTimeout(2000)));
  return out;
}

const browser = await chromium.launch({
  channel: "chrome",
  headless: false,
  args: ["--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "--disable-background-timer-throttling"],
});
const rows: string[] = [];
try {
  for (const n of sizes) {
    const seededLibrary = await keptLibrary(n);
    console.log(JSON.stringify({ ...seededLibrary, url: undefined }));
    const server = await serveLibrary(seededLibrary.url, PORT);
    const context = await browser.newContext(phone ? { viewport: VIEWPORT, isMobile: true, hasTouch: true, deviceScaleFactor: 3 } : { viewport: VIEWPORT });
    await context.addCookies([readerCookie()]);
    // tsx names the functions handed to page.evaluate with a helper the page lacks.
    await context.addInitScript({ content: "window.__name = (f) => f;" });
    const page = await context.newPage();
    page.on("pageerror", (e) => console.error("page error:", e.message));
    const cdp = await context.newCDPSession(page);
    await cdp.send("Performance.enable");
    if (throttle > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
    await page.goto(`http://localhost:${PORT}/graph`);
    await page.locator("canvas").waitFor();
    // The first draw: from the navigation to the frame after the canvas first has ink on it.
    const firstDraw = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const look = () => {
            const c = document.querySelector("canvas");
            const ctx = c?.getContext("2d");
            const inked = c && ctx && c.width > 0 && ctx.getImageData(0, 0, c.width, c.height).data.some((v, i) => i % 4 === 3 && v > 0);
            if (inked) resolve(Math.round(performance.now()));
            else requestAnimationFrame(look);
          };
          look();
        }),
    );
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `scripts/bench/out/${phone ? "phone-" : ""}graph-${n}.png` });
    const cell = (r: Awaited<ReturnType<typeof timed>>) => `${r.fps} fps, p95 ${r.p95} ms, busy ${r.busy} ms`;
    if (phone) {
      const rest = await runPhone(page, cdp, seededLibrary.hub, n);
      rows.push(`| ${n} | ${seededLibrary.connections} | ${seededLibrary.clusters} | ${firstDraw} ms | ${cell(rest.pan)} | ${cell(rest.zoom)} | ${cell(rest.hub)} |`);
    } else {
      const rest = await run(page, cdp, seededLibrary.hub, n);
      rows.push(
        `| ${n} | ${seededLibrary.connections} | ${seededLibrary.clusters} | ${cell(rest.pan)} | ${cell(rest.zoom)} | ${cell(rest.hub)} | ${cell(rest.drag)} | ${cell(rest.settle)} |`,
      );
    }
    console.log(rows.at(-1));
    await context.close();
    server.stop();
  }
} finally {
  await browser.close();
}
console.log(`\nCPU throttle: ${throttle}x\n`);
if (phone) {
  console.log("| Books | Connections | Clusters | first draw | pan | pinch out and in | pan, hub chosen |");
  console.log("|---|---|---|---|---|---|---|");
} else {
  console.log("| Books | Connections | Clusters | pan | zoom in and out | pan, hub chosen | drag a Book | settling after the drag |");
  console.log("|---|---|---|---|---|---|---|---|");
}
for (const r of rows) console.log(r);
