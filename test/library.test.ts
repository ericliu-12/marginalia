import { describe, expect, it } from "vitest";
import { readLibrary } from "../src/domain/library";
import { addBook } from "../src/domain/add-book";
import { changeStatus } from "../src/domain/library-entry";
import { clusterLabel } from "../src/db/schema";
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

  it("carries a Finished Book's Cluster, as the graph has it, and when it was finished", async () => {
    const ids = [];
    for (const t of ["One", "Two", "Three"]) ids.push((await addBook(ctx.db, ctx.pipeline, ctx.userId, work({ workKey: `/works/${t}`, title: t }), "reading")).bookId);
    for (const id of ids) await changeStatus(ctx.db, ctx.pipeline, ctx.userId, id, "read");
    const { bookId: wanted } = await addBook(ctx.db, ctx.pipeline, ctx.userId, work({ workKey: "/works/w", title: "Wanted" }), "want");
    await ctx.db.insert(clusterLabel).values({ userId: ctx.userId, memberBookIds: [...ids, wanted], name: "Quiet failures", wash: 4 });

    const items = await readLibrary(ctx.db, ctx.userId);
    const one = items.find((i) => i.title === "One")!;
    expect(one.cluster).toEqual({ name: "Quiet failures", wash: 4 });
    expect(one.finishedAt).toBeGreaterThan(Date.now() - 60_000);
    // Not Finished, so not in the graph, whatever a stale membership says.
    expect(items.find((i) => i.title === "Wanted")).toMatchObject({ cluster: null, finishedAt: null });
  });
});
