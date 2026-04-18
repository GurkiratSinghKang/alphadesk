# Iteration 2 — User-Required Actions
Date: 2026-04-17
Scope: actions that cannot be completed in code and need the user's credentials.

Code fixes from waves A–E cover everything automatable; the items below need
the user to act on the running VPS (`root@87.99.143.65`).

## 1. Replace the Anthropic API key (P0 — pipeline inert without this)

### What's wrong
The `ANTHROPIC_API_KEY` currently mounted into the `alphadesk-backend`
container has prefix `sk-ant-oat01-*`. That prefix is an **OAuth access
token** (a short-lived credential minted by the Claude Code CLI login flow),
**not** a permanent API key. Every call to `POST /v1/messages` on
`api.anthropic.com` returns:

```
401 Unauthorized — invalid x-api-key
```

Evidence: every row in `data/pipeline_logs/2026-04-12.json` under
`strategies.momentum_quality.analyses` carries this exact 401 error. The
same is true for `claude_alpha`. The pipeline catches the exception, writes
it into the log, and proceeds with zero trades approved — so it looks like
the pipeline succeeded while actually half the strategy stack is dead.

### What to do

1. Open the Anthropic console:
   <https://console.anthropic.com/settings/keys>
2. Click **Create Key**. Give it a name like `alphadesk-prod-vps-2026-04`.
   Copy the resulting value — it will start with `sk-ant-api03-…`. Store it
   in your password manager; it will not be shown again.
3. SSH to the server and update the env file:
   ```
   ssh -i ~/.ssh/alphadesk root@87.99.143.65
   cd /root/alphadesk           # or wherever the compose file lives
   # back up the old env first
   cp .env .env.bak-2026-04-17
   # edit and replace the ANTHROPIC_API_KEY line
   $EDITOR .env
   ```
   The line should become:
   ```
   ANTHROPIC_API_KEY=sk-ant-api03-<the-value-from-step-2>
   ```
4. Recreate the backend container so it picks up the new env:
   ```
   docker compose up -d --force-recreate alphadesk-backend
   ```
5. Verify:
   ```
   docker logs alphadesk-backend --since=2m 2>&1 | grep -iE "anthropic|401|api.anthropic"
   ```
   The 401s should be gone. Trigger a pipeline run (via the admin UI or
   `curl -X POST http://localhost:8000/pipeline/run` with an admin token)
   and inspect the newest file under
   `/app/data/pipeline_logs/YYYY-MM-DD.json` — the `analyses` arrays for
   `momentum_quality` and `claude_alpha` should now contain real JSON
   payloads rather than `{"error": "401 ..."}`.

### Why the dev OAuth token was accidentally deployed
The Claude Code CLI caches its login as an OAuth token in
`~/.claude/.credentials.json`. Someone almost certainly `cat`'d that file
to export a "key" to the server. The prefix `sk-ant-oat01-*` is the
telltale — permanent keys always start with `sk-ant-api03-*`.

A prominent `TODO(user)` comment has been left in
`backend/agents/strategy.py` so any future dev sees this at the top of the
file.

## 2. (Optional) Rotate the old token

Once the new key is confirmed working, invalidate the OAuth token that
was acting as "the key" by logging out of Claude Code on the machine that
minted it. This ensures the token can no longer be used if it leaks.

---

No other user-required actions in wave A. Waves B–E may add more entries
to this file during their sweep.

---

## Wave E — infra hygiene additions

### E.2. Kernel reboot + security updates (P1)

#### What's wrong
`/var/run/reboot-required` is set on the VPS. The running kernel is
`6.8.0-90-generic` while `6.8.0-107-generic` has been installed for some
time. `apt list --upgradable | grep -i security | wc -l` reports **3**
pending security updates (`linux-image-6.8.0-107-generic`, `linux-base`,
`libc6`).

#### What to do
Plan a short maintenance window (expect ~2 minutes of downtime on reboot):

```bash
ssh -i ~/.ssh/alphadesk root@87.99.143.65

# Review what will change
apt list --upgradable | head -20

# Apply updates
apt update && apt upgrade -y

# Reboot to pick up the new kernel
reboot
```

After the box comes back up, verify from your laptop:

```bash
ssh -i ~/.ssh/alphadesk root@87.99.143.65 'uname -r && ls /var/run/reboot-required 2>/dev/null || echo "reboot clean" && docker ps --format "{{.Names}} {{.Status}}"'
curl -fsSI https://tradingalpha.net/ | head -1    # 307 expected
```

If any container is not `Up` after reboot:

```bash
cd /opt/alphadesk
docker compose -f docker-compose.yml -f infrastructure/docker-compose.prod.yml up -d
```

Optional follow-up (after verifying -107 is healthy):

```bash
apt autoremove -y      # removes pinned 6.8.0-90-generic and frees ~300 MB
```

Do **not** run this without the user's explicit go-ahead — Wave E did not
reboot the box.

### E.3. CAA DNS record (P1)

#### What's wrong
`dig tradingalpha.net CAA +short` returns empty. With no CAA record
published, **any** DV-capable CA that can respond to an ACME HTTP-01
challenge on port 80 can mint a valid TLS certificate for the domain.
Adding a CAA record restricts issuance to Let's Encrypt only and
publishes an abuse contact.

#### What to do
Add the following records at your DNS provider (Hetzner DNS / Cloudflare /
Namecheap — wherever the authoritative NS for `tradingalpha.net` lives):

```
tradingalpha.net.   3600  IN  CAA  0 issue "letsencrypt.org"
tradingalpha.net.   3600  IN  CAA  0 iodef "mailto:security@tradingalpha.net"
```

If you do not yet have a `security@tradingalpha.net` inbox, use
`mailto:gurkiratkang@gmail.com` in the `iodef` line until a domain
mailbox exists.

#### Verify
```bash
dig tradingalpha.net CAA +short
# expected:
# 0 issue "letsencrypt.org"
# 0 iodef "mailto:security@tradingalpha.net"
```

Propagation is usually <5 minutes (TTL 3600 s). Certificate renewals
(next one due ~2026-07-09 based on iter-1 probe) will continue to work
because Let's Encrypt is explicitly allowed.

### E.7. Verified — Docker log rotation

`infrastructure/docker-compose.prod.yml` applies
`max-size: 10m, max-file: 3` to every long-running service (frontend,
backend, timescaledb, redis). That caps each container's log footprint
at roughly **30 MB** (3 × 10 MB rotated files). Verified at
commit 5f57ada on branch `feature/deployment`. No action needed — noted
here so it stays visible in future audits.

### E.1. Executed directly in this iteration — for your information

Completed on VPS during the Wave E pass (no user action required, just
so you see what ran):

```
docker system prune -f --filter 'until=48h'   # reclaimed 0 B this pass
journalctl --vacuum-time=7d                   # reclaimed 22.4 MB (119.5M → 97.1M)
```

The docker prune reclaimed 0 B because the 11.11 GB of "reclaimable"
image space is mostly still-tagged backend/frontend images (two SHA
tags + `local` + `latest`) — not dangling layers — and the per-layer
build cache entries are all younger than 48 h. A deeper reclaim needs
`docker image prune -a` after confirming the exact running image tag.
That is not a safe unattended action and should be done interactively:

```bash
ssh -i ~/.ssh/alphadesk root@87.99.143.65
docker ps --format '{{.Image}}'                    # note running tags
docker image ls                                    # review candidates
docker image prune -a --filter "until=7d"          # remove untagged + unused
```

Root filesystem currently sits at **76 % (8.8 GB free)** on the 38 GB
/dev/sda1. Growth trend should be watched — if another deploy push
crosses 80 %, run the interactive prune above.

### E.4 / E.5. Applied automatically — for your information

Already edited in `infrastructure/docker-compose.prod.yml` on the
`feature/deployment` branch. These take effect on the next deploy
(container recreation required); no user intervention needed.

- **Postgres tuning (E.4):** `shared_buffers` 512MB → 128MB,
  `work_mem` 16MB → 4MB. Frees ~400 MB of wired shared-memory on a 2 GB
  box; the database is currently 9 MB so the old setting was heavy
  overkill.
- **Uptime Kuma removed (E.5):** the `uptime-kuma` service had zero
  monitors configured and was consuming ~56 MB RSS + a 724 MB image for
  no benefit. The on-disk data directory
  (`/var/lib/alphadesk/uptime-kuma`) is **preserved**; re-enabling the
  service later re-uses the existing DB.

After the next deploy, verify:

```bash
ssh -i ~/.ssh/alphadesk root@87.99.143.65
docker exec alphadesk-timescaledb psql -U alphadesk -d alphadesk \
  -c "SHOW shared_buffers; SHOW work_mem;"
# expect: 128MB / 4MB

docker ps --format '{{.Names}}' | grep -i kuma
# expect: empty
```

### E.6. Lockfile cleanup (no-op flagged)

Wave-E brief asked to delete `/Users/GK/Downloads/alphadesk/package-lock.json`
if orphaned. Inspection shows the root carries a genuine `package.json`
declaring `playwright`/`puppeteer` dependencies used by **61 `qa-*.mjs`
Playwright/Puppeteer test scripts at repo root**. The root lockfile is
therefore NOT orphaned and must stay. Next.js's "multiple lockfiles"
warning is a side-effect of the repo layout (qa scripts share the root
while the Next app lives in `frontend/`). If the warning is noisy, a
cleaner fix is to move the qa scripts into a `qa/` subfolder with its
own `package.json`+lock — that's out of scope for this iteration.

---

## Wave B — security hardening additions

### B.5. Lock down `.env.prod` on the VPS (P1, 30 seconds)

#### What's wrong
The audit found `/opt/alphadesk/.env.prod` is currently mode `0664`
(world-readable) and contains JWT_SECRET, ALPACA_SECRET_KEY,
ANTHROPIC_API_KEY, POLYGON_API_KEY, ADMIN_PASSWORD_HASH, REDIS_PASSWORD,
STATUS_PASS_HASH. Any local user (or a compromised container bind-mount)
can read every production secret.

#### What to do
```sh
ssh -i ~/.ssh/alphadesk root@87.99.143.65 'chmod 600 /opt/alphadesk/.env.prod && chown deploy:deploy /opt/alphadesk/.env.prod && ls -la /opt/alphadesk/.env.prod'
```
Expect: `-rw------- 1 deploy deploy ... .env.prod`.

An idempotent block was added to `infrastructure/vps-setup.sh` so a
fresh setup applies this automatically on install.

### B.6. Harden sshd on the VPS (P1, 5 minutes, requires care)

#### What's wrong
The audit showed **13,439** failed password logins and **30,138** failed
btmp entries over ~8 days. `PasswordAuthentication yes` is currently
active. Password auth is an active target, and fail2ban alone is not
sufficient hardening for an internet-facing SSH port.

#### What to do
A new script `infrastructure/ssh-harden.sh` backs up
`/etc/ssh/sshd_config`, sets:
- `PasswordAuthentication no`
- `ChallengeResponseAuthentication no`
- `KbdInteractiveAuthentication no`
- `PermitRootLogin prohibit-password`
runs `sshd -t` to validate, then `systemctl reload sshd`. It refuses to
run if it cannot find an `authorized_keys` file anywhere (safety check).

Safety procedure — do NOT close the session that runs the script until
you've verified a new SSH still works:

```sh
# 1. Confirm your key works right now:
ssh -i ~/.ssh/alphadesk root@87.99.143.65 'whoami'   # expect: root

# 2. Push and run (KEEP THIS SESSION OPEN until step 3):
scp -i ~/.ssh/alphadesk infrastructure/ssh-harden.sh root@87.99.143.65:/root/
ssh -i ~/.ssh/alphadesk root@87.99.143.65
  chmod +x /root/ssh-harden.sh
  /root/ssh-harden.sh

# 3. From ANOTHER terminal, confirm key login still works:
ssh -i ~/.ssh/alphadesk root@87.99.143.65 'echo still_in'   # expect: still_in
```

If step 3 fails, in the first session restore the backup the script
printed:
```sh
cp /etc/ssh/sshd_config.bak.YYYYMMDD-HHMMSS /etc/ssh/sshd_config
systemctl reload sshd
```

### B.1. Redeploy to apply loopback port bindings (P0, 3 minutes)

#### What's wrong
The audit verified that Postgres (`5432`), Redis (`6379`), backend API
(`8000`) and frontend (`3000`) are currently reachable from the public
internet (Docker publishes via its own iptables chain which bypasses
UFW). Wave B rebound all four to `127.0.0.1` in `docker-compose.yml`.

#### What to do
```sh
ssh -i ~/.ssh/alphadesk root@87.99.143.65 \
  'cd /opt/alphadesk && docker compose -f docker-compose.yml -f infrastructure/docker-compose.prod.yml up -d --force-recreate'
```

Verify from your laptop:
```sh
# All four should time out / fail:
for p in 5432 6379 8000 3000; do nc -zv -w 3 87.99.143.65 $p; done
# 443 must still succeed:
nc -zv -w 3 87.99.143.65 443
```

Caddy and the inter-container traffic are unchanged — they use the
internal docker network, not the published host ports.

### B.4. Confirm JWT_SECRET is set in `.env.prod` (P0, 1 minute)

#### What's wrong
`backend/core/config.py::jwt_secret_value` previously fell back to
the hardcoded string `"dev-insecure-secret-change-me"` when `JWT_SECRET`
was empty and `ENVIRONMENT != prod`. Wave B changed this to raise a
`ValueError` **in every environment** if `JWT_SECRET` is empty.

If `/opt/alphadesk/.env.prod` already has `JWT_SECRET=<something>`,
this is a no-op. Otherwise the backend will refuse to start after
redeploy.

#### What to do
```sh
ssh -i ~/.ssh/alphadesk root@87.99.143.65 \
  'grep -c "^JWT_SECRET=..*" /opt/alphadesk/.env.prod'   # expect: 1
```

If it's `0`, generate and install:
```sh
openssl rand -hex 32
# SSH to VPS, edit /opt/alphadesk/.env.prod, add:
#   JWT_SECRET=<paste the 64-char hex above>
```

Full secret-generation guide: `infrastructure/secrets-setup.md`.

---

## Wave C — data integrity additions

### C.1. Trade ledger migration — no VPS action required (P0)

The trade ledger has moved from a single JSON file (`ledger.json`, guarded by
a `threading.Lock` that did nothing across Gunicorn workers) to Postgres
(`trade_ledger` table in the existing TimescaleDB instance). The first time
a `TradeLedger()` is instantiated after the deploy it will:

1. Create the `trade_ledger` table if absent (idempotent DDL).
2. Read `/app/data/pipeline_logs/ledger.json` if present.
3. Bulk-insert the trades using `ON CONFLICT (id) DO NOTHING` so re-running
   is safe.
4. Advance the id sequence past the largest migrated id.
5. Rename the JSON file to `ledger.json.migrated`.

Verify on the VPS after the deploy:

```sh
ssh -i ~/.ssh/alphadesk root@87.99.143.65

# Confirm the trades landed in Postgres
docker exec alphadesk-timescaledb psql -U alphadesk -d alphadesk \
  -c "SELECT id, symbol, strategy, status FROM trade_ledger ORDER BY id;"

# Confirm the JSON file was renamed (no new ledger.json should appear)
docker exec alphadesk-backend ls /app/data/pipeline_logs/
# expected: ledger.json.migrated, but NOT ledger.json
```

If the migration was skipped because the DB was unreachable at startup, the
backend logs will show `TradeLedger: DB unavailable, using in-memory fallback`
and the JSON file will still be there — restart the backend to retry:

```sh
ssh -i ~/.ssh/alphadesk root@87.99.143.65 \
  'cd /opt/alphadesk && docker compose restart backend'
```

### C.2. `sync_with_alpaca` moved to the scheduler (P0) — verify only

Four GET handlers in `backend/api/routes/strategies.py` used to call
`ledger.sync_with_alpaca(...)` on every request. That mutated state on a
read, raced across Gunicorn workers, and — most importantly — auto-closed
every open trade with `exit_price=null` / `pnl=null` whenever Alpaca
happened to return an empty positions list (which it does on transient 5xx
or auth hiccups). One real trade (MRK/PEAD) was corrupted this way at
05:42 UTC on 2026-04-18.

The sync now runs exclusively from the APScheduler-equivalent loop in
`backend/data/ingestion/pipeline_runner.py` on a 5-minute cadence during US
equity market hours. The sync logic itself also received a guard: if
Alpaca returns an empty positions list while the ledger has open trades,
the close pass is **skipped** with a WARNING.

Verify after deploy:

```sh
ssh -i ~/.ssh/alphadesk root@87.99.143.65 \
  'docker logs --since 15m alphadesk-backend 2>&1 | grep -E "Ledger sync|sync_with_alpaca"'
```

Expect `Ledger→Alpaca sync loop started` on startup and `Ledger sync tick:
{...}` lines at 5-minute intervals during market hours.

### C.3. Enable nightly Postgres backups (P0)

`infrastructure/backup.sh` has been rewritten to:
- Dump to `/var/lib/alphadesk/backups/$(date +%Y%m%d-%H%M%S).sql.gz`
- Retain the last 30 days locally (older dumps deleted)
- Optionally push to the `hetzner-s3` rclone remote if configured
- Support `--dry-run` for safe verification
- Support `--test-db=URL` for local Postgres smoke-tests

Two systemd units (`alphadesk-backup.timer` + `alphadesk-backup.service`)
ship the schedule: 04:00 ET (08:00 UTC) daily, `Persistent=true` so missed
runs catch up, small randomised delay.

```bash
# 1. Copy the unit files into place
sudo cp /opt/alphadesk/infrastructure/backup.systemd.timer  /etc/systemd/system/alphadesk-backup.timer
sudo cp /opt/alphadesk/infrastructure/backup.systemd.service /etc/systemd/system/alphadesk-backup.service

# 2. Create the backup destination
sudo mkdir -p /var/lib/alphadesk/backups
sudo chown root:root /var/lib/alphadesk/backups
sudo chmod 700 /var/lib/alphadesk/backups

# 3. Ensure the script is executable
sudo chmod +x /opt/alphadesk/infrastructure/backup.sh

# 4. Smoke-test first (does not touch the database)
sudo /opt/alphadesk/infrastructure/backup.sh --dry-run

# 5. Reload + enable
sudo systemctl daemon-reload
sudo systemctl enable --now alphadesk-backup.timer

# 6. Confirm the timer is armed
systemctl status alphadesk-backup.timer
systemctl list-timers | grep alphadesk-backup

# 7. (Optional) Trigger a real backup now to prove the service works
sudo systemctl start alphadesk-backup.service
journalctl -u alphadesk-backup.service -n 50 --no-pager
ls -la /var/lib/alphadesk/backups
```

**Do not set up** the rclone remote inside this iteration's scope — the
script will detect its absence and log a "skipping offsite copy" line. Once
a remote is configured (`rclone config` on the VPS) the next run will
automatically push the dump to `hetzner-s3:alphadesk-backups/daily/`.

