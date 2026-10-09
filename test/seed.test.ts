import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { libraryEntry, user } from "../src/db/schema";
import { getSeededUserId, seedUser } from "../src/db/seed";
import { addBook } from "../src/domain/add-book";
import { work } from "./fakes";
import { useTestDb } from "./harness";

// `pnpm db:deploy` seeds before every deploy: on an empty database it creates the one reader, and on
// one in use it changes nothing.
describe("Seeding", () => {
  const ctx = useTestDb();

  it("creates only the reader, keeps the same one on every run, and leaves their library as it was", async () => {
    const entry = await addBook(ctx.db, ctx.pipeline, ctx.userId, work({ workKey: "/works/seed1", title: "Stoner" }), "reading");
    const again = await seedUser(ctx.db);
    await seedUser(ctx.db);
    expect(again.id).toBe(ctx.userId);
    expect(await getSeededUserId(ctx.db)).toBe(ctx.userId);
    expect(await ctx.db.select().from(user)).toHaveLength(1);
    const [kept] = await ctx.db.select().from(libraryEntry).where(eq(libraryEntry.bookId, entry.bookId));
    expect(kept).toMatchObject({ userId: ctx.userId, status: "reading" });
  });

  it("with OWNER_EMAIL, makes the seeded reader the owner's account, keeping their library, on every run after", async () => {
    const entry = await addBook(ctx.db, ctx.pipeline, ctx.userId, work({ workKey: "/works/seed2", title: "Stoner" }), "reading");
    const env = { OWNER_EMAIL: " Owner@Example.com " };
    const owner = await seedUser(ctx.db, env);
    await seedUser(ctx.db, env);
    expect(owner).toMatchObject({ id: ctx.userId, email: "owner@example.com", emailVerified: true });
    expect(await getSeededUserId(ctx.db, env)).toBe(ctx.userId);
    expect(await ctx.db.select({ email: user.email }).from(user)).toEqual([{ email: "owner@example.com" }]);
    const [kept] = await ctx.db.select().from(libraryEntry).where(eq(libraryEntry.bookId, entry.bookId));
    expect(kept.userId).toBe(ctx.userId);
  });
});
