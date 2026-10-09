-- #44: Google's descriptions are no longer kept. Code since 0015 never reads one stored beside a volume,
-- so it is safe to clear while that code serves. The first two statements repeat 0015's for any Book
-- the older code enriched from its stored Google description during that deploy.
UPDATE "enrichment" e SET "google_books_volume_id" = b."google_books_volume_id"
FROM "book" b WHERE b."id" = e."book_id" AND b."google_books_volume_id" IS NOT NULL AND b."description" IS NOT NULL
  AND e."description_hash" = encode(sha256(convert_to(b."description", 'UTF8')), 'hex');--> statement-breakpoint
UPDATE "enrichment" e SET "description_hash" = encode(sha256(''::bytea), 'hex')
FROM "book" b WHERE b."id" = e."book_id" AND b."google_books_volume_id" IS NOT NULL AND b."description" IS NOT NULL
  AND e."description_hash" = encode(sha256(convert_to(b."description", 'UTF8')), 'hex');--> statement-breakpoint
UPDATE "book" SET "description" = NULL WHERE "google_books_volume_id" IS NOT NULL AND "description" IS NOT NULL;
