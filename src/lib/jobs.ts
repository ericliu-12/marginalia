import { PgBoss } from "pg-boss";
import type { Db } from "@/db/client";
import { enrichBook, type EnrichmentModel, type EnrichmentQueue } from "@/domain/enrichment";
import type { DescriptionGateway } from "@/domain/description";

const ENRICH_QUEUE = "enrich-book";
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
}

function queueFor(boss: PgBoss): EnrichmentQueue {
  return {
    async enqueueEnrichment(bookId) {
      await boss.send(ENRICH_QUEUE, { bookId }, { singletonKey: bookId });
    },
  };
}

let shared: Promise<EnrichmentQueue> | undefined;

// The web app's producer: sends jobs, never runs them or the queue's maintenance.
export function appQueue(): Promise<EnrichmentQueue> {
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
  await boss.work(
    ENRICH_QUEUE,
    {
      localConcurrency: ENRICH_CONCURRENCY,
      includeMetadata: true,
      ...(options.pollingIntervalSeconds && { pollingIntervalSeconds: options.pollingIntervalSeconds }),
    },
    async ([job]) => {
      await enrichBook(
        options.db,
        {
          model: options.model,
          descriptions: options.descriptions,
          finalAttempt: job.retryCount >= job.retryLimit,
        },
        (job.data as { bookId: string }).bookId,
      );
    },
  );
  return { queue: queueFor(boss), stop: () => boss.stop({ graceful: true }) };
}
