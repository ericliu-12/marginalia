import { describe, expect, it } from "vitest";
import { readLibrary } from "../src/domain/library";
import { addBook } from "../src/domain/add-book";
import { work } from "./fakes";
import { useTestDb } from "./harness";

describe("read the library", () => {
  const ctx = useTestDb();

  it("is empty for a new Reader", async () => {
    expect(await readLibrary(ctx.db, ctx.userId)).toEqual([]);
  });

  it("groups by Status: reading, want, then read ordered by most recently finished", async () => {
    await addBook(ctx.db, ctx.pipeline, ctx.userId, work({ workKey: "/works/r1", title: "Read first" }), "read");
    await addBook(ctx.db, ctx.pipeline, ctx.userId, work({ workKey: "/works/w1", title: "Want" }), "want");
    await addBook(ctx.db, ctx.pipeline, ctx.userId, work({ workKey: "/works/r2", title: "Read second" }), "read");
    await addBook(ctx.db, ctx.pipeline, ctx.userId, work({ workKey: "/works/p1", title: "Reading" }), "reading");
    const titles = (await readLibrary(ctx.db, ctx.userId)).map((i) => i.title);
    expect(titles).toEqual(["Reading", "Want", "Read second", "Read first"]);
  });
});
