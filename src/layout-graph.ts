import { appDb } from "@/db/client";
import { user } from "@/db/schema";
import { layoutGraph } from "@/domain/graph";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");

// One-off: Connections found before the graph existed were never laid out. Lays every Reader's graph
// out now; after this the worker does it after every Connections job.
const db = appDb();
for (const { id } of await db.select({ id: user.id }).from(user)) await layoutGraph(db, id);
console.log("Laid out the graphs.");
process.exit(0);
