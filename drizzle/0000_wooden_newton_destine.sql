CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TYPE "public"."connection_type" AS ENUM('thematic', 'contrast', 'context');--> statement-breakpoint
CREATE TYPE "public"."connections_status" AS ENUM('idle', 'running', 'failed');--> statement-breakpoint
CREATE TYPE "public"."enrichment_status" AS ENUM('pending', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."grounding" AS ENUM('notes', 'enrichment');--> statement-breakpoint
CREATE TYPE "public"."status" AS ENUM('want', 'reading', 'read');--> statement-breakpoint
CREATE TYPE "public"."strength" AS ENUM('strong', 'moderate');--> statement-breakpoint
CREATE TABLE "book" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"authors" text[] DEFAULT '{}'::text[] NOT NULL,
	"first_published_year" integer,
	"cover_url" text,
	"open_library_work_key" text,
	"google_books_volume_id" text,
	"created_by_user_id" uuid,
	"snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "book_open_library_work_key_unique" UNIQUE("open_library_work_key")
);
--> statement-breakpoint
CREATE TABLE "cluster_label" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text,
	"description" text,
	"member_book_ids" uuid[] NOT NULL,
	"prompt_version" text,
	"named_member_book_ids" uuid[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"book_a_id" uuid NOT NULL,
	"book_b_id" uuid NOT NULL,
	"type" "connection_type" NOT NULL,
	"strength" "strength" NOT NULL,
	"similarity" double precision NOT NULL,
	"similarity_model" text NOT NULL,
	"explanation" text NOT NULL,
	"grounding" "grounding" NOT NULL,
	"quoted_note_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connection_ordered_pair" CHECK ("connection"."book_a_id" < "connection"."book_b_id")
);
--> statement-breakpoint
CREATE TABLE "enrichment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"recognised" boolean DEFAULT false NOT NULL,
	"summary" text,
	"themes" text[],
	"embedding" vector(1024),
	"description_hash" text,
	"believed_author" text,
	"believed_first_published_year" integer,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"status" "enrichment_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enrichment_book_id_unique" UNIQUE("book_id")
);
--> statement-breakpoint
CREATE TABLE "library_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"book_id" uuid NOT NULL,
	"status" "status" NOT NULL,
	"connections_status" "connections_status" DEFAULT 'idle' NOT NULL,
	"connections_generated_at" timestamp with time zone,
	"title_override" text,
	"author_override" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "note" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"library_entry_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"body" text NOT NULL,
	"quote" text,
	"page" integer,
	"embedding" vector(1024),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "read_through" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"library_entry_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "book" ADD CONSTRAINT "book_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cluster_label" ADD CONSTRAINT "cluster_label_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection" ADD CONSTRAINT "connection_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection" ADD CONSTRAINT "connection_book_a_id_book_id_fk" FOREIGN KEY ("book_a_id") REFERENCES "public"."book"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection" ADD CONSTRAINT "connection_book_b_id_book_id_fk" FOREIGN KEY ("book_b_id") REFERENCES "public"."book"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment" ADD CONSTRAINT "enrichment_book_id_book_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."book"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_entry" ADD CONSTRAINT "library_entry_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_entry" ADD CONSTRAINT "library_entry_book_id_book_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."book"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note" ADD CONSTRAINT "note_library_entry_id_library_entry_id_fk" FOREIGN KEY ("library_entry_id") REFERENCES "public"."library_entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note" ADD CONSTRAINT "note_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "read_through" ADD CONSTRAINT "read_through_library_entry_id_library_entry_id_fk" FOREIGN KEY ("library_entry_id") REFERENCES "public"."library_entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "read_through" ADD CONSTRAINT "read_through_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "book_created_by_idx" ON "book" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "connection_user_pair_idx" ON "connection" USING btree ("user_id","book_a_id","book_b_id");--> statement-breakpoint
CREATE INDEX "enrichment_embedding_idx" ON "enrichment" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "library_entry_user_book_idx" ON "library_entry" USING btree ("user_id","book_id");--> statement-breakpoint
CREATE INDEX "note_embedding_idx" ON "note" USING hnsw ("embedding" vector_cosine_ops);