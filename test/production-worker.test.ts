import { Pool } from "pg";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { startProductionWorker } from "../src/lib/production-worker";

// The worker as `pnpm worker` builds it, with no test overrides (no polling interval, real
// clients). Only the API keys are placeholders; nothing here calls Claude or Voyage.
describe("Production worker", () => {
  // Jobs another file's worker left behind would run here for real, calling Claude, Voyage and the
  // book APIs, and stopping would wait on those calls.
  beforeAll(async () => {
    const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    await pool.query(`DO $$ BEGIN IF to_regclass('pgboss.job') IS NOT NULL THEN DELETE FROM pgboss.job; END IF; END $$`);
    await pool.end();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("starts with its real production config, and stops", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("VOYAGE_API_KEY", "test-key");
    const worker = await startProductionWorker(process.env.TEST_DATABASE_URL!);
    await worker.stop();
  });

  it("fails to start, loudly, when a required API key is missing", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("VOYAGE_API_KEY", "");
    await expect(startProductionWorker(process.env.TEST_DATABASE_URL!)).rejects.toThrow(/VOYAGE_API_KEY/);
  });
});
