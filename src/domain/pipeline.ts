import type { Db } from "@/db/client";
import {
  generateConnections,
  refreshAfterEnrichment,
  resumeConnections,
  resumeNoteConnections,
  startConnections,
  type ConnectionJudge,
} from "./connections";
import type { DescriptionGateway } from "./description";
import { embedEnrichment, embedNote, noteEmbeddingFailed, type Embedder, type EmbeddingTarget } from "./embeddings";
import { enrichBook, readEnrichment, requestEnrichment, type EnrichmentModel } from "./enrichment";
import { recomputeClusters } from "./clusters";
import { layoutGraph } from "./graph";

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

// Seam to the job queue: pg-boss in production, an in-memory queue in tests. Throws when the job
// could not be queued.
export interface JobQueue {
  send(job: Job): Promise<void>;
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
    async refreshRequested(userId: string, bookId: string) {
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
    // A removed Book or a dismissed Connection: the reader's Clusters are recomputed.
    async connectionsChanged(userId: string) {
      try {
        await queue.send({ kind: "graph", userId });
      } catch (err) {
        console.error(err);
      }
    },
  };
}

// Runs one job, and queues the work that follows it. Throws on failure so the queue retries;
// `final` is true when it will not. Connections waiting on an Enrichment or a Note's vector are queued
// again once it settles: done, or failed for good. A Connections job is followed by the reader's graph
// job, so their Clusters are current and a newly Finished Book has a stored place even when it found
// nothing or failed.
export async function runJob(db: Db, deps: JobDeps, queue: JobQueue, job: Job, final: boolean): Promise<void> {
  if (job.kind === "enrich") {
    try {
      await enrichBook(db, { model: deps.model, descriptions: deps.descriptions, finalAttempt: final }, job.bookId);
    } catch (err) {
      if (final) await resumeConnections(db, queue, job.bookId);
      throw err;
    }
    // Always queued, and a no-op for an unrecognised or already-embedded Enrichment, so a retry
    // after a failed send still gets its embedding.
    await queue.send({ kind: "embed", target: { kind: "enrichment", id: job.bookId } });
    await refreshAfterEnrichment(db, queue, job.bookId);
    await resumeConnections(db, queue, job.bookId);
  } else if (job.kind === "embed" && job.target.kind === "note") {
    const { id } = job.target;
    try {
      await embedNote(db, deps.embedder, id, final);
    } catch (err) {
      if (final) await resumeNoteConnections(db, queue, id);
      throw err;
    }
    await resumeNoteConnections(db, queue, id);
  } else if (job.kind === "embed") {
    await embedEnrichment(db, deps.embedder, job.target.id);
  } else if (job.kind === "graph") {
    await recomputeClusters(db, job.userId);
    await layoutGraph(db, job.userId);
  } else {
    try {
      await generateConnections(db, { judge: deps.judge, embedder: deps.embedder, finalAttempt: final }, { userId: job.userId, bookId: job.bookId });
    } catch (err) {
      if (final) await queue.send({ kind: "graph", userId: job.userId });
      throw err;
    }
    await queue.send({ kind: "graph", userId: job.userId });
  }
}
