ALTER TABLE "enrichment" ADD COLUMN "metadata_hash" text;--> statement-breakpoint
ALTER TABLE "enrichment" ADD COLUMN "input_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "enrichment" ADD COLUMN "output_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "enrichment" ADD COLUMN "cost_usd" double precision DEFAULT 0 NOT NULL;