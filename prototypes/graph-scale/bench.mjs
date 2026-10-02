import { chromium } from "playwright-core";
const S = process.argv[2], file = process.argv[3] || "bench.html";
const runs = JSON.parse(process.argv[4]); // [{v:"D",n:300,top:7}]
const browser = await chromium.launch({ channel: "chrome", headless: false,
  args: ["--disable-renderer-backgrounding","--disable-backgrounding-occluded-windows","--disable-features=CalculateNativeWinOcclusion","--disable-background-timer-throttling"] });
const out = [];
for (const r of runs) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", e => console.error("PAGEERR", e.message.slice(0,200)));
  const url = `file://${S}/${file}?variant=${r.v}${r.n ? "&n=" + r.n : ""}&top=${r.top || 3}${r.fix ? "&fix=" + r.fix : ""}`;
  await page.goto(url); await page.waitForFunction(() => window.__E, null, { timeout: 60000 });
  await page.waitForTimeout(r.v === "D" ? 1500 : 800);
  const meta = await page.evaluate(() => window.__BENCH || { N: 26 });
  await page.evaluate(() => {
    window.__rec = () => new Promise(res => { const t = []; let last = performance.now(), stop = false; const lt = [];
      const po = new PerformanceObserver(l => l.getEntries().forEach(e => lt.push(e.duration))); try { po.observe({ entryTypes: ["longtask"] }) } catch {}
      window.__stop = () => { stop = true };
      (function f(now) { t.push(now - last); last = now; if (!stop) requestAnimationFrame(f); else { po.disconnect(); res({ t: t.slice(2), lt }) } })(last); });
  });
  const stat = async (name, drive) => {
    const p = page.evaluate(() => window.__rec());
    await page.waitForTimeout(100);
    await page.evaluate(()=>{window.__draws=0;window.__c0=window.__E.fg?JSON.stringify(window.__E.fg.centerAt())+window.__E.fg.zoom():""});
    const t0 = Date.now(); await drive(); const dur = Date.now() - t0;
    const dr = await page.evaluate(()=>({d:window.__draws,c:window.__E.fg?JSON.stringify(window.__E.fg.centerAt())+window.__E.fg.zoom():"",c0:window.__c0}));
    await page.evaluate(() => window.__stop()); const { t, lt } = await p;
    t.sort((a, b) => a - b); const q = x => t[Math.min(t.length - 1, Math.floor(t.length * x))] || 0;
    const res = { v: r.v, n: meta.N, top: r.top || 3, fix: r.fix || "", scenario: name, frames: t.length, fps: +(t.length / (dur / 1000)).toFixed(1), p50: +q(.5).toFixed(1), p95: +q(.95).toFixed(1), max: +t[t.length - 1].toFixed(0), moved: dr.c!==dr.c0, toViewportCalls: dr.d, long50: lt.filter(d => d > 50).length };
    out.push(res); console.log(JSON.stringify(res));
  };
  const cx = 720, cy = 450;
  const empty = async () => page.evaluate(() => { const E = window.__E; if (!E.fg) return { x: 720, y: 150 }; let best = null, bd = -1;
    const pts = E.nodes.map(n => E.fg.graph2ScreenCoords(n.x, n.y));
    for (let x = 120; x < 1000; x += 20) for (let y = 120; y < 850; y += 20) { const el = document.elementFromPoint(x, y); if (!el || el.tagName !== "CANVAS") continue; let m = 1e9; for (const p of pts) { const d = Math.hypot(p.x - x, p.y - y); if (d < m) m = d } if (m > bd) { bd = m; best = { x, y } } } return best });
  const pan = async (ms = 2500) => { const st = await empty(); await page.mouse.move(st.x, st.y); await page.mouse.down(); const t0 = Date.now(); let i = 0;
    while (Date.now() - t0 < ms) { i++; await page.mouse.move(st.x + Math.sin(i / 10) * 120, st.y + 40 + Math.cos(i / 10) * 40); await page.waitForTimeout(8) } await page.mouse.up() };
  const zoom = async () => { await page.mouse.move(cx, cy); for (let i = 0; i < 40; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(25) } for (let i = 0; i < 40; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(25) } };
  await page.evaluate(()=>{const E=window.__E;window.__draws=0;const o=E.toViewport;E.toViewport=p=>{window.__draws++;return o(p)}});
  await page.screenshot({ path: `${S}/shot-${r.v}-${meta.N}.png` });
  await stat("pan (fit view)", () => pan());
  await stat("zoom in/out", zoom);
  if (r.v === "D") {
    // drag a node near the centre
    const pt = await page.evaluate(() => { const E = window.__E; let best, bd = 1e9; E.nodes.forEach(n => { const p = E.fg.graph2ScreenCoords(n.x, n.y); if (document.elementFromPoint(p.x, p.y)?.tagName !== "CANVAS") return; const d = Math.hypot(p.x - 720, p.y - 450); if (d < bd) { bd = d; best = p } }); return best });
    await stat("drag a node", async () => { await page.mouse.move(pt.x, pt.y); await page.mouse.down(); const t0 = Date.now(); let i = 0; while (Date.now() - t0 < 2500) { i++; await page.mouse.move(pt.x + Math.sin(i / 8) * 80, pt.y + Math.cos(i / 8) * 80); await page.waitForTimeout(8) } await page.mouse.up(); });
    // select the highest-degree book by clicking, then pan
    const hub = await page.evaluate(() => { const E = window.__E; const d = {}; edges.forEach(e => { d[e.a] = (d[e.a] || 0) + 1; d[e.b] = (d[e.b] || 0) + 1 }); const ids = Object.keys(d).sort((a, b) => d[b] - d[a]); for (const id of ids) { const n = E.nodes.find(n => n.id === id); const p = E.fg.graph2ScreenCoords(n.x, n.y); if (document.elementFromPoint(p.x, p.y)?.tagName === "CANVAS") return { x: p.x, y: p.y, id, deg: d[id] } } });
    console.log("hub", JSON.stringify(hub));
    await page.mouse.click(hub.x, hub.y); await page.waitForTimeout(1500);
    await stat("pan (hub selected)", () => pan());
  } else {
    await stat("pan (zoomed)", async () => { await page.mouse.move(cx, cy); for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(30) } await pan(2000) });
  }
  await ctx.close();
}
await browser.close();
console.log("DONE");
