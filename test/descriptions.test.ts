import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { addBook } from "../src/domain/add-book";
import { book } from "../src/db/schema";
import { createDescriptionGateway } from "../src/lib/google-books";
import { fakeDescriptions, prose, volume, work } from "./fakes";
import { useTestDb } from "./harness";

describe("add-time description", () => {
  const ctx = useTestDb();
  const stoner = work({ workKey: "/works/stoner", title: "Stoner", authors: ["John Williams"] });
  const add = async (gw: ReturnType<typeof fakeDescriptions>, w = stoner) => {
    await addBook(ctx.db, ctx.userId, w, "want", gw);
    const [row] = await ctx.db.select().from(book).where(eq(book.openLibraryWorkKey, w.workKey));
    return row;
  };

  it("queries Google Books with a plain `title author` query and stores description and volume id", async () => {
    const gw = fakeDescriptions({ volumes: [volume("gb1", { description: prose(700) })] });
    const row = await add(gw);
    expect(gw.queries).toEqual(["Stoner John Williams"]);
    expect(row.description).toBe(prose(700));
    expect(row.googleBooksVolumeId).toBe("gb1");
  });

  it("takes the longest matching description", async () => {
    const row = await add(
      fakeDescriptions({ volumes: [volume("short", { description: prose(600) }), volume("long", { description: prose(900) })] }),
    );
    expect(row.googleBooksVolumeId).toBe("long");
  });

  it("matches the primary author and the title, not other books or authors", async () => {
    const row = await add(
      fakeDescriptions({
        volumes: [
          volume("other-author", { authors: ["Someone Else"], description: prose(900) }),
          volume("other-title", { title: "Butcher's Crossing", description: prose(900) }),
          volume("right", { description: prose(600) }),
        ],
      }),
    );
    expect(row.googleBooksVolumeId).toBe("right");
  });

  it("rejects study guides, summaries, adaptations, criticism and box sets", async () => {
    const row = await add(
      fakeDescriptions({
        volumes: [
          volume("guide", { title: "Stoner: A Study Guide", description: prose(900) }),
          volume("summary", { subtitle: "Summary and Analysis", description: prose(900) }),
          volume("graphic", { categories: ["Comics & Graphic Novels"], description: prose(900) }),
          volume("criticism", { categories: ["Literary Criticism"], description: prose(900) }),
          volume("box", { subtitle: "The Box Set", description: prose(900) }),
          volume("original", { description: prose(600) }),
        ],
      }),
    );
    expect(row.googleBooksVolumeId).toBe("original");
  });

  it("rejects non-English volumes and non-English descriptions", async () => {
    const row = await add(
      fakeDescriptions({
        volumes: [
          volume("es", { language: "es", description: prose(900) }),
          volume("es-desc", { description: "La historia de una mujer y su vida en la ciudad, con sus amigos. ".repeat(15) }),
          volume("en", { description: prose(600) }),
        ],
      }),
    );
    expect(row.googleBooksVolumeId).toBe("en");
  });

  it("falls back to Open Library when Google Books has nothing", async () => {
    const row = await add(fakeDescriptions({ openLibrary: prose(300) }));
    expect(row.description).toBe(prose(300));
    expect(row.googleBooksVolumeId).toBeNull();
  });

  it("falls back to Open Library when Google's is under 500 chars and Open Library's is longer", async () => {
    const row = await add(
      fakeDescriptions({ volumes: [volume("thin", { description: prose(400) })], openLibrary: prose(450) }),
    );
    expect(row.description).toBe(prose(450));
  });

  it("keeps a thin Google description when Open Library's is not longer", async () => {
    const row = await add(
      fakeDescriptions({ volumes: [volume("thin", { description: prose(400) })], openLibrary: prose(300) }),
    );
    expect(row.description).toBe(prose(400));
    expect(row.googleBooksVolumeId).toBe("thin");
  });

  it("does not consult Open Library when Google's is 500 chars or more", async () => {
    const gw = fakeDescriptions({ volumes: [volume("gb", { description: prose(500) })], openLibrary: prose(5000) });
    await add(gw);
    expect(gw.olCalls).toEqual([]);
  });

  it("adds the Book with no description when no source has one", async () => {
    const row = await add(fakeDescriptions({}));
    expect(row.description).toBeNull();
    expect(row.googleBooksVolumeId).toBeNull();
  });

  it("adds the Book when the lookup fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const row = await add(fakeDescriptions({ gbError: true }));
    expect(row.title).toBe("Stoner");
    expect(row.description).toBeNull();
  });

  it("still uses Open Library when Google Books fails, and keeps a thin Google description when Open Library fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await add(fakeDescriptions({ gbError: true, openLibrary: prose(300) }))).description).toBe(prose(300));
    const row = await add(
      fakeDescriptions({ volumes: [volume("thin", { description: prose(400) })], olError: true }),
      work({ workKey: "/works/two", title: "Stoner", authors: ["John Williams"] }),
    );
    expect(row.description).toBe(prose(400));
  });

  it("never refetches for a Book that already exists", async () => {
    await add(fakeDescriptions({ volumes: [volume("first", { description: prose(600) })] }));
    const second = fakeDescriptions({ volumes: [volume("second", { description: prose(900) })] });
    const { db } = ctx;
    const [other] = await db.execute<{ id: string }>(`INSERT INTO "user" (email) VALUES ('b@example.com') RETURNING id` as never).then((r) => r.rows);
    await addBook(db, other.id, stoner, "want", second);
    expect(second.queries).toEqual([]);
    const [row] = await db.select().from(book).where(eq(book.openLibraryWorkKey, stoner.workKey));
    expect(row.googleBooksVolumeId).toBe("first");
  });
});

describe("Google Books gateway", () => {
  const items = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}` }));
  const opts = { apiKey: "k", userAgent: "Marginalia/0.1 (me@example.com)", sleep: async () => {} };

  it("scans two pages of 20", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ items: items(20, "a") }))
      .mockResolvedValueOnce(Response.json({ items: items(20, "b") }));
    const got = await createDescriptionGateway({ ...opts, fetch }).googleBooksVolumes("stoner john williams");
    expect(got).toHaveLength(40);
    expect(String(fetch.mock.calls[0][0])).toContain("startIndex=0");
    expect(String(fetch.mock.calls[1][0])).toContain("startIndex=20");
    expect(String(fetch.mock.calls[0][0])).toContain("key=k");
  });

  it("stops after a short first page and retries on 429", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response("", { status: 429 }))
      .mockResolvedValueOnce(Response.json({ items: items(3, "a") }));
    expect(await createDescriptionGateway({ ...opts, fetch }).googleBooksVolumes("x")).toHaveLength(3);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("reads Open Library descriptions given as a string or a typed value", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ description: "plain" }))
      .mockResolvedValueOnce(Response.json({ description: { type: "/type/text", value: "typed" } }))
      .mockResolvedValueOnce(Response.json({}));
    const gw = createDescriptionGateway({ ...opts, fetch });
    expect(await gw.openLibraryDescription("/works/OL1W")).toBe("plain");
    expect(await gw.openLibraryDescription("/works/OL1W")).toBe("typed");
    expect(await gw.openLibraryDescription("/works/OL1W")).toBe("");
  });
});
