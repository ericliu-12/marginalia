import { asc, eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { addBook } from "../src/domain/add-book";
import { layoutGraph, lockLayout, readGraph, type GraphView } from "../src/domain/graph";
import { backupPositions, layoutStats, restorePositions } from "../src/domain/relayout";
import { bookPosition, connection } from "../src/db/schema";
import { work } from "./fakes";
import { addReader, useTestDb } from "./harness";

describe("Laying graphs out again", () => {
  const ctx = useTestDb();
  const backups: string[] = [];
  afterEach(async () => {
    for (const t of backups.splice(0)) await ctx.db.execute(sql`DROP TABLE IF EXISTS ${sql.identifier(t)}`);
  });

  // A chain of five Connected Books for the Reader, laid out.
  async function chain(userId: string) {
    const ids = [];
    for (const t of ["A", "B", "C", "D", "E"]) {
      ids.push((await addBook(ctx.db, ctx.pipeline, userId, work({ workKey: `/works/${t}`, title: t, authors: ["A"] }), "read")).bookId);
    }
    for (let i = 1; i < ids.length; i++) {
      const [a, b] = [ids[i - 1], ids[i]].sort();
      await ctx.db.insert(connection).values({
        userId, bookAId: a, bookBId: b, type: "thematic", strength: "strong", similarity: 0.5, similarityModel: "m",
        explanation: "Why.", grounding: "enrichment", model: "m", promptVersion: "p",
      });
    }
    await layoutGraph(ctx.db, userId);
  }
  const rows = (userId: string) =>
    ctx.db.select().from(bookPosition).where(eq(bookPosition.userId, userId)).orderBy(asc(bookPosition.libraryEntryId));

  it("works out a dry run's layout without writing a position", async () => {
    await chain(ctx.userId);
    await ctx.db.update(bookPosition).set({ x: 0, y: 0 });
    const before = await rows(ctx.userId);

    const laidOut = await layoutGraph(ctx.db, ctx.userId, { fresh: true, dryRun: true });
    expect(new Set([...laidOut.values()].map((p) => `${p.x},${p.y}`)).size).toBe(5);
    expect(await rows(ctx.userId)).toEqual(before);
  });

  it("restores one Reader's backed-up positions, leaving other Readers as they are", async () => {
    const other = (await addReader(ctx.db, "other@marginalia.local")).id;
    await chain(ctx.userId);
    await chain(other);
    const mine = await rows(ctx.userId);
    const table = await backupPositions(ctx.db, [ctx.userId]);
    backups.push(table);

    await ctx.db.update(bookPosition).set({ x: 0, y: 0 });
    await layoutGraph(ctx.db, ctx.userId, { fresh: true });
    const theirs = await rows(other);
    expect(await restorePositions(ctx.db, table)).toBe(5);

    expect(await rows(ctx.userId)).toEqual(mine);
    expect(await rows(other)).toEqual(theirs);
  });

  it("restores only from a position backup", async () => {
    await expect(restorePositions(ctx.db, "user")).rejects.toThrow("Not a position backup");
  });

  it("waits for another layout of the same Reader to finish before laying out", async () => {
    await chain(ctx.userId);
    let release!: () => void;
    let locked!: () => void;
    const holding = new Promise<void>((r) => (locked = r));
    const held = ctx.db.transaction(async (tx) => {
      await lockLayout(tx, ctx.userId);
      locked();
      await new Promise<void>((r) => (release = r));
    });
    await holding;

    let done = false;
    const layout = layoutGraph(ctx.db, ctx.userId, { fresh: true }).then(() => (done = true));
    await new Promise((r) => setTimeout(r, 300));
    expect(done).toBe(false);
    release();
    await held;
    await layout;
    expect(done).toBe(true);
  });

  it("counts overlapping labels and crossings among the Connections shown at rest", () => {
    const book = (bookId: string, x: number, y: number) => ({
      bookId, title: bookId, authors: [], x, y, label: bookId, degree: 1, finishedAt: 0, latestPass: { startedAt: null, finishedAt: null },
    });
    const link = (id: string, a: string, b: string) => ({ id, a, b, type: "thematic" as const, strength: "strong" as const, featured: true });
    const graph: GraphView = {
      // Two Connections crossing in an X, and a fifth Book right on top of the first.
      books: [book("A", 0, 0), book("B", 10, 10), book("C", 0, 10), book("D", 10, 0), book("E", 0.1, 0)],
      connections: [link("1", "A", "B"), link("2", "C", "D")],
      clusters: [],
      pending: false,
      naming: false,
    };
    expect(layoutStats(graph)).toMatchObject({ books: 5, labelOverlaps: 1, crossings: 1 });
  });
});
