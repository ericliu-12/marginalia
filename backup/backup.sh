#!/bin/sh
# Nightly backup: a custom-format pg_dump of the whole database (the app's tables and pg-boss's queue),
# checked readable, then uploaded to Cloudflare R2. R2 keeps 30 days of them (a lifecycle rule on the
# bucket). Restoring one is in docs/adr/0001-hosting-on-railway.md.
set -eu
: "${DATABASE_URL:?}" "${R2_ACCOUNT_ID:?}" "${R2_BUCKET:?}" "${AWS_ACCESS_KEY_ID:?}" "${AWS_SECRET_ACCESS_KEY:?}"
# R2 does not take the checksums newer AWS CLIs send by default.
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required

file=/tmp/marginalia.dump
key="marginalia/$(date -u +%Y-%m-%dT%H%M%SZ).dump"
pg_dump --format=custom --no-owner --no-privileges --file="$file" "$DATABASE_URL"
pg_restore --list "$file" > /dev/null
aws s3 cp "$file" "s3://$R2_BUCKET/$key" --endpoint-url "https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com" --region auto --only-show-errors
echo "Backed up $(wc -c < "$file") bytes to $key"
