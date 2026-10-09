import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi, type TaskMeta } from "vitest";
import { startProductionWorker } from "../src/lib/production-worker";
import { readDbActivity, recordDbActivityOnFailure } from "./harness";

// Well inside the hook timeout, so a hung stop fails here, with what it was waiting on.
const STOP_TIMEOUT_MS = 3000;

// The worker as `pnpm worker` builds it, with no test overrides (no polling interval, real
// clients). Only the API keys are placeholders; nothing here calls Claude or Voyage.
describe("Production worker", () => {
  // It once failed intermittently with no diagnostics recorded (#51); a recurrence records what
  // pg-boss waited on.
  recordDbActivityOnFailure();
  // Jobs another file's worker left behind would run here for real, calling Claude, Voyage and the
  // book APIs, and stopping would wait on those calls. Before each test, after the recorder, so a
  // failure or hang here is recorded too.
  beforeEach(async () => {
    const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    try {
      await pool.query(`DO $$ BEGIN IF to_regclass('pgboss.job') IS NOT NULL THEN DELETE FROM pgboss.job; END IF; END $$`);
    } finally {
      await pool.end();
    }
  });
  afterEach(() => vi.unstubAllEnvs());

  it("starts with its real production config, and stops", async ({ task, onTestFinished }) => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("VOYAGE_API_KEY", "test-key");
    const worker = await startProductionWorker(process.env.TEST_DATABASE_URL!);
    onTestFinished(() => stopWithin(worker, task.meta));
  });

  it("fails to start, loudly, when a required API key is missing", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("VOYAGE_API_KEY", "");
    await expect(startProductionWorker(process.env.TEST_DATABASE_URL!)).rejects.toThrow(/VOYAGE_API_KEY/);
  });
});

// Stops the worker, or, past the timeout, records what the database was doing and ends the
// worker's sessions, so a hung stop can't leave it running into later files.
async function stopWithin(worker: { stop(): Promise<void> }, meta: TaskMeta) {
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<true>((resolve) => (timer = setTimeout(() => resolve(true), STOP_TIMEOUT_MS)));
  const stopped = worker.stop().then(() => false as const);
  const hung = await Promise.race([stopped, timedOut]);
  clearTimeout(timer);
  if (!hung) return;
  stopped.catch(() => {}); // it rejects once its sessions are ended below
  meta.dbActivity = await readDbActivity();
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  try {
    await pool.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()`);
  } finally {
    await pool.end();
  }
  throw new Error(`The worker didn't stop within ${STOP_TIMEOUT_MS}ms`);
}
