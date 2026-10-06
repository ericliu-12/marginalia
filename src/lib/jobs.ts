import { PgBoss } from "pg-boss";
import type { Db } from "@/db/client";
import { createPipeline, RETRIES, jobKey, runJob, type Job, type JobDeps, type JobQueue } from "@/domain/pipeline";

// pg-boss queue names, and the data each job carries, are kept as they were before the Pipeline so
// jobs already waiting still run.
const QUEUE: Record<Job["kind"], string> = { enrich: "enrich-book", embed: "embed", connections: "connections" };
const EMBED_RETRY = { retryLimit: RETRIES.embed, retryDelay: 20, retryBackoff: true, retryDelayMax: 300 };
const ENRICH_CONCURRENCY = 3;

const dataOf = (job: Job): object =>
  job.kind === "enrich"
    ? { bookId: job.bookId }
    : job.kind === "embed"
      ? job.target
      : { userId: job.userId, bookId: job.bookId };

async function ensureQueues(boss: PgBoss) {
  // `short`: at most one waiting job per key (a double add or "Try again" coalesces), while one sent
  // during a running job still queues behind it.
  await boss.createQueue(QUEUE.enrich, { policy: "short", retryLimit: RETRIES.enrich, retryDelay: 5, retryBackoff: true });
  // Voyage rate limits (429) need minutes, not seconds, to clear: 20s, 40s, 80s... capped at 5 minutes.
  await boss.createQueue(QUEUE.embed, { policy: "short", ...EMBED_RETRY });
  // Jobs run one at a time (see startWorker), in the order queued.
  await boss.createQueue(QUEUE.connections, { policy: "short", retryLimit: RETRIES.connections, retryDelay: 10, retryBackoff: true });
  // createQueue leaves an existing queue as it was; keep its retry settings current.
  await boss.updateQueue(QUEUE.embed, EMBED_RETRY);
}

function queueFor(boss: PgBoss): JobQueue {
  return {
    async send(job) {
      await boss.send(QUEUE[job.kind], dataOf(job), { singletonKey: jobKey(job) });
    },
  };
}

let shared: Promise<JobQueue> | undefined;

// The web app's producer: sends jobs, never runs them or the queue's maintenance. Connects on the
// first send; a send while pg-boss is unreachable throws, and the next one tries again.
export const appJobQueue: JobQueue = {
  async send(job) {
    shared ??= (async () => {
      const boss = new PgBoss({ connectionString: process.env.DATABASE_URL!, supervise: false, schedule: false });
      boss.on("error", (err) => console.error(err));
      await boss.start();
      await ensureQueues(boss);
      return queueFor(boss);
    })();
    shared.catch(() => (shared = undefined));
    await (await shared).send(job);
  },
};

export const appPipeline = (db: Db) => createPipeline(db, appJobQueue);

export type WorkerOptions = JobDeps & {
  connectionString: string;
  db: Db;
  pollingIntervalSeconds?: number;
};

// The long-running worker: owns queue maintenance and runs every job. Returns the queue it serves
// and a way to stop it.
export async function startWorker(options: WorkerOptions) {
  const { connectionString, db, pollingIntervalSeconds, ...deps } = options;
  const boss = new PgBoss({ connectionString });
  boss.on("error", (err) => console.error(err));
  await boss.start();
  await ensureQueues(boss);
  const queue = queueFor(boss);
  const polling = pollingIntervalSeconds && { pollingIntervalSeconds };
  const work = (kind: Job["kind"], localConcurrency: number, toJob: (data: never) => Job) =>
    boss.work(QUEUE[kind], { localConcurrency, includeMetadata: true, ...polling }, async ([job]) => {
      await runJob(db, deps, queue, toJob(job.data as never), job.retryCount >= job.retryLimit);
    });
  await work("enrich", ENRICH_CONCURRENCY, ({ bookId }: { bookId: string }) => ({ kind: "enrich", bookId }));
  await work("embed", ENRICH_CONCURRENCY, (target: Extract<Job, { kind: "embed" }>["target"]) => ({ kind: "embed", target }));
  // Serial: a burst of finishes (a backfill) queues rather than running in parallel.
  await work("connections", 1, ({ userId, bookId }: { userId: string; bookId: string }) => ({ kind: "connections", userId, bookId }));
  return { queue, stop: () => boss.stop({ graceful: true }) };
}
