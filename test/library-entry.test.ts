import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { addBook } from "../src/domain/add-book";
import { readLibrary } from "../src/domain/library";
import { changeStatus } from "../src/domain/library-entry";
import { book, libraryEntry, readThrough } from "../src/db/schema";
import { work } from "./fakes";
import { useTestDb } from "./harness";

describe("status changes and read-throughs", () => {
  const ctx = useTestDb();
  const w = work({ workKey: "/works/stoner", title: "Stoner" });

  async function start(status: "want" | "reading" | "read") {
    const entry = await addBook(ctx.db, ctx.userId, w, status);
    return entry.bookId;
  }
  const change = (bookId: string, status: "want" | "reading" | "read") =>
    changeStatus(ctx.db, ctx.userId, bookId, status);
  const passes = async () =>
    ctx.db.select().from(readThrough).orderBy(asc(readThrough.createdAt));
  const item = async () => (await readLibrary(ctx.db, ctx.userId))[0];

  it("want to reading opens a Read-through with a start date", async () => {
    const id = await start("want");
    await change(id, "reading");
    const [p] = await passes();
    expect(p.startedAt).toBeInstanceOf(Date);
    expect(p.completedAt).toBeNull();
    expect((await item()).status).toBe("reading");
  });

  it("reading to read closes the open Read-through", async () => {
    const id = await start("reading");
    const res = await change(id, "read");
    const all = await passes();
    expect(all).toHaveLength(1);
    expect(all[0].startedAt).toBeInstanceOf(Date);
    expect(all[0].finishedAt).toBeInstanceOf(Date);
    expect(all[0].completedAt).toBeInstanceOf(Date);
    expect(res.firstCompletion).toBe(true);
  });

  it("want to read directly creates a closed Read-through with unknown dates", async () => {
    const id = await start("want");
    await change(id, "read");
    const [p] = await passes();
    expect(p.startedAt).toBeNull();
    expect(p.finishedAt).toBeNull();
    expect(p.completedAt).toBeInstanceOf(Date);
  });

  it("reading back to want leaves no open Read-through", async () => {
    const id = await start("reading");
    await change(id, "want");
    expect(await passes()).toEqual([]);
    expect((await item()).status).toBe("want");
  });

  it("a re-read opens a new Read-through and keeps the old one", async () => {
    const id = await start("read");
    await change(id, "reading");
    const all = await passes();
    expect(all).toHaveLength(2);
    expect(all.filter((p) => p.completedAt === null)).toHaveLength(1);
  });

  it("a Book stays Finished while re-read and when moved back to want", async () => {
    const id = await start("read");
    await change(id, "reading");
    expect(await item()).toMatchObject({ status: "reading", finished: true, reReading: true });
    await change(id, "want");
    expect(await item()).toMatchObject({ status: "want", finished: true, reReading: false });
    expect(await passes()).toHaveLength(1);
  });

  it("a first read is not marked re-reading and is not Finished until completed", async () => {
    const id = await start("want");
    await change(id, "reading");
    expect(await item()).toMatchObject({ finished: false, reReading: false });
  });

  it("only the first completed Read-through is a first completion", async () => {
    const id = await start("reading");
    expect((await change(id, "read")).firstCompletion).toBe(true);
    await change(id, "reading");
    expect((await change(id, "read")).firstCompletion).toBe(false);
    expect(await passes()).toHaveLength(2);
  });

  it("adding a Book directly as read is a first completion; as want or reading it is not", async () => {
    const first = await addBook(ctx.db, ctx.userId, work({ workKey: "/works/a", title: "A" }), "read");
    expect(first.firstCompletion).toBe(true);
    expect(await item()).toMatchObject({ finished: true });
    const want = await addBook(ctx.db, ctx.userId, work({ workKey: "/works/b", title: "B" }), "want");
    const reading = await addBook(ctx.db, ctx.userId, work({ workKey: "/works/c", title: "C" }), "reading");
    expect([want.firstCompletion, reading.firstCompletion]).toEqual([false, false]);
  });

  it("moving to the same status changes nothing", async () => {
    const id = await start("reading");
    const res = await change(id, "reading");
    expect(await passes()).toHaveLength(1);
    expect(res.firstCompletion).toBe(false);
  });

  it("moving to the same status repairs a Reading entry with no open Read-through", async () => {
    const id = await start("reading");
    await ctx.db.delete(readThrough);
    await change(id, "reading");
    const all = await passes();
    expect(all).toHaveLength(1);
    expect(all[0].completedAt).toBeNull();
  });

  it("read to read records no second pass", async () => {
    const id = await start("read");
    await change(id, "read");
    expect(await passes()).toHaveLength(1);
  });

  it("sorts Read Books with unknown finish dates after dated ones", async () => {
    const dated = await start("reading");
    await change(dated, "read");
    await addBook(ctx.db, ctx.userId, work({ workKey: "/works/undated", title: "Undated" }), "read");
    const titles = (await readLibrary(ctx.db, ctx.userId)).map((i) => i.title);
    expect(titles).toEqual(["Stoner", "Undated"]);
  });

  it("closes a missing open Read-through when reading goes to read", async () => {
    const id = await start("reading");
    await ctx.db.delete(readThrough);
    await change(id, "read");
    expect(await passes()).toHaveLength(1);
  });

  it("fails for a Book not in the library", async () => {
    await ctx.db.insert(book).values({ title: "Other" });
    const [b] = await ctx.db.select().from(book).where(eq(book.title, "Other"));
    await expect(change(b.id, "reading")).rejects.toThrow();
    expect(await ctx.db.select().from(libraryEntry)).toEqual([]);
  });
});
