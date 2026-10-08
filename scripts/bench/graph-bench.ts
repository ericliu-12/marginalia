// Graph benchmark: the #14 harness (prototype/graph-scale), pointed at the real graph view. Run it, and
// record its table on the ticket, after a change that could slow the graph down.
//
//   pnpm build && pnpm bench:graph [300,600,1000] [cpu throttle, e.g. 4]
//
// For each size it seeds a scratch database with that many synthetic Finished Books (about one Cluster
// per 20, 3 to 5 Connections each, 80% inside their Cluster with preferential attachment, 40% strong),
// lays them out and clusters them as the worker would, names every Cluster, then serves the production
// build on it and drives installed Chrome, headed, at 1440 by 900 (see `run`). Each scenario is timed by
// its requestAnimationFrame intervals. A CPU throttle stands in for lower-end hardware. Local DATABASE_URL only; no outside calls.
import { spawn } from "node:child_process";
import { chromium, type CDPSession, type Page } from "@playwright/test";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { createDb, type Db } from "@/db/client";
import { runMigrations } from "@/db/migrate";
import { seedUser } from "@/db/seed";
import { book, bookPosition, clusterLabel, connection, enrichment, libraryEntry, readThrough } from "@/db/schema";
import { recomputeClusters } from "@/domain/clusters";
import { layoutGraph } from "@/domain/graph";

const sizes = (process.argv[2] ?? "300,600,1000").split(",").map(Number);
const throttle = Number(process.argv[3] ?? 1);
// BENCH_PROFILE=<scenario> (pan, zoom, hub, drag or settle) also profiles that scenario and prints where
// its time went, by function. Build with `next build --no-mangling` so the names read.
const profile = process.env.BENCH_PROFILE;
const PORT = 3200;
const NAME = "marginalia_bench";

const adminUrl = process.env.DATABASE_URL;
if (!adminUrl || !["localhost", "127.0.0.1"].includes(new URL(adminUrl).hostname)) {
  throw new Error("pnpm bench:graph only runs against a local DATABASE_URL (it creates and drops a scratch database).");
}
const onDatabase = (name: string) => Object.assign(new URL(adminUrl), { pathname: `/${name}` }).toString();

// Mulberry32, so every run seeds the same library.
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS =
  "river night house garden letter winter season stone memory silence harbour mirror empire island daughter stranger orchard fire light shadow city mountain glass salt bread ash rain field ghost book voyage".split(
    " ",
  );
const ADJECTIVES = "quiet long last hidden broken golden distant small bright silent lost old new white black".split(" ");

// A synthetic library: titles of one to six words, some with subtitles, in Clusters as described above.
function library(n: number) {
  const rand = seeded(n);
  const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const title = (i: number) => {
    const words = Array.from({ length: 1 + Math.floor(rand() * 5) }, () => (rand() < 0.3 ? pick(ADJECTIVES) : pick(WORDS)));
    const main = ["The", ...words].join(" ").replace(/\b\w/g, (c) => c.toUpperCase());
    return `${main} ${i}${rand() < 0.25 ? `: A ${pick(WORDS)} of ${pick(WORDS)}s` : ""}`;
  };
  const groups = Math.max(1, Math.round(n / 20));
  const group = Array.from({ length: n }, (_, i) => i % groups);
  const degree = new Array(n).fill(0);
  const pairs = new Map<string, { a: number; b: number; strong: boolean }>();
  for (let i = 0; i < n; i++) {
    const want = 3 + Math.floor(rand() * 3);
    for (let tries = 0; degree[i] < want && tries < 50; tries++) {
      const inside = rand() < 0.8;
      const pool = Array.from({ length: n }, (_, j) => j).filter((j) => j !== i && (group[j] === group[i]) === inside);
      // Preferential attachment: the better connected are likelier picks.
      const weights = pool.map((j) => 1 + degree[j]);
      let r = rand() * weights.reduce((s, w) => s + w, 0);
      const j = pool[weights.findIndex((w) => (r -= w) < 0)] ?? pool[0];
      const key = [i, j].sort((p, q) => p - q).join(":");
      if (j === undefined || pairs.has(key)) continue;
      pairs.set(key, { a: i, b: j, strong: rand() < 0.4 });
      degree[i]++;
      degree[j]++;
    }
  }
  return { titles: Array.from({ length: n }, (_, i) => title(i)), pairs: [...pairs.values()], degree };
}

async function seed(db: Db, n: number) {
  await db.execute(sql`TRUNCATE "user" CASCADE`);
  const userId = (await seedUser(db)).id;
  const { titles, pairs, degree } = library(n);
  const books = await db.insert(book).values(titles.map((title) => ({ title, authors: ["A. Writer"] }))).returning({ id: book.id });
  const entries = await db
    .insert(libraryEntry)
    .values(books.map((b) => ({ userId, bookId: b.id, status: "read" as const, connectionsGeneratedAt: new Date() })))
    .returning({ id: libraryEntry.id });
  await db.insert(readThrough).values(
    entries.map((e, i) => {
      const at = new Date(Date.UTC(2020, 0, 1 + i));
      return { libraryEntryId: e.id, userId, finishedAt: at, completedAt: at };
    }),
  );
  await db.insert(enrichment).values(books.map((b) => ({ bookId: b.id, status: "ready" as const, recognised: true, summary: "A book.", themes: ["memory"] })));
  const types = ["thematic", "contrast", "context"] as const;
  await db.insert(connection).values(
    pairs.map(({ a, b, strong }, i) => {
      const [x, y] = [books[a].id, books[b].id].sort();
      return {
        userId,
        bookAId: x,
        bookBId: y,
        type: types[i % 3],
        strength: strong ? ("strong" as const) : ("moderate" as const),
        similarity: 0.5,
        similarityModel: "bench",
        explanation: "Why these two meet.",
        grounding: "enrichment" as const,
        model: "bench",
        promptVersion: "bench",
      };
    }),
  );
  await recomputeClusters(db, userId);
  await layoutGraph(db, userId);
  // Names as long as real ones run: two to five words.
  const rand = seeded(n + 1);
  const clusters = await db.select({ id: clusterLabel.id }).from(clusterLabel);
  for (const c of clusters) {
    const words = Array.from({ length: 2 + Math.floor(rand() * 4) }, () => WORDS[Math.floor(rand() * WORDS.length)]);
    const name = words.join(" ").replace(/^\w/, (ch) => ch.toUpperCase());
    await db.update(clusterLabel).set({ name, description: "Synthetic.", namedMemberBookIds: sql`member_book_ids` }).where(sql`id = ${c.id}`);
  }
  const hub = degree.indexOf(Math.max(...degree));
  const placed = await db.select({ n: sql<number>`count(*)::int` }).from(bookPosition);
  return { books: n, connections: pairs.length, clusters: clusters.length, hub: titles[hub], placed: placed[0].n };
}

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

// A spot on the canvas with no ink near it (somewhere to pan from), and the centre of a Book's dot
// near the middle (something to drag), found from the canvas's own pixels.
async function spots(page: Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector("canvas")!;
    const ctx = canvas.getContext("2d")!;
    const scale = canvas.width / canvas.clientWidth;
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const dark = (x: number, y: number) => {
      const i = (Math.round(y) * width + Math.round(x)) * 4;
      return data[i + 3] > 200 && data[i] < 80 && data[i + 1] < 80 && data[i + 2] < 80;
    };
    let empty = { x: 720, y: 450 };
    let best = -1;
    let dot = { x: 720, y: 450 };
    let nearest = Infinity;
    for (let y = 140; y < 780; y += 10) {
      for (let x = 140; x < 1000; x += 10) {
        const [px, py] = [x * scale, y * scale];
        let clear = 0;
        while (clear < 40 && ![0, 1, 2, 3, 4, 5, 6, 7].some((k) => dark(px + Math.cos(k) * clear * scale, py + Math.sin(k) * clear * scale))) clear++;
        if (clear > best && document.elementFromPoint(x, y) === canvas) [best, empty] = [clear, { x, y }];
        const solid = [-3, 0, 3].every((dx) => [-3, 0, 3].every((dy) => px + dx > 0 && px + dx < width && py + dy > 0 && py + dy < height && dark(px + dx, py + dy)));
        const d = Math.hypot(x - 600, y - 450);
        if (solid && d < nearest && document.elementFromPoint(x, y) === canvas) [nearest, dot] = [d, { x, y }];
      }
    }
    return { empty, dot };
  });
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
  await page.getByRole("navigation", { name: "Books in the graph" }).getByRole("button", { name: `${hub}, ` }).first().focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `scripts/bench/out/graph-${n}-hub.png` });
  out.hub = await profiled(cdp, "hub", () => timed(page, cdp, pan));
  // Back to the whole graph; the camera glides home, slowly under a throttle.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(3000);
  const { dot } = await spots(page);
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

const admin = new Pool({ connectionString: onDatabase("postgres") });
await admin.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
await admin.query(`CREATE DATABASE ${NAME}`);
const { db, pool } = createDb(onDatabase(NAME));
await runMigrations(db);

const server = spawn("pnpm", ["exec", "next", "start", "--port", String(PORT)], {
  env: { ...process.env, DATABASE_URL: onDatabase(NAME), ANTHROPIC_API_KEY: "bench-no-calls", VOYAGE_API_KEY: "bench-no-calls", GOOGLE_BOOKS_API_KEY: "bench-no-calls" },
  stdio: "ignore",
});
const browser = await chromium.launch({
  channel: "chrome",
  headless: false,
  args: ["--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "--disable-background-timer-throttling"],
});
const rows: string[] = [];
try {
  for (let tries = 0; ; tries++) {
    try {
      await fetch(`http://localhost:${PORT}/graph`);
      break;
    } catch (e) {
      if (tries > 60) throw e;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  for (const n of sizes) {
    const t0 = Date.now();
    const seededLibrary = await seed(db, n);
    console.log(JSON.stringify({ ...seededLibrary, seedSeconds: (Date.now() - t0) / 1000 }));
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    // tsx names the functions handed to page.evaluate with a helper the page lacks.
    await context.addInitScript({ content: "window.__name = (f) => f;" });
    const page = await context.newPage();
    page.on("pageerror", (e) => console.error("page error:", e.message));
    const cdp = await context.newCDPSession(page);
    await cdp.send("Performance.enable");
    if (throttle > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
    await page.goto(`http://localhost:${PORT}/graph`);
    await page.locator("canvas").waitFor();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `scripts/bench/out/graph-${n}.png` });
    const rest = await run(page, cdp, seededLibrary.hub, n);
    const cell = (r: Awaited<ReturnType<typeof timed>>) => `${r.fps} fps, p95 ${r.p95} ms, busy ${r.busy} ms`;
    rows.push(
      `| ${n} | ${seededLibrary.connections} | ${seededLibrary.clusters} | ${cell(rest.pan)} | ${cell(rest.zoom)} | ${cell(rest.hub)} | ${cell(rest.drag)} | ${cell(rest.settle)} |`,
    );
    console.log(rows.at(-1));
    await context.close();
  }
} finally {
  await browser.close();
  server.kill();
  await pool.end();
  await admin.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
  await admin.end();
}
console.log(`\nCPU throttle: ${throttle}x\n`);
console.log("| Books | Connections | Clusters | pan | zoom in and out | pan, hub chosen | drag a Book | settling after the drag |");
console.log("|---|---|---|---|---|---|---|---|");
for (const r of rows) console.log(r);
