// A large graph to look at, locally: the benchmark's synthetic library, served from the production
// build on its own database and opened, signed in, in Chrome, until the window is closed.
//
//   pnpm build && pnpm graph:large [books, default 300] [--phone]
//
// The library is kept in the marginalia_large database between runs and seeded again only for another
// size (300 Books take about a minute; 1000, about fifteen). --phone opens it at 390 by 844, by touch.
// Local DATABASE_URL only; no outside calls.
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { chromium } from "@playwright/test";
import { Pool } from "pg";
import { createDb } from "@/db/client";
import { runMigrations } from "@/db/migrate";
import { seedSyntheticLibrary } from "./synthetic-library";

const books = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? 300);
const phone = process.argv.includes("--phone");
const PORT = 3300;
const NAME = "marginalia_large";
const SECRET = "large-graph-auth-secret-at-least-32-characters";
const TOKEN = "large-graph-reader-session";

const adminUrl = process.env.DATABASE_URL;
if (!adminUrl || !["localhost", "127.0.0.1"].includes(new URL(adminUrl).hostname)) {
  throw new Error("pnpm graph:large only runs against a local DATABASE_URL (it keeps a database of its own).");
}
const onDatabase = (name: string) => Object.assign(new URL(adminUrl), { pathname: `/${name}` }).toString();

const admin = new Pool({ connectionString: onDatabase("postgres") });
const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [NAME]);
if (!rowCount) await admin.query(`CREATE DATABASE ${NAME}`);
await admin.end();
const { db, pool } = createDb(onDatabase(NAME));
await runMigrations(db);
const { rows } = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM library_entry");
if (rows[0].n !== books) {
  console.log(`Seeding ${books} Books…`);
  await seedSyntheticLibrary(db, books, TOKEN);
}
await pool.end();

const server = spawn("pnpm", ["exec", "next", "start", "--port", String(PORT)], {
  env: {
    ...process.env,
    DATABASE_URL: onDatabase(NAME),
    BETTER_AUTH_URL: `http://localhost:${PORT}`,
    BETTER_AUTH_SECRET: SECRET,
    ANTHROPIC_API_KEY: "large-graph-no-calls",
    VOYAGE_API_KEY: "large-graph-no-calls",
    GOOGLE_BOOKS_API_KEY: "large-graph-no-calls",
  },
  stdio: "ignore",
});
// Ctrl-C stops the server with it.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.kill();
    process.exit(130);
  });
}
for (let tries = 0; ; tries++) {
  try {
    await fetch(`http://localhost:${PORT}/graph`);
    break;
  } catch (e) {
    if (tries > 60) throw e;
    await new Promise((r) => setTimeout(r, 500));
  }
}
const browser = await chromium.launch({ channel: "chrome", headless: false });
const context = await browser.newContext(
  phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 } : { viewport: null },
);
const signed = encodeURIComponent(`${TOKEN}.${createHmac("sha256", SECRET).update(TOKEN).digest("base64")}`);
await context.addCookies([{ name: "better-auth.session_token", value: signed, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
const page = await context.newPage();
await page.goto(`http://localhost:${PORT}/graph`);
console.log(`A ${books}-Book graph at http://localhost:${PORT}/graph. Close the window to stop.`);
await page.waitForEvent("close", { timeout: 0 });
await browser.close();
server.kill();
