ALTER TABLE "cluster_label" ADD COLUMN "wash" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Clusters formed before washes had one each, oldest first, as a new Cluster would take them (6 is WASH_COUNT).
UPDATE "cluster_label" SET "wash" = ranked.n % 6 FROM (
  SELECT "id", (row_number() OVER (PARTITION BY "user_id" ORDER BY "created_at", "id") - 1)::int AS n FROM "cluster_label"
) AS ranked WHERE "cluster_label"."id" = ranked."id";
