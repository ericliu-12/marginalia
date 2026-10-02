import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { readLibrary } from "../src/domain/library";
import { getSeededUserId } from "../src/db/seed";
import { addBook } from "../src/domain/add-book";
import { work } from "./fakes";
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

  it("groups by Status: reading, want, then read ordered by most recently finished", async () => {
    await addBook(ctx.db, ctx.userId, work({ workKey: "/works/r1", title: "Read first" }), "read");
    await addBook(ctx.db, ctx.userId, work({ workKey: "/works/w1", title: "Want" }), "want");
    await addBook(ctx.db, ctx.userId, work({ workKey: "/works/r2", title: "Read second" }), "read");
    await addBook(ctx.db, ctx.userId, work({ workKey: "/works/p1", title: "Reading" }), "reading");
    const titles = (await readLibrary(ctx.db, ctx.userId)).map((i) => i.title);
    expect(titles).toEqual(["Reading", "Want", "Read second", "Read first"]);
  });
});
