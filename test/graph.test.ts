import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { addBook } from "../src/domain/add-book";
import { readConnection, type Strength } from "../src/domain/connections";
import { DISPLAY_CAP, readGraph, visibleConnections, type GraphView } from "../src/domain/graph";
import { changeStatus, removeFromLibrary } from "../src/domain/library-entry";
import type { JobDeps } from "../src/domain/pipeline";
import { connection, libraryEntry } from "../src/db/schema";
import { fakeEmbedder, fakeEnricher, fakeJudge, work } from "./fakes";
import { useTestDb } from "./harness";

describe("Graph", () => {
  const ctx = useTestDb();
  const add = async (title: string, status: "want" | "reading" | "read" = "read") =>
    (await addBook(ctx.db, ctx.pipeline, ctx.userId, work({ workKey: `/works/${title}`, title, authors: ["A"] }), status)).bookId;
  const graph = () => readGraph(ctx.db, ctx.userId);
  const titleOf = (g: GraphView, id: string) => g.books.find((b) => b.bookId === id)!.title;
  const pairs = (g: GraphView, conns: GraphView["connections"]) => conns.map((c) => [titleOf(g, c.a), titleOf(g, c.b)].sort().join("–")).sort();

  // Stored as the judge would leave it; `similarity` breaks ties within a Strength.
  async function connect(x: string, y: string, strength: Strength = "strong", similarity = 0.5, dismissed = false) {
    const [a, b] = [x, y].sort();
    const [row] = await ctx.db
      .insert(connection)
      .values({
        userId: ctx.userId, bookAId: a, bookBId: b, type: "thematic", strength, similarity, similarityModel: "m",
        explanation: `Why ${a} meets ${b}.`, grounding: "enrichment", model: "m", promptVersion: "p",
        dismissedAt: dismissed ? new Date() : null,
      })
      .returning();
    return row.id;
  }

  it("shows Finished Books only, as the reader titles them, a re-read or moved-back Book included", async () => {
    await add("Wanted", "want");
    await add("Current", "reading");
    const read = await add("Read");
    const reread = await add("Reread");
    await changeStatus(ctx.db, ctx.pipeline, ctx.userId, reread, "reading");
    const back = await add("Back");
    await changeStatus(ctx.db, ctx.pipeline, ctx.userId, back, "want");
    await ctx.db.update(libraryEntry).set({ titleOverride: "Read (mine)" }).where(eq(libraryEntry.bookId, read));

    const g = await graph();
    expect(g.books.map((b) => b.title).sort()).toEqual(["Back", "Read (mine)", "Reread"]);
  });

  it("sizes each Book by its Connections, leaving dismissed ones out of the graph", async () => {
    const [a, b, c] = [await add("A"), await add("B"), await add("C")];
    await connect(a, b);
    await connect(a, c, "strong", 0.5, true);

    const g = await graph();
    expect(Object.fromEntries(g.books.map((x) => [x.title, x.degree]))).toEqual({ A: 1, B: 1, C: 0 });
    expect(pairs(g, g.connections)).toEqual(["A–B"]);
  });

  it(`shows each Book's ${DISPLAY_CAP} strongest Connections, and a Connection either of its Books ranks that high`, async () => {
    // The hub links strongly to seven Books, and moderately to a leaf and to a second hub. The leaf has
    // nothing else, so its one Connection shows; the second hub also links strongly to the seven, so
    // neither end ranks the hubs' Connection in its top seven.
    const hub = await add("Hub");
    const other = await add("Other");
    const leaf = await add("Leaf");
    const seven = [];
    for (let i = 1; i <= DISPLAY_CAP; i++) seven.push(await add(`S${i}`));
    for (const s of seven) {
      await connect(hub, s, "strong");
      await connect(other, s, "strong");
    }
    await connect(hub, leaf, "moderate", 0.9);
    await connect(hub, other, "moderate", 0.4);

    const g = await graph();
    const shown = pairs(g, visibleConnections(g, null));
    expect(shown).toContain("Hub–Leaf");
    expect(shown).not.toContain("Hub–Other");
    expect(shown).toHaveLength(2 * DISPLAY_CAP + 1);
  });

  it("shows all of a selected Book's Connections, and only the default ones besides", async () => {
    const hub = await add("Hub");
    const other = await add("Other");
    for (let i = 1; i <= DISPLAY_CAP; i++) {
      const s = await add(`S${i}`);
      await connect(hub, s, "strong");
      await connect(other, s, "strong");
    }
    await connect(hub, other, "weak");

    const g = await graph();
    expect(pairs(g, visibleConnections(g, null))).not.toContain("Hub–Other");
    expect(pairs(g, visibleConnections(g, hub))).toContain("Hub–Other");
    expect(pairs(g, visibleConnections(g, other))).toContain("Hub–Other");
    expect(visibleConnections(g, hub)).toHaveLength(g.connections.length);
  });

  describe("positions", () => {
    const deps = (): JobDeps => ({
      model: fakeEnricher({ themes: ["quiet"] }),
      judge: fakeJudge((input) => ({
        connections: input.candidates.map((c) => ({ candidateId: c.id, type: "thematic", strength: "strong", explanation: "Both are quiet.", quotedNoteIds: [] })),
      })),
      embedder: fakeEmbedder(["quiet"]),
      descriptions: null,
    });
    const positions = (g: GraphView) => Object.fromEntries(g.books.map((b) => [b.title, { x: b.x, y: b.y }]));
    const extent = (g: GraphView) => Math.max(...g.books.flatMap((a) => g.books.map((b) => Math.hypot(a.x - b.x, a.y - b.y))));

    it("gives every Finished Book a place, before the worker has laid the graph out too", async () => {
      await add("A");
      await add("B");
      await add("Lonely");
      const g = await graph();
      expect(g.books).toHaveLength(3);
      for (const b of g.books) expect([b.x, b.y].every(Number.isFinite)).toBe(true);
      expect(new Set(g.books.map((b) => `${b.x},${b.y}`)).size).toBe(3);
    });

    it("lays the graph out once Connections are found, and keeps it the same from one session to the next", async () => {
      for (const t of ["A", "B", "C", "D"]) await add(t);
      const provisional = await graph();
      await ctx.jobs.drain(deps());
      const first = await graph();
      expect(first.connections.length).toBeGreaterThan(0);
      expect(positions(first)).not.toEqual(positions(provisional));
      expect(positions(await graph())).toEqual(positions(first));

      // Nothing new to place: laying out again leaves every Book where it was.
      await ctx.pipeline.refreshRequested(ctx.userId, first.books[0].bookId);
      await ctx.jobs.drain(deps());
      const again = await graph();
      for (const b of again.books) {
        const was = first.books.find((x) => x.bookId === b.bookId)!;
        expect(Math.hypot(b.x - was.x, b.y - was.y)).toBeLessThan(extent(first) * 0.05);
      }
    });

    it("places a newly finished Book without moving the Books already there much", async () => {
      for (const t of ["A", "B", "C", "D", "E"]) await add(t);
      await ctx.jobs.drain(deps());
      const before = await graph();
      await add("New");
      await ctx.jobs.drain(deps());
      const after = await graph();
      expect(after.books.map((b) => b.title)).toContain("New");
      for (const b of before.books) {
        const now = after.books.find((x) => x.bookId === b.bookId)!;
        expect(Math.hypot(now.x - b.x, now.y - b.y)).toBeLessThan(extent(before) * 0.25);
      }
    });

    it("drops a removed Book from the graph and its layout", async () => {
      const a = await add("A");
      await add("B");
      await ctx.jobs.drain(deps());
      await removeFromLibrary(ctx.db, ctx.userId, a);
      const g = await graph();
      expect(g.books.map((b) => b.title)).toEqual(["B"]);
      expect(g.connections).toEqual([]);
    });
  });

  describe("one Connection", () => {
    it("reads a Connection with both Books as the reader titles them", async () => {
      const a = await add("Stoner");
      const b = await add("Lonely");
      await ctx.db.update(libraryEntry).set({ titleOverride: "The Lonely City" }).where(eq(libraryEntry.bookId, b));
      const id = await connect(a, b, "moderate");
      const c = await readConnection(ctx.db, ctx.userId, id);
      expect(c).toMatchObject({ id, type: "thematic", strength: "moderate", grounding: "enrichment" });
      expect([c!.a.title, c!.b.title].sort()).toEqual(["Stoner", "The Lonely City"]);
      expect(c!.explanation).toMatch(/^Why /);
    });

    it("reads nothing for a dismissed or unknown Connection", async () => {
      const id = await connect(await add("A"), await add("B"), "strong", 0.5, true);
      expect(await readConnection(ctx.db, ctx.userId, id)).toBeNull();
      expect(await readConnection(ctx.db, ctx.userId, "00000000-0000-0000-0000-000000000000")).toBeNull();
    });
  });
});
