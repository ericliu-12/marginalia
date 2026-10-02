import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { readLibrary } from "../src/domain/library";
import { getSeededUserId } from "../src/db/seed";
import { useTestDb } from "./harness";

describe("read the library", () => {
  const ctx = useTestDb();

  it("is empty for the seeded user", async () => {
    expect(await readLibrary(ctx.db, ctx.userId)).toEqual([]);
  });

  it("fails with a clear message when the seeded user is missing", async () => {
    await ctx.db.execute(sql`TRUNCATE "user" CASCADE`);
    await expect(getSeededUserId(ctx.db)).rejects.toThrow("pnpm db:seed");
  });
});
