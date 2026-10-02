import { createDb } from "@/db/client";
import { descriptionGateway } from "@/lib/book-search";
import { claudeEnricher } from "@/lib/claude";
import { startWorker } from "@/lib/jobs";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set.");

const { db, pool } = createDb(connectionString);
const worker = await startWorker({ connectionString, db, model: claudeEnricher(), descriptions: descriptionGateway() });
console.log("Marginalia worker running");

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await worker.stop();
    await pool.end();
    process.exit(0);
  });
}
