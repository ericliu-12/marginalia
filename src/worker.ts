import { startProductionWorker } from "@/lib/production-worker";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set.");

const worker = await startProductionWorker(connectionString);
console.log("Marginalia worker running");

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await worker.stop();
    process.exit(0);
  });
}
