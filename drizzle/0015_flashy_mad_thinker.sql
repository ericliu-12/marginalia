ALTER TABLE "enrichment" ADD COLUMN "google_books_volume_id" text;--> statement-breakpoint
-- Enrichments made before #44 were grounded in their Book's Google Books description when it had a volume.
UPDATE "enrichment" e SET "google_books_volume_id" = b."google_books_volume_id"
FROM "book" b WHERE b."id" = e."book_id" AND b."google_books_volume_id" IS NOT NULL;--> statement-breakpoint
-- The description hash now covers only stored descriptions, and a Book with a volume stores none
-- that is read, so its up-to-date Enrichment hashes '' (as it will once #44's follow-up clears them).
UPDATE "enrichment" e SET "description_hash" = encode(sha256(''::bytea), 'hex')
FROM "book" b WHERE b."id" = e."book_id" AND b."google_books_volume_id" IS NOT NULL AND b."description" IS NOT NULL
  AND e."description_hash" = encode(sha256(convert_to(b."description", 'UTF8')), 'hex');
