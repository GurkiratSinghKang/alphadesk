# AlphaDesk On-Call Runbook

Everything needed at 2 AM when an alert fires. Skim the "first 60 seconds"
section first; the rest is context.

## First 60 seconds

1. **Is the site up?**
   ```
   curl -sf -o /dev/null -w '%{http_code}\n' https://tradingalpha.net/readyz
   ```
   - `200` → platform is healthy. Whatever alerted you is narrower than
     "platform down". Move to the specific problem section below.
   - `503` → at least one dep is down. Body tells you which:
     `curl -s https://tradingalpha.net/readyz | jq`.
   - Timeout / connection refused → Caddy or the host itself is down.

2. **Is live-trading enabled?** If yes, and the bug could be routing
   bad orders, **halt first** (see [Halt trading](#halt-trading)).

3. **SSH in.**
   ```
   ssh -i ~/.ssh/alphadesk root@87.99.143.65
   cd /opt/alphadesk
   ```

4. **Check container state.**
   ```
   docker compose ps
   ```

## Halt trading

The fastest, safest way to stop new orders without a redeploy:

### Option A: flip the live-trading flag

Edit `/opt/alphadesk/.env.prod` and set:
```
LIVE_TRADING_ENABLED=false
```
Then:
```
docker compose -f docker-compose.yml -f infrastructure/docker-compose.prod.yml up -d --force-recreate backend
```
The backend rejects any non-paper broker call at the route layer when
this flag is false.

### Option B: disable Alpaca trade-updates

If the broker-side WebSocket is flapping and causing duplicate fills, set:
```
ALPACA_TRADE_UPDATES_ENABLED=false
```
and recreate the backend as above. Quotes still stream; fill events
come from REST reconciliation instead.

### Option C: stop the backend entirely

Last resort — the frontend will show 500s but no orders can be placed:
```
docker compose stop backend
```

## Health-check cheat sheet

| Endpoint | What it means if it fails |
| --- | --- |
| `/livez` | Python process wedged — `docker restart backend`. |
| `/readyz` | Postgres or Redis unreachable — check which via body. |
| `/health` | Legacy alias for `/livez`. Same interpretation. |

The Docker healthcheck hits `/readyz` (as of Wave D fix), so a failing
readiness probe will un-flag the container as healthy and Caddy will
stop routing new traffic to it (the `depends_on: service_healthy`
gate).

## Where logs live

On the VPS (Hetzner, `87.99.143.65`):

| Source | Path / command |
| --- | --- |
| Backend stdout/stderr | `docker compose logs backend --tail 500` |
| Frontend stdout/stderr | `docker compose logs frontend --tail 500` |
| Caddy access logs | `/var/log/alphadesk/caddy/access.log` (JSON) |
| Caddy stderr | `docker compose logs caddy --tail 500` |
| TimescaleDB | `docker compose logs timescaledb --tail 500` |
| Redis | `docker compose logs redis --tail 500` |
| Pipeline run logs | `/var/lib/alphadesk/pipeline_logs/` (mounted) |
| Backup runs | `journalctl -u alphadesk-backup.service -n 200` |

Every JSON log record carries `request_id`. Caddy adds `X-Request-ID`
at the edge (see `infrastructure/Caddyfile`) and the backend honours
the inbound header, so you can join Caddy's access log and the
backend's log on the same UUID.

Example — find a user-reported error by the request id they
screenshotted:
```
grep '"request_id":"<uuid>"' /var/log/alphadesk/caddy/access.log
docker compose logs backend | grep '<uuid>'
```

## Common scenarios

### "Site is down" (Caddy returns 502)

```
docker compose ps
# backend container unhealthy? check /readyz body:
curl -s http://localhost:8000/readyz | jq
```

If DB is down: check disk space (`df -h`), check TimescaleDB logs,
restart timescaledb: `docker compose restart timescaledb`.

If Redis is down: `docker compose restart redis`. Bracket-outbox
state is AOF-persisted, so replays will happen on the next backend
start-up (see `main.py` lifespan / `replay_pending_brackets()`).

### Disk full

```
df -h
docker system df
docker system prune -f --filter "until=24h"
```

Backups live at `/var/lib/alphadesk/backups/`. Retention policy (set
in `infrastructure/backup.sh`, Round 7 Fix 5):

| File pattern | Retention | Why |
| --- | --- | --- |
| `*.sql.gz` (pg_dump) | 2200 days (~6 years + buffer) | SEC 17a-4 broker-trail. |
| `redis-aof-*.tgz`    | 30 days | Transient outbox / rate-limit state. |

Override per-stream via `ALPHADESK_PG_BACKUP_RETENTION_DAYS` /
`ALPHADESK_REDIS_BACKUP_RETENTION_DAYS`. If the prune doesn't recover
enough, drop older backups first (they've already been rclone'd offsite
by nightly `backup.sh`).

### Restoring from backup

The counterpart to `backup.sh` is `infrastructure/restore.sh`. It pulls
a pg_dump archive from the rclone remote (or a local path) and loads
it into the live TimescaleDB container.

**Caveats before you run anything:**

- **No PITR.** We do not ship WAL archives in this deployment, so the
  recovery point is the latest nightly dump — worst-case RPO ~24 h. If
  sub-day recovery is required, set up WAL archiving first; this script
  will not fake it.
- **Destructive.** `restore.sh` DROPs and recreates the `alphadesk`
  database inside the container. Confirm the environment before running.
- **Redis is NOT restored.** AOF snapshots live next to pg dumps for
  separate manual recovery. Outbox / rate-limit counters usually aren't
  worth restoring — the backend replays pending brackets at boot via
  `replay_pending_brackets()`.
- **Target container must be running.** The script `docker exec`s into
  `alphadesk-timescaledb`; if the container isn't up it exits 2.

**Dry-run first:**

```
/opt/alphadesk/infrastructure/restore.sh --dry-run --latest
```

**Real run (latest dump from remote):**

```
/opt/alphadesk/infrastructure/restore.sh --latest
# prompts "Type 'yes' to continue"
```

**Specific dump by name (e.g. from an audit timestamp):**

```
/opt/alphadesk/infrastructure/restore.sh --dump=20251015-030000.sql.gz
```

**Local-only restore (from a file already on disk):**

```
/opt/alphadesk/infrastructure/restore.sh --local=/tmp/dump.sql.gz
```

**After the restore:**

1. Run pending migrations if the dump predates the current code:
   ```
   docker compose -f docker-compose.yml -f infrastructure/docker-compose.prod.yml exec -T backend alembic upgrade head
   ```
2. Restart the backend so any stale connection pool picks up the
   rebuilt DB:
   ```
   docker compose -f docker-compose.yml -f infrastructure/docker-compose.prod.yml restart backend
   ```
3. Verify: `curl -s http://localhost:8000/readyz | jq` — body should
   show `postgres: ok`.
4. Halt trading while validating (see [Halt trading](#halt-trading)).
   Only re-enable after spot-checking portfolio equity, open orders,
   and recent fills match the pre-disaster state.

### Strategies firing wrong orders

1. Halt first (see [Halt trading](#halt-trading)).
2. Pull backend logs for the pipeline run id:
   ```
   docker compose logs backend | grep pipeline_run_id
   ```
3. Check `/var/lib/alphadesk/pipeline_logs/` for the per-run JSON dump.

### Rolling back a bad deploy

See [ROLLBACK.md](./ROLLBACK.md).

## Useful SSH / CLI reminders

```
# SSH into the VPS
ssh -i ~/.ssh/alphadesk root@87.99.143.65

# From the VPS, compose root
cd /opt/alphadesk

# Full compose command with the prod overlay
docker compose -f docker-compose.yml -f infrastructure/docker-compose.prod.yml <cmd>

# Trigger an on-demand backup from the host
/opt/alphadesk/infrastructure/backup.sh

# Apply pending migrations manually (normally the deploy workflow does this)
docker compose -f docker-compose.yml -f infrastructure/docker-compose.prod.yml exec -T backend alembic upgrade head

# Follow backend logs live
docker compose logs -f backend
```

## TLS certificate expiry

Caddy auto-renews via ACME, but a silent renewal failure only surfaces
when the cert actually expires and browsers start throwing
interstitials. The daily `alphadesk-cert-check.timer` (runs 03:30 ET)
executes `backend/scripts/check_cert_expiry.py`, which:

- Opens TLS to `https://{ALPHADESK_CERT_DOMAIN or tradingalpha.net}`.
- WARNs + writes `audit_log` (`event="cert_expiring_soon"`) when less
  than **14 days** remain.
- ERRORs + writes `audit_log` (`event="cert_expired"` /
  `"cert_check_error"`) on expiry or fetch failure.

To inspect the last run:

```
journalctl -u alphadesk-cert-check.service -n 50
```

Query the audit trail:

```
docker compose exec timescaledb psql -U alphadesk -d alphadesk -c \
  "SELECT ts, event, details FROM audit_log \
   WHERE event LIKE 'cert_%' ORDER BY ts DESC LIMIT 20;"
```

### Force-renew the cert (when Caddy is stuck)

Caddy stores certs in its config volume. To force a re-issue:

```
# From the VPS compose root.
# 1. Delete the existing Caddy-managed cert / account cache for the site.
docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile
# If that doesn't retry ACME, nuclear option (tokens are re-minted):
docker compose exec caddy sh -c "rm -rf /data/caddy/certificates/acme-v02.api.letsencrypt.org-directory/tradingalpha.net"
docker compose restart caddy
docker compose logs -f caddy   # watch for the ACME HTTP-01 or TLS-ALPN-01 handshake
```

If ACME is rate-limited (check the Caddy log for `urn:ietf:params:acme:
error:rateLimited`), wait 60 minutes; do NOT loop. The `Retry-After`
header from the ACME server has the exact window.

## Redis AOF / persistence monitoring

Redis is configured with AOF persistence (see
`infrastructure/docker-compose.prod.yml`). A silent AOF rewrite failure
means the next restart loses state — outbox entries, halt sets, cache
values. Monitor with:

```
docker compose exec redis redis-cli INFO persistence | grep -E \
  '(aof_enabled|aof_rewrite_in_progress|aof_last_write_status|aof_last_bgrewrite_status|aof_last_cow_size)'
```

Alerting (Uptime Robot custom HTTP, or whatever monitoring stack is
in use):

- `aof_last_write_status` must be `ok`. Anything else → page.
- `aof_last_bgrewrite_status` must be `ok`. `err` → the last rewrite
  failed and the AOF has been growing unchecked since — page.
- `aof_rewrite_in_progress=1` sustained for > 30 min on a small DB is
  suspicious; spot-check disk pressure and `docker compose logs redis`.

Recovery:

```
docker compose exec redis redis-cli BGREWRITEAOF
# Watch aof_rewrite_in_progress flip 1 -> 0 and aof_last_bgrewrite_status flip to ok.
```

If Redis refuses to start because the AOF is truncated (typically after
an OOM kill mid-rewrite), use `redis-check-aof --fix /data/appendonly.aof`
**from a copy** (never the live file) before restarting.

## Disk usage monitoring

The daily `alphadesk-disk-check.timer` (runs 03:45 ET) calls
`backend/scripts/check_disk_usage.py` against `$ALPHADESK_DATA_DIR`
(default `/var/lib/alphadesk`). Thresholds:

| % used | Behaviour |
| --- | --- |
| < 85 % | Silent; INFO log only. |
| 85 – 90 % | WARN log + `audit_log` (`event="disk_warn"`). |
| >= 90 % | ERROR log + `audit_log` (`event="disk_critical"`) AND `/readyz` body flips `status` to `"degraded"` (HTTP stays 200). |

Manual check:

```
docker compose exec backend python -m scripts.check_disk_usage
```

Recover quickly:

```
df -h /var/lib/alphadesk
docker system df
docker system prune -f --filter "until=48h"
# Rotate pipeline_logs:
find /var/lib/alphadesk/pipeline_logs -type f -mtime +30 -delete
# Trim backups (retention is 30d but a runaway cron can stack):
ls -1t /var/lib/alphadesk/backups | tail -n +31 | xargs -I {} rm /var/lib/alphadesk/backups/{}
```

## Escalation

If the platform is still down after 15 minutes of the above:

1. Halt trading (if not already).
2. Drop a note in whatever incident channel you use.
3. Don't guess at fixes — pull a backup and plan the next steps
   calmly. The market opens every weekday; a bad quick fix lives forever.
