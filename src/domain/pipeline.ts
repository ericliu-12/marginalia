import type { Db } from "@/db/client";
import { generateConnections, type ConnectionJudge } from "./connections";
import type { DescriptionGateway } from "./description";
import { embedEnrichment, embedNote, type Embedder, type EmbeddingTarget } from "./embeddings";
import { enrichBook, type EnrichmentModel } from "./enrichment";
import { startConnections } from "./library-entry";

// The background work, one job at a time: Enrichment for a Book, a vector for an Enrichment or a
// Note (`id` is a Book id for an Enrichment), and Connections for a reader's Book.
export type Job =
  | { kind: "enrich"; bookId: string }
  | { kind: "embed"; target: EmbeddingTarget }
  | { kind: "connections"; userId: string; bookId: string };

// Retries after a job's first attempt. Both queues honour them.
export const RETRIES: Record<Job["kind"], number> = { enrich: 3, embed: 5, connections: 2 };

// Jobs with the same key coalesce: at most one waits per key, while one with the key may be running.
export function jobKey(job: Job): string {
  if (job.kind === "enrich") return job.bookId;
  if (job.kind === "embed") return `${job.target.kind}:${job.target.id}`;
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
  const send = (job: Job) => queue.send(job).catch((err) => console.error(err));
  return {
    // Enrichment is generated once per Book; the job is a no-op when the Book is already enriched.
    async bookAdded(bookId: string) {
      await send({ kind: "enrich", bookId });
    },
    // A Book's first completed Read-through.
    async bookFinished(userId: string, bookId: string) {
      await startConnections(db, queue, userId, bookId);
    },
    async noteSaved(noteId: string) {
      await send({ kind: "embed", target: { kind: "note", id: noteId } });
    },
    // The reader's "Try again". False when no job is coming.
    async enrichmentRetried(bookId: string): Promise<boolean> {
      try {
        await queue.send({ kind: "enrich", bookId });
        return true;
      } catch (err) {
        console.error(err);
        return false;
      }
    },
  };
}

// Runs one job, and queues the work that follows it. Throws on failure so the queue retries;
// `final` is true when it will not.
export async function runJob(db: Db, deps: JobDeps, queue: JobQueue, job: Job, final: boolean): Promise<void> {
  if (job.kind === "enrich") {
    await enrichBook(db, { model: deps.model, descriptions: deps.descriptions, finalAttempt: final }, job.bookId);
    // Always queued, and a no-op for an unrecognised or already-embedded Enrichment, so a retry
    // after a failed send still gets its embedding.
    await queue.send({ kind: "embed", target: { kind: "enrichment", id: job.bookId } });
  } else if (job.kind === "embed") {
    const { kind, id } = job.target;
    await (kind === "note" ? embedNote : embedEnrichment)(db, deps.embedder, id);
  } else {
    await generateConnections(
      db,
      { judge: deps.judge, embedder: deps.embedder, enrichment: deps.model, descriptions: deps.descriptions, finalAttempt: final },
      { userId: job.userId, bookId: job.bookId },
    );
  }
}
