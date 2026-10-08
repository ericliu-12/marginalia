import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { addBook, addManualBook, InvalidBookError } from "../src/domain/add-book";
import { editBook } from "../src/domain/edit-book";
import { enrichBook } from "../src/domain/enrichment";
import { readLibrary } from "../src/domain/library";
import { NotInLibraryError, removeFromLibrary } from "../src/domain/library-entry";
import { findLookalike } from "../src/domain/lookalike";
import { searchBooks } from "../src/domain/search";
import { book, enrichment, libraryEntry, user } from "../src/db/schema";
import { fakeEnricher, fakeGateway, work } from "./fakes";
import { useTestDb } from "./harness";

describe("Manual Books, lookalikes and overrides", () => {
  const ctx = useTestDb();
  const otherReader = async () => (await ctx.db.insert(user).values({ email: "other@example.com" }).returning())[0].id;
  const manual = (input: Partial<Parameters<typeof addManualBook>[3]> = {}, userId = ctx.userId) =>
    addManualBook(ctx.db, ctx.pipeline, userId, { title: "Notes from a Kitchen", author: "June Ash", ...input }, "want");
  const edit = (bookId: string, input: Parameters<typeof editBook>[4], userId = ctx.userId) =>
    editBook(ctx.db, ctx.pipeline, userId, bookId, input);
  const enrichJobs = () => ctx.jobs.sent.filter((j) => j.kind === "enrich");
  const bookRow = async (id: string) => (await ctx.db.select().from(book).where(eq(book.id, id)))[0];

  describe("adding a Book by hand", () => {
    it("creates a private Book owned by the reader, in their library, and asks for its Enrichment", async () => {
      const { bookId } = await manual({ coverUrl: "https://example.com/c.jpg", description: "Recipes and grief." });
      const b = await bookRow(bookId);
      expect(b).toMatchObject({
        title: "Notes from a Kitchen",
        authors: ["June Ash"],
        coverUrl: "https://example.com/c.jpg",
        description: "Recipes and grief.",
        createdByUserId: ctx.userId,
        openLibraryWorkKey: null,
      });
      expect(await readLibrary(ctx.db, ctx.userId)).toMatchObject([
        { bookId, title: "Notes from a Kitchen", authors: ["June Ash"], manual: true, description: "Recipes and grief." },
      ]);
      expect(enrichJobs()).toEqual([{ kind: "enrich", bookId }]);
    });

    it("trims its fields and stores missing optional ones as null", async () => {
      const { bookId } = await manual({ title: "  Kitchen  ", author: " June Ash ", coverUrl: " ", description: "  " });
      expect(await bookRow(bookId)).toMatchObject({ title: "Kitchen", authors: ["June Ash"], coverUrl: null, description: null });
    });

    it("keeps co-authors apart, split on 'and', '&' and ';' but never on a comma", async () => {
      const authors = async (author: string) => (await bookRow((await manual({ author })).bookId)).authors;
      expect(await authors("Terry Pratchett and Neil Gaiman")).toEqual(["Terry Pratchett", "Neil Gaiman"]);
      expect(await authors("Terry Pratchett & Neil Gaiman ; Someone Else")).toEqual(["Terry Pratchett", "Neil Gaiman", "Someone Else"]);
      expect(await authors("Pratchett, Terry")).toEqual(["Pratchett, Terry"]);
      expect(await authors("Ferdinand Anderson")).toEqual(["Ferdinand Anderson"]);
    });

    it("passes the Enrichment author cross-check when the model names any co-author", async () => {
      const { bookId } = await manual({ title: "Good Omens", author: "Neil Gaiman and Terry Pratchett" });
      await enrichBook(ctx.db, { model: fakeEnricher({ author: "Neil Gaiman" }) }, bookId);
      expect((await ctx.db.select().from(enrichment).where(eq(enrichment.bookId, bookId)))[0].recognised).toBe(true);
    });

    it("needs a title and an author, and a cover that is an http(s) address", async () => {
      await expect(manual({ title: " " })).rejects.toBeInstanceOf(InvalidBookError);
      await expect(manual({ author: "" })).rejects.toBeInstanceOf(InvalidBookError);
      await expect(manual({ coverUrl: "javascript:alert(1)" })).rejects.toBeInstanceOf(InvalidBookError);
      expect(await ctx.db.select().from(book)).toEqual([]);
    });

    it("can be added the same twice: each is its own Book", async () => {
      await manual();
      await manual();
      expect(await readLibrary(ctx.db, ctx.userId)).toHaveLength(2);
    });

    it("is invisible to another reader: not in their library, their lookalikes, and not theirs to edit", async () => {
      const { bookId } = await manual();
      const other = await otherReader();
      expect(await readLibrary(ctx.db, other)).toEqual([]);
      expect(await findLookalike(ctx.db, other, { title: "Notes from a Kitchen", author: "June Ash" })).toBeNull();
      await expect(edit(bookId, { title: "Mine now", author: "X" }, other)).rejects.toBeInstanceOf(NotInLibraryError);
      expect((await bookRow(bookId)).title).toBe("Notes from a Kitchen");
    });

    it("is deleted when the reader removes its only Library Entry, Enrichment and all; a shared Book is kept", async () => {
      const { bookId } = await manual();
      await enrichBook(ctx.db, { model: fakeEnricher() }, bookId);
      const shared = await addBook(ctx.db, ctx.pipeline, ctx.userId, work({ workKey: "/works/s", title: "Stoner" }), "want");

      await removeFromLibrary(ctx.db, ctx.pipeline, ctx.userId, bookId);
      await removeFromLibrary(ctx.db, ctx.pipeline, ctx.userId, shared.bookId);

      expect((await ctx.db.select({ id: book.id }).from(book)).map((b) => b.id)).toEqual([shared.bookId]);
      expect(await ctx.db.select().from(enrichment).where(eq(enrichment.bookId, bookId))).toEqual([]);
    });
  });

  describe("editing a Manual Book", () => {
    it("changes the Book itself and re-runs its Enrichment when the title, author or description changes", async () => {
      const { bookId } = await manual({ description: "Old." });
      const model = fakeEnricher();
      await enrichBook(ctx.db, { model }, bookId);

      for (const change of [{ description: "New and fuller." }, { title: "Kitchen Notes" }, { author: "June Asher" }]) {
        ctx.jobs.sent.length = 0;
        const [current] = await readLibrary(ctx.db, ctx.userId);
        await edit(bookId, { title: current.title, author: current.authors[0], description: current.description ?? "", ...change });
        expect(enrichJobs()).toEqual([{ kind: "enrich", bookId }]);
        await enrichBook(ctx.db, { model }, bookId);
      }

      expect(await bookRow(bookId)).toMatchObject({ title: "Kitchen Notes", authors: ["June Asher"], description: "New and fuller." });
      expect(model.inputs.at(-1)).toMatchObject({ title: "Kitchen Notes", authors: ["June Asher"], description: "New and fuller." });
      expect(model.inputs).toHaveLength(4);
      // Edited directly, never through overrides.
      expect(await ctx.db.select({ t: libraryEntry.titleOverride, a: libraryEntry.authorOverride }).from(libraryEntry)).toEqual([{ t: null, a: null }]);
    });

    it("a cover change alone, or no change, does not re-run Enrichment", async () => {
      const { bookId } = await manual({ description: "Same." });
      ctx.jobs.sent.length = 0;
      await edit(bookId, { title: "Notes from a Kitchen", author: "June Ash", description: "Same.", coverUrl: "https://example.com/new.jpg" });
      await edit(bookId, { title: "Notes from a Kitchen", author: "June Ash", description: "Same.", coverUrl: "https://example.com/new.jpg" });
      expect(enrichJobs()).toEqual([]);
      expect((await bookRow(bookId)).coverUrl).toBe("https://example.com/new.jpg");
    });

    it("refuses an empty title or author", async () => {
      const { bookId } = await manual();
      await expect(edit(bookId, { title: "", author: "June Ash" })).rejects.toBeInstanceOf(InvalidBookError);
      expect((await bookRow(bookId)).title).toBe("Notes from a Kitchen");
    });
  });

  describe("overrides on a shared Book", () => {
    const addShared = (userId = ctx.userId) =>
      addBook(ctx.db, ctx.pipeline, userId, work({ workKey: "/works/stoner", title: "Stoner", authors: ["John Williams"] }), "read");

    it("show the reader's title and author without touching the shared Book or re-running Enrichment", async () => {
      const { bookId } = await addShared();
      const before = await bookRow(bookId);
      ctx.jobs.sent.length = 0;

      await edit(bookId, { title: "Stoner (NYRB)", author: "John Edward Williams", description: "ignored", coverUrl: "https://x.test/c.jpg" });

      expect(await bookRow(bookId)).toEqual(before);
      expect(enrichJobs()).toEqual([]);
      expect(await readLibrary(ctx.db, ctx.userId)).toMatchObject([
        {
          title: "Stoner (NYRB)",
          authors: ["John Edward Williams"],
          original: { title: "Stoner", authors: ["John Williams"] },
          manual: false,
          description: null,
        },
      ]);
    });

    it("are another reader's own: theirs still see the shared values", async () => {
      const { bookId } = await addShared();
      const other = await otherReader();
      await addShared(other);
      await edit(bookId, { title: "My Stoner", author: "J. Williams" });
      expect(await readLibrary(ctx.db, other)).toMatchObject([{ title: "Stoner", authors: ["John Williams"] }]);
    });

    it("are cleared by saving the shared value back, or an empty field", async () => {
      const { bookId } = await addShared();
      await edit(bookId, { title: "My Stoner", author: "J. Williams" });
      await edit(bookId, { title: "Stoner", author: "" });
      expect(await ctx.db.select({ t: libraryEntry.titleOverride, a: libraryEntry.authorOverride }).from(libraryEntry)).toEqual([{ t: null, a: null }]);
      expect(await readLibrary(ctx.db, ctx.userId)).toMatchObject([{ title: "Stoner", authors: ["John Williams"], original: null }]);
    });

    it("need the Book in the reader's library", async () => {
      const other = await otherReader();
      const { bookId } = await addShared(other);
      await expect(edit(bookId, { title: "X", author: "Y" })).rejects.toBeInstanceOf(NotInLibraryError);
    });
  });

  describe("the lookalike warning", () => {
    it("finds a Book in the library by normalised title and primary author, ignoring case, accents, articles and subtitles", async () => {
      const { bookId } = await addBook(ctx.db, ctx.pipeline, ctx.userId, work({ workKey: "/works/r", title: "The Remains of the Day", authors: ["Kazuo Ishiguro", "Someone Else"] }), "read");
      for (const title of ["remains of the day", "Remains of the Day: A Novel", "The Remains Of The Day!"]) {
        expect(await findLookalike(ctx.db, ctx.userId, { title, author: "Ishiguro, Kazuo" })).toEqual({ bookId, title: "The Remains of the Day", status: "read" });
      }
      expect(await findLookalike(ctx.db, ctx.userId, { title: "The Remains of the Day", author: "Someone Else" })).toBeNull();
      expect(await findLookalike(ctx.db, ctx.userId, { title: "The Buried Giant", author: "Kazuo Ishiguro" })).toBeNull();
      expect(await findLookalike(ctx.db, ctx.userId, { title: "Rémains of the Day", author: "kazuo ishiguro" })).not.toBeNull();
    });

    it("matches the reader's overrides as well as the shared values, and shows them", async () => {
      const { bookId } = await addBook(ctx.db, ctx.pipeline, ctx.userId, work({ workKey: "/works/s", title: "Stoner", authors: ["John Williams"] }), "want");
      await edit(bookId, { title: "Stoner (my copy)", author: "John Edward Williams" });
      const hit = { bookId, title: "Stoner (my copy)", status: "want" };
      expect(await findLookalike(ctx.db, ctx.userId, { title: "Stoner", author: "John Williams" })).toEqual(hit);
      expect(await findLookalike(ctx.db, ctx.userId, { title: "Stoner (my copy)", author: "Williams" })).toEqual(hit);
    });

    it("finds Manual Books too", async () => {
      const { bookId } = await manual();
      expect(await findLookalike(ctx.db, ctx.userId, { title: "notes from a kitchen", author: "June Ash" })).toMatchObject({ bookId });
    });

    it("annotates search results that look like another Book in the library, never blocking or the Book itself", async () => {
      const { bookId } = await addBook(ctx.db, ctx.pipeline, ctx.userId, work({ workKey: "/works/a", title: "Stoner", authors: ["John Williams"] }), "read");
      const results = await searchBooks(
        ctx.db,
        ctx.userId,
        fakeGateway([
          work({ workKey: "/works/a", title: "Stoner", authors: ["John Williams"] }),
          work({ workKey: "/works/b", title: "Stoner", authors: ["John Williams"] }),
          work({ workKey: "/works/c", title: "Butcher's Crossing", authors: ["John Williams"] }),
        ]),
        "stoner",
      );
      expect(Object.fromEntries(results.map((r) => [r.workKey, r.lookalike]))).toEqual({
        "/works/a": null,
        "/works/b": { bookId, title: "Stoner", status: "read" },
        "/works/c": null,
      });
    });
  });
});
