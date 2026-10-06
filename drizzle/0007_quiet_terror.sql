ALTER TABLE "enrichment" ALTER COLUMN "model" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "enrichment" ALTER COLUMN "prompt_version" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "enrichment" ADD COLUMN "requested_at" timestamp with time zone;