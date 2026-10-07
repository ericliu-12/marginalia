import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { addBook } from "../src/domain/add-book";
import { recomputeClusters } from "../src/domain/clusters";
import { dismissConnection, type Strength } from "../src/domain/connections";
import { readGraph } from "../src/domain/graph";
import { removeFromLibrary } from "../src/domain/library-entry";
import { jobKey, type JobDeps } from "../src/domain/pipeline";
import { clusterLabel, connection } from "../src/db/schema";
import { fakeEmbedder, fakeEnricher, fakeJudge, fakeNamer, work } from "./fakes";
import { useTestDb } from "./harness";

describe("Clusters", () => {
  const ctx = useTestDb();
  const ids = new Map<string, string>();
  const add = async (title: string) => {
    const { bookId } = await addBook(ctx.db, ctx.pipeline, ctx.userId, work({ workKey: `/works/${title}`, title, authors: ["A"] }), "read");
    ids.set(title, bookId);
    return bookId;
  };
  const books = (titles: string) => Promise.all(titles.split(" ").map(add));

  // Stored as the judge would leave it; a pair already stored is set to `strength` and undismissed.
  async function connect(x: string, y: string, strength: Strength = "strong") {
    const [a, b] = [x, y].sort();
    await ctx.db
      .insert(connection)
      .values({
        userId: ctx.userId, bookAId: a, bookBId: b, type: "thematic", strength, similarity: 0.5, similarityModel: "m",
        explanation: "Why.", grounding: "enrichment", model: "m", promptVersion: "p",
      })
      .onConflictDoUpdate({ target: [connection.userId, connection.bookAId, connection.bookBId], set: { strength, dismissedAt: null } });
  }
  const clique = async (members: string[], strength: Strength = "strong") => {
    for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) await connect(members[i], members[j], strength);
  };
  const dismiss = async (x: string, y: string) => {
    const [a, b] = [x, y].sort();
    const [row] = await ctx.db
      .select({ id: connection.id })
      .from(connection)
      .where(and(eq(connection.userId, ctx.userId), eq(connection.bookAId, a), eq(connection.bookBId, b)));
    await dismissConnection(ctx.db, ctx.pipeline, ctx.userId, row.id);
  };

  // Each Cluster as its member titles, keyed by Cluster id.
  async function clusters() {
    const g = await readGraph(ctx.db, ctx.userId);
    const title = (id: string) => g.books.find((b) => b.bookId === id)!.title;
    return Object.fromEntries(g.clusters.map((c) => [c.id, c.bookIds.map(title).sort().join(" ")]));
  }
  const idOf = async (members: string) => Object.entries(await clusters()).find(([, m]) => m === members)?.[0];

  // Background work that finds no Connections of its own, so only the ones a test stores count.
  const quiet = (): JobDeps => ({
    model: fakeEnricher({ themes: ["quiet"] }),
    judge: fakeJudge(() => ({ connections: [] })),
    embedder: fakeEmbedder(["quiet"]),
    descriptions: null,
    namer: fakeNamer(),
  });

  it("groups Books bound by Connections into Clusters of three or more; pairs and lone Books stay unclustered", async () => {
    const [a, b, c, d, e] = await books("A B C D E");
    await books("F");
    const [g, h, i, j] = await books("G H I J");
    await clique([a, b, c]);
    await connect(d, e);
    await clique([g, h, i, j], "moderate");
    await recomputeClusters(ctx.db, ctx.userId);

    expect(Object.values(await clusters()).sort()).toEqual(["A B C", "G H I J"]);
  });

  it("leaves dismissed Connections out", async () => {
    const [a, b, c] = await books("A B C");
    await clique([a, b, c]);
    await dismiss(a, c);
    await dismiss(b, c);
    await recomputeClusters(ctx.db, ctx.userId);

    expect(await clusters()).toEqual({});
  });

  it("weights a Connection by its Strength", async () => {
    // A bridge Book with a strong pair on one side and a weak pair on the other joins the strong side.
    const [x, y, bridge, p, q] = await books("X Y Bridge P Q");
    await connect(x, y);
    await connect(bridge, x);
    await connect(bridge, y);
    await connect(p, q, "weak");
    await connect(bridge, p, "weak");
    await connect(bridge, q, "weak");
    await connect(x, p, "weak");
    await recomputeClusters(ctx.db, ctx.userId);

    expect(Object.values(await clusters())).toContain("Bridge X Y");
  });

  it("gives the same Clusters for the same Connections", async () => {
    // A ring of twelve Books has no single best split, so only a fixed seed keeps it from changing.
    const ring = await books("R1 R2 R3 R4 R5 R6 R7 R8 R9 R10 R11 R12");
    for (let i = 0; i < ring.length; i++) await connect(ring[i], ring[(i + 1) % ring.length]);
    await recomputeClusters(ctx.db, ctx.userId);
    const first = Object.values(await clusters()).sort();
    expect(first.length).toBeGreaterThan(0);

    for (let run = 0; run < 3; run++) {
      await ctx.db.delete(clusterLabel);
      await recomputeClusters(ctx.db, ctx.userId);
      expect(Object.values(await clusters()).sort()).toEqual(first);
    }
  });

  describe("identity", () => {
    it("keeps a Cluster's identity as Books join it", async () => {
      const four = await books("A B C D");
      await clique(four);
      await recomputeClusters(ctx.db, ctx.userId);
      const before = await idOf("A B C D");

      const e = await add("E");
      for (const m of four) await connect(e, m);
      await recomputeClusters(ctx.db, ctx.userId);
      expect(await clusters()).toEqual({ [before!]: "A B C D E" });
    });

    it("keeps a 3-Book Cluster's identity when it grows to 7 in one recompute", async () => {
      const three = await books("A B C");
      await clique(three);
      await recomputeClusters(ctx.db, ctx.userId);
      const before = await idOf("A B C");

      const newcomers = await books("D E F G");
      await clique([...three, ...newcomers]);
      await recomputeClusters(ctx.db, ctx.userId);
      expect(await clusters()).toEqual({ [before!]: "A B C D E F G" });
    });

    it("gives a Cluster that changed past recognition a new identity", async () => {
      // Half of the old Books stay, among three new ones: under both thresholds.
      const [a, b, c, d] = await books("A B C D");
      await clique([a, b, c, d]);
      await recomputeClusters(ctx.db, ctx.userId);
      const before = await idOf("A B C D");

      for (const x of [a, b, d]) await dismiss(c, x);
      for (const x of [a, b]) await dismiss(d, x);
      const newcomers = await books("E F G");
      await clique([a, b, ...newcomers]);
      await recomputeClusters(ctx.db, ctx.userId);
      const after = await idOf("A B E F G");
      expect(after).toBeDefined();
      expect(after).not.toBe(before);
    });

    it("keeps the larger Cluster's identity through a merge", async () => {
      const big = await books("A B C D");
      const small = await books("E F G");
      await clique(big);
      await clique(small);
      await recomputeClusters(ctx.db, ctx.userId);
      const bigId = await idOf("A B C D");

      await clique([...big, ...small]);
      await recomputeClusters(ctx.db, ctx.userId);
      expect(await clusters()).toEqual({ [bigId!]: "A B C D E F G" });
    });

    it("keeps the larger Cluster's identity even when the merged one barely overlaps either", async () => {
      const [six, five, five2] = [await books("A1 A2 A3 A4 A5 A6"), await books("B1 B2 B3 B4 B5"), await books("C1 C2 C3 C4 C5")];
      for (const group of [six, five, five2]) await clique(group);
      await recomputeClusters(ctx.db, ctx.userId);
      const sixId = await idOf("A1 A2 A3 A4 A5 A6");

      await clique([...six, ...five, ...five2]);
      await recomputeClusters(ctx.db, ctx.userId);
      expect(Object.keys(await clusters())).toEqual([sixId]);
    });

    it("gives the largest part of a split the identity, and the rest are new", async () => {
      const left = await books("A B C D");
      const right = await books("E F G");
      await clique([...left, ...right]);
      await recomputeClusters(ctx.db, ctx.userId);
      const whole = await idOf("A B C D E F G");

      for (const l of left) for (const r of right) if (!(l === left[0] && r === right[0])) await dismiss(l, r);
      await recomputeClusters(ctx.db, ctx.userId);
      const after = await clusters();
      expect(after[whole!]).toBe("A B C D");
      expect(Object.values(after).sort()).toEqual(["A B C D", "E F G"]);
    });

    it("gives the largest part of a three-way split the identity, though it holds under half the Books", async () => {
      const parts = [await books("A B C D"), await books("E F G"), await books("H I J")];
      const all = parts.flat();
      await clique(all);
      await recomputeClusters(ctx.db, ctx.userId);
      const whole = Object.keys(await clusters())[0];

      for (const [i, p] of parts.entries())
        for (const q of parts.slice(i + 1)) for (const x of p) for (const y of q) if (x !== p[0] || y !== q[0]) await dismiss(x, y);
      await recomputeClusters(ctx.db, ctx.userId);
      const after = await clusters();
      expect(Object.values(after).sort()).toEqual(["A B C D", "E F G", "H I J"]);
      expect(after[whole]).toBe("A B C D");
    });

    it("keeps a Cluster's identity when a larger one, split, takes as many of the same new Cluster's Books", async () => {
      // Old: P1 = 1..10 and P2 = 11..14. New: 1..6, and 7..14 (all of P2 and four of P1).
      const all = await books("B1 B2 B3 B4 B5 B6 B7 B8 B9 B10 B11 B12 B13 B14");
      const [p1, p2] = [all.slice(0, 10), all.slice(10)];
      await clique(p1);
      await clique(p2);
      await recomputeClusters(ctx.db, ctx.userId);
      const p2Id = await idOf("B11 B12 B13 B14");

      const [first, second] = [all.slice(0, 6), all.slice(6)];
      for (const x of first) for (const y of second) await ctx.db.delete(connection).where(and(eq(connection.bookAId, [x, y].sort()[0]), eq(connection.bookBId, [x, y].sort()[1])));
      await connect(first[0], second[0], "weak");
      await clique(second);
      await recomputeClusters(ctx.db, ctx.userId);
      const after = await clusters();
      expect(Object.values(after).sort()).toEqual(["B1 B2 B3 B4 B5 B6", "B10 B11 B12 B13 B14 B7 B8 B9"]);
      expect(after[p2Id!]).toBe("B10 B11 B12 B13 B14 B7 B8 B9");
    });

    it("dissolves a Cluster below three Books, and one that forms again is new", async () => {
      const [a, b, c] = await books("A B C");
      await clique([a, b, c]);
      await recomputeClusters(ctx.db, ctx.userId);
      const before = await idOf("A B C");

      await dismiss(a, c);
      await dismiss(b, c);
      await recomputeClusters(ctx.db, ctx.userId);
      expect(await clusters()).toEqual({});

      await connect(a, c);
      await recomputeClusters(ctx.db, ctx.userId);
      const again = await idOf("A B C");
      expect(again).toBeDefined();
      expect(again).not.toBe(before);
    });
  });

  describe("wash", () => {
    const washes = async () => {
      const g = await readGraph(ctx.db, ctx.userId);
      const title = (id: string) => g.books.find((b) => b.bookId === id)!.title;
      return Object.fromEntries(g.clusters.map((c) => [c.bookIds.map(title).sort().join(" "), c.wash]));
    };

    it("gives a new Cluster the wash fewest live Clusters have, and keeps it while the Cluster continues", async () => {
      const [a, b, c] = await books("A B C");
      const [d, e, f] = await books("D E F");
      const [g, h, i] = await books("G H I");
      await clique([a, b, c]);
      await clique([d, e, f]);
      await clique([g, h, i]);
      await recomputeClusters(ctx.db, ctx.userId);
      const first = await washes();
      expect(new Set(Object.values(first)).size).toBe(3);

      // D E F dissolves; a new Cluster forms and takes the wash it left; A B C grows and keeps its own.
      await dismiss(d, e);
      await dismiss(e, f);
      await dismiss(d, f);
      const [j, k, l] = await books("J K L");
      await clique([j, k, l]);
      const m = await add("M");
      for (const x of [a, b, c]) await connect(m, x);
      await recomputeClusters(ctx.db, ctx.userId);
      expect(await washes()).toEqual({ "A B C M": first["A B C"], "G H I": first["G H I"], "J K L": first["D E F"] });
    });
  });

  describe("recompute", () => {
    const graphJobs = () => ctx.jobs.sent.filter((j) => j.kind === "graph");

    it("follows a finished Connections job", async () => {
      await books("A B C");
      const all = (): JobDeps => ({
        ...quiet(),
        judge: fakeJudge((input) => ({
          connections: input.candidates.map((c) => ({ candidateId: c.id, type: "thematic", strength: "strong", explanation: "Both are quiet.", quotedNoteIds: [] })),
        })),
      });
      await ctx.jobs.drain(all());
      expect(Object.values(await clusters())).toEqual(["A B C"]);
    });

    it("follows a dismissal", async () => {
      const [a, b, c] = await books("A B C");
      await clique([a, b, c]);
      await ctx.jobs.drain(quiet());
      expect(Object.values(await clusters())).toEqual(["A B C"]);

      await dismiss(a, c);
      await dismiss(b, c);
      await ctx.jobs.drain(quiet());
      expect(await clusters()).toEqual({});
    });

    it("follows a removed Book, which leaves its Clusters at once", async () => {
      const four = await books("A B C D");
      await clique(four);
      await ctx.jobs.drain(quiet());
      const id = await idOf("A B C D");

      await removeFromLibrary(ctx.db, ctx.pipeline, ctx.userId, four[3]);
      expect(await clusters()).toEqual({ [id!]: "A B C" });

      await removeFromLibrary(ctx.db, ctx.pipeline, ctx.userId, four[2]);
      await ctx.jobs.drain(quiet());
      expect(await clusters()).toEqual({});
    });

    it("coalesces per reader", async () => {
      const [a, b, c, d] = await books("A B C D");
      await clique([a, b, c, d]);
      await ctx.jobs.drain(quiet());
      ctx.jobs.sent.length = 0;

      await dismiss(a, b);
      await removeFromLibrary(ctx.db, ctx.pipeline, ctx.userId, d);
      expect(graphJobs()).toHaveLength(2);
      expect(new Set(graphJobs().map(jobKey)).size).toBe(1);
    });

    it("dismissing twice, or someone else's Connection, changes nothing", async () => {
      const [a, b, c] = await books("A B C");
      await clique([a, b, c]);
      const [row] = await ctx.db.select({ id: connection.id }).from(connection).limit(1);
      await dismissConnection(ctx.db, ctx.pipeline, ctx.userId, row.id);
      ctx.jobs.sent.length = 0;
      await dismissConnection(ctx.db, ctx.pipeline, ctx.userId, row.id);
      await dismissConnection(ctx.db, ctx.pipeline, "00000000-0000-0000-0000-000000000000", (await ctx.db.select({ id: connection.id }).from(connection))[1].id);
      expect(graphJobs()).toEqual([]);
    });
  });
});
