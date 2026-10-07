import type { Db } from "@/db/client";
import {
  connectionsGaveUp,
  generateConnections,
  refreshAfterEnrichment,
  resumeConnections,
  resumeNoteConnections,
  startConnections,
  type ConnectionJudge,
} from "./connections";
import type { DescriptionGateway } from "./description";
import {
  embedEnrichment,
  embedNote,
  enrichmentEmbeddingFailed,
  noteEmbeddingFailed,
  retryEmbeddings,
  type Embedder,
  type EmbeddingTarget,
} from "./embeddings";
import { enrichBook, enrichmentGaveUp, readEnrichment, requestEnrichment, type EnrichmentModel } from "./enrichment";
import { recomputeClusters } from "./clusters";
import { clearGraphMark, layoutGraph, markGraphQueued, readGraphMark } from "./graph";

// The background work, one job at a time: Enrichment for a Book, a vector for an Enrichment or a
// Note (`id` is a Book id for an Enrichment), Connections for a reader's Book, and a reader's graph:
// their Clusters, and a place for each newly Finished Book.
export type Job =
  | { kind: "enrich"; bookId: string }
  | { kind: "embed"; target: EmbeddingTarget }
  | { kind: "connections"; userId: string; bookId: string }
  | { kind: "graph"; userId: string };

// Retries after a job's first attempt. Both queues honour them.
export const RETRIES: Record<Job["kind"], number> = { enrich: 3, embed: 5, connections: 2, graph: 2 };

// Jobs with the same key coalesce: at most one waits per key, while one with the key may be running.
export function jobKey(job: Job): string {
  if (job.kind === "enrich") return job.bookId;
  if (job.kind === "embed") return `${job.target.kind}:${job.target.id}`;
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
};

export type Pipeline = ReturnType<typeof createPipeline>;

// Domain seam: what the rest of the domain tells the background work. Never throws: a queue that is
// down must not fail what the reader did.
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
    // Enrichment is generated once per Book; the job is a no-op when the Book is already enriched.
    async bookAdded(bookId: string) {
      await requestEnrichment(db, queue, bookId, false);
    },
    // A Book's first completed Read-through. Its Connections wait on its Enrichment, which a Book
    // added before Enrichment existed has never been asked for.
    async bookFinished(userId: string, bookId: string) {
      if (!(await readEnrichment(db, bookId))) await requestEnrichment(db, queue, bookId, false);
      await startConnections(db, queue, userId, bookId, false);
    },
    // Also the retry after a failed run, or a Note or Enrichment that gave up on its vector: those are
    // embedded again before the run draws on them.
    async refreshRequested(userId: string, bookId: string) {
      await retryEmbeddings(db, queue, userId, bookId);
      await startConnections(db, queue, userId, bookId, true);
    },
    // No vector is coming when the job can't be queued, so the Note is marked as given up and stops
    // holding Connections back; the backfill embeds it later.
    async noteSaved(noteId: string) {
      try {
        await queue.send({ kind: "embed", target: { kind: "note", id: noteId } });
      } catch (err) {
        console.error(err);
        await noteEmbeddingFailed(db, noteId);
        await resumeNoteConnections(db, queue, noteId);
      }
    },
    // The reader's "Try again". False when no job is coming.
    async enrichmentRetried(bookId: string): Promise<boolean> {
      return requestEnrichment(db, queue, bookId, true);
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

// Queues the reader's graph job, their graph pending until it settles.
async function requestGraph(db: Db, queue: JobQueue, userId: string) {
  const mark = await markGraphQueued(db, userId);
  try {
    await queue.send({ kind: "graph", userId });
  } catch (err) {
    await clearGraphMark(db, userId, mark);
    throw err;
  }
}

// Runs one attempt at a job, and queues the work that follows it. Throws on failure so the queue
// retries. Connections waiting on an Enrichment or a Note's vector are queued again once it is done (or,
// in jobGaveUp, has failed for good). A Connections job is followed by the reader's graph job, so their
// Clusters are current and a newly Finished Book has a stored place even when it found nothing.
export async function runJob(db: Db, deps: JobDeps, queue: JobQueue, job: Job): Promise<void> {
  if (job.kind === "enrich") {
    await enrichBook(db, { model: deps.model, descriptions: deps.descriptions }, job.bookId);
    // Always queued, and a no-op for an unrecognised or already-embedded Enrichment, so a retry
    // after a failed send still gets its embedding.
    await queue.send({ kind: "embed", target: { kind: "enrichment", id: job.bookId } });
    await refreshAfterEnrichment(db, queue, job.bookId);
    await resumeConnections(db, queue, job.bookId);
  } else if (job.kind === "embed" && job.target.kind === "note") {
    await embedNote(db, deps.embedder, job.target.id);
    await resumeNoteConnections(db, queue, job.target.id);
  } else if (job.kind === "embed") {
    await embedEnrichment(db, deps.embedder, job.target.id);
  } else if (job.kind === "graph") {
    const mark = await readGraphMark(db, job.userId);
    await recomputeClusters(db, job.userId);
    await layoutGraph(db, job.userId);
    if (mark !== null) await clearGraphMark(db, job.userId, mark);
  } else {
    await generateConnections(db, { judge: deps.judge, embedder: deps.embedder }, { userId: job.userId, bookId: job.bookId });
    await requestGraph(db, queue, job.userId);
  }
}

// A job the queue will not attempt again: its last attempt failed, or its worker died and the attempt
// expired. Whatever it leaves behind is marked failed, so nothing waits on a job that is not coming,
// and the work that waited on it goes ahead. Safe to run more than once.
export async function jobGaveUp(db: Db, queue: JobQueue, job: Job): Promise<void> {
  if (job.kind === "enrich") {
    await enrichmentGaveUp(db, job.bookId);
    await resumeConnections(db, queue, job.bookId);
  } else if (job.kind === "embed" && job.target.kind === "note") {
    await noteEmbeddingFailed(db, job.target.id);
    await resumeNoteConnections(db, queue, job.target.id);
  } else if (job.kind === "embed") {
    await enrichmentEmbeddingFailed(db, job.target.id);
  } else if (job.kind === "graph") {
    // Which request it started with is not known here, so the graph stops pending: at worst it
    // stops checking back before a job queued meanwhile has run.
    await clearGraphMark(db, job.userId);
  } else {
    await connectionsGaveUp(db, job.userId, job.bookId);
    await requestGraph(db, queue, job.userId);
  }
}
