import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { addBook, DuplicateBookError } from "../src/domain/add-book";
import { readLibrary } from "../src/domain/library";
import { searchBooks } from "../src/domain/search";
import { book, libraryEntry, readThrough } from "../src/db/schema";
import { fakeGateway, work } from "./fakes";
import { useTestDb } from "./harness";

describe("search ranking", () => {
  const ctx = useTestDb();
  const search = (works: ReturnType<typeof work>[], q = "x") =>
    searchBooks(ctx.db, ctx.userId, fakeGateway(works), q).then((r) => r.map((w) => w.workKey));

  it("leads with the work that has the most editions", async () => {
    const keys = await search([
      work({ workKey: "/works/few", editionCount: 3 }),
      work({ workKey: "/works/many", editionCount: 80 }),
    ]);
    expect(keys).toEqual(["/works/many", "/works/few"]);
  });

  it("breaks edition-count ties by earliest first-publish year, unknown last", async () => {
    const keys = await search([
      work({ workKey: "/works/unknown", editionCount: 5, firstPublishedYear: null }),
      work({ workKey: "/works/late", editionCount: 5, firstPublishedYear: 2010 }),
      work({ workKey: "/works/early", editionCount: 5, firstPublishedYear: 1965 }),
    ]);
    expect(keys).toEqual(["/works/early", "/works/late", "/works/unknown"]);
  });

  it("demotes adaptations, study guides and box sets below originals but keeps them", async () => {
    const keys = await search([
      work({ workKey: "/works/guide", title: "Stoner: A Study Guide", editionCount: 90 }),
      work({ workKey: "/works/box", title: "The Complete Trilogy Box Set", editionCount: 70 }),
      work({ workKey: "/works/graphic", title: "Stoner", subjects: ["Graphic novel adaptations"], editionCount: 60 }),
      work({ workKey: "/works/summary", title: "Summary of Stoner", editionCount: 50 }),
      work({ workKey: "/works/original", title: "Stoner", editionCount: 4 }),
    ]);
    expect(keys[0]).toBe("/works/original");
    expect(keys.slice(1).sort()).toEqual(["/works/box", "/works/graphic", "/works/guide", "/works/summary"]);
  });

  it("builds a cover url when Open Library has a cover id, none otherwise", async () => {
    const results = await searchBooks(
      ctx.db,
      ctx.userId,
      fakeGateway([work({ workKey: "/works/a", coverId: 123 }), work({ workKey: "/works/b", editionCount: 0 })]),
      "x",
    );
    expect(results[0].coverUrl).toBe("https://covers.openlibrary.org/b/id/123-M.jpg");
    expect(results[1].coverUrl).toBeNull();
  });

  it("marks works already in the library with their status", async () => {
    const stoner = work({ workKey: "/works/stoner", title: "Stoner", editionCount: 9 });
    await addBook(ctx.db, ctx.userId, stoner, "reading");
    const results = await searchBooks(ctx.db, ctx.userId, fakeGateway([stoner, work({ workKey: "/works/other" })]), "x");
    expect(results.map((r) => r.libraryStatus)).toEqual(["reading", null]);
  });

  it("returns nothing for a blank query without calling Open Library", async () => {
    const gw = fakeGateway([work({ workKey: "/works/a" })]);
    expect(await searchBooks(ctx.db, ctx.userId, gw, "   ")).toEqual([]);
    expect(gw.queries).toEqual([]);
  });
});

describe("add a Book", () => {
  const ctx = useTestDb();
  const stoner = work({
    workKey: "/works/OL3511459W",
    title: "Stoner",
    authors: ["John Williams"],
    firstPublishedYear: 1965,
    coverId: 7,
    subjects: ["College teachers", "award:man_booker_prize=1989", "Pr6059.s5 r46 1993x", "Holocaust fast (OCoLC)fst00958866 (uri)"],
  });

  it("adds a Book with the chosen Status, visible in the library", async () => {
    await addBook(ctx.db, ctx.userId, stoner, "want");
    expect(await readLibrary(ctx.db, ctx.userId)).toEqual([
      expect.objectContaining({ title: "Stoner", authors: ["John Williams"], status: "want" }),
    ]);
  });

  it("stores the work key, year, cover and a snapshot with noisy subjects dropped", async () => {
    await addBook(ctx.db, ctx.userId, stoner, "want");
    const [row] = await ctx.db.select().from(book);
    expect(row).toMatchObject({
      openLibraryWorkKey: "/works/OL3511459W",
      firstPublishedYear: 1965,
      coverUrl: "https://covers.openlibrary.org/b/id/7-M.jpg",
      snapshot: { subjects: ["College teachers"] },
    });
  });

  it("'Already read' creates one completed Read-through with null dates", async () => {
    await addBook(ctx.db, ctx.userId, stoner, "read");
    const rows = await ctx.db.select().from(readThrough);
    expect(rows).toHaveLength(1);
    expect(rows[0].startedAt).toBeNull();
    expect(rows[0].finishedAt).toBeNull();
    expect(rows[0].completedAt).toBeInstanceOf(Date);
  });

  it("'Want to read' creates no Read-through", async () => {
    await addBook(ctx.db, ctx.userId, stoner, "want");
    expect(await ctx.db.select().from(readThrough)).toEqual([]);
  });

  it("rejects adding the same work key twice and leaves one Library Entry", async () => {
    await addBook(ctx.db, ctx.userId, stoner, "want");
    await expect(addBook(ctx.db, ctx.userId, stoner, "read")).rejects.toBeInstanceOf(DuplicateBookError);
    expect(await ctx.db.select().from(book)).toHaveLength(1);
    expect(await ctx.db.select().from(libraryEntry)).toHaveLength(1);
    expect(await ctx.db.select().from(readThrough)).toEqual([]);
  });

  it("rejects concurrent adds of the same work key", async () => {
    const results = await Promise.allSettled([
      addBook(ctx.db, ctx.userId, stoner, "want"),
      addBook(ctx.db, ctx.userId, stoner, "want"),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(await ctx.db.select().from(libraryEntry)).toHaveLength(1);
  });

  it("adds with thin metadata: no cover, no year, no authors", async () => {
    await addBook(ctx.db, ctx.userId, work({ workKey: "/works/thin", title: "Thin", authors: [], firstPublishedYear: null }), "want");
    const [row] = await ctx.db
      .select()
      .from(book)
      .where(and(eq(book.openLibraryWorkKey, "/works/thin")));
    expect(row).toMatchObject({ title: "Thin", authors: [], coverUrl: null, firstPublishedYear: null });
  });
});
