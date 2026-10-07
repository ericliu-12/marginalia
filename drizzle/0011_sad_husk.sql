ALTER TABLE "cluster_label" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "cluster_label" ADD COLUMN "input_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "cluster_label" ADD COLUMN "output_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "cluster_label" ADD COLUMN "cost_usd" double precision DEFAULT 0 NOT NULL;