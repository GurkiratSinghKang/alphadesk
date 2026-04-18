# Iteration 1 — Backend Audit (post-Phase-2)
Date: 2026-04-18
Scope: code + live state at 87.99.143.65 (container image 751c8c62)

## Severity legend
P0 = data corruption, security risk, or blocks core flow
P1 = correctness bug affecting users
P2 = quality / hygiene
P3 = nice-to-have

## Findings

### [P0] Registry `load_all` completely broken — zero strategies registered in prod
**Where:** `backend/strategies/registry.py:49` (`_PACKAGE = "backend.strategies"`), `backend/data/ingestion/strategy_runner.py:47`
**What:** Live container log: `load_all: cannot import backend.strategies: No module named 'backend'`. Dockerfile sets `WORKDIR=/app` with `strategies/` as a top-level package — `backend` is not on sys.path. Verified inside container: `build_all_strategies()` returns `0`, `list_strategies()` returns `0`. Therefore `ALL_STRATEGIES = []` at runtime.
**Why it matters:** Daily pipeline has nothing to run. The last pipeline log is 2026-04-12 (6 days stale). PEAD/MomentumQuality/etc. never fire. Strategy catalogue also silently uses `_FALLBACK_META` forever.
**Fix:** `_PACKAGE = os.environ.get("ALPHADESK_STRATEGIES_PACKAGE", "strategies")` or ship with a `backend` shim package.

### [P0] `sync_with_alpaca` writes corrupt "closed" trades with `exit_price: null` and `pnl: null`
**Where:** `backend/data/ingestion/trade_ledger.py:241-262`
**What:** Live ledger contains trade id=1 MRK (pead) with `status="closed"`, `exit_reason="alpaca_sync_closed"`, `exit_price=null`, `pnl=null`. When Alpaca returns a position-list that doesn't contain MRK (for any reason — transient 5xx, RBAC hiccup, etc.) the sync blindly marks the ledger trade closed with no price, no P&L. Any GET that triggers sync (routes call `sync_with_alpaca` on every hit to `/strategies/`, `/strategies/leaderboard`, `/strategies/{id}/performance`, `/strategies/{id}/positions`) can silently destroy open-trade records.
**Why it matters:** Permanent P&L loss, win-rate arithmetic breaks (`pnl=None` sneaks into sums as 0), leaderboards skewed.
**Fix:** Only close a ledger trade after confirming the position is really gone (fetch `/v2/account/activities`, cross-check `open_orders`), never from an empty GET; always set `exit_price` to last known current_price if closing; never persist `pnl=None` on closed trades.

### [P0] `sync_with_alpaca` runs on every GET to strategies endpoints
**Where:** `backend/api/routes/strategies.py:931-942, 1050-1057, 1163-1170, 1574-1581`
**What:** Four distinct GET handlers call `ledger.sync_with_alpaca(...)` and re-read the ledger. A single page load triggers 4× JSON file rewrites + a race with the scheduler. The audit's original P0 is still live.
**Why it matters:** Concurrent writes corrupt the ledger JSON; a GET mutating data violates HTTP semantics; each request writes to disk.
**Fix:** Read-only for GETs — run `sync_with_alpaca` only in the scheduler tick.

### [P0] Trade ledger is still a single JSON file guarded by `threading.Lock`
**Where:** `backend/data/ingestion/trade_ledger.py:21, 38-42`
**What:** `_ledger_lock = threading.Lock()` is a thread-local lock but the app runs under Gunicorn+Uvicorn workers (multi-process) and asyncio (single-thread). Neither ProcessLock nor fcntl. `_save` uses `tmp.replace(...)` which is atomic per-file but `TradeLedger()` loads stale state into memory on construction and every mutation replaces the full file. Two concurrent requests → lost writes.
**Why it matters:** Data loss under any concurrent workflow (pipeline tick + strategies GET + manual order at the same time).
**Fix:** Move to the existing `data.storage.models.Trade` SQLAlchemy table (Timescale is running, healthy, and connected).

### [P0] `is_token_revoked` fails closed — one Redis blip logs everyone out
**Where:** `backend/core/auth.py:62-71`
**What:** If Redis `GET` raises, the code logs and returns `True` ("revoked"). Every authenticated API call hits this on every request.
**Why it matters:** The Redis container is healthy right now, but any restart/connection-churn returns 401 on every endpoint — no frontend can function. The audit P0 is unchanged.
**Fix:** Fail open: return `False`, emit a metric, surface a critical alert. Revocation is a defence-in-depth measure, not the primary auth check.

### [P0] Trading `_is_trading_halted` also fails closed the same way
**Where:** `backend/api/routes/trades.py:27-36`
**What:** Same pattern as above — Redis error → halts all trading. A minor Redis bounce halts the bot.
**Why it matters:** Blocks all live orders, scheduler runs, halt/resume flow, and MasterAgent-approved entries.
**Fix:** Use a short TTL in-memory fallback and surface redis health separately.

### [P0] JWT secret fallback to hardcoded string in non-prod
**Where:** `backend/core/config.py:95-99`
**What:** `jwt_secret_value` returns `"dev-insecure-secret-change-me"` when JWT_SECRET empty and not prod. `ENVIRONMENT=prod` on the live VPS is the only thing preventing a hardcoded secret in the wild. A dev who deploys with `ENVIRONMENT=dev` ships tokens signed with a publicly known key.
**Why it matters:** Total auth bypass if the env flag is forgotten (this code shipped to prod once already — it was fortunate the flag was set correctly).
**Fix:** Fail hard in all environments; require a `.env.local` step in the dev docs.

### [P0] `audit-reports/` directory does not exist in the container
**Where:** `backend/api/routes/strategies.py:544` (`_OOS_DIR = Path(__file__).resolve().parents[3] / "audit-reports"`)
**What:** Container filesystem has no `/app/audit-reports/`. `_load_oos_for` → file not exists → all strategies return `sharpe=None, max_drawdown=None, …`. The "real OOS metrics" the audit claims were wired through Phase 2 are not reachable in prod.
**Why it matters:** Every Phase-1 strategy in the catalogue shows null Sharpe/max_drawdown to the user. The whole Phase-1 metrics pipeline is dead weight live.
**Fix:** `COPY audit-reports/phase1-*-oos.json /app/audit-reports/` in the Dockerfile, or serve these from the DB.

### [P0] Anthropic API key rejected (401) yet pipeline silently drops the analyses
**Where:** `backend/data/ingestion/daily_pipeline.py` (claude_alpha + momentum_quality analyses), live `pipeline_logs/2026-04-12.json`
**What:** Every analysis from `claude_alpha` and `momentum_quality` recorded `{"error": "Error code: 401 - invalid x-api-key"}`. The key in env (`sk-ant-oat01-…`) looks like an OAuth token rather than a permanent API key. No strategy using the CLI produces approved trades.
**Why it matters:** Half the strategy stack is inert; pipeline silently succeeds rather than failing loudly.
**Fix:** Rotate the key, add an import-time health-check in `agents.base` that refuses to start if the key 401s.

### [P0] No rate limit for Alpaca-heavy endpoints (`/agents/chat`, `/pipeline/run`)
**Where:** `backend/api/routes/auth.py:26` TODO; `backend/api/routes/pipeline.py:22` (`POST /run`)
**What:** Only `/auth/login` has a sliding-window limiter. Any authenticated user can hammer `/pipeline/run` — each call triggers screening, Anthropic calls, Alpaca round-trips, and file writes. The pipeline itself has an asyncio lock, so flooding just produces `{"error": "Pipeline already running"}`, but the attack surface is still there.
**Fix:** Add the same redis sliding-window limiter to any route that does I/O > ~500ms.

### [P1] `_alpaca_keys_empty()` returns empty list instead of error on `/trades/orders` GET
**Where:** `backend/api/routes/trades.py:281-284, 381-383`
**What:** If Alpaca keys are missing the API returns `[]`. A UI showing "no positions" when the broker is misconfigured looks identical to "no positions". No signal to the user.
**Fix:** Return 503 with a helpful error body; surface at the frontend.

### [P1] `sharpe_ratio` hard-coded to 0 in summaries
**Where:** `backend/api/routes/strategies.py:1015, 1234`
**What:** `StrategySummary` and `StrategyPerformance` both pass `sharpe_ratio=0` — never the computed OOS Sharpe, never the leaderboard Sharpe. OOS is wired into `_STRATEGIES[..]["sharpe_ratio"]` by `_reload_oos_metrics()` but the summary builder never reads it.
**Fix:** `sharpe_ratio=data.get("sharpe_ratio")` in both call sites.

### [P1] `total_invested` accumulates double when a symbol is re-entered
**Where:** `backend/data/ingestion/trade_ledger.py:363-387` and `backend/api/routes/strategies.py:802`
**What:** `get_strategy_performance()` and `_get_real_strategy_performance()` sum `entry_price * shares` across **all** trades (open + closed). A symbol re-entered after exit doubles the "invested" total. `return_pct = pnl / invested` is then understated.
**Fix:** Only sum still-open positions' notional + closed trades' initial notional at time-of-close, or use a single canonical `invested` column on the trade record.

### [P1] `_check_exits` parses entry_time with hard-coded fallback
**Where:** `backend/data/ingestion/daily_pipeline.py:467`
**What:** `datetime.fromisoformat(trade.get("entry_time", "2026-01-01T00:00:00+00:00"))`. Any trade without `entry_time` gets an age of 3+ months and will be force-closed by the 28-day time exit. Silent data destruction.
**Fix:** Skip trades with no `entry_time` and log a WARNING; never use a magic fallback.

### [P1] Pipeline hasn't produced a log in 6 days
**Where:** Live `/app/data/pipeline_logs/` shows 2026-04-11.json, 2026-04-12.json, then nothing. Today is 2026-04-18.
**What:** Either the scheduler isn't firing (P0 above re registry), or the trading-window check silently no-ops on weekends (logged but produces no file). Combined with ALL_STRATEGIES=[], nothing would be written even if it did run.
**Fix:** Emit an empty log every scheduled tick with the reason for no-op (`"reason": "weekend"`, etc.) so stale monitoring alerts.

### [P1] `strategies.sync_with_alpaca` matches strategies by first-open-ledger-trade
**Where:** `backend/api/routes/strategies.py:954-961, 1063-1069, 1178-1186`
**What:** For each Alpaca position, loops through `ledger._data["trades"]` and takes the **first** open trade matching the symbol. If the same symbol is held by multiple strategies (currently blocked by MasterAgent but not enforced in the ledger), unrealised P&L is attributed to the wrong strategy.
**Fix:** Make `position→strategy` a 1:1 constraint in data, not code; or rely on `client_order_id` prefix the pipeline already sets (`{strategy}_{symbol}_{ts}`).

### [P1] `ALPACA_BASE_URL = "https://paper-api.alpaca.markets"` in config.py default
**Where:** `backend/core/config.py:51`
**What:** Still fine (paper), but the `_base_url()` safety check in `daily_pipeline.py` uses `"paper" not in url.lower()` — misses `papertrading.io`-style aliases. If someone re-points to a cname that contains "paper" elsewhere, trades go live.
**Fix:** Check the literal host equals `paper-api.alpaca.markets`.

### [P1] `logout` revokes access but not refresh tokens
**Where:** `backend/api/routes/auth.py:151-164`
**What:** `revoke_token` is called only on the access token, not `refresh_token`. After logout a stolen refresh token can mint new access tokens for 30 days.
**Fix:** Revoke both cookies' tokens.

### [P1] `check_alerts_for_symbol` triggers at `price >= alert.price`
**Where:** `backend/api/routes/trades.py:784-785`
**What:** Uses `>=` for "above" and `<=` for "below". An alert at exactly $100 triggers on the first $100 print. Traders usually want strict crossing.
**Fix:** Compare last two prints and trigger on crossing, or document the semantics.

### [P1] Ledger `record_exit` uses `shares` argument directly, may zero out other fills
**Where:** `backend/data/ingestion/trade_ledger.py:127`
**What:** `trade["shares"] = shares` overwrites with whatever caller passed. Partial fills or multi-strategy sells collapse the record.
**Fix:** Track exit_qty separately; preserve entry shares.

### [P2] `_annualized_return` treats anything < 365 days linearly
**Where:** `backend/api/routes/strategies.py:742-743`
**What:** `annualized = return_pct * (365 / days_held)` for <1yr records — linear scaling, not CAGR. Overstates returns by ~5% for high-return short records.
**Fix:** Use CAGR form uniformly: `((1+r)**(365/d) - 1)*100`.

### [P2] Secrets leaked into the Anthropic OAuth token
**Where:** Live env — `ANTHROPIC_API_KEY=sk-ant-oat01-ccUXWkbz…` is an *OAuth access token*, not a static API key. It will expire and the 401s are the proof.
**Fix:** Replace with a long-lived `sk-ant-api03-*` key; document the difference in the deployment runbook.

### [P2] `_get_symbol_sector_map` imports from `_build_demo_symbols`
**Where:** `backend/api/routes/strategies.py:1345-1351`
**What:** Sector data comes from demo code. If demo is removed (the recent commits suggest that's the direction), sector exposure metrics break.
**Fix:** Persist sector with each trade at entry time.

## What's good
- `_check_duplicate_order` correctly uses Redis `SET NX EX` (atomic).
- `_submit_to_broker` safety-guards `"paper" not in base_url` and refuses live submissions.
- HttpOnly cookies + SameSite=strict on login are correct.
- Circuit breaker and VaR budget logic in MasterAgent is thoughtful.
- Pipeline log format is clean and useful for forensics; the 2026-04-12 log captured the Anthropic 401 signal cleanly.
- `_risk_check` hard-caps single-order notional at $50k.
