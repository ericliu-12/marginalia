ALTER TABLE "paid_call" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "paid_call" ADD CONSTRAINT "paid_call_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "paid_call_user_id_created_at_idx" ON "paid_call" USING btree ("user_id","created_at");