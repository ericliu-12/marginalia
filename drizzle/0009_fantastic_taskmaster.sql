CREATE TABLE "book_position" (
	"library_entry_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"x" double precision NOT NULL,
	"y" double precision NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "book_position" ADD CONSTRAINT "book_position_library_entry_id_library_entry_id_fk" FOREIGN KEY ("library_entry_id") REFERENCES "public"."library_entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_position" ADD CONSTRAINT "book_position_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;