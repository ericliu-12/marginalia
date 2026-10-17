// A large graph to look at, locally: the benchmark's kept synthetic library (./kept-library.ts), served
// from the production build and opened, signed in, in Chrome, until the window is closed.
//
//   pnpm build && pnpm graph:large [books, default 300] [--phone]
//
// The first run of a size seeds its library (300 Books take about a minute; 1000, about fifteen); later
// runs, and the benchmark, reuse it. --phone opens it at 390 by 844, by touch. Local DATABASE_URL only;
// no outside calls.
import { chromium } from "@playwright/test";
import { keptLibrary, readerCookie, serveLibrary } from "./kept-library";

const books = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? 300);
const phone = process.argv.includes("--phone");
const PORT = 3300;

const { url } = await keptLibrary(books);
const server = await serveLibrary(url, PORT);
const browser = await chromium.launch({ channel: "chrome", headless: false });
const context = await browser.newContext(
  phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 } : { viewport: null },
);
await context.addCookies([readerCookie()]);
const page = await context.newPage();
await page.goto(`http://localhost:${PORT}/graph`);
console.log(`A ${books}-Book graph at http://localhost:${PORT}/graph. Close the window to stop.`);
await page.waitForEvent("close", { timeout: 0 });
await browser.close();
server.stop();
