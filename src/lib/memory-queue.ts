import type { Db } from "@/db/client";
import { RETRIES, jobKey, runJob, type Job, type JobDeps, type JobQueue } from "@/domain/pipeline";

// In-memory job queue: holds what is sent until `drain` runs it, coalescing by job key and retrying
// a failed job up to its limit, as pg-boss does. `down` makes every send fail.
export function memoryQueue(db: Db): JobQueue & { sent: Job[]; down: boolean; drain(deps: JobDeps): Promise<void> } {
  const waiting: { job: Job; attempt: number }[] = [];
  const queue = {
    sent: [] as Job[],
    down: false,
    async send(job: Job) {
      if (queue.down) throw new Error("queue down");
      queue.sent.push(job);
      if (!waiting.some((w) => jobKey(w.job) === jobKey(job))) waiting.push({ job, attempt: 0 });
    },
    // Runs every waiting job, and the jobs they send, until none is left.
    async drain(deps: JobDeps) {
      for (let next = waiting.shift(); next; next = waiting.shift()) {
        const { job, attempt } = next;
        const final = attempt >= RETRIES[job.kind];
        try {
          await runJob(db, deps, queue, job, final);
        } catch {
          if (!final) waiting.push({ job, attempt: attempt + 1 });
        }
      }
    },
  };
  return queue;
}
