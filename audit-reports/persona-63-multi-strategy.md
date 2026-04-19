# Persona 63 — Multi-Strategy Concurrency Audit

**Scope:** All 12 registered strategies (`dual_momentum`, `earnings_vol`, `kama_breakout`, `momentum_quality`, `orb`, `pairs_trading`, `pead`, `regime_adaptive`, `rsi2_reversal`, `ts_momentum`, `vrp_harvest`, `vwap`) running concurrently under a single `MasterAgent` instance. Pre-live-trading review.
**Verdict:** DO NOT GO LIVE. Concurrency primitives around trade gating are effectively absent; STRATEGY_LIMITS is silently wrong; Persona-16's drawdown-halt gap is confirmed and worse than flagged.

---

## Top 10 Findings (by severity)

### P0-1. MasterAgent is mutated by 12 concurrent coroutines with NO lock
**File:** `backend/data/ingestion/daily_pipeline.py:1295-1298`, `backend/data/ingestion/master_agent.py:463-725`.
`await asyncio.gather(*[_run_single_strategy(s) for s in strategy_instances])` fans out 12 strategies in parallel. Each calls `master.request_trade()`, which mutates `self.existing_positions`, `self.pending_orders`, `self.cash`, and `self.rejections` without an `asyncio.Lock` or `threading.Lock`. `request_trade` itself is sync, so under the GIL a single invocation is atomic — but `request_trade_smart` awaits `smart_review` (up to a 30 s Claude subprocess, `master_agent.py:776`) between the check and the approval write. While that await is pending, another strategy on the same event loop can read stale `cash`, stale `total_deployed`, and approve a trade that blows the portfolio cap. No `asyncio.Lock` exists in `master_agent.py` at all (grep confirmed).

### P0-2. Check-then-act race on portfolio deployment (90% cap unenforceable under load)
**File:** `backend/data/ingestion/master_agent.py:576-586, 553-566`.
`total_deployed + total_pending + notional > self.max_deployment * self.equity` reads summed state, then — many lines later — writes `self.existing_positions[symbol] = {...}; self.cash -= notional`. 12 strategies each requesting a $5k position at the 89% mark can all pass Check 3 simultaneously because each reads the same pre-write deployment total. Result: portfolio deployment silently exceeds the regime cap. Equal-weight `STRATEGY_LIMITS` has the same race.

### P0-3. `STRATEGY_LIMITS` off-by-one — smoke strategy counted in divisor, excluded from pool
**File:** `backend/data/ingestion/master_agent.py:82-115`, `backend/data/ingestion/strategy_adapter.py:513-515`, `backend/strategies/registry.py:210-213`.
`_build_strategy_limits` calls `list_names()` which returns ALL registered strategies including `buy_and_hold_spy` (category `smoke`). With 12 real + 1 smoke = 13 names, each allocation becomes 1/13 ≈ 7.69 %. But `build_all_strategies` strips smoke, so only 12 strategies actually run — they collectively use 12 × 7.69 % = 92.3 % of equity, breaching the 90% deployment cap by construction before any risk check even fires. The 1/13 slot reserved for the smoke strategy is dead capital nobody uses.

### P0-4. Drawdown halt non-functional — confirmed + amplified beyond Persona-16
**File:** `backend/data/ingestion/master_agent.py:211-214, 225-252`, `backend/data/ingestion/daily_pipeline.py:1206-1219, 1310-1321`.
`strategy_peaks`, `strategy_current`, `halted_strategies` are instance attributes re-initialized empty on every `MasterAgent(...)` construction. `daily_pipeline.py:1118` builds a fresh instance every pipeline run — yesterday's halt, peak, and drawdown are discarded. Worse, the "current value" fed to `update_strategy_pnl` (`daily_pipeline.py:1210-1214, 1311-1314`) is `sum(pos.notional)` per strategy, i.e. DEPLOYED CAPITAL, not realized P&L. Closing a winner shrinks notional and registers as a drawdown, while taking a loss that closes the position *also* shrinks notional — both halt the strategy incorrectly, and neither reflects actual performance. The P1 control is non-functional, as Persona-16 flagged; with 12 strategies sharing one instance the wrong-direction signal now fires 12× per run.

### P0-5. Duplicate-symbol race under concurrent `request_trade_smart`
**File:** `backend/data/ingestion/master_agent.py:544-550, 799-849`.
Check 1 tests `symbol in self.existing_positions`. `request_trade_smart` awaits Claude between the rules-based approval and any rollback, and rollback DELETES the symbol (`master_agent.py:832`). Between two concurrent calls for the same symbol with both passing Check 1, the first is tentatively approved (symbol added), Claude is awaited, Claude rejects (symbol removed), the second approval — which was parked on the await — now sees the slot as free and approves. Final state: two strategies own the same ticker. The "no duplicate positions" invariant is violated.

### P0-6. `_build_strategy_limits` cache prevents runtime registry changes but hides registry-load failures
**File:** `backend/data/ingestion/master_agent.py:82-115`.
`_STRATEGY_LIMITS_CACHE` is filled once per process. If `load_all()` fails (import error in any strategy subpackage — `registry.py:247-251` logs + returns empty), `limits = {}` is cached, `STRATEGY_LIMITS` stays empty for the process lifetime, and every `request_trade` falls through to the `0.10` default at line 564 — giving every strategy a 10% cap and allowing ~120% total allocation across 12 strategies. The warning is only logged once; a restart is needed to retry registry load. Ship-blocker.

### P0-7. `_execute_approved_orders` loops AFTER master is done — broker-side failures leave double-counted allocations
**File:** `backend/data/ingestion/daily_pipeline.py:288-426, 703-725`.
During `gather`, `master.request_trade` approves orders and subtracts notional from `master.cash`. Only AFTER all 12 strategies finish does `_execute_approved_orders` call Alpaca. If Alpaca rejects order N (insufficient BP, market closed, whatever), the rollback at 703-725 restores cash and removes the symbol — but by then subsequent pipeline stages have already read `master.get_summary()` (line 1324) for the log and the UI. The summary shows the approved trades as deployed when they never filled. The `master.pending_orders` list can also grow past `existing_positions` (approval races) — no consistency check reconciles them.

### P1-8. `_SHARED_MOMENTUM_DATA` + `_MOMENTUM_GATE_WARNED` class-level state leaks across concurrent pipelines
**File:** `backend/data/ingestion/master_agent.py:41-57, 417, 449`.
`set_momentum_data` and `set_absolute_momentum` write class-level dicts. Per-instance snapshots protect the CURRENT instance, but two overlapping pipeline runs (scheduler + manual /pipeline/run — the pipeline lock is asyncio-only, not cross-worker) both mutate the class dict while each other's instances are mid-decision. `_MOMENTUM_GATE_WARNED` is an unbounded set mutated on every unknown-strategy hit with no clear or eviction — memory leak under any name-churn scenario and an entropy sink across pipeline runs. Concurrency-audit-r4 flagged this at P1; it is still unfixed.

### P1-9. `detect_factor_crowding` warnings are informational only — no action ever taken
**File:** `backend/data/ingestion/master_agent.py:308-395, 1129-1134`.
Crowding warnings (momentum tilt >75 RS, growth tilt >60%, sector >35%) are logged and returned in `log["factor_crowding"]`. Nothing gates the trade loop on them. With 12 momentum-family strategies all running, the "momentum-crowding" warning will fire every single pipeline run and be ignored every single time. Risk dashboard shows them; trades continue unchanged. For live trading, should either auto-tighten conviction threshold or skip the crowded factor's contributor strategies.

### P1-10. VRP `_PENDING_HTTP` module global race (concurrency-audit-r4 P0, still present)
**File:** `backend/strategies/vrp_harvest/provider.py:311, 314-329`.
Flagged at P0 in concurrency-audit-r4 and not fixed. Two concurrent VRP-harvest signals (inevitable when `vrp_harvest` is one of the 12 parallel strategies and produces multiple signals per run) overwrite each other's HTTP client in the module global. Result: intermittent `RuntimeError("no _PENDING_HTTP installed")` or cross-wired authenticated HTTP clients between trades. With all 12 strategies live, this goes from "rare" to "expected daily".

---

## Summary (248 words)

Running all 12 strategies concurrently under `asyncio.gather` with a single `MasterAgent` instance is unsafe today. There is no `asyncio.Lock` anywhere in `master_agent.py`: every `request_trade` path does a read-many-fields / branch / write-multiple-fields sequence, and under the event loop the synchronous `request_trade` is only atomic because it contains no awaits — `request_trade_smart` does, and during the 30 s Claude subprocess window the position-map, pending-order list, and cash counter are all readable by the other 11 strategies. The 90% deployment cap is therefore a soft suggestion, not an invariant. Compounding this, `_build_strategy_limits` divides 1/N using a registry name count that includes the `buy_and_hold_spy` smoke strategy (N=13) while only 12 strategies actually run, so equal-weight allocation overshoots the cap by construction before any race condition even fires. Drawdown halt, as Persona-16 flagged, is non-functional: state resets every pipeline run because `MasterAgent` is reconstructed, and the "current value" fed into it is deployed notional, not realized P&L — closing winners triggers false halts and closing losers triggers real halts for the wrong reason. Several issues predate this review (VRP `_PENDING_HTTP` race, `_SHARED_MOMENTUM_DATA` class-level state, duplicate-exit race between `_check_exits` and bracket stops) but amplify sharply when 12 strategies each fire multiple signals per run. Recommendation: add an `asyncio.Lock` around `request_trade` state mutation, persist drawdown state to Postgres, fix the smoke-strategy divisor bug, and audit VRP before enabling live capital.

**Files audited (absolute paths):**
- `/Users/GK/Downloads/alphadesk/backend/data/ingestion/master_agent.py`
- `/Users/GK/Downloads/alphadesk/backend/data/ingestion/daily_pipeline.py`
- `/Users/GK/Downloads/alphadesk/backend/data/ingestion/strategy_runner.py`
- `/Users/GK/Downloads/alphadesk/backend/data/ingestion/strategy_adapter.py`
- `/Users/GK/Downloads/alphadesk/backend/strategies/registry.py`
- `/Users/GK/Downloads/alphadesk/audit-reports/persona-16-risk-manager.md`
- `/Users/GK/Downloads/alphadesk/audit-reports/concurrency-audit-r4.md`
