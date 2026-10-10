import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { addBook, addManualBook } from "../src/domain/add-book";
import { recomputeClusters } from "../src/domain/clusters";
import { layoutGraph } from "../src/domain/graph";
import { addNote } from "../src/domain/notes";
import {
  book, bookPosition, clusterLabel, connection, connectionRun, enrichment, graphJob, libraryEntry, note, paidCall, readThrough, session, user,
} from "../src/db/schema";
import { work } from "./fakes";
import { addReader, useTestDb } from "./harness";

// Deleting a Reader's `user` row removes everything they own, and nothing of anyone else's.

// Every foreign key to `user`: the referencing table, its column, and what a deletion does to it
// (pg_constraint.confdeltype: c = cascade, n = set null, a = no action, r = restrict, d = set default).
const userForeignKeys = sql`
  SELECT c.conrelid::regclass::text AS table, a.attname AS column, c.confdeltype AS "onDelete"
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
  WHERE c.contype = 'f' AND c.confrelid = '"user"'::regclass
  ORDER BY 1, 2`;

type UserForeignKey = { table: string; column: string; onDelete: string };

const TABLES = { user, session, book, enrichment, libraryEntry, readThrough, note, connection, connectionRun, clusterLabel, bookPosition, graphJob };

describe("Deleting a Reader", () => {
  const ctx = useTestDb();
  let a: string;
  let b: string;
  const manual: Record<string, string> = {};
  const stoner = work({ workKey: "/works/stoner", title: "Stoner", authors: ["John Williams"] });
  const beloved = work({ workKey: "/works/beloved", title: "Beloved", authors: ["Toni Morrison"] });

  async function connect(userId: string, x: string, y: string) {
    const [p, q] = [x, y].sort();
    await ctx.db.insert(connection).values({
      userId, bookAId: p, bookBId: q, type: "thematic", strength: "strong", similarity: 0.5, similarityModel: "m",
      explanation: "Why.", grounding: "notes", model: "m", promptVersion: "p",
    });
  }

  // The Reader reads the two shared Books and a Manual Book of their own, with a Note on each, and
  // Connections binding the three into a Cluster, laid out; signed in, with a graph job queued and paid calls made.
  async function populate(userId: string, name: string) {
    const shared = [(await addBook(ctx.db, ctx.pipeline, userId, stoner, "read")).bookId, (await addBook(ctx.db, ctx.pipeline, userId, beloved, "read")).bookId];
    manual[userId] = (await addManualBook(ctx.db, ctx.pipeline, userId, { title: `${name}'s Diary`, author: name }, "read")).bookId;
    const books = [...shared, manual[userId]];
    for (const id of books) await addNote(ctx.db, ctx.pipeline, userId, id, { body: `${name} on ${id}.` });
    await connect(userId, books[0], books[1]);
    await connect(userId, books[1], books[2]);
    await connect(userId, books[0], books[2]);
    await recomputeClusters(ctx.db, userId);
    await layoutGraph(ctx.db, userId);
    const [entry] = await ctx.db.select().from(libraryEntry).where(eq(libraryEntry.bookId, manual[userId]));
    await ctx.db.insert(connectionRun).values({ userId, libraryEntryId: entry.id, candidateCount: 2, connectionCount: 2 });
    await ctx.db.insert(graphJob).values({ userId }).onConflictDoNothing();
    await ctx.db.insert(session).values({ userId, token: `token-${name}`, expiresAt: new Date(Date.now() + 60_000) });
    await ctx.db.insert(paidCall).values({ userId, provider: "anthropic", model: "m", purpose: "judge", inputTokens: 1, outputTokens: 1, costUsd: 0.01 });
  }

  // Every row of the tables a Reader's data lives in, as text, less those `drop` picks out.
  const snapshot = async (drop: (row: Record<string, unknown>) => boolean = () => false) =>
    Object.fromEntries(
      await Promise.all(
        Object.entries(TABLES).map(async ([name, t]) => [
          name,
          (await ctx.db.select().from(t)).filter((r) => !drop(r)).map((r) => JSON.stringify(r)).sort(),
        ]),
      ),
    );

  beforeEach(async () => {
    a = ctx.userId;
    b = (await addReader(ctx.db, "b@example.com")).id;
    await populate(a, "A");
    await populate(b, "B");
  });

  it("every foreign key to a Reader cascades or is set null", async () => {
    const { rows } = await ctx.db.execute<UserForeignKey>(userForeignKeys);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((r) => !["c", "n"].includes(r.onDelete))).toEqual([]);
  });

  it("removes everything they own, keeps their paid calls unattributed, and leaves the other Reader and the shared Books alone", async () => {
    const theirs = (r: Record<string, unknown>) =>
      r.userId === a || r.id === a || r.createdByUserId === a || r.bookId === manual[a];
    const others = await snapshot(theirs);
    // Seeding gave A a row in each table, so the check below proves something.
    const all = await snapshot();
    for (const name of Object.keys(TABLES)) expect(all[name].length, name).toBeGreaterThan(others[name].length);

    await ctx.db.delete(user).where(eq(user.id, a));

    for (const { table, column } of (await ctx.db.execute<UserForeignKey>(userForeignKeys)).rows) {
      const { rows } = await ctx.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM ${sql.raw(table)} WHERE ${sql.identifier(column)} = ${a}`);
      expect(rows[0].n, `${table}.${column}`).toBe(0);
    }
    expect(await snapshot()).toEqual(others);
    expect((await ctx.db.select({ title: book.title }).from(book)).map((r) => r.title).sort()).toEqual(["B's Diary", "Beloved", "Stoner"]);
    expect((await ctx.db.select({ userId: paidCall.userId }).from(paidCall)).map((r) => r.userId).sort()).toEqual([b, null].sort());
  });
});
