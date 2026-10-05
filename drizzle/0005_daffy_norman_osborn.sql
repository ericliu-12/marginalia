CREATE TABLE "connection_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"library_entry_id" uuid NOT NULL,
	"candidate_count" integer NOT NULL,
	"connection_count" integer NOT NULL,
	"model" text,
	"prompt_version" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "connection_run" ADD CONSTRAINT "connection_run_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_run" ADD CONSTRAINT "connection_run_library_entry_id_library_entry_id_fk" FOREIGN KEY ("library_entry_id") REFERENCES "public"."library_entry"("id") ON DELETE cascade ON UPDATE no action;