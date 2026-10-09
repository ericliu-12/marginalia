# Host the private deploy on Railway, keeping the pg-boss worker

Status: accepted, 2026-10-09 (#43)

## Context

Marginalia has three running parts: the Next app, the pg-boss worker (Enrichment, embeddings, Connections, the graph job), and Postgres with pgvector. The first deploy is private: one reader, behind a password. Opening it to others waits on #45.

Options weighed (October 2026 prices, one reader):

| Option | Monthly | Why not |
|---|---|---|
| **Railway Hobby, all three services in one project** | about $5–9 ($5 plan, $5 usage included) | chosen |
| Render (web $7, worker $7, Postgres $6 plus storage) | about $20 | twice the cost for the same shape |
| Vercel Hobby + Neon or Supabase + a worker host | $2–5 on free tiers, ~$30 paid | three vendors; the worker's polling keeps Neon's compute awake past its free 100 CU-hours (~$19 on Launch); Supabase free has no backups and pauses |
| Fly.io, Postgres run by hand | about $7–10 | backups and upgrades of Postgres are ours; managed Postgres is $38 |

A hosted queue (Inngest, Trigger.dev, QStash) calling serverless functions was also weighed. The Pipeline relies on pg-boss's per-key coalescing (`short` policy), heartbeats and expiry, dead-letter queues for jobs given up on, and cancelling by key. Rebuilding that on another queue saves about $5 a month.

## Decision

- **Railway, one project, four services**, each reading its config from the repo (set "Railway Config File" in each service's settings):
  - **web**: `railway/web.json`. Builds Next, runs `pnpm db:deploy` (migrations, then the idempotent seed of the one reader) before each deploy, so a failing migration stops the deploy. Health check on `/login`.
  - **worker**: `railway/worker.json`. No build step; `pnpm worker`, restarted always.
  - **backup**: `railway/backup.json`. A cron service, 03:00 UTC, built from `backup/Dockerfile`.
  - **postgres**: the `pgvector/pgvector:pg17` image, the same as `docker-compose.yml`, with a volume at `/var/lib/postgresql/data` and `PGDATA=/var/lib/postgresql/data/pgdata`. Reached only over Railway's private network; no public TCP proxy.
- **Keep pg-boss.**
- **The gate**: `APP_PASSWORD` and `SESSION_SECRET` (at least 32 characters). A signed, HttpOnly cookie lasts 90 days and is renewed daily as the app is used, so the iPhone home-screen app stays signed in. Five wrong passwords from one address, or fifty overall, stop sign-in for fifteen minutes. In production, a missing or short value lets no one in.
- **Spend**: every Claude and Voyage call is logged in `paid_call` at list price. At `MONTHLY_AI_BUDGET_USD` ($8) for the UTC month, the worker holds every job (re-queued every 30 minutes, using up no attempts) and the app says so by the wordmark. Hard caps sit outside the app: an Anthropic workspace limit of $10, a Railway hard limit of $15, a Google Books key restricted to that API with a lowered daily quota. Voyage has no spending cap; its key is kept apart from development's.

## Backups

Two layers:

1. **Railway volume backups** of the postgres service (Backups tab): daily kept 6 days, weekly kept a month, monthly kept 3 months. For "undo yesterday": pick a backup, Restore, deploy the staged change.
2. **Nightly `pg_dump` to Cloudflare R2**, off Railway, so a lost Railway account still leaves the data. `backup/backup.sh` writes a custom-format dump of the whole database (the app's tables, pgvector, and pg-boss's queue), checks it reads back, and uploads it as `marginalia/<UTC time>.dump`. A bucket lifecycle rule deletes dumps after 30 days.

### Restoring a dump

Restore into a new database beside the live one, check it, then point the services at it. The old database stays as it was until the new one is proven.

1. Download the dump from the R2 dashboard (bucket, `marginalia/`, the newest file), or:
   `aws s3 cp s3://<bucket>/marginalia/<file>.dump . --endpoint-url https://<account id>.r2.cloudflarestorage.com --region auto`
2. Stop the worker so nothing writes during the switch: in Railway, the worker service, its active deployment, "Remove".
3. Turn on the postgres service's TCP proxy (Settings → Networking) and copy its public connection URL into your shell as `PG` (it holds the password; don't paste it anywhere else). Use pg 17 tools (`brew install postgresql@17`, or `docker run --rm -it postgres:17-alpine`).
4. `psql "$PG" -c 'CREATE DATABASE marginalia_restored'`
5. `pg_restore --no-owner --no-privileges --exit-on-error --dbname="${PG%/*}/marginalia_restored" <file>.dump`
6. Check it: `psql "${PG%/*}/marginalia_restored" -c 'select count(*) from book' -c 'select count(*) from note' -c 'select count(*) from connection'`, and compare with what the app showed.
7. In Railway, change the database name at the end of `DATABASE_URL` from `/marginalia` to `/marginalia_restored` on web, worker and backup, and deploy each. Redeploying the worker starts it again.
8. Turn the TCP proxy off again. Drop the old database once the restored one has run for a while.

To practise without touching production, do steps 4–6 against the local docker-compose database (`postgres://marginalia:marginalia@localhost:5433`). This was done when the backup was added: every table's count, the embeddings, pg-boss's jobs and the pgvector version came back.

## Consequences

- One vendor and one bill, with a hard cap at every layer.
- Migrations run before the web deploy, but the worker deploys from the same commit at the same time, so a migration that the old worker can't run against needs the worker stopped first.
- The sign-in limit lives in the web process's memory; a restart forgets it.
- Opening the app to other readers (#45) reopens this: real accounts, per-reader spend, and Voyage's lack of a cap.
