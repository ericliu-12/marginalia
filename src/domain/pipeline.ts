import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { libraryEntry, user } from "@/db/schema";
import {
  connectionsGaveUp,
  connectionsNotQueued,
  generateConnections,
  refreshAfterEnrichment,
  resumeConnections,
  resumeNoteConnections,
  startConnections,
  type ConnectionJudge,
  type ConnectionsDue,
} from "./connections";
import type { DescriptionGateway } from "./description";
import {
  embedEnrichment,
  embedNote,
  enrichmentEmbeddingFailed,
  noteEmbeddingFailed,
  retryEmbeddings,
  staleEmbeddings,
  type Embedder,
  type EmbeddingTarget,
} from "./embeddings";
import { enrichBook, enrichmentGaveUp, readEnrichment, requestEnrichment, type EnrichmentModel } from "./enrichment";
import { nameClusters, recomputeClusters, type ClusterNamer } from "./clusters";
import { layoutGraph } from "./graph";
import { chargeTo } from "./spend";
import { graphJobGaveUp, graphNotQueued, requestGraph as graphRequested, runGraphJob } from "./graph-job";

// The background work, one job at a time: Enrichment for a Book, a vector for an Enrichment or a
// Note (`id` is a Book id for an Enrichment), Connections for a reader's Book, and a reader's graph:
// their Clusters, and a place for each newly Finished Book. `userId` is the Reader whose action caused
// the job, who pays for it; none for a bulk script (or a job queued before jobs carried one).
export type Job =
  | { kind: "enrich"; bookId: string; userId?: string }
  | { kind: "embed"; target: EmbeddingTarget; userId?: string }
  | { kind: "connections"; userId: string; bookId: string }
  | { kind: "graph"; userId: string };

// Retries after a job's first attempt. Both queues honour them.
export const RETRIES: Record<Job["kind"], number> = { enrich: 3, embed: 5, connections: 2, graph: 2 };

// Jobs with the same key coalesce: at most one waits per key, while one with the key may be running.
// A shared Book's Enrichment and its vector are keyed per Reader too, so a job held at one Reader's
// budget never holds another's; whichever runs second finds the work done and pays nothing.
export function jobKey(job: Job): string {
  const reader = (job.kind === "enrich" || job.kind === "embed") && job.userId ? `:${job.userId}` : "";
  if (job.kind === "enrich") return `${job.bookId}${reader}`;
  if (job.kind === "embed") return `${job.target.kind}:${job.target.id}${reader}`;
  if (job.kind === "graph") return job.userId;
  return `${job.userId}:${job.bookId}`;
}

// Seam to the job queue: pg-boss in production, an in-memory queue in tests. Each throws when the
// queue can't be reached. Once a job's last attempt has failed, or its worker died mid-run, the queue
// calls `jobGaveUp`.
export interface JobQueue {
  send(job: Job): Promise<void>;
  // Drops the job with this key, waiting or running: it is never attempted again. A running attempt
  // is left to finish.
  cancel(job: Job): Promise<void>;
}

export type JobDeps = {
  model: EnrichmentModel;
  judge: ConnectionJudge;
  embedder: Embedder;
  descriptions: DescriptionGateway | null;
  namer: ClusterNamer;
};

export type Pipeline = ReturnType<typeof createPipeline>;

// Domain seam: what the rest of the domain tells the background work. Never throws: a queue that is
// down must not fail what the reader did. The domain says what work is due; only this module turns it
// into jobs, choosing each one's key, the Reader who pays, and (by the queue it goes to) its priority.
export function createPipeline(db: Db, queue: JobQueue) {
  // A removed Book or a dismissed Connection: the reader's Clusters are recomputed.
  async function connectionsChanged(userId: string) {
    try {
      await requestGraph(db, queue, userId);
    } catch (err) {
      console.error(err);
    }
  }
  return {
    // Enrichment is generated once per Book, charged to the Reader who caused it; the job is a no-op
    // when the Book is already enriched.
    async bookAdded(userId: string, bookId: string) {
      await sendEnrichment(db, queue, userId, bookId, false);
    },
    // A Book's first completed Read-through. Its Connections wait on its Enrichment, which a Book
    // added before Enrichment existed has never been asked for.
    async bookFinished(userId: string, bookId: string) {
      if (!(await readEnrichment(db, bookId))) await sendEnrichment(db, queue, userId, bookId, false);
      await sendConnections(db, queue, await startConnections(db, userId, bookId, false));
    },
    // Also the retry after a failed run, or a Note or Enrichment that gave up on its vector: those are
    // embedded again before the run draws on them.
    async refreshRequested(userId: string, bookId: string) {
      await sendEmbeddings(db, queue, userId, await retryEmbeddings(db, userId, bookId));
      await sendConnections(db, queue, await startConnections(db, userId, bookId, true));
    },
    // No vector is coming when the job can't be queued, so the Note is marked as given up and stops
    // holding Connections back; the backfill embeds it later.
    async noteSaved(userId: string, noteId: string) {
      try {
        await queue.send({ kind: "embed", target: { kind: "note", id: noteId }, userId });
      } catch (err) {
        console.error(err);
        await noteEmbeddingFailed(db, noteId);
        await sendConnections(db, queue, await resumeNoteConnections(db, noteId));
      }
    },
    // The reader's "Try again". False when no job is coming.
    async enrichmentRetried(userId: string, bookId: string): Promise<boolean> {
      return sendEnrichment(db, queue, userId, bookId, true);
    },
    // A Manual Book's title, author or description changed: its Enrichment runs again on what the reader
    // wrote. Its existing Connections change only through a Refresh.
    async manualBookEdited(userId: string, bookId: string) {
      await sendEnrichment(db, queue, userId, bookId, true);
    },
    connectionsChanged,
    // A removed Library Entry: its Connections job, if one is waiting or running, is cancelled.
    async entryRemoved(userId: string, bookId: string) {
      try {
        await queue.cancel({ kind: "connections", userId, bookId });
      } catch (err) {
        console.error(err);
      }
      await connectionsChanged(userId);
    },
  };
}

// The Book's Enrichment, asked for and charged to the Reader asking. False when no job is coming, and
// then the Enrichment is failed rather than left pending.
async function sendEnrichment(db: Db, queue: JobQueue, userId: string, bookId: string, retry: boolean): Promise<boolean> {
  await requestEnrichment(db, bookId, retry);
  try {
    await queue.send({ kind: "enrich", bookId, userId });
    return true;
  } catch (err) {
    console.error(err);
    await enrichmentGaveUp(db, bookId);
    return false;
  }
}

// Vectors due, charged to `userId`. One that can't be queued is given up on.
async function sendEmbeddings(db: Db, queue: JobQueue, userId: string, targets: EmbeddingTarget[]): Promise<void> {
  for (const target of targets) {
    try {
      await queue.send({ kind: "embed", target, userId });
    } catch (err) {
      console.error(err);
      await (target.kind === "note" ? noteEmbeddingFailed(db, target.id) : enrichmentEmbeddingFailed(db, target.id));
    }
  }
}

// Connections due, each charged to the Reader whose Book it is. One that can't be queued is left failed.
async function sendConnections(db: Db, queue: JobQueue, due: ConnectionsDue[]): Promise<void> {
  for (const { entryId, userId, bookId } of due) {
    try {
      await queue.send({ kind: "connections", userId, bookId });
    } catch (err) {
      console.error(err);
      await connectionsNotQueued(db, entryId);
    }
  }
}

// Queues the reader's graph job, their graph pending until it settles. Throws when it cannot be
// queued, and then nothing stays pending for it.
export async function requestGraph(db: Db, queue: JobQueue, userId: string): Promise<void> {
  const request = await graphRequested(db, userId);
  try {
    await queue.send({ kind: "graph", userId });
  } catch (err) {
    await graphNotQueued(db, userId, request);
    throw err;
  }
}

// Runs `work`, which changes the reader's Connections, then queues their graph job. The graph is
// pending from before `work` starts, so it never reads as settled in between.
export async function requestGraphAfter(db: Db, queue: JobQueue, userId: string, work: () => Promise<void>): Promise<void> {
  await graphRequested(db, userId);
  await work();
  await requestGraph(db, queue, userId);
}

// Queues an embed job, charged to nobody, for every vector that is missing or from another model (see
// staleEmbeddings). Returns how many were queued; jobs for the same target coalesce, so re-running is safe.
export async function backfillEmbeddings(db: Db, queue: JobQueue, model: string): Promise<number> {
  const targets = await staleEmbeddings(db, model);
  for (const target of targets) await queue.send({ kind: "embed", target });
  return targets.length;
}

// Runs one attempt at a job, and queues the work that follows it. Throws on failure so the queue
// retries. Connections waiting on an Enrichment or a Note's vector are queued again once it is done (or,
// in jobGaveUp, has failed for good). A Connections job is followed by the reader's graph job, so their
// Clusters are current (and named) and a newly Finished Book has a stored place even when it found
// nothing; the graph stays pending until all of it is done. What the job pays for is charged to its Reader.
export async function runJob(db: Db, deps: JobDeps, queue: JobQueue, job: Job): Promise<void> {
  if (await dropIfReaderGone(db, queue, job)) return;
  return chargeTo(job.userId ?? null, () => run(db, deps, queue, job));
}

// A job whose Reader has been deleted since it was queued is dropped: it pays for no call, writes no
// row and sends no job. But an Enrichment for a Book other Readers still have is queued again with no
// payer (charged to nobody, still under the cap on everyone), so theirs doesn't stay pending. True when
// the job was dropped; one that names no Reader runs.
export async function dropIfReaderGone(db: Db, queue: JobQueue, job: Job): Promise<boolean> {
  if (!job.userId) return false;
  const [reader] = await db.select({ id: user.id }).from(user).where(eq(user.id, job.userId));
  if (reader) return false;
  if (job.kind === "enrich" && (await db.select({ id: libraryEntry.id }).from(libraryEntry).where(eq(libraryEntry.bookId, job.bookId)).limit(1)).length) {
    await queue.send({ kind: "enrich", bookId: job.bookId });
  }
  return true;
}

async function run(db: Db, deps: JobDeps, queue: JobQueue, job: Job): Promise<void> {
  if (job.kind === "enrich") {
    await enrichBook(db, { model: deps.model, descriptions: deps.descriptions }, job.bookId);
    // Always queued, and a no-op for an unrecognised or already-embedded Enrichment, so a retry
    // after a failed send still gets its embedding. Charged to whoever the Enrichment was.
    await queue.send({ kind: "embed", target: { kind: "enrichment", id: job.bookId }, userId: job.userId });
    await sendConnections(db, queue, await refreshAfterEnrichment(db, job.bookId));
    await sendConnections(db, queue, await resumeConnections(db, job.bookId));
  } else if (job.kind === "embed" && job.target.kind === "note") {
    await embedNote(db, deps.embedder, job.target.id);
    await sendConnections(db, queue, await resumeNoteConnections(db, job.target.id));
  } else if (job.kind === "embed") {
    await embedEnrichment(db, deps.embedder, job.target.id);
  } else if (job.kind === "graph") {
    await runGraphJob(db, job.userId, {
      layOut: async () => {
        await recomputeClusters(db, job.userId);
        await layoutGraph(db, job.userId);
      },
      name: () => nameClusters(db, deps.namer, job.userId),
    });
  } else {
    await requestGraphAfter(db, queue, job.userId, () =>
      generateConnections(db, { judge: deps.judge, embedder: deps.embedder }, { userId: job.userId, bookId: job.bookId }),
    );
  }
}

// A job the queue will not attempt again: its last attempt failed, or its worker died and the attempt
// expired. Whatever it leaves behind is marked failed, so nothing waits on a job that is not coming,
// and the work that waited on it goes ahead. Safe to run more than once. Dropped, as runJob drops it, once its Reader is gone.
export async function jobGaveUp(db: Db, queue: JobQueue, job: Job): Promise<void> {
  if (await dropIfReaderGone(db, queue, job)) return;
  if (job.kind === "enrich") {
    await enrichmentGaveUp(db, job.bookId);
    await sendConnections(db, queue, await resumeConnections(db, job.bookId));
  } else if (job.kind === "embed" && job.target.kind === "note") {
    await noteEmbeddingFailed(db, job.target.id);
    await sendConnections(db, queue, await resumeNoteConnections(db, job.target.id));
  } else if (job.kind === "embed") {
    await enrichmentEmbeddingFailed(db, job.target.id);
  } else if (job.kind === "graph") {
    await graphJobGaveUp(db, job.userId);
  } else {
    await requestGraphAfter(db, queue, job.userId, () => connectionsGaveUp(db, job.userId, job.bookId));
  }
}
