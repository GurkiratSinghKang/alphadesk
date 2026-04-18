# Iteration 1 — Infrastructure Audit
Date: 2026-04-18
Host: 87.99.143.65 (Ubuntu 24.04.3, kernel 6.8.0-90-generic running; 6.8.0-107 installed, reboot pending)

## State snapshot
| Area | State | Notes |
|---|---|---|
| Uptime | 8d 1h | load 0.25/0.22/0.16 |
| Disk used | 27G / 38G (76%) | /var/lib/docker dominant; 8.8G free |
| Memory | 1276 / 1919 MiB used | only 104 MiB free, 739 buff/cache |
| Swap | 728 / 2048 MiB | swap is being used (~35%) on a VPS w/ 2GB RAM |
| Restart counts | backend=0 frontend=? caddy=? redis=0 timescaledb=0 kuma=0 | frontend/caddy containers lack healthcheck, inspect returned empty Health; all started within last 49min, i.e. redeployed today |
| Docker image disk | 21.73 GB total, 11.11 GB reclaimable (51%); buildkit cache 5.68 GB, 1.76 GB reclaimable | 4 copies of backend image at ~3.9 GB each |
| Backups | none ever run | no cron, no systemd timer, no dumps on disk, no journal entries for `backup.sh` or `pg_dump` |
| Crontab | empty (`no crontab for root`) | |
| Ufw | active, 22/80/443 allowed — but Docker bypasses ufw via iptables DOCKER chain |  |

## Findings

### [P0] Postgres, Redis, and backend API exposed to the public internet
**Where:** `/opt/alphadesk/docker-compose.yml` — `ports: "5432:5432"`, `"6379:6379"`, `"8000:8000"`, `"3000:3000"`
**Evidence:** From my laptop: `nc -zv 87.99.143.65 5432` -> succeeded; same for 6379, 8000, 3000. UFW shows only 22/80/443 allowed, but Docker publishes ports via the `DOCKER` iptables chain which is processed *before* ufw's rules — iptables -L DOCKER confirms `ACCEPT 0.0.0.0/0 -> 172.18.0.4 tcp:5432`, same for 6379/8000/3000.
**What:** The Postgres, Redis, backend FastAPI, and Next.js containers are reachable from the whole Internet. Caddy and UFW are effectively decorative for these services.
**Fix:** In compose, bind to loopback: `"127.0.0.1:5432:5432"` (same for 6379, 8000, 3000). Everything except Caddy should be internal-only.

### [P0] Postgres uses a hardcoded weak password in the connection string
**Where:** `/opt/alphadesk/docker-compose.yml`
**Evidence:** `DATABASE_URL: postgresql+asyncpg://alphadesk:alphadesk_dev@timescaledb:5432/alphadesk` — the password `alphadesk_dev` is literally in the compose file, not templated from `.env.prod`. Combined with finding above (5432 exposed), anyone on the internet can `psql` in. `pg_hba.conf` last line: `host all all all scram-sha-256` — only thing between attacker and DB is that one password.
**Fix:** Rotate the DB password now; move to `${POSTGRES_PASSWORD}` env var sourced from `.env.prod`; close port 5432.

### [P0] No database backups are being taken
**Where:** `/opt/alphadesk/infrastructure/backup.sh` exists (26 lines, pg_dump + rclone to `hetzner-s3:alphadesk-backups`) but is never invoked.
**Evidence:** no crontab for root; `systemctl list-timers` shows no backup timer; no `*.sql.gz` or `alphadesk-backup-*` anywhere on disk; `journalctl --since '7 days ago' | grep -iE 'backup.sh|pg_dump'` returns nothing; `/opt/alphadesk/backups` and `/root/backups` don't exist.
**What:** If TimescaleDB is lost, zero recovery — and the DB contains user trade data (currently small, 9 MB).
**Fix:** Add `systemd-timer` or cron entry `0 3 * * * /opt/alphadesk/infrastructure/backup.sh >> /var/log/alphadesk-backup.log 2>&1`; verify rclone remote is configured; test restore.

### [P1] `.env.prod` is world-readable
**Where:** `/opt/alphadesk/.env.prod`
**Evidence:** `-rw-rw-r-- deploy deploy` (mode 0664). Contains JWT_SECRET, ADMIN_PASSWORD_HASH, POLYGON_API_KEY, ALPACA_SECRET_KEY, ANTHROPIC_API_KEY, NEWSDATA_API_KEY, REDIS_PASSWORD, STATUS_PASS_HASH. Any local user (or a compromised container bind-mount) can read every production secret.
**Fix:** `chmod 600 /opt/alphadesk/.env.prod && chown deploy:deploy /opt/alphadesk/.env.prod`.

### [P1] SSH allows password authentication + root login
**Where:** effective `sshd -T` output: `permitrootlogin without-password`, `passwordauthentication yes`
**Evidence:** `auth.log` shows **13,439** `Failed password` and **3,542** `Invalid user` attempts; btmp (failed) has **30,138** entries since Apr 10. Ongoing brute-force (45.148.10.147 hitting right now). Only `fail2ban sshd` jail is mitigating. `PermitRootLogin without-password` happens to only allow key login for root, but `PasswordAuthentication yes` still lets attackers try passwords for any other user.
**Fix:** In `/etc/ssh/sshd_config`: `PasswordAuthentication no`, `PermitRootLogin prohibit-password` (or create a sudo user and `no`). Reload sshd.

### [P1] 3 security updates pending, kernel reboot required
**Where:** MOTD / apt
**Evidence:** `apt list --upgradable | grep -i security | wc -l` → **3**; `/var/run/reboot-required` present listing `linux-image-6.8.0-107-generic`, `linux-base`, `libc6`. Running kernel is `6.8.0-90`, installed is `6.8.0-107` — the box has been running an outdated kernel for some time.
**Fix:** Schedule a maintenance window; `apt upgrade` and reboot.

### [P2] Docker image/build cache bloat — disk at 76%
**Where:** `/var/lib/docker`
**Evidence:** `docker system df` → 21.73 GB images, 11.11 GB reclaimable (51%); build cache 5.68 GB. Four backend images at ~3.9 GB each (two SHA tags + `local` + `latest`). Root FS is 76% full.
**What:** At current rate, next few deploys could fill disk; a full `/` will take Postgres + Redis down.
**Fix:** `docker image prune -a` after confirming the running image tag; `docker builder prune`. Long-term, slim the backend image (3.9 GB is very large — likely pulling full CUDA/torch; audit the Dockerfile).

### [P2] systemd journal using 119.5 MB; no explicit cap
**Where:** `/var/log/journal` = 128 MB; `/var/log/btmp` = 12 MB (failed-login metadata, growing with brute force).
**Fix:** `SystemMaxUse=200M` in `/etc/systemd/journald.conf`; `journalctl --vacuum-time=14d` periodically.

### [P2] Uptime Kuma has **zero monitors** configured
**Where:** `alphadesk-uptime-kuma-1` sqlite db
**Evidence:** `SELECT COUNT(*), SUM(active) FROM monitor;` → `0|` (total 0, active null). The container has been running but is monitoring nothing.
**Fix:** Configure monitors for https://tradingalpha.net, backend `/health`, Postgres port, Redis ping; wire up a notification channel (email/Telegram).

### [P2] Redis has no persistence backup strategy but holds 1 key
**Where:** `alphadesk-redis`
**Evidence:** AOF is on (`--appendonly yes`), maxmemory 512 MB, policy `allkeys-lru`, current usage `1.23M`, peak `1.23M`, DBSIZE=1. Config is fine for now, but `/var/lib/alphadesk/redis` (1.9 MB) is not included in the non-existent backup.
**What:** Config itself is safe (won't OOM); just note for backup scope.
**Fix:** Include `/var/lib/alphadesk/redis/appendonly*` in the backup routine above.

### [P2] Swap in use on a 2 GB VPS; backend container limit is 1.5 GiB of 1.9 GiB total
**Where:** free / compose
**Evidence:** Mem 1276/1919 MiB used, swap 728/2048 MiB used. Backend container limit 1.5 GiB, TimescaleDB 1.875 GiB — sum of limits exceeds physical RAM.
**What:** Memory pressure today is low (backend 91 MiB), but any burst (heavy backtest, pg_dump during backup) will page hard and slow API latency.
**Fix:** Either upgrade VPS RAM or tighten container `mem_limit` (backend can easily live in 768 MiB given 91 MiB RSS).

### [P2] Postgres `shared_buffers=512 MB` on a 2 GB box with TimescaleDB + other containers
**Where:** TimescaleDB container
**Evidence:** `SHOW shared_buffers` = 512MB, `work_mem` = 16MB, `max_connections` = 50 (currently 9 active). DB size = 9 MB only. 512 MB shared_buffers is oversized for a 9 MB database and competes with the backend for RAM.
**Fix:** Drop `shared_buffers` to 256 MB; `max_connections` to 25. Current usage only needs a fraction.

### [P3] Multiple copies of the frontend tree (`frontend/` + `frontend-standalone/`) on host
**Where:** `/opt/alphadesk/frontend` (90 MB) and `/opt/alphadesk/frontend-standalone` (41 MB) both contain `.next/` build artifacts with compiled chunks containing secret env names.
**Evidence:** `grep -rl POLYGON_API_KEY` hits `.next/server/chunks/*.js` in both trees.
**What:** Orphan build output on the host from previous deploys. Not itself a leak (names not values), but build residue adds noise and enlarges backup scope if `/opt` ever gets backed up.
**Fix:** Delete `frontend-standalone/` if unused; keep `frontend/` clean via CI artifacts rather than on-host builds.

### [P3] Caddyfile warning not fixed; HTTP/2 and HTTP/3 disabled on :80
**Where:** `alphadesk-caddy-1` logs
**Evidence:** `Caddyfile input is not formatted; run 'caddy fmt --overwrite' to fix inconsistencies` (line 2).
**Fix:** Run `caddy fmt --overwrite` locally and commit. Cosmetic but it's a warning on every start.

### [P3] Two kernels installed; old one pinned by apt config
**Where:** `dpkg --list | grep linux-image` → `6.8.0-90-generic` (running), `6.8.0-107-generic`, `linux-image-virtual`.
**Fix:** After reboot onto -107, autoremove -90.

## What's good
- Containers stable: zero restarts, zero OOM kills, all healthchecks passing on services that have them.
- Docker log driver has sane caps (`max-size: 10m, max-file: 3`), so container logs cannot runaway.
- Redis: password-protected, `allkeys-lru` with 512 MB cap — will not OOM.
- `/root/.ssh/authorized_keys` is 0600, only one key, root dir 0700.
- NTP active, system clock synchronized — no drift.
- fail2ban sshd jail active and doing work.
- No secrets leaked in container logs (`grep sk-|xoxb-|AKIA|Bearer...` → 0 hits).
- `bash_history` has 4 lines and no secret strings.
- Docker log files per container are all <5 KB right now (healthy signal density).
- TimescaleDB data dir is tidy (67 MB) and DB is small (9 MB) — easy to back up once backups exist.
