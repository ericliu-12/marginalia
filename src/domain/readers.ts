import { count, desc, eq, max, min, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { account, allowedEmail, libraryEntry, session, user } from "@/db/schema";
import { readerBudgetUsd, spentThisMonthByReaderUsd } from "@/domain/spend";

type Env = Record<string, string | undefined>;
type SignIn = "Google" | "email";

export type ReaderRow = {
  email: string;
  joinedAt: Date;
  signIn: SignIn[];
  lastSessionAt: Date | null;
  books: number;
  spentUsd: number;
  budgetUsd: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;
// Google's account row is made in the same request as a Reader who joins with Google.
const LINKED_LATER_MS = 60 * 1000;

// `pnpm readers`: every Reader, newest first, for the owner. Reads only, and only what it prints: no
// tokens, passwords or codes.
export async function listReaders(db: Db, now = new Date(), env: Env = process.env) {
  const books = db
    .select({ userId: libraryEntry.userId, n: count().as("n") })
    .from(libraryEntry)
    .groupBy(libraryEntry.userId)
    .as("books");
  const sessions = db
    .select({ userId: session.userId, lastAt: max(session.createdAt).as("last_at") })
    .from(session)
    .groupBy(session.userId)
    .as("sessions");
  const google = db
    .select({ userId: account.userId, linkedAt: min(account.createdAt).as("linked_at") })
    .from(account)
    .where(eq(account.providerId, "google"))
    .groupBy(account.userId)
    .as("google");
  const credential = db
    .selectDistinct({ userId: account.userId })
    .from(account)
    .where(eq(account.providerId, "credential"))
    .as("credential");

  const [rows, spent] = await Promise.all([
    db
      .select({
        email: user.email,
        joinedAt: user.createdAt,
        overrideUsd: allowedEmail.monthlyBudgetUsd,
        books: sql<number>`coalesce(${books.n}, 0)::int`,
        lastSessionAt: sessions.lastAt,
        googleLinkedAt: google.linkedAt,
        hasCredential: sql<boolean>`${credential.userId} is not null`,
        id: user.id,
      })
      .from(user)
      .leftJoin(allowedEmail, eq(allowedEmail.email, user.email))
      .leftJoin(books, eq(books.userId, user.id))
      .leftJoin(sessions, eq(sessions.userId, user.id))
      .leftJoin(google, eq(google.userId, user.id))
      .leftJoin(credential, eq(credential.userId, user.id))
      .orderBy(desc(user.createdAt)),
    spentThisMonthByReaderUsd(db, now),
  ]);

  const readers: ReaderRow[] = rows.map((r) => {
    // An email code leaves no account row. A Reader who joined with one has no Google account from
    // the start; one who joined with Google and later used a code can't be told apart.
    const joinedByEmail = !r.googleLinkedAt || r.googleLinkedAt.getTime() - r.joinedAt.getTime() > LINKED_LATER_MS;
    const signIn: SignIn[] = [];
    if (r.googleLinkedAt) signIn.push("Google");
    if (joinedByEmail || r.hasCredential) signIn.push("email");
    return {
      email: r.email,
      joinedAt: r.joinedAt,
      signIn,
      lastSessionAt: r.lastSessionAt,
      books: r.books,
      spentUsd: spent.get(r.id) ?? 0,
      budgetUsd: readerBudgetUsd({ createdAt: r.joinedAt, overrideUsd: r.overrideUsd }, now, env).usd,
    };
  });
  const joinedWithin = (days: number) => readers.filter((r) => r.joinedAt.getTime() > now.getTime() - days * DAY_MS).length;
  return { totals: { readers: readers.length, last7Days: joinedWithin(7), last30Days: joinedWithin(30) }, readers };
}
