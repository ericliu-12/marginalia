import { eq } from "drizzle-orm";
import type { Db } from "./client";
import { user } from "./schema";

// The MVP has no auth: one real user row that everything hangs off.
export const SEEDED_USER_EMAIL = "reader@marginalia.local";

export async function seedUser(db: Db) {
  await db.insert(user).values({ email: SEEDED_USER_EMAIL }).onConflictDoNothing();
  const [row] = await db.select().from(user).where(eq(user.email, SEEDED_USER_EMAIL));
  return row;
}

export async function getSeededUserId(db: Db) {
  return (await seedUser(db)).id;
}

if (process.argv[1]?.endsWith("seed.ts")) {
  const { createDb } = await import("./client");
  const { db, pool } = createDb(process.env.DATABASE_URL!);
  console.log("seeded user", (await seedUser(db)).id);
  await pool.end();
}
