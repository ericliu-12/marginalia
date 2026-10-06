import { appDb } from "@/db/client";
import { getSeededUserId } from "@/db/seed";
import { backfillConnections } from "@/domain/connections";
import { appPipeline } from "@/lib/jobs";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");

// One-off: Books marked Already read before the Connections pipeline existed had their first
// completion with nothing listening. This queues them, oldest finish first, for the worker
// (`pnpm worker`) to run one at a time.
const db = appDb();
const queued = await backfillConnections(db, appPipeline(db), await getSeededUserId(db));
console.log(`Queued Connections for ${queued} Finished Books; the worker (pnpm worker) runs them.`);
process.exit(0);
