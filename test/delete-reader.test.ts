import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addBook, addManualBook } from "../src/domain/add-book";
import { invite } from "../src/domain/allowlist";
import { recomputeClusters } from "../src/domain/clusters";
import { layoutGraph } from "../src/domain/graph";
import { addNote } from "../src/domain/notes";
import {
  allowedEmail, book, bookPosition, clusterLabel, connection, connectionRun, enrichment, graphJob, libraryEntry, note, paidCall, readThrough, session, user,
} from "../src/db/schema";
import { createAuth } from "../src/lib/auth";
import { fakeMailer, work } from "./fakes";
import { addReader, useTestDb } from "./harness";

// Deleting a Reader's `user` row removes everything they own, and nothing of anyone else's. A Reader
// deletes their own from the account page (#68), through Better Auth's delete-user.

const BASE_URL = "https://marginalia.test";
const HOUR = 60 * 60 * 1000;

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
  const mailer = fakeMailer();
  const auth = () =>
    createAuth(ctx.db, {
      mailer, signupMode: "allowlist", baseURL: BASE_URL, secret: "s".repeat(32), google: { clientId: "id", clientSecret: "secret" }, turnstileSecretKey: "secret", codeReplyMs: 0,
    });
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

  // The Reader signs in with a code; their session cookie.
  async function signIn(email: string) {
    await auth().api.sendVerificationOTP({ body: { email, type: "sign-in" } });
    const { headers } = await auth().api.signInEmailOTP({ body: { email, otp: mailer.codeFor(email) }, returnHeaders: true });
    return headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  }

  // Delete your account, as the account page asks for it, with what the Reader typed to confirm it.
  const deleteAccount = (cookie: string, confirm: string) =>
    auth().handler(
      new Request(`${BASE_URL}/api/auth/delete-user`, {
        method: "POST",
        headers: { cookie, origin: BASE_URL, "content-type": "application/json", "x-forwarded-for": "203.0.113.1" },
        body: JSON.stringify({ confirm }),
      }),
    );

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
    await invite(ctx.db, "reader@marginalia.local", BASE_URL);
    await invite(ctx.db, "b@example.com", BASE_URL);
    await populate(a, "A");
    await populate(b, "B");
  });

  it("every foreign key to a Reader cascades or is set null", async () => {
    const { rows } = await ctx.db.execute<UserForeignKey>(userForeignKeys);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((r) => !["c", "n"].includes(r.onDelete))).toEqual([]);
    // Spend outlives the Reader: the call still counts toward the month.
    expect(rows.filter((r) => r.onDelete === "n").map((r) => r.table)).toEqual(["paid_call"]);
  });

  it("removes everything they own, keeps their paid calls unattributed, and leaves the other Reader and the shared Books alone", async () => {
    const cookie = await signIn("reader@marginalia.local");
    const theirs = (r: Record<string, unknown>) =>
      r.userId === a || r.id === a || r.createdByUserId === a || r.bookId === manual[a];
    const withoutA = await snapshot(theirs);
    // Seeding gave A a row in each table, so the check below proves something.
    const all = await snapshot();
    for (const name of Object.keys(TABLES)) expect(all[name].length, name).toBeGreaterThan(withoutA[name].length);

    const res = await deleteAccount(cookie, "delete");
    expect(res.status).toBe(200);
    // Signed out here, and (their sessions gone) on every other device.
    expect(res.headers.getSetCookie().some((c) => /session_token=;/.test(c))).toBe(true);

    for (const { table, column } of (await ctx.db.execute<UserForeignKey>(userForeignKeys)).rows) {
      const { rows } = await ctx.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM ${sql.raw(table)} WHERE ${sql.identifier(column)} = ${a}`);
      expect(rows[0].n, `${table}.${column}`).toBe(0);
    }
    expect(await snapshot()).toEqual(withoutA);
    expect((await ctx.db.select({ title: book.title }).from(book)).map((r) => r.title).sort()).toEqual(["B's Diary", "Beloved", "Stoner"]);
    expect((await ctx.db.select({ userId: paidCall.userId }).from(paidCall)).map((r) => r.userId).sort()).toEqual([b, null].sort());
    // Off the allowlist: signing up again takes a fresh invitation.
    expect((await ctx.db.select().from(allowedEmail)).map((r) => r.email)).toEqual(["b@example.com"]);
  });

  it("still deletes, and says so, when taking them off the allowlist fails; the log names the Reader by id, not email", async () => {
    const cookie = await signIn("reader@marginalia.local");
    // Postgres refuses to delete any allowlist row, as a failing database would.
    await ctx.db.execute(sql`CREATE FUNCTION refuse_delete() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'refused'; END $$ LANGUAGE plpgsql`);
    await ctx.db.execute(sql`CREATE TRIGGER refuse_delete BEFORE DELETE ON allowed_email FOR EACH ROW EXECUTE FUNCTION refuse_delete()`);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await deleteAccount(cookie, "delete");
      expect(res.status).toBe(200);
      expect(await ctx.db.select().from(user).where(eq(user.id, a))).toEqual([]);
      expect((await ctx.db.select().from(allowedEmail)).map((r) => r.email).sort()).toEqual(["b@example.com", "reader@marginalia.local"]);
      expect(logged).toHaveBeenCalledTimes(1);
      const line = logged.mock.calls[0].map((arg) => (arg instanceof Error ? `${arg.message} ${arg.stack}` : String(arg))).join(" ");
      expect(line).toContain(a);
      expect(line).not.toContain("reader@marginalia.local");
    } finally {
      logged.mockRestore();
      await ctx.db.execute(sql`DROP TRIGGER refuse_delete ON allowed_email`);
      await ctx.db.execute(sql`DROP FUNCTION refuse_delete`);
    }
  });

  it("refuses without the typed delete, and keeps everything", async () => {
    const cookie = await signIn("reader@marginalia.local");
    const before = await snapshot();
    for (const typed of ["", "Delete it", "yes"]) expect((await deleteAccount(cookie, typed)).status).toBe(400);
    expect(await snapshot()).toEqual(before);
  });

  it("refuses a session signed in more than 24 hours ago, and keeps everything", async () => {
    const cookie = await signIn("reader@marginalia.local");
    await ctx.db.update(session).set({ createdAt: new Date(Date.now() - 25 * HOUR) }).where(eq(session.userId, a));
    const before = await snapshot();
    const res = await deleteAccount(cookie, "delete");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "SESSION_EXPIRED" });
    expect(await snapshot()).toEqual(before);
    expect(await ctx.db.select().from(allowedEmail)).toHaveLength(2);
  });
});
