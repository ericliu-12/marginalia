import { Pool } from "pg";
import { createDb } from "../src/db/client";
import { runMigrations } from "../src/db/migrate";
import { perWorktree } from "./worktree";

const ADMIN_URL = process.env.DATABASE_URL ?? "postgres://marginalia:marginalia@localhost:5433/marginalia";
export const TEST_DB_NAME = perWorktree("marginalia_test");

export function testDatabaseUrl() {
  const url = new URL(ADMIN_URL);
  url.pathname = `/${TEST_DB_NAME}`;
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
  await pool.end();
  process.env.TEST_DATABASE_URL = testDatabaseUrl();
}
