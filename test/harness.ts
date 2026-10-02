import { sql } from "drizzle-orm";
import { afterAll, beforeEach } from "vitest";
import { createDb } from "../src/db/client";
import { seedUser } from "../src/db/seed";

// Real Postgres, reset to "just the seeded user" before every test.
export function useTestDb() {
  const { db, pool } = createDb(process.env.TEST_DATABASE_URL!);
  const ctx = { db, userId: "" };

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE "user" CASCADE`);
    ctx.userId = (await seedUser(db)).id;
  });
  afterAll(() => pool.end());

  return ctx;
}
