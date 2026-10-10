ALTER TABLE "book" DROP CONSTRAINT "book_created_by_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "book_position" DROP CONSTRAINT "book_position_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "cluster_label" DROP CONSTRAINT "cluster_label_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "connection" DROP CONSTRAINT "connection_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "connection_run" DROP CONSTRAINT "connection_run_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "library_entry" DROP CONSTRAINT "library_entry_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "note" DROP CONSTRAINT "note_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "read_through" DROP CONSTRAINT "read_through_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "book" ADD CONSTRAINT "book_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_position" ADD CONSTRAINT "book_position_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cluster_label" ADD CONSTRAINT "cluster_label_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection" ADD CONSTRAINT "connection_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_run" ADD CONSTRAINT "connection_run_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_entry" ADD CONSTRAINT "library_entry_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note" ADD CONSTRAINT "note_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "read_through" ADD CONSTRAINT "read_through_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;