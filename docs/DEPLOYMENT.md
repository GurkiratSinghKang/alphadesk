# AlphaDesk Deployment

How to ship AlphaDesk to production (`tradingalpha.net`, Hetzner VPS
`87.99.143.65`).

## TL;DR

```
git push origin main       # triggers GHA workflow `Deploy AlphaDesk`
```

That's it for the normal path. The rest of this document is for when the
normal path doesn't work.

## Architecture overview

- **Source**: GitHub (`main` branch is the deploy branch).
- **CI/CD**: GitHub Actions (`.github/workflows/deploy.yml`) — builds
  frontend and backend images, pushes to GHCR, SSHs to the VPS, runs
  `docker compose up` + `alembic upgrade head`.
- **Host**: single Hetzner VPS, Ubuntu, Docker + docker-compose v2.
  Config lives in `/opt/alphadesk/`.
- **Edge**: Caddy 2 handles TLS (ACME) + reverse proxy. Caddyfile at
  `infrastructure/Caddyfile`.
- **Data**: TimescaleDB (pg16) + Redis 7. Both bind-mounted to
  `/var/lib/alphadesk/{timescaledb,redis}`.
- **Logs**: per-service Docker json-file driver, 50MB × 5 (~250MB/service).
  Caddy access logs persist to `/var/log/alphadesk/caddy` on the host.

## Pre-requisites

One-time setup on the VPS (already done for the prod host — documented
here for rebuild-from-zero or staging spin-up).

1. `/opt/alphadesk` exists and is owned by the `deploy` user.
2. `/opt/alphadesk/.env.prod` exists. Copy `.env.prod.example` from the
   repo root and fill in real values. Required vars:
   `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `STATUS_PASS_HASH`, `DOMAIN`,
   `PRODUCTION_ORIGIN`.
3. Data volume dirs exist and are writable by Docker:
   ```
   sudo mkdir -p /var/lib/alphadesk/{timescaledb,redis,pipeline_logs,backups}
   sudo mkdir -p /var/log/alphadesk/caddy
   ```
4. `rclone` is installed and the `hetzner-s3` (or configured) remote is
   set up via `rclone config` (used by `infrastructure/backup.sh` — it's
   now mandatory, see that script's header).
5. GitHub repo secrets are configured: `VPS_HOST`, `VPS_SSH_KEY`.
6. The `deploy` user can run `docker` without sudo.

## Deploy flow (forward)

The default path:

1. Merge to `main` (or `workflow_dispatch` with empty `image_sha`).
2. GHA job `test` runs frontend unit tests.
3. GHA job `build-and-deploy`:
   - Logs into GHCR as the GHA actor.
   - Builds and pushes `frontend` and `backend` images with both the
     short `${{ github.sha }}` tag AND `:latest`.
   - Syncs `docker-compose.yml` and `infrastructure/*` to
     `/opt/alphadesk` on the VPS.
   - SSHes to the VPS, sources `.env.prod`, `docker compose pull`
     `frontend backend`, `docker compose up -d --remove-orphans
     --force-recreate`.
   - Waits 15s for the backend healthcheck.
   - Runs `docker compose exec -T backend alembic upgrade head`
     (idempotent — a no-op when schema is current).
   - Hits `/readyz` — not `/health` — to confirm Postgres and Redis
     are reachable before claiming success.
   - `docker system prune -f --filter "until=24h"` to reclaim disk.

Every step is `set -e`-guarded; any failure leaves the previous
container stack running (because `--force-recreate` is only triggered
if the image pull succeeded) and halts the workflow with a red X.

## Manually triggering a deploy

From the GitHub UI:

1. **Actions** tab → **Deploy AlphaDesk**.
2. **Run workflow** → pick the branch → leave `image_sha` blank.

From the CLI:

```
gh workflow run deploy.yml --ref main
```

## Rolling back

See [ROLLBACK.md](./ROLLBACK.md).

## On-call playbook

See [RUNBOOK.md](./RUNBOOK.md).

## Going live (paper → real money)

**STOP.** Flipping live trading on moves real capital. An unchecked
mistake here will send orders against the account the Alpaca keys
belong to — there is no paper-safety net once these flags flip.

The system refuses to execute live orders unless ALL THREE of the
following are in agreement. The boot path audits every reject with
``event=live_gate_reject`` so you can confirm intent post-deploy.

1. **`.env.prod` must set `LIVE_TRADING_ENABLED=true`.**
   This is the operator's explicit consent. The compose file reads
   this via `${LIVE_TRADING_ENABLED:-false}` — the default when the
   variable is missing is `false` (paper). Add the line exactly:

       LIVE_TRADING_ENABLED=true

   Do NOT commit this value to git. `.env.prod` lives only on the
   VPS at `/opt/alphadesk/.env.prod` and is ignored by source
   control.

2. **`.env.prod` must set `ALPACA_BASE_URL` to the live endpoint.**

       ALPACA_BASE_URL=https://api.alpaca.markets

   The default `https://paper-api.alpaca.markets` accepts orders
   against the sandbox account and returns fake fills — safe but
   useless for real trading. The `LIVE_TRADING_ENABLED` flag and
   the base URL are BOTH checked by `core.trading_gate`; the
   moment they disagree (one says live, the other says paper),
   every order is rejected with `event=live_gate_reject` and
   `reason=flag_url_mismatch`.

3. **Postgres `halt_state.is_halted` must be `FALSE`.**
   The emergency kill-switch is durable in Postgres (see Wave 4P
   Fix 1 / migration 0007). If a prior incident halted trading
   and nobody called `POST /api/v1/trades/resume`, the halt
   survives restarts and live orders still reject with 503. Check
   and clear deliberately:

       docker compose exec -T timescaledb psql -U alphadesk -d alphadesk \
           -c 'SELECT id, is_halted, halted_at, halted_by, reason FROM halt_state;'

   If `is_halted` is `t`, call `POST /api/v1/trades/resume` as
   the admin user (the endpoint writes through the same
   audit_log as the halt event, so the ops trail is intact).

Post-flip verification steps:

    # 1. Confirm env is live
    docker compose exec -T backend python -c 'from core.config import settings; print("LIVE?", settings.LIVE_TRADING_ENABLED, "URL?", settings.ALPACA_BASE_URL)'

    # 2. Confirm halt is clear
    docker compose exec -T timescaledb psql -U alphadesk -d alphadesk \
        -c 'SELECT is_halted FROM halt_state WHERE id=1;'

    # 3. Submit a tiny paper-sized order through the API and verify
    #    the broker_order_id matches Alpaca's live account panel.

**If in doubt, keep `LIVE_TRADING_ENABLED=false`.** Switching back
to paper is a single env edit + `docker compose up -d backend`.
Reversing a live order requires a manual `POST /flatten_all` and
the associated cleanup, which is strictly harder.

## Local dev (not production)

Do not run the prod compose file locally. For local dev, use
`docker-compose.yml` (dev) at the repo root and `backend/.env.example`
for env vars. Live prod is at `https://tradingalpha.net` — avoid starting
backend instances that could race against it.
