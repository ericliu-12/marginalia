import { PgBoss } from "pg-boss";
import type { Db } from "@/db/client";
import { generateConnections, type ConnectionJudge, type ConnectionQueue } from "@/domain/connections";
import { embedEnrichment, embedNote, type Embedder, type EmbeddingQueue, type EmbeddingTarget } from "@/domain/embeddings";
import { enrichBook, type EnrichmentModel, type EnrichmentQueue } from "@/domain/enrichment";
import type { DescriptionGateway } from "@/domain/description";

const ENRICH_QUEUE = "enrich-book";
const EMBED_QUEUE = "embed";
const EMBED_RETRY = { retryLimit: 5, retryDelay: 20, retryBackoff: true, retryDelayMax: 300 };
const ENRICH_RETRIES = 3;
const ENRICH_CONCURRENCY = 3;
const CONNECTIONS_QUEUE = "connections";
const CONNECTIONS_RETRIES = 2;

async function ensureQueues(boss: PgBoss) {
  // `short`: at most one waiting job per Book (a double add or "Try again" coalesces), while a
  // "Try again" during a running job still queues behind it.
  await boss.createQueue(ENRICH_QUEUE, {
    policy: "short",
    retryLimit: ENRICH_RETRIES,
    retryDelay: 5,
    retryBackoff: true,
  });
  // Same coalescing per target: saving a Note twice in a row embeds it once. Voyage rate limits
  // (429) need minutes, not seconds, to clear: 20s, 40s, 80s... capped at 5 minutes.
  await boss.createQueue(EMBED_QUEUE, { policy: "short", ...EMBED_RETRY });
  // One waiting job per reader's Book. Jobs run one at a time (see startWorker), in the order queued.
  await boss.createQueue(CONNECTIONS_QUEUE, {
    policy: "short",
    retryLimit: CONNECTIONS_RETRIES,
    retryDelay: 10,
    retryBackoff: true,
  });
  // createQueue leaves an existing queue as it was; keep its retry settings current.
  await boss.updateQueue(EMBED_QUEUE, EMBED_RETRY);
}

type Queues = EnrichmentQueue & EmbeddingQueue & ConnectionQueue;

function queueFor(boss: PgBoss): Queues {
  return {
    async enqueueEnrichment(bookId) {
      await boss.send(ENRICH_QUEUE, { bookId }, { singletonKey: bookId });
    },
    async enqueueEmbedding(target) {
      await boss.send(EMBED_QUEUE, target, { singletonKey: `${target.kind}:${target.id}` });
    },
    async enqueueConnections(job) {
      await boss.send(CONNECTIONS_QUEUE, job, { singletonKey: `${job.userId}:${job.bookId}` });
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
  judge: ConnectionJudge;
  embedder: Embedder;
  descriptions: DescriptionGateway | null;
  pollingIntervalSeconds?: number;
};

// The long-running worker: owns queue maintenance and runs Enrichment, embedding and Connections jobs. Returns the queue it
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
  // Serial: a burst of finishes (a backfill) queues rather than running in parallel.
  await boss.work(CONNECTIONS_QUEUE, { localConcurrency: 1, includeMetadata: true, ...polling }, async ([job]) => {
    await generateConnections(
      options.db,
      {
        judge: options.judge,
        embedder: options.embedder,
        enrichment: options.model,
        descriptions: options.descriptions,
        finalAttempt: job.retryCount >= job.retryLimit,
      },
      job.data as { userId: string; bookId: string },
    );
  });
  return { queue, stop: () => boss.stop({ graceful: true }) };
}
