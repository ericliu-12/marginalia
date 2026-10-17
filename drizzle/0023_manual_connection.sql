CREATE TYPE "public"."made_by" AS ENUM('judge', 'reader');--> statement-breakpoint
ALTER TABLE "connection" ALTER COLUMN "type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "connection" ALTER COLUMN "similarity" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "connection" ALTER COLUMN "similarity_model" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "connection" ALTER COLUMN "grounding" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "connection" ALTER COLUMN "model" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "connection" ALTER COLUMN "prompt_version" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "connection" ADD COLUMN "made_by" "made_by" DEFAULT 'judge' NOT NULL;