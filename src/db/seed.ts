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

// Read-only: the seeded user is created by `pnpm db:seed`, never on a read path.
export async function getSeededUserId(db: Db) {
  const [row] = await db.select({ id: user.id }).from(user).where(eq(user.email, SEEDED_USER_EMAIL));
  if (!row) throw new Error("Seeded user not found. Run `pnpm db:migrate && pnpm db:seed` first.");
  return row.id;
}

if (process.argv[1]?.endsWith("seed.ts")) {
  const { createDb } = await import("./client");
  const { db, pool } = createDb(process.env.DATABASE_URL!);
  console.log("seeded user", (await seedUser(db)).id);
  await pool.end();
}
