# Persona 14 — DevOps / Operator

**Date:** 2026-04-19
**Role:** I deploy, monitor, troubleshoot, back up, and rotate secrets. I don't trade.
**Live at:** https://tradingalpha.net (Hetzner VPS `87.99.143.65`, Ubuntu 24.04, 2GB/38GB)
**Live probe summary:** `uptime 9d 9h`, load 0.05, backend/db/redis all healthy, readyz=200, 5 containers, ~430MB RSS total.

---

## Walk-through vs the 10-area brief

### 1. Deploys — `.github/workflows/deploy.yml` (112 lines)
- **Trigger:** push to `main` or `workflow_dispatch`. Job graph is `test` (frontend vitest only — no backend pytest in CI) → `build-and-deploy`.
- **Build:** multi-stage buildx builds frontend + backend, pushes both to `ghcr.io/<repo>-{backend,frontend}:{sha,latest}`.
- **Sync + restart:** `scp` compose/infrastructure → VPS `/opt/alphadesk/`, `docker compose pull && up -d --remove-orphans --force-recreate`, `sleep 15`, `curl /health` gate, `docker system prune -f --filter until=24h`.
- **Strategy:** **rolling with downtime** — `--force-recreate` kills all containers simultaneously. No blue-green, no canary, no health-gated switch-over. Users see ~15–30s of 502/503.
- **Rollback:** none documented. Manual path is `docker compose up -d backend=ghcr.io/.../backend:<prev-sha>` but no scripted helper and no pin on the image tag inside compose (`latest` is used at default fallback).
- **Flakiness:** the deploy scp step fails silently if SSH key rotates — we've had config drift before (see deploy.yml:64–68 comment).

### 2. Monitoring — near-dark
- **/livez** + **/readyz** exist (backend/main.py:223/244) and return correct JSON. `/readyz` pings Postgres `SELECT 1` and Redis `PING`. **Nothing scrapes them** — no uptime-kuma (removed 2026-04-17), no Prometheus, no external monitor. The compose healthcheck still hits legacy `/health` every 30s — that's the only observer.
- **Logs:** JSON structured (Wave 18, `core.logging.configure_logging`), driver `json-file` with 50m×5=250MB/service cap, stays on the box. **No log aggregator** (Loki/CloudWatch/Datadog absent). To read yesterday's logs: `ssh` + `docker logs --since`. No query, no dashboard.
- **Metrics:** **none**. observability-audit-r4 P0 #1 flagged this explicitly — no `prometheus-client`, no `/metrics`, no RED counters, no business KPIs (trades/day, orders_rejected, strategy_runs). Flagged as follow-up; not yet implemented.
- **/status** dashboard: removed with uptime-kuma; now 404s.

### 3. Alerting — nothing
If the backend dies at 03:00, I find out when a user complains. No pager, no email alert, no Telegram hook (despite `python-telegram-bot` being a dep and `TELEGRAM_BOT_TOKEN` existing in env). No Sentry / Bugsnag / RUM for frontend errors either.

### 4. Backups
- **Timer active:** `alphadesk-backup.timer` next run Mon 2026-04-20 08:02 UTC. Last success Sun 2026-04-19 08:04 UTC. Local dumps at `/var/lib/alphadesk/backups/20260418-141938.sql.gz` (1.6KB) and `20260419-080431.sql.gz` (2.5KB). Retention 30d.
- **Off-box:** **NOT configured.** Live `rclone listremotes` returns empty; `rclone` config file does not exist. `backup.sh:108` logs `rclone remote 'hetzner-s3:alphadesk-backups' not configured — skipping offsite copy` every run. A box fire = data gone.
- **Restore test:** never performed. backup.sh has a `--test-db=URL` mode but no scheduled restore test. `pg_dump` emits `WARNING: circular foreign-key constraints` on `continuous_agg` — the dump may not restore cleanly without `--disable-triggers`.
- **Dump sizes 1.6–2.5 KB** are suspicious — implies schema-only or a near-empty DB despite 9 strategies + trade_ledger. Needs verification that the dump is actually complete.

### 5. Secrets
- `/opt/alphadesk/.env.prod`: `-rw-------  deploy deploy` (correct, 0600 landed).
- **Content:** JWT_SECRET, POSTGRES_PASSWORD, REDIS_PASSWORD, STATUS_PASS_HASH, ADMIN_PASSWORD_HASH, ALPACA_SECRET_KEY, ANTHROPIC_API_KEY (prefix now `sk-ant-...`), POLYGON_API_KEY.
- **Rotation:** manual only — `infrastructure/secrets-setup.md` walks the ops through each secret but there's no scheduled reminder and no automation. Anthropic key rotation was manual as of overnight sweep.
- **GH secrets:** only `VPS_HOST` + `VPS_SSH_KEY` are set — no prod/test boundary confusion because no test-env secrets exist. The trade-off is that the VPS key is effectively the master credential for the whole deploy surface.

### 6. Resource usage
- **CPU/RAM:** `docker stats` idle right now: backend 277MB/1.5G (18%), TSDB 49MB, Redis 5.6MB, frontend 71MB, Caddy 24MB. **Host RAM 1.3Gi / 1.9Gi used, swap 826MB / 2GB used** — the box swaps constantly even at idle. Any burst (pipeline batch + pg_dump) will page hard.
- **Disk:** `/` at **75% (27G/38G)**, `/var/lib/docker` dominates with 21.5 GB images (73% reclaimable = 15.8 GB of stale images). Three or four more deploys and we fill the disk.
- **OOM proximity:** sum of container `mem_limit` (1.5 + 1.875 + 0.64 + 0.5 + 0.256 = 4.77 GiB) vastly exceeds physical 1.9 GiB. Relies on swap.

### 7. CI secrets
- `gh secret list`: `VPS_HOST`, `VPS_SSH_KEY`. That's it. No `PROD_`/`TEST_` prefixes — also no leakage risk because there are no test-env secrets. Clean but minimal.

### 8. Caddy config — `infrastructure/Caddyfile` + live probe
- HSTS `max-age=31536000; includeSubDomains; preload` present. TLS auto-renews via Let's Encrypt (cert valid `Jul 9 2026`). HTTP/2 served, alt-svc advertises h3 but Caddy isn't configured with `protocols h1 h2 h3`.
- Security headers: X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy strict-origin, Permissions-Policy restrictive. CSP present but retains `'unsafe-inline'` for script-src + style-src (Next.js requirement — tracked as P2).
- No CAA DNS record yet (iter-4 user action #6 open).

### 9. Upgrades
- Python **3.12.13**, Node **22.22.2**, Next.js **16.2.2**, FastAPI 0.136, SQLAlchemy 2.0.49, anthropic 0.96, redis-py 6.4 — all current stable majors.
- **OS:** **49 apt packages upgradable**, **0 flagged security** (so no CVE backlog per `apt list --upgradable | grep security`), but running kernel `6.8.0-90-generic` with `6.8.0-107` installed — `/var/run/reboot-required` **exists**. Reboot has been pending since 2026-04-10.
- `pip audit` / `npm audit` are not part of CI.

### 10. Documentation
- **No RUNBOOK.md**, no on-call guide, no incident-response doc. `infrastructure/secrets-setup.md` + `vps-setup.sh` + `ssh-harden.sh` are the closest thing. No onboarding doc for a new operator — a handoff today would be pointing at the compose files + git history.

---

## Top 10 operational gaps (the 400-word summary)

1. **Off-box backups are dark.** `rclone` remote not configured; every nightly run logs "skipping offsite copy." A disk failure on the Hetzner VPS loses the DB. Configure `rclone config` against Hetzner Object Storage (or S3), verify the remote pushes, and add a weekly restore test.
2. **No alerting anywhere.** Backend can be down for hours before anyone notices. Add at minimum a 5-min external ping (UptimeRobot/BetterStack free tier) on `https://tradingalpha.net/readyz` with Telegram/email notify — project already has `python-telegram-bot` dependencies.
3. **No metrics / APM.** Zero `/metrics` endpoint, no Prometheus, no Sentry, no RUM. The only observable is `docker logs`. Add `prometheus-client` + `starlette-prometheus`, expose on loopback, and add Sentry for both backend unhandled exceptions and Next.js browser errors.
4. **Disk 75% full, 15.8 GB of reclaimable Docker images.** Three more deploys fills the disk and takes Postgres down with it. Run `docker image prune -a --filter until=7d` now; add a weekly systemd timer.
5. **Deploy has downtime and no rollback.** `--force-recreate` kills everything simultaneously; `curl /health` runs only after sleep 15 — too late to prevent 502s. No scripted rollback. Tag images with the previous green SHA and add a `deploy/rollback.sh` that re-pulls it.
6. **Running kernel 6.8.0-90; 6.8.0-107 installed, reboot pending 9+ days.** Schedule a weekend maintenance window and reboot.
7. **Swap-thrashing 2 GB VPS.** 826 MB swap in use at idle. Either upgrade RAM or tighten `mem_limit` (backend hold-steady at 277 MB, 1.5 GiB limit is 5× actual).
8. **SSH still allows password auth; btmp shows 34,931 failed logins and 6,037 banned IPs via fail2ban.** Run `infrastructure/ssh-harden.sh` (already written, idempotent) — this item has been open for 9 days.
9. **No RUNBOOK / no on-call docs.** A new operator has nothing to onboard against. Write a one-page RUNBOOK.md covering: how to deploy, how to roll back, how to check health, where logs live, how to restore a backup, how to rotate each secret.
10. **Backup dump size is 2.5 KB and `pg_dump` warns about circular FKs on `continuous_agg`.** The dump may not be restorable; we have no evidence it is. Run a restore into a scratch DB today and measure.

---

## Files touched during this audit (absolute paths)
- `/Users/GK/Downloads/alphadesk/.github/workflows/deploy.yml`
- `/Users/GK/Downloads/alphadesk/docker-compose.yml`
- `/Users/GK/Downloads/alphadesk/infrastructure/docker-compose.prod.yml`
- `/Users/GK/Downloads/alphadesk/infrastructure/Caddyfile`
- `/Users/GK/Downloads/alphadesk/infrastructure/backup.sh`
- `/Users/GK/Downloads/alphadesk/infrastructure/backup.systemd.service`
- `/Users/GK/Downloads/alphadesk/infrastructure/backup.systemd.timer`
- `/Users/GK/Downloads/alphadesk/infrastructure/.env.prod.example`
- `/Users/GK/Downloads/alphadesk/infrastructure/secrets-setup.md`
- `/Users/GK/Downloads/alphadesk/infrastructure/vps-setup.sh`
- `/Users/GK/Downloads/alphadesk/infrastructure/ssh-harden.sh`
- `/Users/GK/Downloads/alphadesk/backend/main.py` (health probes)
- `/Users/GK/Downloads/alphadesk/backend/Dockerfile`
- `/Users/GK/Downloads/alphadesk/frontend/Dockerfile`
- `/Users/GK/Downloads/alphadesk/audit-reports/iter-1-infra.md` (source of truth for fixed items)
- `/Users/GK/Downloads/alphadesk/audit-reports/iter-4-user-actions.md` (still-open human actions)
- `/Users/GK/Downloads/alphadesk/audit-reports/observability-audit-r4.md` (monitoring gaps)
