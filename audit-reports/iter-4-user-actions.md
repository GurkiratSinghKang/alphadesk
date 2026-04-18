# Iteration 4 — User-Required Actions
Date: 2026-04-17
Scope: actions that cannot be completed in code and need the user to act on the
running VPS (`root@87.99.143.65`) or on external providers.

Iter-4 code fixes (psycopg2-binary, `_OOS_DIR` hardening, TradingChart
Bollinger tokens) landed in `feature/deployment` but have **not** been
deployed yet — the items below must be done **after** the rebuild + deploy.

---

## 1. Clear the scheduler de-dup state so today's windows can re-run (P0 — blocks today's pipeline)

### What's wrong
`backend/data/ingestion/pipeline_runner.py::_run_window` records the state key
*before* the strategy batch runs (line 219, `state[state_key] = today; await
cache_set(...)`). The 14:00 UTC `premarket` window on 2026-04-18 hit the old
`NameError: name 'only_strategies' is not defined` from iter-1 P2 and still
wrote `{"last_premarket": "2026-04-18"}` into Redis key
`pipeline:scheduler_state` (TTL 172800s ≈ 48h). After iter-2 deploys the
NameError fix, the scheduler will see today already marked and skip the
re-run — so no pipeline will execute until 2026-04-19.

### What to do
On the VPS, clear the Redis state key so the scheduler re-attempts the next
window on its natural cadence:

```bash
ssh -i ~/.ssh/alphadesk root@87.99.143.65
docker exec alphadesk-redis redis-cli DEL pipeline:scheduler_state
# verify it's gone
docker exec alphadesk-redis redis-cli GET pipeline:scheduler_state   # -> (nil)
```

If you want to also manually trigger today's premarket batch rather than
wait for the next window:

```bash
docker exec alphadesk-backend python -c "
import asyncio
from data.ingestion.daily_pipeline import run_daily_pipeline
print(asyncio.run(run_daily_pipeline(only_strategies=['pead','regime_adaptive'])))
"
```

### Acceptance
- `docker exec alphadesk-redis redis-cli GET pipeline:scheduler_state` returns
  `(nil)` or an object *without* today's `last_*` keys.
- The next window (next 5-min gate that triggers per `WINDOWS` in
  `pipeline_runner.py`) logs `=== PREMARKET window === Running: ...`.

### Longer-term fix (deferred)
Move `state[state_key] = today; cache_set(...)` to **after** `run_daily_pipeline`
returns successfully inside `_run_window`. Same file, ~5 lines.

---

## 2. Rebuild + redeploy the backend image (prerequisite for iter-4 code fixes)

The following iter-4 commits are in `feature/deployment` but must ship in a
new image before they take effect:

- `psycopg2-binary` in `backend/requirements.txt` — TradeLedger sync engine
- `_OOS_DIR` defensive glob check in `backend/api/routes/strategies.py`
- TradingChart Bollinger tokens in
  `frontend/src/components/charts/TradingChart.tsx`

### What to do
```bash
ssh -i ~/.ssh/alphadesk root@87.99.143.65
cd /opt/alphadesk
git fetch origin feature/deployment && git checkout feature/deployment && git pull
docker compose build backend frontend
docker compose up -d backend frontend
# confirm
docker exec alphadesk-backend python -c "import psycopg2; print(psycopg2.__version__)"
docker exec alphadesk-backend ls /app/data/oos/ | wc -l   # -> 10
docker exec alphadesk-backend psql "$DATABASE_URL" -c "\d trade_ledger" 2>/dev/null \
  || docker exec alphadesk-timescaledb psql -U alphadesk -d alphadesk -c "\d trade_ledger"
```

### Acceptance
- `docker logs alphadesk-backend 2>&1 | grep TradeLedger` does **not** contain
  `DB unavailable, using in-memory fallback`.
- `/api/v1/strategies/momentum-quality/performance` returns a non-null
  `sharpe_ratio`.
- `ledger.json` at `/app/data/pipeline_logs/` has been renamed to
  `ledger.json.migrated` after first worker boot.

---

## 3. Rotate the Anthropic API key (carryover from iter-2/3 — still P0)

Unchanged from `iter-2-user-actions.md §1` and `iter-3-reaudit.md` Pass 3.
`ANTHROPIC_API_KEY` on the VPS still starts with `sk-ant-oat01-…` (OAuth
token). Every `momentum_quality`/`claude_alpha` analysis still 401s.

```bash
# Create a new key in https://console.anthropic.com/settings/keys (name it
# alphadesk-prod-vps-2026-04), copy the sk-ant-api03-... value, then:
ssh -i ~/.ssh/alphadesk root@87.99.143.65
cd /opt/alphadesk
cp .env.prod .env.prod.bak-2026-04-17
sed -i 's|^ANTHROPIC_API_KEY=.*|ANTHROPIC_API_KEY=sk-ant-api03-REPLACE|' .env.prod
docker compose up -d backend
```

### Acceptance
- Next pipeline log at `/app/data/pipeline_logs/YYYY-MM-DD.json` has
  `strategies.momentum_quality.analyses[*]` with **JSON payloads**, not
  `401 invalid x-api-key`.

---

## 4. Disable SSH password auth (carryover — P1, 30-second change)

`infrastructure/ssh-harden.sh` is idempotent. btmp shows ~30k failed
password attempts since 2026-04-10.

```bash
ssh -i ~/.ssh/alphadesk root@87.99.143.65
bash /opt/alphadesk/infrastructure/ssh-harden.sh
# verify
sshd -T | grep -E '^(passwordauthentication|pubkeyauthentication)'
```

### Acceptance
- `sshd -T | grep -i passwordauth` → `passwordauthentication no`
- `sshd -T | grep -i pubkey` → `pubkeyauthentication yes`

---

## 5. Kernel reboot + security updates (carryover — P1)

Running `6.8.0-90`, installed `6.8.0-107`. Unpatched local privilege and
network fixes sit on disk until reboot.

```bash
ssh -i ~/.ssh/alphadesk root@87.99.143.65
apt list --upgradable 2>/dev/null | wc -l
apt-get update && apt-get -y upgrade
# only reboot during off-hours (US market closed), e.g. 03:00 UTC Sat/Sun
shutdown -r +5 "kernel upgrade"
```

Ensure `docker compose` has `restart: unless-stopped` on every service first
(it does — `docker-compose.yml` is already hardened).

### Acceptance
- `uname -r` → `6.8.0-107-generic` (or newer)
- `ls /var/run/reboot-required` → file absent

---

## 6. Add CAA DNS record (carryover — P2)

Restricts who can issue TLS certs for `tradingalpha.net` to Let's Encrypt,
and sends incident notifications to your inbox if anyone else tries.

At your DNS registrar for `tradingalpha.net`, add:

```
tradingalpha.net.   86400  IN  CAA  0 issue "letsencrypt.org"
tradingalpha.net.   86400  IN  CAA  0 iodef "mailto:gurkiratkang@gmail.com"
```

### Acceptance
- `dig tradingalpha.net CAA +short` returns both lines.

---

## 7. `chmod 600` on `/opt/alphadesk/.env.prod` (carryover — P2, 5-second change)

```bash
ssh -i ~/.ssh/alphadesk root@87.99.143.65
chmod 600 /opt/alphadesk/.env.prod
ls -la /opt/alphadesk/.env.prod
```

### Acceptance
- `ls -la /opt/alphadesk/.env.prod` shows `-rw-------`.

---

## Deferred (not P0/P1)
- Caddyfile `caddy fmt --overwrite` — cosmetic, run whenever convenient.
- `/healthz` log dampening for backend — reduces log noise.
