import { eq } from "drizzle-orm";
import type { Db } from "./client";
import { normaliseEmail } from "@/domain/allowlist";
import { user } from "./schema";

// Until the Reader boundary (#64), the app reads one Reader: the seeded user. With OWNER_EMAIL set, that
// row carries the owner's real email, so signing in with it opens their existing library.
export const SEEDED_USER_EMAIL = "reader@marginalia.local";

const seededEmail = (env: Record<string, string | undefined>) => (env.OWNER_EMAIL && normaliseEmail(env.OWNER_EMAIL)) || SEEDED_USER_EMAIL;

export async function seedUser(db: Db, env: Record<string, string | undefined> = process.env) {
  const email = seededEmail(env);
  // The one-off step: the first run with OWNER_EMAIL moves the seeded row to it; later runs find it there.
  if (email !== SEEDED_USER_EMAIL) {
    const [owner] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
    if (!owner) await db.update(user).set({ email, updatedAt: new Date() }).where(eq(user.email, SEEDED_USER_EMAIL));
  }
  await db.insert(user).values({ email }).onConflictDoNothing();
  // The owner gave OWNER_EMAIL themselves, so it counts as verified: Google joins only a verified Reader.
  if (email !== SEEDED_USER_EMAIL) await db.update(user).set({ emailVerified: true }).where(eq(user.email, email));
  const [row] = await db.select().from(user).where(eq(user.email, email));
  return row;
}

// Read-only: the seeded user is created by `pnpm db:seed`, never on a read path.
export async function getSeededUserId(db: Db, env: Record<string, string | undefined> = process.env) {
  const [row] = await db.select({ id: user.id }).from(user).where(eq(user.email, seededEmail(env)));
  if (!row) throw new Error("Seeded user not found. Run `pnpm db:migrate && pnpm db:seed` first.");
  return row.id;
}

if (process.argv[1]?.endsWith("seed.ts")) {
  const { createDb } = await import("./client");
  const { db, pool } = createDb(process.env.DATABASE_URL!);
  console.log("seeded user", (await seedUser(db)).id);
  await pool.end();
}
