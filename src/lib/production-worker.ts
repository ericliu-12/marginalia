import { createDb } from "@/db/client";
import { descriptionGateway } from "./book-search";
import { claudeEnricher } from "./claude";
import { startWorker } from "./jobs";
import { voyageEmbedder } from "./voyage";

// The worker exactly as `pnpm worker` runs it: real clients, built from the environment, and no
// test overrides. Kept out of worker.ts so a test can start it.
export async function startProductionWorker(connectionString: string) {
  const { db, pool } = createDb(connectionString);
  try {
    const worker = await startWorker({
      connectionString,
      db,
      model: claudeEnricher(),
      embedder: voyageEmbedder(),
      descriptions: descriptionGateway(),
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
