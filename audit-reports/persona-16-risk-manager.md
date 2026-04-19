# Persona 16 — Risk Manager Audit

**Scope:** Pre-production risk controls before AlphaDesk handles real capital.
**Methodology:** Code review + live API tests against tradingalpha.net (paper Alpaca).
**Verdict:** NOT READY FOR LIVE CAPITAL. Multiple P0 gaps.

---

## Top 10 Risk Gaps (ordered by severity)

### P0-1. Emergency halt doesn't stop the automated pipeline
`/api/v1/trades/halt` sets Redis key `trading:halted` and is checked ONLY in the manual `POST /trades/orders` handler (`backend/api/routes/trades.py:304`). The daily pipeline (`backend/data/ingestion/daily_pipeline.py`), MasterAgent, and strategy runners never call `_is_trading_halted()`. An operator hitting the panic button still watches the bot place trades on the next cron tick. Fix: add an early abort in `_run_pipeline_inner` and in `request_trade()`.

### P0-2. Halt state has a 24-hour auto-expiry
`_set_trading_halted(True)` writes with `ttl_seconds=86400` (trades.py:44). If a halt is placed during a weekend crisis and nobody re-halts within 24 h, Redis evicts the key and trading auto-resumes silently. Halt must be sticky until explicitly cleared.

### P0-3. Halt cancels pending orders but doesn't flatten positions
`halt_trading` only `DELETE /v2/orders` (cancels open orders). Existing positions stay open and naked to market moves. There is no "flatten all" endpoint anywhere in the repo. For a true kill-switch, add a companion endpoint that liquidates positions at market.

### P0-4. `/trades/orders` endpoint bypasses MasterAgent entirely
The manual order path (`trades.py:294`) runs only `_risk_check()` which enforces a single $50 k notional cap per order and nothing else. I verified live: 5 rapid $16 k orders (= $82 k total) all returned 201 in under a second. No aggregate-notional check, no buying-power check, no per-symbol concentration, no sector cap, no duplicate-position check, no MasterAgent touch. Manual trades are a complete risk bypass.

### P0-5. Drawdown halt state is ephemeral and never persists
`MasterAgent.halted_strategies`, `strategy_peaks`, `strategy_current` are instance dicts initialized empty on every `MasterAgent(...)` construction. Each pipeline run creates a fresh instance (`daily_pipeline.py:1118`), so yesterday's -5 % halt is forgotten by this morning's run. Strategy peak equity also resets, making `STRATEGY_DRAWDOWN_LIMIT` effectively unreachable except within a single run.

### P0-6. Strategy "P&L" tracked in `update_strategy_pnl` is actually deployed notional
`daily_pipeline.py:1210-1214` sums `pos.get("notional")` per strategy and feeds that as `current_value` to `update_strategy_pnl`. Drawdown = notional shrink, so closing a profitable winner registers as negative drawdown and could incorrectly halt the strategy. Real P&L from the trade ledger is never used. The P1 control is non-functional.

### P0-7. `RISK_MONITOR_ENABLED` off disables every safeguard
`MasterAgent.request_trade()` lines 482-501 bypass ALL of: conviction floor, max-positions, position-size cap, buying-power, R:R ratio, strategy allocation, portfolio deployment, sector cap, VaR budget, momentum gates, drawdown halt. Only duplicate-symbol check remains. State is a process-local class attribute (`master_agent.py:129`) — not persisted, resets to `True` on every redeploy, no audit log beyond a WARNING line, no time-bounded off window.

### P1-8. Pre-trade buying-power / margin checks absent
Alpaca paper account currently reports `buying_power=$328 k` on `equity=$101 k` (3.2× margin). Nothing in the code path compares order notional against `account.buying_power` before submission — the order just rejects at Alpaca if it exceeds margin. No wash-sale check, no PDT flag check, no overnight-margin cap.

### P1-9. Live sector concentration already breaches MasterAgent limits
Live portfolio: Industrials 41.58 %, Technology 22.23 %, Consumer Defensive 22.06 %. `MasterAgent.SECTOR_LIMIT = 0.30` is enforced at BUY-time only; there is no rebalancer or warning for existing breaches. `/api/v1/risk/crowding` flags it, but nothing acts. Existing portfolio carries 39 % more Industrials than the stated policy — a 10 % drop on BA is a ~4 % equity hit.

### P1-10. Circuit breaker is pipeline-local and logs-only
`daily_pipeline.py:45 CIRCUIT_BREAKER_PCT = -0.02` is checked once per pipeline invocation (`1064`). A -2 % intraday drop between pipeline runs won't trigger it; realtime_scanner and manual orders ignore it entirely. Discord webhook is best-effort and has no retry. Once tripped it only prevents THIS pipeline run — the next run has a fresh MasterAgent and trades again.

---

## Other material findings (brief)

- `POST /trades/halt` requires `require_auth` only; `toggle_risk_monitor` is admin-only. Inconsistent privilege model — anyone with a valid JWT can halt all trading.
- Stop-loss placement fallback after bracket failure has emergency-unwind logic (good, `daily_pipeline.py:641-674`), but the unwind itself uses a plain market `sell` with no retry — if both fail the position is naked and logged-only.
- `_ensure_stop_orders` uses 5 % hardcoded fallback when ledger has no stop — this is conservative but not strategy-aware.
- No correlation matrix ever populated: `/api/v1/risk/correlation` returns empty strategies/matrix/pairs (live-verified).
- VaR assumes zero cross-position correlation (line 361 comment calls it "conservative" but in practice all positions are long-US-equity — correlation near 1 is realistic and would double the VaR).
- Momentum gate defaults to "apply" for unregistered strategies — safe default, but the warning is emitted once per name, so a broken registry silently rejects every signal from that strategy for the process lifetime.

**Files audited:** `backend/data/ingestion/master_agent.py`, `backend/data/ingestion/daily_pipeline.py`, `backend/data/ingestion/trade_ledger.py`, `backend/api/routes/risk.py`, `backend/api/routes/strategies.py` (risk-monitor + toggle), `backend/api/routes/trades.py` (halt/resume/order), `frontend/src/components/dashboard/RiskDashboard.tsx`.
