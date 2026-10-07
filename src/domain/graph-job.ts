import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { graphJob } from "@/db/schema";
import { countFindingConnections } from "./connections";
import type { JobQueue } from "./pipeline";

// The reader's graph job: it recomputes their Clusters and lays the graph out, then names the
// Clusters. From the moment it is asked for until it settles, the reader's graph is pending; once it
// has laid the graph out, only naming is left. A request that comes in while it runs keeps the graph
// pending until the job queued for that request has run too.

// Whether the reader's graph is about to change: a Book is finding Connections, or the graph job is
// queued or running (`pending`); and, of that, whether only the Clusters' names are on the way (`naming`).
export type GraphStatus = { pending: boolean; naming: boolean };

// Domain seam: the reader's graph status, checked alone while the graph waits for background work.
export async function readGraphStatus(db: Db, userId: string): Promise<GraphStatus> {
  const [job] = await db.select({ laidOut: graphJob.laidOut }).from(graphJob).where(eq(graphJob.userId, userId));
  const finding = (await countFindingConnections(db, userId)) > 0;
  return { pending: job !== undefined || finding, naming: job?.laidOut === true && !finding };
}

// Queues the reader's graph job, their graph pending until it settles. Throws when it cannot be
// queued, and then nothing stays pending for it.
export async function requestGraph(db: Db, queue: JobQueue, userId: string): Promise<void> {
  const mark = await markRequested(db, userId);
  try {
    await queue.send({ kind: "graph", userId });
  } catch (err) {
    await settle(db, userId, mark);
    throw err;
  }
}

// Runs `work`, which changes the reader's Connections, then queues their graph job. The graph is
// pending from before `work` starts, so it never reads as settled in between.
export async function requestGraphAfter(db: Db, queue: JobQueue, userId: string, work: () => Promise<void>): Promise<void> {
  await markRequested(db, userId);
  await work();
  await requestGraph(db, queue, userId);
}

// The steps of a graph job: the Clusters recomputed and the graph laid out, then the Clusters named.
export type GraphJobSteps = { layOut: () => Promise<void>; name: () => Promise<void> };

// Runs one attempt at the reader's graph job, answering the latest request so far.
export async function runGraphJob(db: Db, userId: string, steps: GraphJobSteps): Promise<void> {
  const [row] = await db.select({ request: graphJob.request }).from(graphJob).where(eq(graphJob.userId, userId));
  const mark = row?.request;
  await steps.layOut();
  if (mark !== undefined) {
    await db.update(graphJob).set({ laidOut: true }).where(and(eq(graphJob.userId, userId), eq(graphJob.request, mark)));
  }
  await steps.name();
  if (mark !== undefined) await settle(db, userId, mark);
}

// The graph job will not be attempted again. Which request it answered is not known here, so the
// graph stops pending: at worst it stops checking back before a job queued meanwhile has run.
export async function graphJobGaveUp(db: Db, userId: string): Promise<void> {
  await settle(db, userId);
}

async function markRequested(db: Db, userId: string): Promise<number> {
  const [row] = await db
    .insert(graphJob)
    .values({ userId })
    .onConflictDoUpdate({ target: graphJob.userId, set: { request: sql`${graphJob.request} + 1`, laidOut: false } })
    .returning({ request: graphJob.request });
  return row.request;
}

// Given the request a job answered, one that came in since stays pending; without one, nothing does.
async function settle(db: Db, userId: string, mark?: number): Promise<void> {
  await db.delete(graphJob).where(and(eq(graphJob.userId, userId), mark === undefined ? undefined : eq(graphJob.request, mark)));
}
