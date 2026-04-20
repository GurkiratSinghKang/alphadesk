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

Backups live at `/var/lib/alphadesk/backups/`. Retention is 30 days.
If the prune doesn't recover enough, drop older backups first
(they've already been rclone'd offsite by nightly `backup.sh`).

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

## Escalation

If the platform is still down after 15 minutes of the above:

1. Halt trading (if not already).
2. Drop a note in whatever incident channel you use.
3. Don't guess at fixes — pull a backup and plan the next steps
   calmly. The market opens every weekday; a bad quick fix lives forever.
