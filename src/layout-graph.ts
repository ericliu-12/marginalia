import { appDb } from "@/db/client";
import { user } from "@/db/schema";
import { layoutGraph } from "@/domain/graph";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");

// One-off: lays every Reader's graph out anew, as the first time, for graphs crowded by placing Books
// one at a time among fixed ones (#130); after this the worker settles it after every Connections job.
const db = appDb();
for (const { id } of await db.select({ id: user.id }).from(user)) await layoutGraph(db, id, { fresh: true });
console.log("Laid out the graphs.");
process.exit(0);
