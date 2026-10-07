import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { addBook } from "../src/domain/add-book";
import { NAMING_ATTEMPTS } from "../src/domain/clusters";
import type { Strength } from "../src/domain/connections";
import { readGraph, readGraphMark } from "../src/domain/graph";
import { removeFromLibrary } from "../src/domain/library-entry";
import type { JobDeps } from "../src/domain/pipeline";
import { clusterLabel, connection, enrichment } from "../src/db/schema";
import { fakeEmbedder, fakeEnricher, fakeJudge, fakeNamer, work } from "./fakes";
import { useTestDb } from "./harness";

describe("Cluster naming", () => {
  const ctx = useTestDb();
  const add = async (title: string) =>
    (await addBook(ctx.db, ctx.pipeline, ctx.userId, work({ workKey: `/works/${title}`, title, authors: ["A"] }), "read")).bookId;
  const books = (titles: string) => Promise.all(titles.split(" ").map(add));

  async function connect(x: string, y: string, explanation = "Why.", strength: Strength = "strong") {
    const [a, b] = [x, y].sort();
    await ctx.db.insert(connection).values({
      userId: ctx.userId, bookAId: a, bookBId: b, type: "thematic", strength, similarity: 0.5, similarityModel: "m",
      explanation, grounding: "enrichment", model: "m", promptVersion: "p",
    }).onConflictDoNothing();
  }
  const clique = async (members: string[]) => {
    for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) await connect(members[i], members[j]);
  };

  // Background work that finds no Connections of its own: only the ones a test stores count.
  const deps = (namer = fakeNamer()): JobDeps => ({
    model: fakeEnricher({ themes: ["quiet"] }),
    judge: fakeJudge(() => ({ connections: [] })),
    embedder: fakeEmbedder(["quiet"]),
    descriptions: null,
    namer,
  });
  // The reader's graph job, run to the end.
  const recompute = async (namer = fakeNamer()) => {
    await ctx.pipeline.connectionsChanged(ctx.userId);
    await ctx.jobs.drain(deps(namer));
    return namer;
  };
  const clusters = async () => (await readGraph(ctx.db, ctx.userId)).clusters;

  it("names a new Cluster from its Books' themes and Connection explanations, and records the call", async () => {
    const [a, b, c] = await books("A B C");
    await ctx.jobs.drain(deps());
    await ctx.db.update(enrichment).set({ themes: ["grief", "silence"] }).where(eq(enrichment.bookId, a));
    await connect(a, b, "Both dwell on grief.");
    await connect(b, c);
    await connect(a, c);

    const namer = await recompute(fakeNamer(() => ({ name: "Grief Held Close", description: "Books that sit with loss." })));

    expect(namer.inputs).toHaveLength(1);
    const input = namer.inputs[0];
    expect(input.previousName).toBeNull();
    expect(input.books).toHaveLength(3);
    expect(input.books.find((x) => x.themes.includes("grief"))).toBeDefined();
    expect(input.connections.map((x) => x.explanation)).toContain("Both dwell on grief.");
    expect(await clusters()).toEqual([expect.objectContaining({ name: "Grief Held Close", description: "Books that sit with loss." })]);
    const [row] = await ctx.db.select().from(clusterLabel);
    expect(row).toMatchObject({ model: "fake-sonnet", promptVersion: "naming-test-1", inputTokens: 500, outputTokens: 50, costUsd: 0.0015 });
    expect([...row.namedMemberBookIds!].sort()).toEqual([...row.memberBookIds].sort());
  });

  it("keeps the graph pending until naming has finished", async () => {
    await clique(await books("A B C"));
    const seen: (number | null)[] = [];
    await recompute(fakeNamer(async () => (seen.push(await readGraphMark(ctx.db, ctx.userId)), {})));
    expect(seen).toHaveLength(1);
    expect(seen[0]).not.toBeNull();
    expect((await readGraph(ctx.db, ctx.userId)).pending).toBe(false);
  });

  it("drops a name given for a membership that changed during the call, for the next job to redo", async () => {
    const four = await books("A B C D");
    await clique(four);
    let calls = 0;
    const namer = await recompute(
      fakeNamer(async () => (calls++ ? { name: "Fresh Name" } : (await removeFromLibrary(ctx.db, ctx.pipeline, ctx.userId, four[3]), { name: "Stale Name" }))),
    );
    expect(namer.inputs.map((i) => i.books.length)).toEqual([4, 3]);
    expect((await clusters())[0].name).toBe("Fresh Name");
  });

  it("leaves a named Cluster alone when nothing changed", async () => {
    await clique(await books("A B C"));
    await recompute();
    const again = await recompute();
    expect(again.inputs).toHaveLength(0);
  });

  describe("rename threshold", () => {
    // Grows a named Cluster of `size` by `added` Books, and returns the namer of the recompute after.
    async function grow(size: number, added: number) {
      const first = await books(Array.from({ length: size }, (_, i) => `M${i}`).join(" "));
      await clique(first);
      await recompute(fakeNamer(() => ({ name: "Old Name", description: "Old." })));
      const more = await books(Array.from({ length: added }, (_, i) => `N${i}`).join(" "));
      await clique([...first, ...more]);
      return recompute(fakeNamer(() => ({ name: "New Name", description: "New." })));
    }

    it("keeps the name under 30% change, though two Books joined", async () => {
      const namer = await grow(10, 2);
      expect(namer.inputs).toHaveLength(0);
      expect((await clusters())[0].name).toBe("Old Name");
      expect((await clusters())[0].bookIds).toHaveLength(12);
    });

    it("keeps the name when one Book joined, though that is 30% or more", async () => {
      const namer = await grow(3, 1);
      expect(namer.inputs).toHaveLength(0);
      expect((await clusters())[0].name).toBe("Old Name");
    });

    it("renames at 30% change and two Books, showing the call the old name", async () => {
      const namer = await grow(3, 2);
      expect(namer.inputs).toHaveLength(1);
      expect(namer.inputs[0].previousName).toBe("Old Name");
      expect(namer.inputs[0].books).toHaveLength(5);
      expect((await clusters())[0]).toMatchObject({ name: "New Name", description: "New." });
    });

    it("counts Books removed from the library as removed", async () => {
      const five = await books("M0 M1 M2 M3 M4");
      await clique(five);
      await recompute(fakeNamer(() => ({ name: "Old Name" })));
      await removeFromLibrary(ctx.db, ctx.pipeline, ctx.userId, five[3]);
      expect((await recompute()).inputs).toHaveLength(0);
      await removeFromLibrary(ctx.db, ctx.pipeline, ctx.userId, five[4]);
      expect((await recompute()).inputs).toHaveLength(1);
    });

    it("measures change against the membership at naming time, so small changes add up", async () => {
      const first = await books("M0 M1 M2 M3 M4 M5");
      await clique(first);
      await recompute(fakeNamer(() => ({ name: "Old Name" })));
      const [n0, n1] = await books("N0 N1");
      for (const m of first) await connect(n0, m);
      expect((await recompute()).inputs).toHaveLength(0);
      for (const m of [...first, n0]) await connect(n1, m);
      expect((await recompute()).inputs).toHaveLength(1);
    });
  });

  it("keeps the old name when the call keeps it, and measures the next change from now", async () => {
    const first = await books("A B C");
    await clique(first);
    await recompute(fakeNamer(() => ({ name: "Old Name" })));
    const more = await books("D E");
    await clique([...first, ...more]);
    await recompute(fakeNamer((input) => ({ name: input.previousName!, description: "Still quiet." })));

    expect((await clusters())[0]).toMatchObject({ name: "Old Name", description: "Still quiet." });
    const [row] = await ctx.db.select().from(clusterLabel);
    expect(row.namedMemberBookIds).toHaveLength(5);
  });

  describe("failure", () => {
    const failing = () => fakeNamer(() => Promise.reject(new Error("overloaded")));

    it("shows an unnamed Cluster as 'Cluster of N Books' and never blocks the graph", async () => {
      await clique(await books("A B C"));
      const namer = await recompute(failing());

      // Only its own attempts: the graph job itself succeeded, and was not retried.
      expect(namer.inputs).toHaveLength(NAMING_ATTEMPTS);
      const g = await readGraph(ctx.db, ctx.userId);
      expect(g.clusters).toEqual([expect.objectContaining({ name: "Cluster of 3 Books", description: null })]);
      expect(g.pending).toBe(false);
    });

    it("tries again at the next recompute", async () => {
      await clique(await books("A B C"));
      await recompute(failing());
      await recompute(fakeNamer(() => ({ name: "Late Name" })));
      expect((await clusters())[0].name).toBe("Late Name");
    });

    it("retries a reply that is not a name of at most four words", async () => {
      await clique(await books("A B C"));
      let n = 0;
      const namer = await recompute(fakeNamer(() => ({ name: n++ ? "Four Words At Most" : "Far Too Many Words Here" })));
      expect(namer.inputs).toHaveLength(2);
      expect((await clusters())[0].name).toBe("Four Words At Most");
    });

    it("keeps a named Cluster's old name when its rename fails", async () => {
      const first = await books("A B C");
      await clique(first);
      await recompute(fakeNamer(() => ({ name: "Old Name" })));
      const more = await books("D E");
      await clique([...first, ...more]);
      await recompute(failing());
      expect((await clusters())[0].name).toBe("Old Name");
    });
  });
});
