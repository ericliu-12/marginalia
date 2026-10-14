import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { createDb } from "../src/db/client";
import { runMigrations } from "../src/db/migrate";
import { perWorktree } from "./worktree";

const ADMIN_URL = process.env.DATABASE_URL ?? "postgres://marginalia:marginalia@localhost:5433/marginalia";
export const TEST_DB_NAME = perWorktree("marginalia_test");

export function testDatabaseUrl() {
  const url = new URL(ADMIN_URL);
  url.pathname = `/${TEST_DB_NAME}`;
  // On macOS about 1 in 1000 connects by the name localhost waits 5s before it connects, which times out
  // a test whose pool opens connections mid-test (#51). The address never waits.
  if (url.hostname === "localhost") url.hostname = "127.0.0.1";
  return url.toString();
}

// Fresh, migrated database per run against the docker-compose Postgres.
export default async function setup() {
  const { hostname } = new URL(ADMIN_URL);
  if (!["localhost", "127.0.0.1"].includes(hostname)) {
    throw new Error(`Refusing to drop and recreate ${TEST_DB_NAME} on non-local host ${hostname}`);
  }
  const admin = new Pool({ connectionString: ADMIN_URL });
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEST_DB_NAME}`);
  await admin.end();

  const { db, pool } = createDb(testDatabaseUrl());
  await runMigrations(db);
  // A Book added by work key gets an id made from it (a valid v4 UUID), not a random one: the layout
  // orders Books by id, so random ids would lay the same graph out differently on every run.
  await db.execute(sql`
    CREATE FUNCTION stable_book_id() RETURNS trigger AS $$
    DECLARE h text := md5(NEW.open_library_work_key);
    BEGIN
      NEW.id := (substr(h, 1, 12) || '4' || substr(h, 14, 3) || '8' || substr(h, 18, 15))::uuid;
      RETURN NEW;
    END $$ LANGUAGE plpgsql;
    CREATE TRIGGER stable_book_id BEFORE INSERT ON book
      FOR EACH ROW WHEN (NEW.open_library_work_key IS NOT NULL) EXECUTE FUNCTION stable_book_id();
  `);
  await pool.end();
  process.env.TEST_DATABASE_URL = testDatabaseUrl();
}
