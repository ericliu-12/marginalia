import { appDb } from "@/db/client";
import { backfillEmbeddings } from "@/domain/embeddings";
import { bulkJobQueue } from "@/lib/jobs";
import { MODELS } from "@/lib/models";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");

const queued = await backfillEmbeddings(appDb(), bulkJobQueue, MODELS.embedding);
console.log(`Queued ${queued} embed jobs; the worker (pnpm worker) runs them.`);
process.exit(0);
