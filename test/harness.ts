import { sql } from "drizzle-orm";
import { Client, type Pool } from "pg";
import { afterAll, beforeEach } from "vitest";
import { createDb } from "../src/db/client";
import { seedUser } from "../src/db/seed";
import { createPipeline, type Pipeline } from "../src/domain/pipeline";
import { memoryQueue } from "../src/lib/memory-queue";

declare module "vitest" {
  interface TaskMeta {
    // What the database was doing when the test failed, kept in the JSON report (vitest-results/).
    dbActivity?: { pool?: { total: number; idle: number; waiting: number }; sessions: Record<string, unknown>[] };
  }
}

// Real Postgres, reset to "just the seeded user" before every test, with a fresh in-memory job queue
// behind the Pipeline: jobs wait until the test drains them. A failed test records its database activity.
export function useTestDb() {
  const { db, pool } = createDb(process.env.TEST_DATABASE_URL!);
  recordDbActivityOnFailure(pool);
  const ctx = { db, userId: "", jobs: memoryQueue(db), pipeline: undefined as unknown as Pipeline };

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE "user" CASCADE`);
    ctx.userId = (await seedUser(db)).id;
    ctx.jobs = memoryQueue(db);
    ctx.pipeline = createPipeline(db, ctx.jobs);
  });
  afterAll(() => pool.end());

  return ctx;
}

// A failed test records every other session on the test database (state, what it waits on, who
// blocks it), and the pool's counts when given one, so an intermittent stall can be diagnosed from
// the run that had it. A test that already recorded its own (at the moment it gave up) keeps that.
export function recordDbActivityOnFailure(pool?: Pool) {
  beforeEach(({ task, onTestFailed }) => {
    onTestFailed(async () => {
      task.meta.dbActivity ??= await readDbActivity(pool);
    });
  });
}

export async function readDbActivity(pool?: Pool) {
  // Its own connection: the pool may be the thing that is stuck.
  const client = new Client({ connectionString: process.env.TEST_DATABASE_URL! });
  try {
    await client.connect();
    const { rows } = await client.query(
      `SELECT pid, state, wait_event_type, wait_event, pg_blocking_pids(pid) AS blocked_by,
              extract(epoch FROM now() - xact_start) AS in_transaction_s, left(query, 300) AS query
       FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()`,
    );
    return { pool: pool && { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount }, sessions: rows };
  } catch {
    // Diagnostics only; the failure itself is what the report needs.
    return undefined;
  } finally {
    await client.end().catch(() => {});
  }
}
