CREATE TABLE "graph_job" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"request" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "enrichment" ADD COLUMN "embed_failed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "graph_job" ADD CONSTRAINT "graph_job_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;