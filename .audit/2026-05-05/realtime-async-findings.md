# Real-time/Async/Concurrency Adversarial Findings (2026-05-05)

**Auditor scope:** Fresh adversarial pass focused on code merged since 2026-04-18
(Plan B.1 multi-leg ledger PR #42, claude_alpha LLM strategy, kill-switch L1/L2/L3
+ observability panel, sector_rotation / mean_reversion / vcp_breakout / dividend_capture
strategies, ticker context service, broker-connections multi-tenant rewrite).
The R4 audit (`audit-reports/concurrency-audit-r4.md`, 2026-04-18) was read first;
none of the findings below duplicate that work — they are all NEW post-Plan-B.1 surface.

## Summary

**11 findings** — **3 P0** (kill-switch is dead code, multi-leg fill backward delivery,
realtime-scanner setups race) — **5 P1** (filled_qty regression, manual disable
race, ticker_context unbounded lock map, alpaca refresh-loop race carry-over,
multileg class-level `_warned` flag) — **3 P2** (broker-conn upsert race,
emergency disable missing IntegrityError handler, metrics/csp/vitals dict
mutation under no lock).

## Findings (grouped by theme)

---

### Theme 1 — Kill-Switch & Manual-Disable

#### F1 — Three-layer kill-switch is implemented + tested, but NEVER called from the live pipeline (the wrapper is dead code)

**Severity:** P0 (security control bypass — money)
**File:**
  - `backend/strategies/_core/kill_switch.py` (impl + InMem repo + Postgres repo)
  - `backend/strategies/_core/runners/pipeline_runner.py:32-68` (`invoke_strategy_with_kill_switch`)
  - `backend/strategies/_core/runners/pipeline_runner.py:362-370` (TODO marker — wrapper NOT installed)
  - `backend/data/ingestion/daily_pipeline.py` (no `kill_switch`, `KillSwitch`, `is_enabled`, or `strategy_disabled_events` references found)
  - `backend/api/routes/strategies.py:2530-2585` (`emergency_disable` writes to Postgres)
  - `frontend/src/app/(dashboard)/strategies/[id]/_strategy/KillSwitchStatusPanel.tsx` (UI button exists)

**Reproduction:**
1. Operator hits the "Emergency disable" button in the KillSwitchStatusPanel for `pead`.
2. UI POSTs to `/api/v1/strategies/pead/emergency-disable`.
3. The route inserts a `strategy_disabled_events` row with `layer=3, resolved_at IS NULL`.
4. Audit log records the event; UI shows "disabled".
5. Next pipeline tick fires `run_daily_pipeline()`. `daily_pipeline.py` does NOT
   query the `strategy_disabled_events` table, does NOT instantiate `KillSwitch`,
   and does NOT call `invoke_strategy_with_kill_switch`. `pead` runs normally
   and emits live signals. The line at `pipeline_runner.py:370` is the bare
   `result = self._strategy.run(input, params)` call that the wrapper at
   line 362 explicitly says it should replace, with the
   `# TODO(kill-switch-wire-up):` comment confirming the gap.
6. Layer 1 (drawdown) and Layer 2 (daily-pnl) NEVER trigger — no caller
   ever passes a `KillSwitchContext` with peak_nav / current_nav / realized_today.

**Impact:** The advertised "three-layer kill-switch" is a UI placebo. Operators
believe pressing "Emergency disable" stops the strategy from emitting capital;
in reality the next pipeline run trades it normally. A drawdown-driven Layer-1
auto-disable is impossible because the wrapper is never invoked. The DB table
fills with rows that nothing reads.

**Fix:**
1. Wire the wrapper at `pipeline_runner.py:370`: replace
   `self._strategy.run(input, params)` with
   `invoke_strategy_with_kill_switch(strategy=self._strategy, input=input, params=params, kill_switch=self._kill_switch, kill_switch_context=ctx)`.
2. In `daily_pipeline._run_pipeline_inner`, before each `runner.run_today(...)`
   call, build a `KillSwitchContext` from `master.peak_nav` (or pull from
   trade_ledger), `master.current_nav`, the strategy's allocated capital,
   and `realized_today` (sum of today's `Trade.exit_price - entry_price` for
   trades tagged with that strategy).
3. Wire the `KillSwitch` instance through `DailyPipelineRunner.__init__` (currently
   ignored) using `PostgresDisabledEventsRepo` against the same async session
   the runner already uses.
4. Add an end-to-end test asserting that an inserted layer-3 row blocks the
   next `run_today()` call from producing any signal.

---

#### F2 — `PostgresDisabledEventsRepo` sync facade calls `asyncio.get_event_loop().run_until_complete()` — wedges the event loop the moment any sync caller hits it

**Severity:** P1 (latent until any sync caller wires the kill-switch)
**File:** `backend/strategies/_core/kill_switch.py:408-425`

**Reproduction:**
```python
# Current sync facade:
def insert(self, event: DisabledEvent) -> DisabledEvent:
    import asyncio
    return asyncio.get_event_loop().run_until_complete(self.insert_async(event))
```
Inside any FastAPI handler (running on the live event loop):
1. A future caller wires `KillSwitch(repo=PostgresDisabledEventsRepo(session))`.
2. `kill_switch.is_enabled(strategy, ctx)` calls `repo.latest_unresolved_for_strategy(...)` (sync).
3. That calls `asyncio.get_event_loop().run_until_complete(...)` — but the
   current event loop is ALREADY running (we're inside an `await`-driven
   handler). Python raises `RuntimeError: This event loop is already running`,
   or worse, deadlocks when an older Python is permissive.
4. Even if it didn't raise, `get_event_loop()` is deprecated in 3.10+ and
   under 3.12 returns `DeprecationWarning` + creates a NEW loop in some paths.

**Impact:** The moment F1 is fixed by wiring the wrapper, the Postgres-backed
repo immediately deadlocks. The `InMemoryDisabledEventsRepo` works (it doesn't
touch the loop), so tests pass, but production goes red on first invocation.

**Fix:** Convert the `KillSwitch` interface to async (rename `is_enabled` →
`is_enabled_async`, take care of the layer methods) and remove the sync
facade entirely. Or wrap the repo with `asyncio.run_coroutine_threadsafe()`
in a dedicated thread, but that introduces its own ordering hazards. Async
all-the-way-down is the right call.

---

#### F3 — `emergency_disable` and `re_enable_strategy` use SELECT-then-INSERT/UPDATE without explicit `IntegrityError` catch — race losers see HTTP 500 instead of idempotent "already_disabled"

**Severity:** P2 (operator UX — looks like a system error during double-click)
**File:** `backend/api/routes/strategies.py:2530-2585, 2588-2644`
**Migration:** `backend/alembic/versions/0014_strategy_disabled_events.py:43-49` (partial unique index `WHERE layer=3 AND resolved_at IS NULL`)

**Reproduction:**
1. Two operators (or one operator double-clicking from the panel) both call
   `POST /api/v1/strategies/pead/emergency-disable` within the same network round trip.
2. Both `SELECT ... WHERE strategy='pead' AND layer=3 AND resolved_at IS NULL`
   return `None` (no existing event).
3. Both `INSERT` proceed concurrently. The partial unique index catches the
   second insert with `psycopg.errors.UniqueViolation` → SQLAlchemy
   `IntegrityError` → un-handled exception → HTTP 500.
4. Operator sees "Server error" toast; the disable is actually IN EFFECT
   (one insert succeeded), but the user thinks it failed and tries again.

**Impact:** Confusing UX during emergencies. The event is logged but the
admin keeps clicking. Audit log shows multiple "attempted disables" for one
intent.

**Fix:** Wrap the INSERT in `try/except IntegrityError` and on hit re-query
to return the existing row's id with `success=False, message="already_disabled"`
(matches the planned semantics). Or use `INSERT ... ON CONFLICT DO NOTHING
RETURNING id` and handle the empty-RETURNING case.

---

### Theme 2 — Multi-leg Ledger (Plan B.1) Race & Replay Hazards

#### F4 — Multi-leg fills can stamp `Trade.filled_qty` BACKWARD when `partial_fill` events arrive out-of-order or are replayed by Alpaca

**Severity:** P0 (data corruption — false position size in dashboard + downstream P&L)
**File:** `backend/data/ingestion/fill_reconciler.py:513-532` (the `J-17` block)

**Reproduction:**
Alpaca's broker `trade_updates` stream sends two `partial_fill` events for
order `O123` with a 100-share parent:
- Event A: `filled_qty=30` (timestamp T+0)
- Event B: `filled_qty=80` (timestamp T+1)

Order of arrival is NOT guaranteed when:
- Reconnect replay: Alpaca redelivers buffered events on broker-WS reconnect,
  and the redelivery batch order can differ from original send order
  (`alpaca_stream._run_trade_updates_stream` reconnects with no
  monotonic-cursor enforcement).
- The fill_reconciler subscribes to Redis pubsub which guarantees nothing
  about cross-publisher ordering. If the boot-time `reconcile_on_boot`
  also catches up on missed events, those interleave with live pubsub.

When B arrives first then A:
- B writes `trade.filled_qty = 80` → commit (version bumps to 1).
- A writes `trade.filled_qty = 30` → commit (version bumps to 2).
- Final state: `filled_qty=30`, but actually the order is 80% filled.

The unconditional assignment at line 527 (`trade.filled_qty = fq_dec`) has
no monotonic guard. The optimistic-locking note at lines 553-559 protects
torn writes but NOT ordering — both writes succeed serially, the LATER
write wins.

For a multi-leg options ticket (4-leg iron condor, etc.) each leg can have
its own `partial_fill` cycle, all keyed off the SAME `Trade.broker_order_id`
when bracket parent is collapsed; cumulative-vs-leg semantics are even more
fragile.

**Impact:**
- Dashboard `filled_qty` regresses mid-trade.
- Pipeline sizing logic that consumes `filled_qty` (J-17 spec said "downstream
  pipeline code can size against the actually-filled qty") will under-size
  or over-size subsequent rebalances.
- P&L attribution at the leg level for multi-leg signals (vrp-harvest,
  earnings-vol post-Plan-B.1) is unreliable.

**Fix:** Guard the assignment with a max:
```python
if fq_dec > 0 and hasattr(trade, "filled_qty"):
    cur = Decimal(trade.filled_qty or 0)
    if fq_dec > cur:
        trade.filled_qty = fq_dec
```
Plus: add a monotonic event-ordering field (Alpaca's `data.timestamp` parsed
to UTC) and track `last_fill_ts` on the row so an out-of-order earlier event
is dropped entirely, not silently merged. Long term: switch the reconciler
to read from the durable Redis stream (`xrevrange`) with a per-order cursor
instead of pubsub, so replay determinism is guaranteed.

---

#### F5 — `FillSimulator._multileg_warned` is class-level mutable — concurrent `BacktestRunner.run_today` invocations from the same process race the flag

**Severity:** P1 (test flakiness — production effect is nil because the warning is one-shot informational, but the pattern is identical to the prior `_MOMENTUM_GATE_WARNED` finding the R4 audit flagged)
**File:** `backend/strategies/_core/fills.py:201, 225-233`

**Reproduction:**
```python
class FillSimulator:
    _multileg_warned: bool = False  # class-level
    ...
    if not FillSimulator._multileg_warned:
        FillSimulator._multileg_warned = True
        log.warning(...)
```
Two parallel backtests in pytest (or `BacktestRunner` instances spawned via
`asyncio.gather`) both encounter a multi-leg signal with no `options_provider`
wired. Both read `_multileg_warned == False`, both pass the guard, both log
the warning. Harmless. BUT: a future test that asserts "warning emitted
exactly once" will flake. More important: the moment a future code path
mutates this flag for state (e.g. "skip the slow native path after first
fallback"), the race produces real divergent behavior between sibling
runners.

**Impact:** Currently nil. Tomorrow when the flag is repurposed, real bug.

**Fix:** Move to `threading.Lock` + per-instance flag. Or use Python's
`logging.warning` `cache` mechanism (already de-dupes by stack-frame
identity). Or just drop the once-per-process guard and let the warning
fire — it's a configuration error and operators benefit from seeing it
on every fallback.

---

#### F6 — `claude_alpha` replay cache (`Path.home() / ".alphadesk" / "claude_alpha_cache"`) is shared across all users + all backtest workers; `tmp.replace(path)` is atomic per-file but NOT atomic across the read-then-write race

**Severity:** P2 (cross-tenant cache leakage when MULTI-TENANT-MIGRATION lands; today benign)
**File:** `backend/strategies/claude_alpha/strategy.py:64, 250-279, 308-321`

**Reproduction:**
1. User A backtests `claude_alpha` for `(prompt_id="v1", asof=2026-04-15, input_hash=abc)`.
2. Cache miss → deterministic fallback computes scores → writes
   `~/.alphadesk/claude_alpha_cache/v1_v0_2026-04-15_abc.json`.
3. User B (different tenant when multi-tenant lands) runs the SAME
   `(prompt_id, asof, input_hash)` — the input_hash is purely a hash of bars +
   fundamentals + asof, so it's the same on the same data window across users.
4. User B silently serves user A's cached scores. If user A had a corrupted
   feed (one bad bar that hashed identically), user B inherits the corruption.
5. If two replay workers race step (2): both check `path.exists() == False`,
   both compute scores, both `tmp.write_text` → `tmp.replace(path)`. Last
   writer wins; the JSON is well-formed on disk but represents whichever
   worker finished its tmp write last — non-deterministic given parallel
   floating-point determinism is brittle.

**Impact:** Fine today (single-tenant, kind="research" so no live capital).
Becomes a real correctness bug the moment kind flips to autonomous AND/OR
multi-tenant ships.

**Fix:** Add a process-PID/tenant suffix to the tmp filename
(`tmp = path.with_suffix(f".{os.getpid()}.{uuid.hex[:8]}.tmp")`) so concurrent
writers don't collide. Add tenant scoping to the cache directory once
multi-tenant lands. Consider moving to Postgres-backed scoring cache keyed
by `(tenant_id, prompt_id, prompt_version, input_hash, asof)`.

---

### Theme 3 — Realtime Scanner Race (Carry-over and NEW)

#### F7 — `register_setup` mutates `_pending_setups` synchronously WITHOUT acquiring `_setups_lock`; `_evaluate_tick`'s lock-protected dict-rebuild loses concurrent registrations

**Severity:** P0 (lost setups — strategies whose triggers fire during the rebuild window silently never execute)
**File:** `backend/data/ingestion/realtime_scanner.py:191-230, 348-360`

**Reproduction:**
The lock comment at line 176-179 says all three call sites (`register_setup`,
`clear_expired_setups`, `_evaluate_tick`) serialise via `_setups_lock`. But
`register_setup` is a SYNC `def` and never acquires the lock — it just does
the copy-on-write rebind directly:
```python
def register_setup(setup):
    ...
    next_map = dict(_pending_setups)
    next_map[sym] = [*existing, setup]
    _pending_setups.clear()
    _pending_setups.update(next_map)
```

Concurrent sequence:
1. Tick handler `_evaluate_tick("MSFT", ...)` enters at line 350, grabs
   `_setups_lock`, computes `next_map = dict(_pending_setups)` (copy).
2. Daily pipeline calls `register_setup({"symbol": "AAPL", ...})` (sync,
   no await, no lock). This rebinds `_pending_setups` with AAPL added.
3. Tick handler resumes, does `_pending_setups.clear()` then
   `_pending_setups.update(next_map)` — AAPL setup gone.

The lock comment is a lie because `register_setup` is sync; the asyncio
lock can't see it. Under CPython GIL the dict ops themselves are atomic,
but the `clear()+update()` sequence is two separate ops with no atomicity
between them, and the AAPL insert is invisible to the tick handler's
in-progress rebuild.

**Impact:** A pead/orb/vcp setup registered between the daily-window scan
output and the tick handler's next iteration silently disappears. The
trade never fires. There's no log indication — the setup was "registered"
(per the log at line 227), it just no longer exists when the price tick
arrives. Noisy at market open when both paths are most active.

**Fix:** Convert `register_setup` to async + grab `_setups_lock`. Or move
all three call sites to a shared synchronous lock (`threading.Lock`) since
the underlying state is shared with sync entry points. The simplest fix:
```python
async def register_setup(setup):
    async with _setups_lock:
        ... existing logic ...
```
And update the daily pipeline caller to `await register_setup(...)`.

---

### Theme 4 — Ticker Context Service (Plan B.5 adjacency)

#### F8 — `_LOCAL_FACT_LOCKS` module-global dict grows unboundedly: one entry per `(symbol, namespace, key)` tuple, never evicted

**Severity:** P1 (memory leak — slow but real)
**File:** `backend/services/ticker_context.py:34, 370, 423`

**Reproduction:**
```python
_LOCAL_FACT_LOCKS: dict[str, asyncio.Lock] = {}
...
lock = _LOCAL_FACT_LOCKS.setdefault(lock_key, asyncio.Lock())
```
Each request for ticker context consumes up to `len(symbols) * len(needs)`
entries (capped by validation at 50 symbols × 6 needs = 300 keys per
request). The set of `(symbol, namespace, key)` keys is unbounded across
the universe of all tickers ever queried × all custom-fact namespaces
(strategies create custom facts on the fly via `get_custom_ticker_fact`).

After a year of operation the dict has tens of thousands of entries, each
holding a never-released `asyncio.Lock` (~1KB with overhead). Memory leak
proportional to the cumulative ticker × namespace surface.

There's also a SECOND issue: `setdefault` is "atomic" in CPython for the
KEY check, but the `asyncio.Lock()` creation runs even when the key
exists — the constructor is invoked, the result is discarded. Wasteful
under high QPS.

**Impact:** Low blast radius (locks are cheap), but in a long-running
process serving many distinct symbol+need combos, this dict will be
visible in heap dumps and grow unboundedly. Same shape as the
`_REVOCATION_CACHE` issue R4 flagged.

**Fix:** Bound via `cachetools.LRUCache(maxsize=50_000)` or use
`weakref.WeakValueDictionary` so locks are GC'd after the last waiter
releases them. Alternative: drop the per-key lock entirely and rely on
the Redis-distributed slot (already implemented at line 273-301) — the
cost is occasional duplicate refreshes within a single process, which is
the same fail-mode the R4 audit recommended for the `@cached` decorator.

---

#### F9 — `_score_universe` cache write is non-atomic across the read-decide-write critical section; second worker can clobber first worker's freshly-cached scores

**Severity:** P2 (replay-determinism violated under parallel backtest)
**File:** `backend/strategies/claude_alpha/strategy.py:308-322` (the `_score_universe` flow)

**Reproduction:**
1. Worker A: `_read_cached_scores(path)` → `None` (cache miss).
2. Worker B (parallel walk-forward): `_read_cached_scores(path)` → `None`.
3. Worker A: `scores = _deterministic_fallback_score(universe, A_input, asof)`.
4. Worker B: `scores = _deterministic_fallback_score(universe, B_input, asof)`.
5. Worker A: `_write_cached_scores(path, A_scores)`.
6. Worker B: `_write_cached_scores(path, B_scores)` — overwrites A's.

If `A_input` and `B_input` differ (e.g. user-tweaked params don't reach
`_input_hash`), the cache now serves `B_scores` for queries that should
return `A_scores`. The replay-determinism guarantee the docstring promises
("running the same strategy on the same data twice produces the same
result") is violated under parallel backtests sharing the cache dir.

**Impact:** Replay-cache integrity broken when prompt tuning runs walk-forward
in parallel. Backtests give non-reproducible results — the headline failure
mode the strategy was designed to PREVENT.

**Fix:** Use `tmp = path.with_suffix(f".{os.getpid()}-{uuid.hex[:6]}.tmp")`,
then `tmp.replace(path)` (atomic rename inherits one-of-N semantics; last
writer wins but at least no torn JSON). Or wrap the entire read-compute-write
in a per-key file lock (`fcntl.flock`).

---

### Theme 5 — Carry-over P1s Worth Re-flagging

#### F10 — `alpaca_stream._update_subscriptions` race between watchlist refresh loop and reconnect path persists (no lock added since R4)

**Severity:** P1 (R4 carry-over; still real)
**File:** `backend/data/ingestion/alpaca_stream.py:172-217, 359-371`

**Reproduction:** Same as R4 audit P1 #12. Verified: still no
`asyncio.Lock` around `_current_symbols` mutations. The connect path at
line 359-362 does `_current_symbols = set()` then calls
`_update_subscriptions(ws, set(watchlist))` while `_watchlist_refresh_loop`
(spawned at line 371) can be scheduled in between on the same event loop.
With multiple `await ws.send(...)` and `await ws.recv()` calls inside
`_update_subscriptions`, interleaving is possible.

**Impact:** Transient quote subscription divergence after reconnect during
a watchlist mutation. R4 says "Ticker stops updating for some symbols
after a reconnect during a watchlist change" — still true.

**Fix:** Add module-level `_subscriptions_lock = asyncio.Lock()` and gate
`_update_subscriptions` with `async with _subscriptions_lock:`.

---

#### F11 — `BrokerConnection.upsert_*` SELECT-then-INSERT race produces HTTP 500 on duplicate-tab save

**Severity:** P2 (UX papercut)
**File:** `backend/services/broker_connections.py:441-475`

**Reproduction:**
1. User opens Settings → Broker Connections in two tabs.
2. Saves API key in tab A. POST starts; SELECT returns `None`; INSERT begins.
3. Before tab A's commit lands, user clicks Save in tab B.
4. Tab B's SELECT returns `None` (A hasn't committed yet); INSERT begins.
5. One of the inserts hits the `(username, provider, account_env)` unique
   constraint → SQLAlchemy `IntegrityError` → un-caught → HTTP 500.

The route returns the raw exception body. User sees "Internal Server Error".

**Impact:** Confusing UX; user thinks save failed and may retry, generating
log noise. Same shape as F3.

**Fix:** Wrap the INSERT in `try/except IntegrityError`, on hit re-query
and apply the UPDATE branch. Or use `INSERT ... ON CONFLICT (username,
provider, account_env) DO UPDATE SET ...` and skip the SELECT entirely.

---

## Top Findings (by hit probability under live trading)

| # | Prio | Title | File |
|---|------|-------|------|
| 1 | **P0** | Kill-switch wrapper exists but is never called from live pipeline; emergency disable is a UI placebo | `pipeline_runner.py:362` + `daily_pipeline.py` (no kill_switch refs) |
| 2 | **P0** | `Trade.filled_qty` stamps backward on out-of-order/replay `partial_fill` events | `fill_reconciler.py:513-532` |
| 3 | **P0** | `register_setup` lacks `_setups_lock` — concurrent registrations vanish during `_evaluate_tick`'s rebuild | `realtime_scanner.py:191-230, 348-360` |
| 4 | **P1** | `PostgresDisabledEventsRepo` sync facade calls `run_until_complete` from inside event loop — wedges on first use | `kill_switch.py:408-425` |
| 5 | **P1** | `_LOCAL_FACT_LOCKS` ticker_context dict grows unboundedly | `ticker_context.py:34, 370, 423` |
| 6 | **P1** | `alpaca_stream._update_subscriptions` race carry-over (R4 P1#12 not fixed) | `alpaca_stream.py:172-217` |
| 7 | **P1** | `FillSimulator._multileg_warned` class-level mutable racing parallel runners | `fills.py:201, 225-233` |
| 8 | **P2** | `emergency_disable` no IntegrityError catch — race losers see HTTP 500 | `strategies.py:2530-2585` |
| 9 | **P2** | `claude_alpha` replay cache write race (clobbers concurrent cache write) | `claude_alpha/strategy.py:308-322` |
| 10 | **P2** | `BrokerConnection.upsert_*` SELECT-then-INSERT race → HTTP 500 on duplicate save | `broker_connections.py:441-475` |
| 11 | **P2** | claude_alpha cache shared across users (latent multi-tenant leak) | `claude_alpha/strategy.py:64, 308-321` |

---

## Recommendations

**Priority sequence:**
1. F1 first — landing the kill-switch wiring is short and surgical (the wrapper
   is already implemented + tested). The dashboard panel exists, the DB table
   exists, the only thing missing is one line replacement at `pipeline_runner.py:370`
   plus a `KillSwitchContext` builder. This is a 2-day task that closes a P0
   security control gap.

2. F2 immediately after F1 — converting `KillSwitch` to fully-async is
   straightforward (the layer methods only do repo calls + arithmetic). Otherwise
   F1 lands and immediately deadlocks under Postgres.

3. F4 — the filled_qty regression is a silent data-corruption bug that grows
   in importance as multi-leg options strategies start trading capital.
   Two-line fix.

4. F3 — the emergency-disable IntegrityError fix is a one-paragraph try/except
   that improves the UX of the most-stressful operator interaction (panic
   button under load). Easy win.

5. F7 — `register_setup` lock fix is mechanical (add `async`, add `async with`).
   Mostly invisible today because the daily-pipeline → realtime-scanner
   handoff happens at the start of session when ticks haven't started, but
   still a real bug that bites at midday.

The remaining P2s can batch in a single "concurrency hygiene" sweep —
`_VITALS_HITS` / `_CSP_HITS` / `_LOCAL_FACT_LOCKS` all share the same
"unbounded module-level mutable + no-lock evict" pattern; one `LRUCache`
helper covers all three.
