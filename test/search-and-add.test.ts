import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { addBook, DuplicateBookError } from "../src/domain/add-book";
import { readLibrary } from "../src/domain/library";
import { searchBooks } from "../src/domain/search";
import { book, libraryEntry, readThrough } from "../src/db/schema";
import { fakeDescriptions, fakeGateway, prose, volume, work } from "./fakes";
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

  it("demotes omnibus editions: titles joining works with ' / ' and generic collection titles", async () => {
    const keys = await search([
      work({ workKey: "/works/omnibus", title: "Novels (La chute / L'Étranger)", authors: ["Albert Camus"], editionCount: 40 }),
      work({ workKey: "/works/joined", title: "Nineteen Eighty-Four / Animal Farm", editionCount: 30 }),
      work({ workKey: "/works/oeuvres", title: "Œuvres", editionCount: 25 }),
      work({ workKey: "/works/selected", title: "Selected Works", editionCount: 22 }),
      work({ workKey: "/works/collected", title: "Collected Works of Albert Camus", editionCount: 21 }),
      work({ workKey: "/works/stranger", title: "The Stranger", authors: ["Albert Camus"], editionCount: 5 }),
      work({ workKey: "/works/plain", title: "Fear and Trembling", editionCount: 3 }),
    ]);
    expect(keys.slice(0, 2)).toEqual(["/works/stranger", "/works/plain"]);
    expect(keys).toHaveLength(7);
  });

  it("demotes an omnibus by its original title too, and keeps a work whose title is the query", async () => {
    const keys = await search(
      [
        work({
          workKey: "/works/omnibus",
          title: "The Fall and The Outsider",
          originalTitle: "Novels (La chute / L'Étranger)",
          authors: ["Albert Camus"],
          editionCount: 40,
        }),
        work({ workKey: "/works/defeat", title: "Strange defeat", originalTitle: "L' étrange défaite", authors: ["Marc Bloch"], editionCount: 58 }),
        work({
          workKey: "/works/stranger",
          title: "The Stranger",
          originalTitle: "L’étranger",
          authors: ["Albert Camus"],
          subjects: ["Criticism and interpretation"],
          editionCount: 468,
        }),
      ],
      "L'étranger",
    );
    expect(keys).toEqual(["/works/stranger", "/works/defeat", "/works/omnibus"]);
  });

  it("when the query names an author, demotes books about them by someone else, not the novel", async () => {
    const keys = await search(
      [
        work({ workKey: "/works/mccarthy", title: "Albert Camus's The Stranger", authors: ["Patrick McCarthy"], editionCount: 60 }),
        work({ workKey: "/works/carey", title: "Camus' The Stranger", authors: ["Gary Carey"], editionCount: 55 }),
        work({
          workKey: "/works/bloom",
          title: "Albert Camus's The Stranger (Bloom's Modern Critical Interpretations)",
          authors: ["Harold Bloom"],
          editionCount: 50,
        }),
        // As Open Library has it: the novel itself carries a "Criticism and interpretation" subject.
        work({
          workKey: "/works/stranger",
          title: "The Stranger",
          authors: ["Albert Camus"],
          subjects: ["Fiction", "Criticism and interpretation"],
          editionCount: 30,
        }),
        work({ workKey: "/works/combat", title: "Camus at Combat", authors: ["Albert Camus"], editionCount: 10 }),
      ],
      "The Stranger Camus",
    );
    expect(keys.slice(0, 2)).toEqual(["/works/stranger", "/works/combat"]);
    expect(keys.slice(2).sort()).toEqual(["/works/bloom", "/works/carey", "/works/mccarthy"]);
  });

  it("demotes a book that names another author's work, even when the query names no author", async () => {
    const keys = await search(
      [
        work({
          workKey: "/works/parkes",
          title: "Kazuo Ishiguro's the Remains of the Day",
          authors: ["Adam Parkes"],
          firstPublishedYear: 2001,
          editionCount: 40,
        }),
        work({ workKey: "/works/novel", title: "The Remains of the Day", authors: ["Kazuo Ishiguro"], editionCount: 20 }),
      ],
      "remains of the day",
    );
    expect(keys).toEqual(["/works/novel", "/works/parkes"]);
  });

  it("catches a bare possessive (\"Camus' The Stranger\") without the query naming the author", async () => {
    const keys = await search([
      work({ workKey: "/works/carey", title: "Camus' The Stranger", authors: ["Gary Carey"], editionCount: 55 }),
      work({ workKey: "/works/stranger", title: "The Stranger", authors: ["Albert Camus"], editionCount: 30 }),
    ]);
    expect(keys).toEqual(["/works/stranger", "/works/carey"]);
  });

  it("leaves a possessive title alone when the possessor is not an author in the results", async () => {
    const keys = await search(
      [
        work({ workKey: "/works/revisited", title: "Bridget Jones Revisited", authors: ["Zed Other"], editionCount: 20 }),
        work({ workKey: "/works/bridget", title: "Bridget Jones's Diary", authors: ["Helen Fielding"], editionCount: 90 }),
      ],
      "bridget jones",
    );
    expect(keys).toEqual(["/works/bridget", "/works/revisited"]);
  });

  describe("title match leads, edition count only breaks ties", () => {
    it("Set My Heart on Fire: the exact title beats a 408-edition book that merely turned up", async () => {
      const keys = await search(
        [
          work({ workKey: "/works/twain", title: "Roughing It", authors: ["Mark Twain"], editionCount: 408 }),
          work({ workKey: "/works/film", title: "American Film", authors: ["American Film Institute"], editionCount: 83 }),
          work({ workKey: "/works/martin", title: "Set My Heart on Fire", authors: ["Catherine Martin"], editionCount: 1 }),
          work({ workKey: "/works/suzuki", title: "Set My Heart on Fire", authors: ["Izumi Suzuki"], editionCount: 2 }),
        ],
        "Set My Heart on Fire",
      );
      expect(keys.slice(0, 2)).toEqual(["/works/suzuki", "/works/martin"]);
    });

    it("The Plague: Camus's novel leads Defoe's journal and The Plague Dogs", async () => {
      const keys = await search(
        [
          work({ workKey: "/works/defoe", title: "Daniel Defoe's Journal of the plague year", authors: ["Daniel Defoe"], editionCount: 318 }),
          work({ workKey: "/works/camus", title: "The Plague", authors: ["Albert Camus"], editionCount: 280 }),
          work({ workKey: "/works/dogs", title: "The Plague Dogs", authors: ["Richard Adams"], editionCount: 8 }),
          work({ workKey: "/works/paul", title: "Old Saint Paul's, a tale of the plague & the fire.", authors: ["William Harrison Ainsworth"], editionCount: 125 }),
        ],
        "The Plague",
      );
      expect(keys[0]).toBe("/works/camus");
    });

    it("Normal People: Sally Rooney's novel leads books that contain the words", async () => {
      const keys = await search(
        [
          work({ workKey: "/works/mysticism", title: "Practical mysticism", authors: ["Evelyn Underhill"], editionCount: 185 }),
          work({ workKey: "/works/prepping", title: "Survival Prepping for Normal People", authors: ["Rick Henderson"], editionCount: 51 }),
          work({ workKey: "/works/rooney", title: "Normal People", authors: ["Sally Rooney"], editionCount: 27 }),
        ],
        "Normal People",
      );
      expect(keys).toEqual(["/works/rooney", "/works/prepping", "/works/mysticism"]);
    });

    it("Convenience Store Woman: Sayaka Murata's novel leads, by title and by author in the query", async () => {
      const works = [
        work({ workKey: "/works/king", title: "Night Shift", authors: ["Stephen King"], editionCount: 65 }),
        work({ workKey: "/works/anon", title: "Convenience Store Woman", authors: [], editionCount: 17 }),
        work({ workKey: "/works/murata", title: "Convenience store woman", authors: ["Sayaka Murata"], editionCount: 16 }),
      ];
      expect((await search(works, "Convenience Store Woman"))[0]).toBe("/works/anon");
      // The title is matched with the author's name left out of the query.
      expect(await search(works, "Convenience Store Woman Sayaka Murata")).toEqual(["/works/murata", "/works/anon", "/works/king"]);
    });

    it("an exact match counts against the original and the English title", async () => {
      const keys = await search(
        [
          work({ workKey: "/works/other", title: "Another Book", editionCount: 400 }),
          work({ workKey: "/works/kafka", title: "Kafka on the Shore", originalTitle: "海辺のカフカ", editionCount: 3 }),
          work({ workKey: "/works/stranger", title: "The Stranger", originalTitle: "L’étranger", editionCount: 2 }),
        ],
        "L'étranger",
      );
      expect(keys[0]).toBe("/works/stranger");
      expect((await search([work({ workKey: "/works/other", title: "Another Book", editionCount: 400 }), work({ workKey: "/works/kafka", title: "Kafka on the Shore", originalTitle: "海辺のカフカ", editionCount: 3 })], "kafka on the shore"))[0]).toBe("/works/kafka");
    });

    it("results with the same title tier are ordered by the queried author, then edition count", async () => {
      const keys = await search(
        [
          work({ workKey: "/works/jackson", title: "The Stranger", authors: ["Bruce Jackson"], editionCount: 500 }),
          work({ workKey: "/works/camus", title: "The Stranger", authors: ["Albert Camus"], editionCount: 5 }),
        ],
        "The Stranger Camus",
      );
      expect(keys).toEqual(["/works/camus", "/works/jackson"]);
    });

    it("a leading article does not stop an exact match: The Remains of the Day leads Remains of the Day", async () => {
      const keys = await search(
        [
          work({ workKey: "/works/stub", title: "Remains of the Day", authors: ["Kazuo Ishiguro"], editionCount: 1 }),
          work({ workKey: "/works/novel", title: "The Remains of the Day", authors: ["Kazuo Ishiguro"], editionCount: 87 }),
          work({ workKey: "/works/parkes", title: "Kazuo Ishiguro's the Remains of the Day", authors: ["Adam Parkes"], editionCount: 40 }),
        ],
        "remains of the day",
      );
      expect(keys).toEqual(["/works/novel", "/works/stub", "/works/parkes"]);
    });

    it("demotions still apply: a study guide containing every query word stays below an original", async () => {
      const keys = await search(
        [
          work({ workKey: "/works/guide", title: "Normal People: A Study Guide", editionCount: 99 }),
          work({ workKey: "/works/original", title: "Normal People", editionCount: 1 }),
        ],
        "Normal People",
      );
      expect(keys).toEqual(["/works/original", "/works/guide"]);
    });
  });

  it("builds a cover url when Open Library has a cover id, none otherwise", async () => {
    const results = await searchBooks(
      ctx.db,
      ctx.userId,
      fakeGateway([work({ workKey: "/works/a", coverId: 123 }), work({ workKey: "/works/b", editionCount: 0 })]),
      "x",
    );
    expect(results[0].coverUrl).toBe("https://covers.openlibrary.org/b/id/123-M.jpg?default=false");
    expect(results[1].coverUrl).toBeNull();
  });

  it("marks works already in the library with their status and Book, so the result can open it", async () => {
    const stoner = work({ workKey: "/works/stoner", title: "Stoner", editionCount: 9 });
    const { bookId } = await addBook(ctx.db, ctx.pipeline, ctx.userId, stoner, "reading");
    const results = await searchBooks(ctx.db, ctx.userId, fakeGateway([stoner, work({ workKey: "/works/other" })]), "x");
    expect(results.map((r) => [r.libraryStatus, r.libraryBookId])).toEqual([["reading", bookId], [null, null]]);
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
    await addBook(ctx.db, ctx.pipeline, ctx.userId, stoner, "want");
    expect(await readLibrary(ctx.db, ctx.userId)).toEqual([
      expect.objectContaining({ title: "Stoner", authors: ["John Williams"], status: "want" }),
    ]);
  });

  it("stores the work key, year, cover and a snapshot with noisy subjects dropped", async () => {
    await addBook(ctx.db, ctx.pipeline, ctx.userId, stoner, "want");
    const [row] = await ctx.db.select().from(book);
    expect(row).toMatchObject({
      openLibraryWorkKey: "/works/OL3511459W",
      firstPublishedYear: 1965,
      coverUrl: "https://covers.openlibrary.org/b/id/7-M.jpg?default=false",
      snapshot: { subjects: ["College teachers"] },
    });
  });

  const kafkaOnTheShore = work({
    workKey: "/works/OL2625431W",
    title: "Kafka on the Shore",
    originalTitle: "海辺のカフカ",
    authors: ["Haruki Murakami"],
    originalAuthors: ["村上春樹"],
    authorAliases: ["Haruki Murakami", "Murakami Haruki"],
  });

  it("stores the English title and Latin author, keeps the originals, and looks the description up by them", async () => {
    const descriptions = fakeDescriptions({});
    await addBook(ctx.db, ctx.pipeline, ctx.userId, kafkaOnTheShore, "want", descriptions);
    const [row] = await ctx.db.select().from(book);
    expect(row).toMatchObject({
      title: "Kafka on the Shore",
      originalTitle: "海辺のカフカ",
      authors: ["Haruki Murakami"],
      snapshot: { originalAuthors: ["村上春樹"], authorAliases: ["Haruki Murakami", "Murakami Haruki"] },
    });
    expect(descriptions.queries[0]).toContain("Kafka on the Shore");
    expect(descriptions.queries[0]).toContain("Haruki Murakami");
  });

  it("stores L'étranger as The Stranger, with the French title kept", async () => {
    await addBook(ctx.db, ctx.pipeline, ctx.userId, work({ workKey: "/works/OL1230613W", title: "The Stranger", originalTitle: "L’étranger", authors: ["Albert Camus"] }), "read");
    const [row] = await ctx.db.select().from(book);
    expect(row).toMatchObject({ title: "The Stranger", originalTitle: "L’étranger", authors: ["Albert Camus"] });
    expect((await readLibrary(ctx.db, ctx.userId))[0]).toMatchObject({ title: "The Stranger" });
  });

  describe("authors", () => {
    // Open Library lists every contributor of a work as an author, translators included; the Google
    // Books volume found for the description names the real ones.
    const authorsOf = async (w: ReturnType<typeof work>, descriptions: ReturnType<typeof fakeDescriptions> | null) => {
      await addBook(ctx.db, ctx.pipeline, ctx.userId, w, "read", descriptions);
      return (await ctx.db.select().from(book))[0].authors;
    };
    const convenience = work({
      workKey: "/works/OL19744024W",
      title: "Convenience store woman",
      authors: ["Murata Sayaka", "Nancy Wu", "Mathilde Tamae-Bouhon", "Albert Nolla Cabellos", "Marina Bornas Montaña"],
    });

    it("drops translators: keeps the authors that match an author on the Google Books volume", async () => {
      const gb = fakeDescriptions({
        volumes: [volume("gb1", { title: "Convenience Store Woman", authors: ["Sayaka Murata", "Ginny Tapley Takemori"], description: prose(900) })],
      });
      // "Murata Sayaka" is "Sayaka Murata"; Takemori is on the volume but not an Open Library author.
      expect(await authorsOf(convenience, gb)).toEqual(["Murata Sayaka"]);
    });

    it("keeps real co-authors", async () => {
      const goodOmens = work({ workKey: "/works/OL1W", title: "Good Omens", authors: ["Terry Pratchett", "Neil Gaiman"] });
      const gb = fakeDescriptions({
        volumes: [volume("gb2", { title: "Good Omens", authors: ["Neil Gaiman", "Terry Pratchett"], description: prose(900) })],
      });
      expect(await authorsOf(goodOmens, gb)).toEqual(["Terry Pratchett", "Neil Gaiman"]);
    });

    it("tolerates spelling variants between the two sources", async () => {
      const w = work({ workKey: "/works/OL2W", title: "The Brothers Karamazov", authors: ["Fyodor Dostoevsky", "Constance Garnett"] });
      const gb = fakeDescriptions({
        volumes: [volume("gb3", { title: "The Brothers Karamazov", authors: ["Fyodor Dostoyevsky"], description: prose(900) })],
      });
      expect(await authorsOf(w, gb)).toEqual(["Fyodor Dostoevsky"]);
    });

    it("falls back to the first-listed author when no Google Books volume matches or none is available", async () => {
      expect(await authorsOf(convenience, fakeDescriptions({ volumes: [] }))).toEqual(["Murata Sayaka"]);
      await ctx.db.delete(libraryEntry);
      await ctx.db.delete(book);
      expect(await authorsOf(convenience, null)).toEqual(["Murata Sayaka"]);
    });

    it("does not touch a single-author work", async () => {
      expect(await authorsOf(stoner, null)).toEqual(["John Williams"]);
    });
  });

  it("a Book whose title was not localised has no original title", async () => {
    await addBook(ctx.db, ctx.pipeline, ctx.userId, stoner, "want");
    expect((await ctx.db.select().from(book))[0].originalTitle).toBeNull();
  });

  it("'Already read' creates one completed Read-through with null dates", async () => {
    await addBook(ctx.db, ctx.pipeline, ctx.userId, stoner, "read");
    const rows = await ctx.db.select().from(readThrough);
    expect(rows).toHaveLength(1);
    expect(rows[0].startedAt).toBeNull();
    expect(rows[0].finishedAt).toBeNull();
    expect(rows[0].completedAt).toBeInstanceOf(Date);
  });

  it("'Want to read' creates no Read-through", async () => {
    await addBook(ctx.db, ctx.pipeline, ctx.userId, stoner, "want");
    expect(await ctx.db.select().from(readThrough)).toEqual([]);
  });

  it("rejects adding the same work key twice and leaves one Library Entry", async () => {
    await addBook(ctx.db, ctx.pipeline, ctx.userId, stoner, "want");
    await expect(addBook(ctx.db, ctx.pipeline, ctx.userId, stoner, "read")).rejects.toBeInstanceOf(DuplicateBookError);
    expect(await ctx.db.select().from(book)).toHaveLength(1);
    expect(await ctx.db.select().from(libraryEntry)).toHaveLength(1);
    expect(await ctx.db.select().from(readThrough)).toEqual([]);
  });

  it("rejects concurrent adds of the same work key", async () => {
    const results = await Promise.allSettled([
      addBook(ctx.db, ctx.pipeline, ctx.userId, stoner, "want"),
      addBook(ctx.db, ctx.pipeline, ctx.userId, stoner, "want"),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(await ctx.db.select().from(libraryEntry)).toHaveLength(1);
  });

  it("adds with thin metadata: no cover, no year, no authors", async () => {
    await addBook(ctx.db, ctx.pipeline, ctx.userId, work({ workKey: "/works/thin", title: "Thin", authors: [], firstPublishedYear: null }), "want");
    const [row] = await ctx.db
      .select()
      .from(book)
      .where(and(eq(book.openLibraryWorkKey, "/works/thin")));
    expect(row).toMatchObject({ title: "Thin", authors: [], coverUrl: null, firstPublishedYear: null });
  });
});
