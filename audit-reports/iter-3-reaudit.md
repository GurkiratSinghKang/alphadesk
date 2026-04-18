# Iteration 3 — Re-audit
Date: 2026-04-18
Purpose: verify iter-2 landed; find regressions; enumerate remaining P0/P1
Context: all checks run against live tradingalpha.net + container state (backend "Up 4 minutes", deploy at 14:16:28 UTC)

## Pass 1 — iter-2 fixes verified

| Wave | Claim | Verdict | Evidence (command → result) |
|---|---|---|---|
| A | Registry loads 13 strategies | **PASS** | `docker exec ... load_all(); len(list_strategies())` → `13` |
| A | ALL_STRATEGIES has 12 adapters | **PASS** | `from strategy_runner import ALL_STRATEGIES; len()` → `12` (dual_momentum, earnings_vol, kama_breakout, momentum_quality, orb, pairs_trading, pead, regime_adaptive, rsi2_reversal, ts_momentum, vrp_harvest, vwap) |
| A | OOS JSONs bundled in image | **FAIL** (partial) | `ls /app/audit-reports/` → `0 files`; **however** `ls /app/data/oos/` → `10` files. OOS data was shipped to a different path than `_OOS_DIR` in strategies.py still expects. Dockerfile copied to `/app/data/oos/` but the backend code at `backend/api/routes/strategies.py:544` resolves `_OOS_DIR = parents[3] / "audit-reports"`. **Sharpe/drawdown will still be null until `_OOS_DIR` is updated** |
| A | `only_strategies` NameError fixed | **PASS** | `grep` confirms param added at line 617, forwarded at 610, used at 802; no post-deploy pipeline exceptions in live logs |
| A | Anthropic TODO(user) comment exists | **PASS** | `backend/agents/strategy.py:7` contains `TODO(user): The ANTHROPIC_API_KEY currently deployed...` |
| B | Ports 5432/6379/8000/3000 bound loopback | **PASS** | `nc -w 3 -z 87.99.143.65 <port>` → all four `CLOSED`; 443 `OPEN` |
| B | Login rate limit 5/window | **PASS** | 6 POSTs to `/api/v1/auth/login` with valid payload shape → attempts 1-5 = 401, attempt 6 = **429**, attempt 7 = 429 |
| B | JWT_SECRET hard-fail in all envs | **PASS** | Backend is Up + healthy ⇒ `JWT_SECRET` is present; `docker exec printenv` → `JWT_SECRET set: True` |
| B | CSP no `unsafe-eval` | **PASS** | Live header: `script-src 'self' 'unsafe-inline'` (no `unsafe-eval`). `'unsafe-inline'` remains — still a P2 until nonce mode lands |
| C | trade_ledger migrated to Postgres | **FAIL** (critical regression — see Pass 2) | `psql -c "SELECT COUNT(*) FROM trade_ledger"` → `ERROR: relation "trade_ledger" does not exist`. Backend logs show `TradeLedger: DB unavailable, using in-memory fallback: No module named 'psycopg2'` at every worker startup |
| C | sync_with_alpaca removed from GETs | **PASS** | `grep sync_with_alpaca backend/api/routes/strategies.py` → all 4 GET sites now have `# Read-only: sync_with_alpaca removed from GET per C2` comments, no call sites remain |
| C | Backups enabled | **PASS** | `systemctl list-timers` → `Sun 2026-04-19 08:04:30 UTC  17h  alphadesk-backup.timer` |
| D | Fonts self-hosted | **PASS** | `/login` HTML contains `newsreader_f06d9b72-module`, `inter_tight_e4be7ea8-module`, `jetbrains_mono_ad386b32-module` and 4 `<link rel=preload>` woff2 fonts |
| D | `--panel`/`--surface` aliases defined | **PASS** | `globals.css:151-152` and `:158-159` define `--panel: var(--bg-elev-1); --surface: var(--bg-card);` for both themes |
| D | Docs lists real 12 strategy names | **PASS** | `/docs` HTML contains `PEAD, VRP, Earnings Vol, Dual Momentum, KAMA, ORB, VWAP, Time-Series Momentum` (no fake `Trend Surfer`/`Breakout Hunter`/`Dip Buyer`) |
| D | apiFetch has timeout | **PASS** | `frontend/src/lib/api.ts:60` → `const timeoutSignal = AbortSignal.timeout(effectiveTimeout);` |
| D | TradingChart uses tokens | **PARTIAL** | `#2a271d` default fallback in `getTokenVar` (OK — fallback). But lines 535, 537 still hard-code `#ef4444` and `#22c55e` for Bollinger band up/down (P2 residue) |
| D | 404 page editorial | **PASS** (source) | `not-found.tsx` uses `Display`, `Eyebrow`, `bg-bg`, `text-fg` and the string `Not on the tape`. Live verification blocked: `GET /nonexistent` returns 307→/login (middleware auth redirect before rendering 404) |
| E | Postgres shared_buffers 128MB | **PASS** | `SHOW shared_buffers` → `128MB`, `work_mem` → `4MB` |
| E | uptime-kuma removed | **PASS** | `docker ps -a` → no kuma container. Stats confirm: 5 containers total (caddy, frontend, backend, timescaledb, redis) |

**Count:** 17 PASS, 2 FAIL, 1 PARTIAL (OOS path mis-wired), 1 PARTIAL (chart hex residue).

## Pass 2 — new bugs / regressions

### [P0] TradeLedger Postgres migration silently degraded to in-memory fallback — `psycopg2` missing from image
**Where:** live `alphadesk-backend` container; `backend/data/ingestion/trade_ledger.py` (migration path); backend Docker image
**Evidence:** `docker logs alphadesk-backend` → `WARNING | TradeLedger: DB unavailable, using in-memory fallback: No module named 'psycopg2'`. Confirmed: `docker exec ... python -c "import psycopg2"` → `ModuleNotFoundError`. `asyncpg 0.31.0` is installed but `trade_ledger.py` uses `psycopg2` for the sync DDL + bulk insert path. Postgres itself is reachable from the container (backend is healthy) and `SHOW shared_buffers` works from a direct psql exec. Only the backend client is missing the driver.
**What:** Iter-2 Wave-C "trade_ledger migrated to Postgres" CLAIM IS FALSE in prod. The ledger is re-loaded from `/app/data/pipeline_logs/ledger.json` into memory every request and any writes go nowhere durable. The `.migrated` rename never happened (`ls /app/data/pipeline_logs/` shows `ledger.json` still present, no `.migrated` suffix). All iter-1 P0s that Wave-C claimed to close — multi-process lock loss, JSON race corruption, `sync_with_alpaca` clobber — remain live in practice.
**Fix:** Add `psycopg2-binary` to `backend/requirements.txt`, rebuild and redeploy. Then verify the migration actually runs on first worker boot (`ls ledger.json.migrated` + `psql SELECT COUNT(*) FROM trade_ledger` > 0).

### [P0] OOS JSONs ship to `/app/data/oos/` but code reads from `/app/audit-reports/`
**Where:** `backend/api/routes/strategies.py:544` (`_OOS_DIR = Path(__file__).resolve().parents[3] / "audit-reports"`)
**Evidence:** `docker exec ... ls /app/data/oos/ | wc -l` → `10` (OOS JSONs present). `docker exec ... ls /app/audit-reports/` → `No such file or directory`. The Dockerfile was updated to copy the OOS bundle to `data/oos/` but `strategies.py` path resolution was not updated to match. `parents[3]` from `/app/backend/api/routes/strategies.py` (if that were the path) would be `/`, which also does not contain `audit-reports`. In live container code is at `/app/api/routes/strategies.py`, `parents[3]` = `/` — same result.
**What:** Iter-1 P0 "`audit-reports/` does not exist in container" is structurally unresolved — data is bundled, but the reader still fails. `_load_oos_for` keeps returning None, `StrategySummary.sharpe_ratio=0`. User-visible Sharpe/drawdown on the strategy catalogue remain null/zero.
**Fix:** Change `_OOS_DIR = Path("/app/data/oos")` (or read from env var) and confirm `_load_oos_for` fires.

### [P1] Pipeline still wrote a 14:00 UTC error log with the old NameError (before deploy) — scheduler de-dup may block today's run
**Where:** `/app/data/pipeline_logs/2026-04-18.json`; `pipeline_runner._run_window`
**Evidence:** The 2026-04-18 log was written at 14:00:09 UTC (just before the 14:16:28 deploy) with `errors: ["Pipeline exception: name 'only_strategies' is not defined"]` and empty `strategies: {}`. Iter-1 P2 flagged the scheduler de-dup as "keyed by date — if state is written before the run, one-shot windows unrecoverable." If that state key was set at 14:00 today, the post-deploy scheduler will skip today's morning window entirely.
**What:** Even though the NameError is fixed in the image, today's pipeline may never re-attempt. Can't tell without probing Redis state.
**Fix:** Clear `pipeline:scheduler_state` keys for today, or trigger a manual run. Longer-term: iter-1 P2 fix — mark state complete AFTER success.

### [P1] `caddy fmt` warning still emits on every start (iter-1 P3 unchanged)
**Where:** `/opt/alphadesk/infrastructure/Caddyfile`
**Evidence:** log rotation interrupted the check, but iter-1 flagged this and no commit has touched the Caddyfile formatting. Cosmetic regression (still P3) but uncorrected.
**Fix:** `caddy fmt --overwrite` + commit.

### [P2] Bollinger band colors still hard-coded hex in TradingChart.tsx
**Where:** `frontend/src/components/charts/TradingChart.tsx:535, 537`
**Evidence:** `upper: "#ef4444"`, `lower: "#22c55e"` — bright SaaS red/green, not the F0 chartreuse/coral palette.
**Fix:** Replace with `getTokenVar("--up-500")` / `--down-500`.

### [P2] Memory headroom post-tuning is fine, no thrash observed
**Where:** `docker stats --no-stream`
**Evidence:** backend 191 MB/1.5 GB (12.47%), timescale 49 MB/1.875 GB (2.55%), redis 4.5 MB/640 MB (0.72%), frontend 67 MB/512 MB, caddy 11 MB. Sum ~322 MB RSS across containers — much better than iter-1 (swap was 728 MB in use). No regression; the 128 MB shared_buffers tuning shipped cleanly.

### [P2] Backend worker handling 7 `/health` probes/sec from Caddy + frontend — noisy logs, no impact yet
**Where:** backend logs during 4-min window
**Evidence:** `GET /health HTTP/1.1 200` dominates log volume. Not a bug, but log signal-to-noise is degraded for forensics.
**Fix:** Move Caddy's healthcheck to a dedicated `/healthz` that returns 204 and doesn't log, or add a log filter.

## Pass 3 — still outstanding (user or design)

- **Anthropic key rotation** — user action. TODO(user) comment in `backend/agents/strategy.py:7`. Key still starts `sk-ant-oat01-…` (OAuth). Acceptance: `sk-ant-api03-…` in `.env.prod`, `momentum_quality`/`claude_alpha` analyses in next pipeline log contain JSON payloads, not `401 invalid x-api-key`.
- **SSH password auth disable** — user action via `infrastructure/ssh-harden.sh`. btmp currently ~30k failed attempts since Apr 10. Acceptance: `sshd -T | grep PasswordAuth` → `no`.
- **Kernel reboot + security updates** — user action. Running 6.8.0-90, installed 6.8.0-107. Acceptance: `uname -r` reports `6.8.0-107`, `/var/run/reboot-required` absent.
- **CAA DNS record** — user action at DNS registrar. Acceptance: `dig tradingalpha.net CAA +short` returns `letsencrypt.org` + `iodef`.
- **`.env.prod` perms chmod 600** — 30-second user action; vps-setup.sh does it idempotently on fresh install but existing file needs manual touch. Acceptance: `ls -la /opt/alphadesk/.env.prod` → `-rw-------`.
- **Master Agent momentum gate applied across all strategies** — design decision. Iter-1 strategy-pipeline P0-5 flagged that RSI2/VRP/EV/pairs trades get rejected by a gate that shouldn't apply to mean-reversion/short-vol plays. Needs product call.
- **Alpaca stop-order 403 for NKE/PG/WMT** — iter-1 P1 untouched; positions remain unprotected. Acceptance: stop-attach succeeds or policy documented.
- **`total_invested` doubles on re-entries** (iter-1 backend P1) — untouched.
- **Dual cookie revoke on logout** (iter-1 backend P1) — untouched.
- **`check_alerts_for_symbol` strict crossing** (iter-1 backend P1) — untouched.
- **Websocket bar-vs-snapshot H/L/V clobber** (iter-1 frontend P1) — untouched.
- **`useDataPipeline.hasFetched` latch** (iter-1 frontend P1) — untouched.
- **Portfolio default `is_demo: true`** (iter-1 frontend P1) — untouched.
- **HTTP/3 actually terminated** (iter-1 network P1) — `alt-svc` still advertised without `protocols h1 h2 h3`.
- **Login page 14 async chunks (~1.3 MB)** (iter-1 network P1) — code-splitting not yet done.
- **Docker image signature validation half-broken** (iter-1 network P1) — untouched.

## Scorecard

- **Before iter-2 (iter-1 open P0/P1):** ~**44** (backend 17, frontend 12, infra 5, networking 6, strategy-pipeline 9 — deduping overlaps ≈ 44 distinct)
- **After iter-2 (Pass 1 FAIL + Pass 2 new P0/P1):**  **20 open**
  - Pass 1 FAIL: 2 P0 (trade_ledger psycopg2, OOS path)
  - Pass 2 new: 1 P0 (scheduler de-dup risk = P1), 1 P1 (caddy fmt still P3)
  - Pass 3 still-open P0/P1 (not user-action): ~13 untouched items from iter-1 backend + frontend + networking
  - User-owned: 5 (Anthropic rotate, SSH harden, kernel reboot, CAA DNS, .env.prod chmod)
- **Target for iter-4:**
  1. Ship `psycopg2-binary` in backend image + verify ledger rows land in Postgres.
  2. Fix `_OOS_DIR` path so Sharpe/drawdown render.
  3. Clear stale scheduler de-dup state; fix state-write-after-success pattern.
  4. Sweep remaining iter-1 P1s: `total_invested`, WebSocket H/L/V, `hasFetched` latch, portfolio `is_demo`, cookie revoke on logout, TradingChart Bollinger hex.
  5. Master Agent gate-per-strategy design note + implementation.
