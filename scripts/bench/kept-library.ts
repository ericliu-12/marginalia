// The synthetic libraries the graph benchmark and `pnpm graph:large` run on, kept between runs: one
// database per size, seeded once (with fixed Book ids, so the layout is the same every time) and reused,
// so every run of a size measures the same graph and only the first pays for the seeding (a minute for
// 300 Books, about fifteen for 1000).
//
// Each database is named for its size and a hash of everything that shapes what is seeded: the schema
// and its migrations, the seed script, and the layout and clustering code it runs. A change to any of
// them names a new database, seeded afresh, and the stale ones of that size are dropped, so an old
// library can't skew a run.
//
// Local only: it refuses a DATABASE_URL on any other host, and it only ever creates, seeds or drops
// databases named marginalia_bench_<size>_<hash>, never the dev or test databases.
import { spawn } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { createDb } from "@/db/client";
import { runMigrations } from "@/db/migrate";
import { seedSyntheticLibrary } from "./synthetic-library";

const ROOT = join(import.meta.dirname, "..", "..");
const SHAPING = [
  "src/db/schema.ts",
  "scripts/bench/synthetic-library.ts",
  "scripts/bench/kept-library.ts",
  "src/domain/graph.ts",
  "src/domain/graph-fit.ts",
  "src/domain/graph-drawing.ts",
  "src/domain/clusters.ts",
];
const PREFIX = "marginalia_bench_";
// Where the kept libraries' Reader is signed in, and the secret the servers sign its cookie with.
const SECRET = "bench-auth-secret-at-least-32-characters";
const TOKEN = "bench-reader-session";

const adminUrl = process.env.DATABASE_URL;
if (!adminUrl || !["localhost", "127.0.0.1"].includes(new URL(adminUrl).hostname)) {
  throw new Error("The kept bench libraries only live on a local Postgres: DATABASE_URL must point at localhost or 127.0.0.1.");
}
const onDatabase = (name: string) => Object.assign(new URL(adminUrl), { pathname: `/${name}` }).toString();
const DEV_DATABASE = new URL(adminUrl).pathname.slice(1);

// The hash of everything that shapes a seeded library.
function shapeHash() {
  const hash = createHash("sha256");
  const migrations = join(ROOT, "drizzle");
  const files = [...SHAPING, ...readdirSync(migrations, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".sql")).sort().map((f) => join("drizzle", f))];
  for (const f of files) hash.update(f).update(readFileSync(join(ROOT, f)));
  return hash.digest("hex").slice(0, 10);
}

// A name this module may create, seed or drop: never the dev or the test databases.
function ours(name: string) {
  if (!/^marginalia_bench_\d+_[0-9a-f]{10}$/.test(name) || name === DEV_DATABASE) throw new Error(`Refusing to touch the database ${name}.`);
  return name;
}

// The kept library of `n` Books: its database's URL (seeded first if it is missing, stale or was left
// half-seeded) and what it holds.
export async function keptLibrary(n: number) {
  const name = ours(`${PREFIX}${n}_${shapeHash()}`);
  const admin = new Pool({ connectionString: onDatabase("postgres") });
  try {
    // Marked seeded only once the seed finished; anything else of this size is stale or half done.
    const { rows } = await admin.query<{ datname: string; seeded: boolean }>(
      "SELECT datname, shobj_description(oid, 'pg_database') = 'seeded' AS seeded FROM pg_database WHERE datname LIKE $1",
      [`${PREFIX}${n}\\_%`],
    );
    for (const r of rows) if (r.datname !== name || !r.seeded) await admin.query(`DROP DATABASE IF EXISTS ${ours(r.datname)} WITH (FORCE)`);
    if (!rows.some((r) => r.datname === name && r.seeded)) {
      console.log(`Seeding ${n} Books into ${name}…`);
      const t0 = Date.now();
      await admin.query(`CREATE DATABASE ${name}`);
      const { db, pool } = createDb(onDatabase(name));
      try {
        await runMigrations(db);
        await seedSyntheticLibrary(db, n, TOKEN, { fixedIds: true });
      } finally {
        await pool.end();
      }
      await admin.query(`COMMENT ON DATABASE ${name} IS 'seeded'`);
      console.log(`Seeded in ${Math.round((Date.now() - t0) / 1000)}s.`);
    }
  } finally {
    await admin.end();
  }
  const url = onDatabase(name);
  const pool = new Pool({ connectionString: url });
  try {
    const count = async (sql: string) => (await pool.query<{ n: number }>(sql)).rows[0].n;
    // The best-connected Book, by its Connections, as the bench chooses it.
    const hub = await pool.query<{ title: string }>(
      "SELECT b.title FROM book b JOIN connection c ON b.id IN (c.book_a_id, c.book_b_id) GROUP BY b.id, b.title ORDER BY count(*) DESC, b.id LIMIT 1",
    );
    return {
      url,
      books: await count("SELECT count(*)::int AS n FROM library_entry"),
      connections: await count("SELECT count(*)::int AS n FROM connection"),
      clusters: await count("SELECT count(*)::int AS n FROM cluster_label"),
      hub: hub.rows[0]?.title ?? "",
    };
  } finally {
    await pool.end();
  }
}

// The production build served on a kept library, as its Reader; stopped with `stop`, and with this
// process (Ctrl-C included).
export async function serveLibrary(url: string, port: number) {
  const server = spawn("pnpm", ["exec", "next", "start", "--port", String(port)], {
    env: {
      ...process.env,
      DATABASE_URL: url,
      BETTER_AUTH_URL: `http://localhost:${port}`,
      BETTER_AUTH_SECRET: SECRET,
      ANTHROPIC_API_KEY: "bench-no-calls",
      VOYAGE_API_KEY: "bench-no-calls",
      GOOGLE_BOOKS_API_KEY: "bench-no-calls",
    },
    stdio: "ignore",
  });
  const stop = () => server.kill();
  process.on("exit", stop);
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      stop();
      process.exit(130);
    });
  }
  for (let tries = 0; ; tries++) {
    try {
      await fetch(`http://localhost:${port}/graph`);
      break;
    } catch (e) {
      if (tries > 60) throw e;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return { stop };
}

// The Reader's session cookie, signed as Better Auth signs it, for a browser on `serveLibrary`'s server.
export const readerCookie = () => ({
  name: "better-auth.session_token",
  value: encodeURIComponent(`${TOKEN}.${createHmac("sha256", SECRET).update(TOKEN).digest("base64")}`),
  domain: "localhost",
  path: "/",
  httpOnly: true,
  sameSite: "Lax" as const,
});
