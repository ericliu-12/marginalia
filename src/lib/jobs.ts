import { PgBoss } from "pg-boss";
import type { Db } from "@/db/client";
import { embedEnrichment, embedNote, type Embedder, type EmbeddingQueue, type EmbeddingTarget } from "@/domain/embeddings";
import { enrichBook, type EnrichmentModel, type EnrichmentQueue } from "@/domain/enrichment";
import type { DescriptionGateway } from "@/domain/description";

const ENRICH_QUEUE = "enrich-book";
const EMBED_QUEUE = "embed";
const ENRICH_RETRIES = 3;
const ENRICH_CONCURRENCY = 3;

async function ensureQueues(boss: PgBoss) {
  // `short`: at most one waiting job per Book (a double add or "Try again" coalesces), while a
  // "Try again" during a running job still queues behind it.
  await boss.createQueue(ENRICH_QUEUE, {
    policy: "short",
    retryLimit: ENRICH_RETRIES,
    retryDelay: 5,
    retryBackoff: true,
  });
  // Same coalescing per target: saving a Note twice in a row embeds it once.
  await boss.createQueue(EMBED_QUEUE, {
    policy: "short",
    retryLimit: ENRICH_RETRIES,
    retryDelay: 5,
    retryBackoff: true,
  });
}

type Queues = EnrichmentQueue & EmbeddingQueue;

function queueFor(boss: PgBoss): Queues {
  return {
    async enqueueEnrichment(bookId) {
      await boss.send(ENRICH_QUEUE, { bookId }, { singletonKey: bookId });
    },
    async enqueueEmbedding(target) {
      await boss.send(EMBED_QUEUE, target, { singletonKey: `${target.kind}:${target.id}` });
    },
  };
}

let shared: Promise<Queues> | undefined;

// The web app's producer: sends jobs, never runs them or the queue's maintenance.
export function appQueue(): Promise<Queues> {
  shared ??= (async () => {
    const boss = new PgBoss({ connectionString: process.env.DATABASE_URL!, supervise: false, schedule: false });
    boss.on("error", (err) => console.error(err));
    await boss.start();
    await ensureQueues(boss);
    return queueFor(boss);
  })();
  shared.catch(() => (shared = undefined));
  return shared;
}

export type WorkerOptions = {
  connectionString: string;
  db: Db;
  model: EnrichmentModel;
  embedder: Embedder;
  descriptions: DescriptionGateway | null;
  pollingIntervalSeconds?: number;
};

// The long-running worker: owns queue maintenance and runs Enrichment jobs. Returns the queue it
// serves and a way to stop it.
export async function startWorker(options: WorkerOptions) {
  const boss = new PgBoss({ connectionString: options.connectionString });
  boss.on("error", (err) => console.error(err));
  await boss.start();
  await ensureQueues(boss);
  const queue = queueFor(boss);
  const polling = options.pollingIntervalSeconds && { pollingIntervalSeconds: options.pollingIntervalSeconds };
  await boss.work(
    ENRICH_QUEUE,
    {
      localConcurrency: ENRICH_CONCURRENCY,
      includeMetadata: true,
      ...polling,
    },
    async ([job]) => {
      const { bookId } = job.data as { bookId: string };
      await enrichBook(
        options.db,
        { model: options.model, descriptions: options.descriptions, finalAttempt: job.retryCount >= job.retryLimit },
        bookId,
      );
      // Always queued, and a no-op for an unrecognised or already-embedded Enrichment, so a retry
      // after a failed enqueue still gets its embedding.
      await queue.enqueueEmbedding({ kind: "enrichment", id: bookId });
    },
  );
  await boss.work(EMBED_QUEUE, { localConcurrency: ENRICH_CONCURRENCY, ...polling }, async ([job]) => {
    const { kind, id } = job.data as EmbeddingTarget;
    await (kind === "note" ? embedNote : embedEnrichment)(options.db, options.embedder, id);
  });
  return { queue, stop: () => boss.stop({ graceful: true }) };
}
