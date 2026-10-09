import { createDb } from "@/db/client";
import { monthlyBudgetUsd, spendLog } from "@/domain/spend";
import { descriptionGateway } from "./book-search";
import { claudeClusterNamer, claudeEnricher, claudeJudge } from "./claude";
import { startWorker } from "./jobs";
import { voyageEmbedder } from "./voyage";

// The worker exactly as `pnpm worker` runs it: real clients, built from the environment, and no
// test overrides. Kept out of worker.ts so a test can start it.
export async function startProductionWorker(connectionString: string) {
  const { db, pool } = createDb(connectionString);
  const spend = spendLog(db);
  try {
    const worker = await startWorker({
      connectionString,
      db,
      budgetUsd: monthlyBudgetUsd(),
      model: claudeEnricher(undefined, spend),
      judge: claudeJudge(undefined, spend),
      embedder: voyageEmbedder(undefined, undefined, spend),
      descriptions: descriptionGateway(),
      namer: claudeClusterNamer(undefined, spend),
    });
    return {
      queue: worker.queue,
      async stop() {
        await worker.stop();
        await pool.end();
      },
    };
  } catch (err) {
    await pool.end();
    throw err;
  }
}
