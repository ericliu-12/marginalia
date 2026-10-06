import { appDb } from "@/db/client";
import { getSeededUserId } from "@/db/seed";
import { layoutGraph } from "@/domain/graph";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");

// One-off: Connections found before the graph existed were never laid out. Lays the reader's graph
// out now; after this the worker does it after every Connections job.
const db = appDb();
await layoutGraph(db, await getSeededUserId(db));
console.log("Laid out the graph.");
process.exit(0);
