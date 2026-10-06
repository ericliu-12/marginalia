import { sql } from "drizzle-orm";
import { afterAll, beforeEach } from "vitest";
import { createDb } from "../src/db/client";
import { seedUser } from "../src/db/seed";
import { createPipeline, type Pipeline } from "../src/domain/pipeline";
import { memoryQueue } from "../src/lib/memory-queue";

// Real Postgres, reset to "just the seeded user" before every test, with a fresh in-memory job queue
// behind the Pipeline: jobs wait until the test drains them.
export function useTestDb() {
  const { db, pool } = createDb(process.env.TEST_DATABASE_URL!);
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
