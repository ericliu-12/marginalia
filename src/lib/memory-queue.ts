import type { Db } from "@/db/client";
import { RETRIES, jobGaveUp, jobKey, runJob, type Job, type JobDeps, type JobQueue } from "@/domain/pipeline";

const sameJob = (p: Job, q: Job) => p.kind === q.kind && jobKey(p) === jobKey(q);

// In-memory job queue: holds what is sent until `drain` runs it, coalescing by job key, retrying a
// failed job up to its limit and then giving up on it, as pg-boss does. `down` makes every call fail.
export function memoryQueue(db: Db): JobQueue & { sent: Job[]; cancelled: Job[]; down: boolean; drain(deps: JobDeps): Promise<void> } {
  const waiting: { job: Job; attempt: number }[] = [];
  let running: { job: Job; cancelled: boolean } | undefined;
  const queue = {
    sent: [] as Job[],
    cancelled: [] as Job[],
    down: false,
    async send(job: Job) {
      if (queue.down) throw new Error("queue down");
      queue.sent.push(job);
      if (!waiting.some((w) => sameJob(w.job, job))) waiting.push({ job, attempt: 0 });
    },
    async cancel(job: Job) {
      if (queue.down) throw new Error("queue down");
      queue.cancelled.push(job);
      for (let i = waiting.length - 1; i >= 0; i--) if (sameJob(waiting[i].job, job)) waiting.splice(i, 1);
      if (running && sameJob(running.job, job)) running.cancelled = true;
    },
    // Runs every waiting job, and the jobs they send, until none is left.
    async drain(deps: JobDeps) {
      for (let next = waiting.shift(); next; next = waiting.shift()) {
        const { job, attempt } = next;
        running = { job, cancelled: false };
        try {
          await runJob(db, deps, queue, job);
        } catch {
          if (running.cancelled) continue;
          if (attempt < RETRIES[job.kind]) waiting.push({ job, attempt: attempt + 1 });
          else await jobGaveUp(db, queue, job);
        } finally {
          running = undefined;
        }
      }
    },
  };
  return queue;
}
