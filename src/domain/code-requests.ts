import { and, asc, eq, gt, lt, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { codeRequest } from "@/db/schema";
import { normaliseEmail } from "./allowlist";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const PER_HOUR = 5;

// An email may be asked a sign-in code once a minute and five times an hour (#65), whoever it belongs
// to, so the limits say nothing about who may sign in. Records the request and returns null, or returns
// how many seconds until the email may ask again; a refused request isn't recorded.
export async function takeCodeRequest(db: Db, email: string, now = new Date()): Promise<{ retryAfterS: number } | null> {
  const address = normaliseEmail(email);
  const hourAgo = new Date(now.getTime() - HOUR_MS);
  return db.transaction(async (tx) => {
    // One request for an email at a time, so two at once can't both slip under a limit.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${address}))`);
    await tx.delete(codeRequest).where(lt(codeRequest.createdAt, hourAgo));
    const lastHour = await tx
      .select({ at: codeRequest.createdAt })
      .from(codeRequest)
      .where(and(eq(codeRequest.email, address), gt(codeRequest.createdAt, hourAgo)))
      .orderBy(asc(codeRequest.createdAt));
    const waits = [
      lastHour.length > 0 ? lastHour[lastHour.length - 1].at.getTime() + MINUTE_MS : 0,
      lastHour.length >= PER_HOUR ? lastHour[lastHour.length - PER_HOUR].at.getTime() + HOUR_MS : 0,
    ];
    const until = Math.max(...waits);
    if (until > now.getTime()) return { retryAfterS: Math.ceil((until - now.getTime()) / 1000) };
    await tx.insert(codeRequest).values({ email: address, createdAt: now });
    return null;
  });
}
