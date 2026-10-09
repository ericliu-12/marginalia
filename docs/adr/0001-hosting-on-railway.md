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

- **Railway, one project, four services, set in each service's dashboard settings.** No config files: Railway's Config as Code (`railway.json`) is deprecated and stops working on 2026-12-01, and its replacement, Infrastructure as Code (`.railway/railway.ts`), has no cron schedule, restart policy, watch paths or Dockerfile build in its reference, which the backup service needs. The settings below are the record; change them here when they change there. Empty means Railway's default.

  | Setting | web | worker | backup | postgres |
  |---|---|---|---|---|
  | Source | GitHub `ericliu-12/marginalia`, `main` | same | same | Docker image `pgvector/pgvector:pg17` |
  | Builder | Railpack | Railpack | Dockerfile, chosen by `RAILWAY_DOCKERFILE_PATH=backup/Dockerfile` | — |
  | Build command | `pnpm build` | `echo The worker runs from source with tsx` | — | — |
  | Pre-deploy command | `pnpm db:deploy` | — | — | — |
  | Start command | `pnpm start` | `pnpm worker` | — (the Dockerfile's `CMD`) | — |
  | Cron schedule | — | — | `0 3 * * *` (03:00 UTC) | — |
  | Watch paths | — | — | `/backup/**` | — |
  | Healthcheck path | `/login` | — | — | — |
  | Restart policy | On failure, 5 retries | Always | Never | On failure, 5 retries |
  | Volume | — | — | — | `/var/lib/postgresql/data` |
  | Networking | `inkmarginalia.com` (custom domain, port 8080), plus Railway's `web-production-fd25da.up.railway.app` | private only | private only | private only, no TCP proxy |

  **The domain** is `https://inkmarginalia.com` (#54). Its DNS is at Cloudflare, DNS-only (not proxied), so Railway's edge issues the certificate. Nothing in the app names a host: the manifest and redirects are relative, Server Actions check the request's own host, and the session cookie sets no `domain`, so it belongs to whichever host signed in. Every request on the Railway domain gets a 308 to the same path on `https://inkmarginalia.com` (#60), so nobody signs in there. Anything that needs an absolute origin (auth callbacks, #45) uses `https://inkmarginalia.com`.

  `pnpm db:deploy` runs the migrations, then the seed, which only creates the one reader if missing, so a failing migration stops the deploy. The postgres service also sets `PGDATA=/var/lib/postgresql/data/pgdata`, since the volume's root holds `lost+found`; it is the same image as `docker-compose.yml`.

  web, worker and backup reach it by reference, with the password kept out of the URL (it holds characters a URL would need escaped): `DATABASE_URL=postgresql://${{postgres.POSTGRES_USER}}@${{postgres.RAILWAY_PRIVATE_DOMAIN}}:5432/${{postgres.POSTGRES_DB}}` and `PGPASSWORD=${{postgres.POSTGRES_PASSWORD}}`, which node-postgres, pg-boss and pg_dump all read when the URL has none. web and worker also take `MONTHLY_AI_BUDGET_USD=8`; web takes Better Auth's `BETTER_AUTH_URL=https://inkmarginalia.com`, `BETTER_AUTH_SECRET` and `RESEND_API_KEY`, and `SIGNUP_MODE` when signup opens (#45); backup takes `R2_BUCKET=marginalia-backups` and `RAILWAY_DOCKERFILE_PATH`.
- **Keep pg-boss.**
- **The gate**: `APP_PASSWORD` and `SESSION_SECRET` (at least 32 characters). A signed, HttpOnly cookie lasts 90 days and is renewed daily as the app is used, so the iPhone home-screen app stays signed in. Five wrong passwords from one address, or fifty overall, stop sign-in for fifteen minutes. In production, a missing or short value lets no one in.
- **Spend**: every Claude and Voyage call is logged in `paid_call` at list price. At `MONTHLY_AI_BUDGET_USD` ($8) for the UTC month, the worker holds every job (re-queued every 30 minutes, using up no attempts) and the app says so by the wordmark. Hard caps sit outside the app: an Anthropic workspace limit of $10, a Railway hard limit of $15, a Google Books key restricted to that API with a lowered daily quota. Voyage has no spending cap; its key is kept apart from development's.

## Backups

One layer: a **nightly `pg_dump` to Cloudflare R2**, off Railway, so even a lost Railway account leaves the data. `backup/backup.sh` writes a custom-format dump of the whole database (the app's tables, pgvector, and pg-boss's queue), checks it reads back, and uploads it as `marginalia/<UTC time>.dump`. A bucket lifecycle rule deletes dumps after 30 days. The first one landed on 2026-10-09.

Railway's volume backups were the planned second layer, for quick "undo yesterday" restores, but they need the Pro plan ($20 a month against Hobby's $5). At one reader's scale the nightly dump covers it: a restore loses at most the day since 03:00 UTC.

### Restoring a dump

Restore into a new database beside the live one, check it, then point the services at it. The old database stays as it was until the new one is proven.

1. Download the dump from the R2 dashboard (bucket, `marginalia/`, the newest file), or:
   `aws s3 cp s3://<bucket>/marginalia/<file>.dump . --endpoint-url https://<account id>.r2.cloudflarestorage.com --region auto`
2. Stop the worker so nothing writes during the switch: in Railway, the worker service, its active deployment, "Remove".
3. Turn on the postgres service's TCP proxy (Settings → Networking) and note its host and port. In your shell, set `PG=postgresql://marginalia@<proxy host>:<proxy port>` and put the password in `PGPASSWORD` without echoing it (`read -s PGPASSWORD; export PGPASSWORD`, then paste `POSTGRES_PASSWORD` from the postgres service's variables). The password stays out of the URL, as it does for the services. Use pg 17 tools (`brew install postgresql@17`, or `docker run --rm -it -e PGPASSWORD postgres:17-alpine`).
4. `psql "$PG/marginalia" -c 'CREATE DATABASE marginalia_restored'`
5. `pg_restore --no-owner --no-privileges --exit-on-error --dbname="$PG/marginalia_restored" <file>.dump`
6. Check it: `psql "$PG/marginalia_restored" -c 'select count(*) from book' -c 'select count(*) from note' -c 'select count(*) from connection'`, and compare with what the app showed.
7. In Railway, change the database name at the end of `DATABASE_URL` from `/${{postgres.POSTGRES_DB}}` to `/marginalia_restored` on web, worker and backup, and deploy each. Redeploying the worker starts it again.
8. Turn the TCP proxy off again. Drop the old database once the restored one has run for a while.

### Practice restore

The dumps are only worth having if one restores. Now and then (after a schema change, say), do steps 1 and 4–6 against the local docker-compose database instead of production: `PG=postgresql://marginalia@localhost:5433` with `PGPASSWORD=marginalia`, and the newest dump from R2. Then drop `marginalia_restored`. This was first done when the backup was added: every table's count, the embeddings, pg-boss's jobs and the pgvector version came back.

## Consequences

- One vendor and one bill, with a hard cap at every layer.
- A single backup layer, a day apart: a restore can lose up to a day's Notes and Books. Revisit (Railway Pro's volume backups, or a more frequent dump) when the data or the readers grow.
- Migrations run before the web deploy, but the worker deploys from the same commit at the same time, so a migration that the old worker can't run against needs the worker stopped first.
- The sign-in limit lives in the web process's memory; a restart forgets it.
- Opening the app to other readers (#45) reopens this: real accounts, per-reader spend, and Voyage's lack of a cap.
