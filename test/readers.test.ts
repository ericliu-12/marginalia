import { describe, expect, it } from "vitest";
import { account, allowedEmail, book, libraryEntry, paidCall, session, user } from "../src/db/schema";
import { listReaders } from "../src/domain/readers";
import { useTestDb } from "./harness";

const DAY = 24 * 60 * 60 * 1000;
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
  const spend = (userId: string, costUsd: number, at: Date) =>
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
    await ctx.db.insert(paidCall).values({ provider: "anthropic", model: "m", purpose: "judge", inputTokens: 1, outputTokens: 1, costUsd: 50, createdAt: daysAgo(1) });

    const { totals, readers } = await listReaders(ctx.db, NOW, {});

    expect(totals).toEqual({ readers: 4, last7Days: 1, last30Days: 2 });
    expect(readers.map((r) => ({ ...r, spentUsd: Number(r.spentUsd.toFixed(6)) }))).toEqual([
      { email: "newcomer@marginalia.local", joinedAt: daysAgo(5), signIn: ["email"], lastSessionAt: null, books: 1, spentUsd: 0.42, budgetUsd: 1 },
      { email: "lurker@marginalia.local", joinedAt: daysAgo(20), signIn: ["Google"], lastSessionAt: null, books: 0, spentUsd: 0, budgetUsd: 1 },
      { email: "switcher@marginalia.local", joinedAt: daysAgo(40), signIn: ["Google", "email"], lastSessionAt: daysAgo(1), books: 0, spentUsd: 0.42, budgetUsd: 2 },
      { email: "veteran@marginalia.local", joinedAt: daysAgo(90), signIn: ["Google"], lastSessionAt: daysAgo(3), books: 2, spentUsd: 0.2, budgetUsd: 5 },
    ]);
  });
});
