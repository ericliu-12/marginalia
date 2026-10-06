ALTER TABLE "connection_run" ADD COLUMN "without_enrichment" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "note" ADD COLUMN "embed_failed_at" timestamp with time zone;--> statement-breakpoint
-- Notes left without a vector before this column existed count as given up, so they do not hold
-- Connections back; `pnpm embed:backfill` embeds them.
UPDATE "note" SET "embed_failed_at" = now() WHERE "embedding" IS NULL;
