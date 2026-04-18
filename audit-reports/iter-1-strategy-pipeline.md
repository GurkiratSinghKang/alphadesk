# Iteration 1 — Live Strategy Pipeline Audit
Date: 2026-04-18
Scope: runtime behavior on 87.99.143.65 container alphadesk-backend

## Verdict
The pipeline is **NOT producing trades**. Two independent P0 blockers: (1) `load_all()` in `strategy_adapter.py` hardcodes package `"backend.strategies"` which does not exist in the container — the actual code is at `/app/strategies`, so `ALL_STRATEGIES` is computed as `[]` at import time and every subsequent `screen()/analyze()` silently resolves zero strategies. (2) Even if that were fixed, `_run_pipeline_inner` references the undefined local `only_strategies` (line 797), raising `NameError` on every scheduler-triggered window. Last successful run was 2026-04-12 16:00 UTC — nothing since. The 4-11/4-12 logs also show that at no point did any trade get approved by Master Agent (0/8 strategies approved any trade that day).

## Evidence table
| Layer | State | Evidence |
|---|---|---|
| Registry load (default) | FAIL | `load_all: cannot import backend.strategies: No module named 'backend'` (stderr on every boot, line 6 of `docker logs`) |
| Registry load (pkg="strategies") | OK | 13 metas: all 12 Phase 1 + `buy_and_hold_spy` |
| ALL_STRATEGIES list | **0** | `from data.ingestion.strategy_runner import ALL_STRATEGIES; len = 0` |
| Scheduler task created | unknown | No "Pipeline scheduler started" stdout line ever appears — startup logs skip from "Booting worker" straight to "Application startup complete" with no lifespan INFO messages |
| Most recent pipeline run | 2026-04-12 16:00 UTC | `data/pipeline_logs/2026-04-12.json` mtime |
| Candidates screened (4-12) | 93 total | MQ=4, PEAD=13, VRP=20, EV=10, Regime=8, claude_alpha=20, mean_rev=6, vcp_breakout=12 |
| Trades proposed (4-12) | 9 | |
| Trades approved (4-12) | **0** | Every strategy ended `trades_approved: 0` |
| trade_ledger.json mtime | 2026-04-18 05:42 UTC | 8 trades total, but 7/8 are `strategy:"manual"` with `"Auto-created by Alpaca sync"` — only 1 real strategy trade (PEAD/MRK from 4-12, now closed by Alpaca sync) |
| Alpaca paper API | reachable | `GET /v2/account` → 200, buying_power $325k |
| Alpaca stop-order POST | **403 Forbidden** | Observed on NKE/PG/WMT during dry-run position check |
| Anthropic API key | **INVALID** | `401 invalid x-api-key` (same error present in every 4-12 analyze row for MQ) |
| Polygon key | present | `POLYGON_API_KEY` set in env (not rate-tested) |

## Findings

### [P0] `load_all()` uses wrong package name → ALL_STRATEGIES is empty
**Where:** `data/ingestion/strategy_adapter.py:251` (inside `LiveStrategyAdapter._load_strategy`) and `:508` (inside `build_all_strategies`). Both call `load_all()` with no args.
**What:** `strategies/registry.py:49` sets `_PACKAGE = "backend.strategies"` as the default. At runtime the module path is `strategies.*` (no `backend.` prefix in the container). `importlib.import_module("backend.strategies")` raises `ModuleNotFoundError`, `load_all` catches it and returns without importing anything. `list_strategies()` returns `[]`, so `ALL_STRATEGIES = []`.
**Why it matters:** Every call path into the pipeline (`daily_pipeline.py` line 798 iterates `ALL_STRATEGIES`) runs zero strategies. The `LiveStrategyAdapter` would also fail to resolve its underlying strategy class even if the pipeline reached that point.
**Fix:** Change `_PACKAGE` to `"strategies"` OR pass `package="strategies"` in both `load_all()` call sites.

### [P0] `_run_pipeline_inner` references undefined `only_strategies`
**Where:** `data/ingestion/daily_pipeline.py:797` — `if only_strategies:`
**What:** `run_daily_pipeline(only_strategies=...)` accepts the arg but calls `_run_pipeline_inner(screen_limit, analyze_limit)` without forwarding it. Line 797 then references a name that is not in the inner function's scope.
**Why it matters:** Every call made by the scheduler (`pipeline_runner._run_window` → `run_daily_pipeline(only_strategies=strategies)`) raises `NameError: name 'only_strategies' is not defined`. Confirmed by direct call today: pipeline caught the exception and wrote "Pipeline exception: name 'only_strategies' is not defined" to errors.
**Fix:** Forward the arg: `_run_pipeline_inner(screen_limit, analyze_limit, only_strategies=only_strategies)` and add the parameter to the inner function signature.

### [P0] Anthropic API key is invalid in container env
**Where:** `ANTHROPIC_API_KEY` env var
**What:** Direct `POST /v1/messages` → `401 invalid x-api-key`. Same error logged for every `momentum_quality` analyze row in `pipeline_logs/2026-04-12.json` (`AVGO`, `MRK`).
**Why it matters:** Even when screens succeed, MQ analysis fails, so MQ never proposes trades. Likely also affects any other strategy that calls Claude for reasoning.
**Fix:** Rotate / re-issue the Anthropic key on the container (docker-compose env or secrets mount).

### [P0] Scheduler `start_pipeline_scheduler()` leaves no log trace
**Where:** `main.py` lifespan (lines 62–70) wraps the call in `try/except Exception as e`.
**What:** The startup log shows only gunicorn INFO lines then "Application startup complete" — none of the `logger.info("Pipeline scheduler started")` / "Alpaca stream" / "Real-time scanner started" / "Continuous market monitor started" lines appear. Either every lifespan startup raised and the exception was swallowed without `logger.warning`, or the logger was silenced before these ran. Note the `logging.basicConfig(force=True)` at line 27 runs AFTER the imports which include `start_pipeline_scheduler`; but even if it ran, the INFO lines inside `_scheduler_loop` should have appeared.
**Why it matters:** Cannot confirm the scheduler is alive without restarting and capturing logs. Also the Redis-backed state key `pipeline:scheduler_state` did not respond (Redis auth error) which blocks window de-dup.
**Fix:** Ensure every `start_*` call either succeeds with a visible INFO line or logs a WARNING on exception; ensure Redis credentials are correct so the state persists.

### [P0] Master Agent approved 0 of 9 proposed trades on last run
**Where:** `pipeline_logs/2026-04-12.json`
**What:** 9 trades proposed, 0 approved. Rejection reasons:
- PEAD/MRK "already held by strategy 'pead'" (good — duplicate guard)
- PEAD/WMT "Strategy 'pead' would exceed allocation (9858 > 9006)" (allocation budget tight)
- EV/INTC "Absolute momentum gate: INTC has negative momentum (-11.2%)"
- Regime/BA "Absolute momentum gate: BA has negative momentum (-10.3%)"
- Others: similar momentum gates
**Why it matters:** The dual-momentum gate is rejecting trades from strategies that are EXPLICITLY about mean-reversion (RSI2, VRP, earnings-vol short-vol). This is an incorrect coupling — a short-vol earnings play should not require 12-month positive absolute momentum. Either the gate is mis-applied across all strategies, or the Master Agent needs per-strategy filter selection.
**Fix:** Audit `master_agent.py` gate logic; momentum gates should be off for RSI2/VRP/EV/pairs.

### [P1] Pipeline's cached strategy list is stale — runs legacy names not in registry
**Where:** `pipeline_logs/2026-04-12.json`
**What:** Log shows 8 strategies ran: `momentum_quality, pead, vrp_harvest, earnings_vol, regime_adaptive, claude_alpha, mean_reversion, vcp_breakout`. Three of those (`claude_alpha`, `mean_reversion`, `vcp_breakout`) are NOT in the Phase 1 registry — and the 7 actually-registered Phase 1 strategies (`ts_momentum, rsi2_reversal, dual_momentum, pairs_trading, kama_breakout, orb, vwap`) DID NOT run.
**Why it matters:** The "12 Phase 1 strategies" claim is false on a per-run basis. Even before the P0 blockers, only ~5 of the intended 12 ever ran in a daily window, and 3 legacy names are still being invoked from somewhere.
**Fix:** Verify `build_all_strategies` once load_all is fixed enumerates all 12; strip any residual legacy references.

### [P1] Alpaca stop-loss orders return 403 Forbidden
**Where:** Position-check loop (observed on NKE, PG, WMT during dry run)
**What:** `POST /v2/orders` for `stop` orders → 403 Forbidden. Account itself is reachable (200 on /v2/account), so it's order-specific — likely trying to attach a stop to a position that has no remaining qty available (PDT / wash-trade / tied up in another order), or using a symbol Alpaca rejects.
**Why it matters:** Positions have no stops set. `trade_ledger.json` shows 7 open positions with `stop_loss: null` — they are entirely unprotected downside.
**Fix:** Log the full 403 body, inspect which positions are missing `qty_available`, gate stop-attach on available qty.

### [P1] Trade ledger shows 7/8 trades are "manual"
**Where:** `data/pipeline_logs/ledger.json`
**What:** Of 8 ledger entries, 7 have `strategy: "manual"` with rationale "Auto-created by Alpaca sync (matched to manual)" — these were existing Alpaca positions the ledger adopted because it couldn't match them to a strategy. Only one true strategy trade (PEAD/MRK) exists, and it was just auto-closed by `alpaca_sync_closed` on 2026-04-18.
**Why it matters:** The pipeline has not originated a trade since 4-12 (6 days). The "live strategy trades" count is effectively zero.
**Fix:** Resolves once P0s above are fixed.

### [P1] Factor-crowding warns "strategy:manual 100%"
**Where:** Master Agent portfolio check output
**What:** `"Strategy 'manual' owns 7/7 positions (100%). Diversify across strategies."` — correct observation given the above, but means the pipeline is now blocking new trades based on its own failure to produce strategy trades.
**Why it matters:** Even after fixing the P0 bugs, the factor-crowding medium warning could suppress new allocations until manual positions are reclassified.
**Fix:** Allow positions marked `"auto-created by Alpaca sync"` to be ignored from strategy-crowding calcs, or force-reclassify them.

### [P2] Regime detection appears to produce signals but context is thin
**Where:** `regime_adaptive` output: "Industrials ranked #1 (avg score 68). Top sector — overweight."
**What:** Rankings are being produced with sector scores. Could not verify VIX ingestion — the daily log doesn't record the regime input (VIX, SPY trend, breadth).
**Why it matters:** Without logging the regime snapshot, can't validate regime correctness after the fact.
**Fix:** Log the full regime snapshot (VIX level, regime bucket, breadth) into each pipeline log entry.

### [P2] Pipeline log schema omits per-strategy timing
**What:** Logs record `screened/analyzed/trades_requested/trades_approved` but no wall-clock timing, no API call counts, no cost tally.
**Why it matters:** Can't diagnose performance or rate-limit issues.
**Fix:** Add `elapsed_ms`, `claude_calls`, `polygon_calls` per strategy.

### [P2] Scheduler de-dup keyed by date — one-shot windows unrecoverable
**Where:** `pipeline_runner._run_window` sets `state[f"last_{window_name}"] = today` BEFORE calling `run_daily_pipeline`.
**What:** If the run fails (P0 NameError above) the state is already marked as "ran today" so the window won't retry.
**Fix:** Set state AFTER successful completion, or wrap in try/except that rolls back.

### [P2] Trading window is 9:35–15:55 ET — blocks all out-of-hours testing
**What:** `_is_within_trading_window` gates the whole pipeline; the 4-11 log is from 19:30 UTC (15:30 ET — inside window) and 4-12 is from 16:00 UTC (Sunday — weekend!). Suspicious the weekend log exists at all.
**Why it matters:** Either the window check was bypassed for that run, or `_run_window` was called manually. Worth verifying against scheduler intent.

### [P2] Trade ledger closure inference is brittle
**What:** `id:1 MRK` was marked closed with `exit_reason: alpaca_sync_closed` and null prices on 4-18 — meaning the Alpaca-sync adopted the disappearance of the position but couldn't reconstruct exit price/PnL.
**Fix:** When Alpaca returns a closed lot, fetch the fill and record actual exit_price.

### [P2] `mean_reversion` and `vcp_breakout` in log but not in registry
**What:** Log shows these strategies running, but the registry has no such names. Dead adapters still referenced somewhere.
**Fix:** grep the codebase for leftover adapter classes and prune.

## What's good
- All 12 Phase 1 strategy packages exist under `/app/strategies/` and import cleanly when `load_all(package="strategies")` is invoked manually.
- Alpaca paper API key is valid; buying power $325k on a healthy paper account.
- Master Agent's rejection logic is actually working: duplicate-symbol guard, allocation budgets, and momentum gates all fire with clear reasons in the log.
- `TradeLedger` reconciliation with Alpaca positions is running (even if it overwhelmingly picks up manual positions).
- `ENVIRONMENT=prod` but `ALPACA_BASE_URL=paper-api.alpaca.markets` — the hard safety check (`_base_url` refuses non-paper URLs) is wired correctly.
- Pipeline log structure is clean JSON, easy to diff across days.
