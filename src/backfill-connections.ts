import { appDb } from "@/db/client";
import { user } from "@/db/schema";
import { backfillConnections } from "@/domain/connections";
import { appPipeline } from "@/lib/jobs";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");

// One-off: Books marked Already read before the Connections pipeline existed had their first
// completion with nothing listening. This queues them for every Reader, oldest finish first, for the
// worker (`pnpm worker`) to run one at a time.
const db = appDb();
let queued = 0;
for (const { id } of await db.select({ id: user.id }).from(user)) queued += await backfillConnections(db, appPipeline(db), id);
console.log(`Queued Connections for ${queued} Finished Books; the worker (pnpm worker) runs them.`);
process.exit(0);
