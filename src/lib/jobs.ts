import { PgBoss } from "pg-boss";
import type { Db } from "@/db/client";
import { createPipeline, RETRIES, jobGaveUp, jobKey, dropIfReaderGone, runJob, type Job, type JobDeps, type JobQueue } from "@/domain/pipeline";
import { readPause } from "@/domain/spend";

// pg-boss queue names, and the data each job carries, are kept as they were before the Pipeline so
// jobs already waiting still run. Enrich and embed jobs queued before they carried a Reader have none.
const QUEUE: Record<Job["kind"], string> = { enrich: "enrich-book", embed: "embed", connections: "connections", graph: "layout" };
// Where pg-boss puts a copy of a job it has given up on: its last attempt failed, or it expired.
const GAVE_UP: Record<Job["kind"], string> = Object.fromEntries(
  Object.entries(QUEUE).map(([kind, name]) => [kind, `${name}-gave-up`]),
) as Record<Job["kind"], string>;
const EMBED_RETRY = { retryLimit: RETRIES.embed, retryDelay: 20, retryBackoff: true, retryDelayMax: 300 };
// A running job's worker checks in this often (pg-boss does it while the handler runs); a job whose
// worker has stopped checking in (crashed, or killed) expires and is retried, or given up on.
const HEARTBEAT_SECONDS = 30;
const ENRICH_CONCURRENCY = 3;
// While this month's spend is at the budget, a job is put back to be looked at again this much later.
const PAUSED_RECHECK_SECONDS = 30 * 60;
const KINDS = Object.keys(QUEUE) as Job["kind"][];
// pg-boss claims a higher priority first. What a Reader does in the app runs ahead of the backfill and
// seed scripts, so one Reader's backfill never holds up another's add or Refresh. A job sent while
// running another (an Enrichment's vector, a resumed Connections run, the graph) takes that job's priority.
const PRIORITY = { direct: 1, bulk: 0 };

const dataOf = (job: Job): object =>
  job.kind === "enrich"
    ? { bookId: job.bookId, userId: job.userId }
    : job.kind === "embed"
      ? { ...job.target, userId: job.userId }
      : job.kind === "graph"
        ? { userId: job.userId }
        : { userId: job.userId, bookId: job.bookId };

async function ensureQueues(boss: PgBoss) {
  for (const kind of KINDS) await boss.createQueue(GAVE_UP[kind], { retryLimit: 2, retryDelay: 10 });
  const expiry = (kind: Job["kind"]) => ({ deadLetter: GAVE_UP[kind], heartbeatSeconds: HEARTBEAT_SECONDS });
  // `short`: at most one waiting job per key (a double add or "Try again" coalesces), while one sent
  // during a running job still queues behind it.
  await boss.createQueue(QUEUE.enrich, { policy: "short", retryLimit: RETRIES.enrich, retryDelay: 5, retryBackoff: true, ...expiry("enrich") });
  // Voyage rate limits (429) need minutes, not seconds, to clear: 20s, 40s, 80s... capped at 5 minutes.
  await boss.createQueue(QUEUE.embed, { policy: "short", ...EMBED_RETRY, ...expiry("embed") });
  // Jobs run one at a time (see startWorker), in the order queued.
  await boss.createQueue(QUEUE.connections, {
    policy: "short",
    retryLimit: RETRIES.connections,
    retryDelay: 10,
    retryBackoff: true,
    ...expiry("connections"),
  });
  // One waiting graph job per reader: a burst of Connections jobs, removals or dismissals recomputes
  // Clusters and lays the graph out once more, not once each.
  await boss.createQueue(QUEUE.graph, { policy: "short", retryLimit: RETRIES.graph, retryDelay: 10, ...expiry("graph") });
  // createQueue leaves an existing queue as it was; keep its retry and expiry settings current.
  await boss.updateQueue(QUEUE.embed, EMBED_RETRY);
  for (const kind of KINDS) await boss.updateQueue(QUEUE[kind], expiry(kind));
}

const LIVE = new Set(["created", "retry", "active"]);

function queueFor(boss: PgBoss, priority: number): JobQueue {
  return {
    async send(job) {
      await boss.send(QUEUE[job.kind], dataOf(job), { singletonKey: jobKey(job), priority });
    },
    // A cancelled job is never retried or given up on. A running one's heartbeat finds it cancelled. A
    // copy already given up on (it keeps the key) is cancelled too, so it can't settle a newer job's work.
    async cancel(job) {
      for (const name of [QUEUE[job.kind], GAVE_UP[job.kind]]) {
        const live = (await boss.findJobs(name, { key: jobKey(job) })).filter((j) => LIVE.has(j.state));
        if (live.length) await boss.cancel(name, live.map((j) => j.id));
      }
    },
  };
}

let shared: Promise<PgBoss> | undefined;

// The web app's producer: sends jobs, never runs them or the queue's maintenance. Connects on the
// first send; a send while pg-boss is unreachable throws, and the next one tries again.
const sharedBoss = () => {
  shared ??= (async () => {
    const boss = new PgBoss({ connectionString: process.env.DATABASE_URL!, supervise: false, schedule: false });
    boss.on("error", (err) => console.error(err));
    await boss.start();
    await ensureQueues(boss);
    return boss;
  })();
  shared.catch(() => (shared = undefined));
  return shared;
};

const sharedQueue = (priority: number): JobQueue => ({
  send: async (job) => queueFor(await sharedBoss(), priority).send(job),
  cancel: async (job) => queueFor(await sharedBoss(), priority).cancel(job),
});

export const appJobQueue = sharedQueue(PRIORITY.direct);
export const appPipeline = (db: Db) => createPipeline(db, appJobQueue);
// The backfill and seed scripts' producer.
export const bulkJobQueue = sharedQueue(PRIORITY.bulk);
export const bulkPipeline = (db: Db) => createPipeline(db, bulkJobQueue);

export type WorkerOptions = JobDeps & {
  connectionString: string;
  db: Db;
  // This month's spend on everyone, in dollars, at which every job waits (each may pay for a model call);
  // none by default. A job a Reader caused also waits while that Reader is at their own budget.
  budgetUsd?: number | null;
  pollingIntervalSeconds?: number;
  pausedRecheckSeconds?: number;
};

// The long-running worker: owns queue maintenance and runs every job. Returns the queue it serves (at
// direct-action priority, and at the scripts'), and a way to stop it.
export async function startWorker(options: WorkerOptions) {
  const { connectionString, db, budgetUsd = null, pollingIntervalSeconds, pausedRecheckSeconds = PAUSED_RECHECK_SECONDS, ...deps } = options;
  const boss = new PgBoss({ connectionString });
  boss.on("error", (err) => console.error(err));
  await boss.start();
  await ensureQueues(boss);
  const queue = queueFor(boss, PRIORITY.direct);
  const polling = pollingIntervalSeconds && { pollingIntervalSeconds };
  // Each queue, and the queue of the jobs it gave up on. Over budget (everyone's, or its Reader's), a job
  // is sent again for later instead of run, so it uses up none of its attempts however long the month has
  // left; one whose Reader is gone is dropped instead (see dropIfReaderGone).
  const work = async (kind: Job["kind"], localConcurrency: number, toJob: (data: never) => Job) => {
    await boss.work(QUEUE[kind], { localConcurrency, includeMetadata: true, ...polling }, async ([job]) => {
      const next = toJob(job.data as never);
      const followOn = queueFor(boss, job.priority);
      if (await dropIfReaderGone(db, followOn, next)) return;
      if (await readPause(db, next.userId ?? null, { globalBudgetUsd: budgetUsd })) {
        await boss.send(QUEUE[kind], dataOf(next), { singletonKey: jobKey(next), startAfter: pausedRecheckSeconds, priority: job.priority });
        return;
      }
      await runJob(db, deps, followOn, next);
    });
    await boss.work(GAVE_UP[kind], { includeMetadata: true, ...polling }, async ([job]) =>
      jobGaveUp(db, queueFor(boss, job.priority), toJob(job.data as never)),
    );
  };
  await work("enrich", ENRICH_CONCURRENCY, ({ bookId, userId }: { bookId: string; userId?: string }) => ({ kind: "enrich", bookId, userId }));
  await work("embed", ENRICH_CONCURRENCY, ({ userId, ...target }: Extract<Job, { kind: "embed" }>["target"] & { userId?: string }) => ({
    kind: "embed",
    target,
    userId,
  }));
  // Serial: a burst of finishes (a backfill) queues rather than running in parallel.
  await work("connections", 1, ({ userId, bookId }: { userId: string; bookId: string }) => ({ kind: "connections", userId, bookId }));
  await work("graph", 1, ({ userId }: { userId: string }) => ({ kind: "graph", userId }));
  return { queue, bulkQueue: queueFor(boss, PRIORITY.bulk), stop: () => boss.stop({ graceful: true }) };
}
