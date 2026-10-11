import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { account, allowedEmail, book, libraryEntry, paidCall, session, user, verification } from "../src/db/schema";
import { listReaders } from "../src/domain/readers";
import { DAY_MS as DAY } from "../src/domain/spend";
import { useTestDb } from "./harness";

const NOW = new Date(Date.UTC(2026, 9, 20, 12));
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);

describe("pnpm readers", () => {
  const ctx = useTestDb();

  async function reader(email: string, joined: Date) {
    const [row] = await ctx.db.insert(user).values({ email, createdAt: joined }).returning();
    return row.id;
  }
  const signIn = (userId: string, providerId: string, at: Date) =>
    ctx.db.insert(account).values({ userId, providerId, accountId: `${providerId}-${userId}`, accessToken: "secret", createdAt: at });
  const sessionAt = (userId: string, at: Date) =>
    ctx.db.insert(session).values({ userId, token: `token-${at.getTime()}`, expiresAt: new Date(at.getTime() + 7 * DAY), createdAt: at });
  async function books(userId: string, count: number) {
    for (let i = 0; i < count; i++) {
      const [b] = await ctx.db.insert(book).values({ title: `Book ${i}`, createdByUserId: userId }).returning();
      await ctx.db.insert(libraryEntry).values({ userId, bookId: b.id, status: "read" });
    }
  }
  const spend = (userId: string | null, costUsd: number, at: Date) =>
    ctx.db.insert(paidCall).values({ provider: "anthropic", model: "m", purpose: "judge", inputTokens: 1, outputTokens: 1, costUsd, userId, createdAt: at });

  it("totals the Readers and lists each, newest first, with how they sign in, their last session, Books and spend against their budget", async () => {
    await ctx.db.delete(user);

    // Joined with Google 90 days ago; signed in twice; last month's spend doesn't count.
    const veteran = await reader("veteran@marginalia.local", daysAgo(90));
    await signIn(veteran, "google", daysAgo(90));
    await sessionAt(veteran, daysAgo(30));
    await sessionAt(veteran, daysAgo(3));
    await books(veteran, 2);
    await spend(veteran, 0.2, daysAgo(1));
    await spend(veteran, 9, new Date(Date.UTC(2026, 8, 30, 23, 59)));

    // Joined with an email code 40 days ago, linked Google later, and has the owner's $2 override.
    const switcher = await reader("switcher@marginalia.local", daysAgo(40));
    await signIn(switcher, "google", daysAgo(10));
    await sessionAt(switcher, daysAgo(1));
    await ctx.db.insert(allowedEmail).values({ email: "switcher@marginalia.local", monthlyBudgetUsd: 2 });
    await spend(switcher, 0.3, daysAgo(2));
    await spend(switcher, 0.12, daysAgo(1));

    // Joined with an email code 5 days ago: in their first month, on $1. No session left.
    const newcomer = await reader("newcomer@marginalia.local", daysAgo(5));
    await books(newcomer, 1);
    await spend(newcomer, 0.42, daysAgo(4));

    // Joined with Google 20 days ago and hasn't done anything since.
    const lurker = await reader("lurker@marginalia.local", daysAgo(20));
    await signIn(lurker, "google", daysAgo(20));

    // Someone else's spend, and spend charged to nobody, aren't anyone's.
    await spend(null, 50, daysAgo(1));

    const { totals, readers } = await listReaders(ctx.db, NOW, {});

    expect(totals).toEqual({ last7Days: 1, last30Days: 2 });
    expect(readers.map((r) => ({ ...r, spentUsd: Number(r.spentUsd.toFixed(6)) }))).toEqual([
      { email: "newcomer@marginalia.local", joinedAt: daysAgo(5), signIn: ["email"], lastSessionAt: null, books: 1, spentUsd: 0.42, budgetUsd: 1 },
      { email: "lurker@marginalia.local", joinedAt: daysAgo(20), signIn: ["google"], lastSessionAt: null, books: 0, spentUsd: 0, budgetUsd: 1 },
      { email: "switcher@marginalia.local", joinedAt: daysAgo(40), signIn: ["google", "email"], lastSessionAt: daysAgo(1), books: 0, spentUsd: 0.42, budgetUsd: 2 },
      { email: "veteran@marginalia.local", joinedAt: daysAgo(90), signIn: ["google"], lastSessionAt: daysAgo(3), books: 2, spentUsd: 0.2, budgetUsd: 5 },
    ]);
  });

  // The script itself, as the owner runs it. Starting tsx can take seconds while the suite is busy.
  const run = (databaseUrl: string) =>
    promisify(execFile)("node_modules/.bin/tsx", ["src/readers.ts"], { env: { ...process.env, DATABASE_URL: databaseUrl } });

  it("prints no token, password, sign-in code or connection string", async () => {
    await signIn(ctx.userId, "google", new Date());
    await ctx.db.update(account).set({ accessToken: "access-tok-111", refreshToken: "refresh-tok-222", idToken: "id-tok-333", password: "PASSWORD-hash-444" });
    await ctx.db.insert(session).values({ userId: ctx.userId, token: "session-tok-555", expiresAt: new Date(Date.now() + DAY) });
    await ctx.db.insert(verification).values({ id: "v1", identifier: "sign-in-otp-reader@marginalia.local", value: "829301:0", expiresAt: new Date(Date.now() + DAY) });

    const { stdout, stderr } = await run(process.env.TEST_DATABASE_URL!);
    const output = stdout + stderr;
    expect(output).toContain("reader@marginalia.local");
    for (const secret of ["tok-", "PASSWORD", "829301", "postgres://", "postgresql://"]) expect(output).not.toContain(secret);
  }, 20_000);

  it("on failure, prints one short line and nothing of the error, and exits non-zero", async () => {
    const failed = await run("postgres://owner:hunter2@127.0.0.1:1/marginalia").catch((err) => err);
    expect(failed.code).not.toBe(0);
    expect(failed.stdout).toBe("");
    expect(failed.stderr).toBe("Could not list the Readers.\n");
  }, 20_000);
});
