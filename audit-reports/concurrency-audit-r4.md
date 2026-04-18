# Concurrency / Race-Condition Audit — Round 4

**Scope:** FastAPI + SQLAlchemy + asyncio + threading mix in backend. React 19 + Zustand + React Query in frontend. Repo at `/Users/GK/Downloads/alphadesk`, live at https://tradingalpha.net.

**Method:** Grepped for `threading.`, `ThreadPoolExecutor`, `asyncio.create_task`, `asyncio.Lock`, `async with`, `Lock()`, `Event()`, `Queue()`, module-level `global` state, dict mutation under async, and reviewed background services (`alpaca_stream`, `pipeline_runner`, `continuous_monitor`, `realtime_scanner`), the trade ledger, the master agent, web socket handler, and frontend hooks/stores/providers.

The prior three rounds fixed the biggest offenders in `daily_pipeline` (sequence-based trade ids, `_pipeline_lock`, Redis SET NX for order dedupe, supervisor wrapper for alpaca stream). This round targets the gaps.

---

### [P0] `_PENDING_HTTP` global overwritten by concurrent VRP chain fetches
**File:** `backend/strategies/vrp_harvest/provider.py:311, 314-329, 266-272`
**Race:** `_fetch_contracts_cached(..., http_source=X)` writes the HTTP client to the module-level `_PENDING_HTTP` global, calls `_PROXY.fetch(...)` (which reads the global back in), then resets to `None` in a `finally`. Two concurrent VRP calls (scheduler + user-initiated run, or two VRP signals processed in the same pipeline window via `asyncio.gather`) will overlap: caller B overwrites A's `_PENDING_HTTP` while A is still inside `_PROXY.fetch`, and A will either use B's client or see `None` after B's `finally` runs first.
**Symptom:** `RuntimeError("no _PENDING_HTTP installed")` — or worse, silent cross-talk where trade A's contracts request goes through trade B's HTTP client (different auth headers / different Polygon account). Intermittent, reproduces under load, hides in "VRP failed: RuntimeError" log lines.
**Fix:** Replace the module global with `contextvars.ContextVar[Optional[HTTPClient]]` (asyncio-safe) and use `token = _PENDING_HTTP.set(http); try: ...; finally: _PENDING_HTTP.reset(token)`. Alternatively, bind the HTTP client into the cache key args and pass through properly.

---

### [P0] `threading.Lock` held across `await` in async `@cached` wrapper
**File:** `backend/data/providers/cache.py:188-200`
**Race:** The async branch of the `cached` decorator does:
```python
lock = _lock_for(key)          # threading.Lock (mutex)
with lock:
    hit = store.get(key, ttl_seconds)
    if hit is not None:
        return hit
    result: pd.DataFrame = await fn(self, *args, **kwargs)  # <-- await UNDER lock
    store.set(key, result)
```
The underlying async function (e.g. an HTTP call to Polygon / FMP) can take seconds. Task 2 arriving on the same key hits the `with lock:` on whichever event-loop thread it's scheduled on — and since the lock is a *threading* lock, not an `asyncio.Lock`, under a single-threaded event loop `with lock:` blocks the entire loop, and under `asyncio.to_thread` contexts (strategy_adapter uses them heavily) produces genuine thread contention.
**Symptom:** Dashboard freezes for the duration of a cold-cache Polygon fetch whenever the worker is busy doing any cached provider call; in the worst case, deadlock if the awaited coroutine itself tries to acquire the same lock (re-entrant call on the same key).
**Fix:** Use `asyncio.Lock` for the async branch, or drop the lock entirely and accept duplicate fetches on race (parquet rename is atomic, so the only cost is an extra wasted HTTP round-trip, which is the lesser evil).

---

### [P0] `realtime_scanner` mutates shared `_pending_setups` without synchronization; endpoint iterates it concurrently
**File:** `backend/data/ingestion/realtime_scanner.py:63-64, 109-118, 132-195`; `backend/api/routes/pipeline.py:346-368` (`get_realtime_setups`)
**Race:** The scanner loop mutates `_pending_setups: dict` and the list `_pairs_setups` on every quote tick (`_evaluate_tick`, `_check_pairs_zscore`). Simultaneously, `clear_expired_setups()` rebuilds `_pending_setups[sym]` (line 110-115) while the tick handler may be mid-iteration. Worse, the HTTP handler `get_realtime_setups` in `pipeline.py:346-368` iterates the same module-level dict directly (`for sym, setups in _pending_setups.items(): for s in setups:`). All three run on the single asyncio event loop, but `_evaluate_tick` has multiple `await`s inside it — during which `clear_expired_setups` or the HTTP handler can run and mutate the dict.
**Symptom:** `RuntimeError: dictionary changed size during iteration` or silently missed triggers (a setup deleted between the scanner's read and the eval's mutation). Pairs list has the exact same pattern with `_pairs_setups = remaining` global rebind.
**Fix:** Copy the dict under a single synchronous non-await section before iterating (`for sym, setups in list(_pending_setups.items()):`), and have `get_realtime_setups` snapshot via deep-copy before rendering. Longer-term: move setups into Redis.

---

### [P0] `publish()` mutates caller-owned dict — shared-reference race
**File:** `backend/core/redis.py:51-56`
**Race:** `publish` does `data["_ts"] = time.time()` on the *caller's* dict. Callers frequently reuse dicts (e.g. a cached `alert = alerts[i]` dict referenced by multiple tasks and/or re-read from Redis), and `publish` is awaited, so between the mutation and the `orjson.dumps` another task iterating `alert.items()` will see a mid-mutation dict.
**Symptom:** `RuntimeError: dictionary changed size during iteration` in any code path that reads alert/price-alert/pipeline-status dicts while they are published. Also corrupts callers that serialize the same dict again downstream — they'll carry a stale `_ts`.
**Fix:** `payload = {**data, "_ts": time.time()}` before serialising; never mutate the argument.

---

### [P0] `toggle_strategy` lost-update race — read / write is not atomic in Redis
**File:** `backend/api/routes/strategies.py:1337-1359, 921-938`
**Race:** `toggle_strategy` does `_get_strategy_status_override(strategy_id)` (GET from Redis), computes inverted status, then `_set_strategy_status_override(...)` (SET to Redis). Two simultaneous toggles (user double-clicks, or two tabs open) will both read the same current state, both invert, and both write — the second write wins. Net effect of two clicks: flip once instead of zero.
**Symptom:** Strategy status toggle intermittently feels "stuck"; user clicks twice thinking the first didn't register, both POSTs land, and the strategy ends up in the original state.
**Fix:** Single-shot atomic operation. Use Redis Lua script or `GETSET` with expected-value check. Cleaner: accept a `{status: "active"|"paused"}` payload on the endpoint and use Redis `SET` unconditionally — let the client decide what state to target (idempotent).

---

### [P0] `daily_pipeline._check_exits` calls non-existent `ledger._persist()` + in-memory mutation of ephemeral DB rows
**File:** `backend/data/ingestion/daily_pipeline.py:473-510`
**Race:** After the P0 ledger migration to Postgres, `_persist()` no longer exists on `TradeLedger` (grep confirms). The trailing-stop branch still calls `ledger._persist()` (line 482), which raises `AttributeError`. Even if it didn't, the preceding `trade["stop_loss"] = round(new_stop, 2)` mutates a dict that was freshly loaded from the DB via `get_open_positions()` — the mutation lives only in the current iteration's local list, evaporates on the next call, and never hits the DB. Under concurrent `_check_exits` invocations (scheduler + manual trigger) both compute the same `new_stop`, both attempt to place a stop order, both end up cancelling each other's orders.
**Symptom:** Stops get raised on Alpaca but the ledger still shows the old stop (reconciliation drift). `AttributeError` swallowed by the `except Exception` a few lines down and logged as a "trailing stop failed" warning. Over time, trailing stops stop working.
**Fix:** Replace `ledger._persist()` with `ledger.update(trade["id"], {"stop_loss": round(new_stop, 2)})`. Add a second-layer dedupe on "trailing-stop for symbol X" using Redis `SET NX` with 60s TTL so only one worker does the Alpaca cancel+place pair per window.

---

### [P1] `master_agent._MOMENTUM_GATE_WARNED` and `_SHARED_MOMENTUM_DATA` mutated from multiple pipeline invocations
**File:** `backend/data/ingestion/master_agent.py:41-57, 416-417, 449`
**Race:** `MasterAgent.set_momentum_data()` / `set_absolute_momentum()` are classmethods that overwrite the class-level shared dicts, called from `daily_pipeline._run_pipeline_inner` during the momentum-population pass. Meanwhile, an earlier `MasterAgent()` instance (same pipeline run) has already snapshotted the previous state. If a *second* run is triggered before the first completes (it shouldn't, due to `_pipeline_lock`, but the lock is asyncio-level — a `ThreadPoolExecutor` call path or a different entry point bypasses it), the second run will mutate `_SHARED_MOMENTUM_DATA` while the first run's `request_trade` is still reading it. `_MOMENTUM_GATE_WARNED` is a mutable set mutated from `_momentum_gate_exempt` every time an unknown-strategy signal is encountered — shared across every MasterAgent instance in the process, so the set grows unboundedly and is written to on every pipeline run.
**Symptom:** Stale momentum decisions across back-to-back pipeline runs; subtle "why did we buy a -15% momentum name?" support tickets. `_MOMENTUM_GATE_WARNED` has no cap or clear, so a malicious/buggy strategy name producer can grow memory linearly.
**Fix:** Convert class-level shared state to instance-level only, and pass the snapshot explicitly into `MasterAgent.__init__` (already supported — just stop writing to the class attribute). Bound `_MOMENTUM_GATE_WARNED` with a small LRU or reset per pipeline run.

---

### [P1] Orphaned `asyncio.create_task` for token-refresh + refresh_task in alpaca_stream inner loop not tracked
**File:** `backend/data/ingestion/alpaca_stream.py:249, 329-334`
**Race:** Inside `_run_stream`, after a successful connect, `refresh_task = asyncio.create_task(_watchlist_refresh_loop(ws))` is created. On a normal reconnect this is cancelled in the `finally`. But if `_run_stream` returns via an exception path *before* the `finally` sets `refresh_task` (e.g. the `raise ConnectionError` at line 231), or if `_supervised_run` cancels the outer task while the websocket is still open, the refresh task may linger with a stale `ws` reference and try to `ws.send(...)` on a closed socket.
**Symptom:** "WebSocket connection closed" spam in logs; the watchlist refresh task keeps ticking on a dead socket and the user sees no subscription update until the next full reconnect. Under repeated connection churn, an ever-growing graveyard of dead `_watchlist_refresh_loop` tasks.
**Fix:** Use a named `asyncio.TaskGroup` (Python 3.11+) or track the task reference outside the try, so the finally can *always* cancel even if creation didn't complete. Also, guard the `ws.send` inside the refresh loop with a `ws.state == State.OPEN` check.

---

### [P1] `_pipeline_lock` is an `asyncio.Lock`, but `run_daily_pipeline` can be entered from sync code via the CLI tuner
**File:** `backend/data/ingestion/daily_pipeline.py:84, 603-611`; `backend/tuner/__init__.py`, `backend/tuner/objective.py`
**Race:** `_pipeline_lock` is an `asyncio.Lock()` — it only serialises coroutines on one event loop. The multi-window scheduler, the manual `POST /pipeline/run`, and the continuous monitor's strategy-eval slot all share the same loop, so they're safe. But any sync entry point (e.g. a tuner job running with `asyncio.run(run_daily_pipeline(...))` in a child thread or a separate process) has its own event loop and its own `asyncio.Lock` instance isn't cross-process. Nothing in the code currently does this, but the `RISK_MONITOR_ENABLED` + `STRATEGY_LIMITS` mutations on the class would still corrupt if they did.
**Symptom:** Not a live hit today, but a ticking time-bomb the moment anything spawns a second loop (e.g. `uvicorn --workers 2` without cross-process Redis lock).
**Fix:** Promote the lock to Redis (`SET NX EX 3600` on a `pipeline:running` key). Document that the in-process lock is insufficient under multi-worker deployments.

---

### [P1] `daily_pipeline._execute_approved_orders` — place order → poll fill → set stop → set TP, with no atomicity
**File:** `backend/data/ingestion/daily_pipeline.py:288-426`
**Race:** The flow is: `_place_order` (buy) → `record_entry` → `_poll_fill_price` (up to 10 s of polling) → `update_entry_price` → `_place_stop_order` → `_place_limit_order` (TP). During the 10-second fill-poll window, a concurrent `_check_exits` or a separate execution path can see the entry row and race to exit before the stop/TP brackets are attached. The `ghost position rollback` catches one error path but not interleaved execution.
**Symptom:** Position briefly exists on the broker with no stop-loss and no take-profit — a bad tick or an overnight gap during that 10s window would produce unbounded loss. Also: the `master.existing_positions[symbol] = {...}` mutation happens during `request_trade` before the `_place_order` even starts; a second strategy running concurrently (via `asyncio.gather` in `_run_pipeline_inner:849`) sees the slot as taken and rejects its own signal — so at least the double-buy is blocked, but a failed order silently locks the symbol out of a retry.
**Fix:** Wrap each order placement in `asyncio.shield` so a caller cancel can't leave dangling brackets. Place the stop-loss *first* (before the entry is polled) so the position is never naked — Alpaca supports `order_class: bracket` for this. Short-term: the rollback logic (already present) should also run on timeout/poll failure.

---

### [P1] `is_token_revoked` — module-level `_REVOCATION_CACHE` mutated without lock, `clear()` + `setitem` race
**File:** `backend/core/auth.py:15-17, 97-130`
**Race:** Under CPython's GIL most dict operations are atomic, but the `if len(...) > _MAX: _REVOCATION_CACHE.clear()` followed by the later `_REVOCATION_CACHE[jti] = (revoked, expiry)` isn't atomic — another request can insert just before `clear()` wipes it. Worse, `_last_redis_warning_ts` is checked-then-set without a lock; during a Redis outage thousands of requests stampede and each one evaluates `(now - ts) > 30` to True before any of them writes.
**Symptom:** Cache gets nuked at random times; a just-revoked token silently stays accepted for one request. Log spam during Redis outages (every request logs once rather than one-per-30s).
**Fix:** Move to `cachetools.TTLCache(maxsize=50_000, ttl=60)` with an `asyncio.Lock` for eviction, and use `time.monotonic()` with an atomic CAS-ish pattern for the warning throttle.

---

### [P1] `useDataPipeline` second `useEffect([])` captures stale `enabled` + `onMessage`
**File:** `frontend/src/hooks/useDataPipeline.ts:39-130, 133-231`
**Race:** The initial-fetch `useEffect` has `[]` deps — runs once on mount — but reads `enabled` from the closure; if `enabled` flips to `true` after mount (as it does: `DataPipelineBridge` passes `hydrated`), the initial fetch never fires. The later WS-message effect has `[onMessage]` but reads `enabled` in the closure too (line 134). The guard only runs on the initial render.
**Symptom:** After store rehydration, the initial portfolio fetch is skipped if `enabled` was false at mount; user sees "no data" until the 30s interval fires. The bars/quotes WS callback may also attach when `enabled` was false and never re-attach.
**Fix:** Add `enabled` to the deps array. Use a proper `useEffect(() => { if (!enabled) return; ... }, [enabled, ...])` pattern throughout.

---

### [P1] `useWebSocket` re-subscribe race: 100ms `setTimeout` after `onopen` can fire after close
**File:** `frontend/src/hooks/useWebSocket.ts:84-103, 165-175`
**Race:** The `onopen` handler schedules `setTimeout(() => { subscribedChannels.current.forEach(ch => ws.send(...)) }, 100)`. If the socket closes in the 100ms window (e.g. server restart, tab throttled), the timeout fires and `ws.send` on a closing/closed socket throws `InvalidStateError`. Not caught. Also, `connect` is a `useCallback([])` (empty deps) — correct — but the cleanup in the visibility `useEffect` calls `ws.close()` without first clearing `ws.onclose`, so an unexpected visibility-triggered reconnect races the reconnect timer that `onclose` schedules and you get two sockets.
**Symptom:** `Uncaught InvalidStateError: Failed to execute 'send' on 'WebSocket'`; double-sockets on tab switch under slow connection. Silent in the UI but user sees duplicate quote updates.
**Fix:** In the 100ms timeout callback, check `ws.readyState === WebSocket.OPEN` before `send()`. In the visibility handler, cancel `reconnectTimerRef.current` before reconnecting. Consider merging the two reconnect loops.

---

### [P1] Toast id collision — `Date.now()-Math.random().slice(2,6)` has ~1/1.7M collision window
**File:** `frontend/src/components/ui/toast.tsx:101-112, 90-99`
**Race:** Two toasts fired in the same millisecond with the same 4-char random suffix (36^4 = 1.68M) will share an id. The store also keys alerts by this id, so a collision drops the new alert on top of the previous one's dismiss timer; dismissing one clears the wrong entry. Under a burst of WS-driven alerts (e.g. circuit-breaker fires 5 different symbol alerts in 1ms) this is rare but possible.
**Symptom:** Toasts appear to "not dismiss" or "dismiss the wrong one" under burst conditions; alert store occasionally loses items.
**Fix:** Use `crypto.randomUUID()` — modern browsers all support it (baseline 2023). Fallback to `crypto.getRandomValues(new Uint8Array(8))` for older environments.

---

### [P1] Order-fill race: duplicate exits when scheduler `_check_exits` + bracket-order webhook arrive together
**File:** `backend/data/ingestion/daily_pipeline.py:429-570`
**Race:** `_check_exits` loops over open trades, and when `current_price <= stop` it fires a `_place_order(sell)`. But the bracket stop-order the pipeline already placed on entry will ALSO fire at Alpaca. Result: two sells for the same position — Alpaca rejects the second (position went to 0), but the ledger gets two `record_exit` calls. The second one logs "no open trade to exit" and returns None. This is mostly benign today, but means the P&L attribution logs count the exit twice in analytics.
**Symptom:** Occasional "recording exit at snapshot price" warnings; analytics show extra exit events with null pnl.
**Fix:** Before the manual `_place_order(sell)`, cancel the bracket legs atomically first (swap the order of the existing "cancel after exit fills" logic — cancel bracket before placing the manual order, then `record_exit` only once).

---

### [P1] `_current_symbols` race between watchlist refresh loop and main message loop
**File:** `backend/data/ingestion/alpaca_stream.py:45, 141-174, 177-195, 252-318`
**Race:** `_update_subscriptions` mutates module-level `_current_symbols`, and is called from two places on the same event loop: (a) the initial connect path and (b) the `_watchlist_refresh_loop` task. Both `await ws.send(...)`; if the refresh loop sees a changed set and starts sending unsubscribe+subscribe frames, but the connect path is mid-way through reassigning `_current_symbols = set()` (line 240), the sequence of sends becomes: unsub A, unsub B, sub A, sub B, sub C — producing a subscription state divergent from `_current_symbols`.
**Symptom:** Ticker stops updating for some symbols after a reconnect during a watchlist change; hard to reproduce, hides as "flaky quotes".
**Fix:** Gate both call sites on an `asyncio.Lock` inside the module. Or consolidate: only the refresh loop writes `_current_symbols`; the initial connect seeds via the same code path.

---

### [P2] `frontend/src/stores/market.ts` multi-tab writes to `alphadesk-watchlist` localStorage key stomp
**File:** `frontend/src/stores/market.ts:83-89`
**Race:** Zustand `persist` writes `watchlist` to `localStorage.alphadesk-watchlist`. Two tabs open: tab A adds `TSLA`, tab B adds `NVDA`. Both hydrate the same initial list, both set their own list + persist. Last write wins — the `TSLA` or `NVDA` is lost.
**Symptom:** User adds a symbol in one tab, switches to another tab, it's there, comes back to first tab, a different symbol is gone.
**Fix:** Subscribe to the `storage` event; on change, rehydrate the Zustand store in the listening tab.

---

### [P2] `_local_rate_limited_until` in `news.py` — per-worker global bypasses Redis-down coordination
**File:** `backend/api/routes/news.py:101, 104-131`
**Race:** Under Redis outage, each worker maintains its own `_local_rate_limited_until`. Worker A gets 429 from newsdata.io, sets its local cooldown. Worker B never saw the 429, so it happily calls newsdata again, gets its own 429, sets its own cooldown. Instead of one 15-minute cross-worker cooldown we now have N workers each burning their own quota.
**Symptom:** newsdata.io starts returning 429 across every worker independently; the backoff that was meant to protect the quota now *uses up* the quota.
**Fix:** Cross-worker pub/sub on rate-limit events, or accept the degraded mode (it's correctly fail-open today).

---

### [P2] `login` form no protection against stale failures between tabs
**File:** `frontend/src/app/login/_login/LoginForm.tsx:29-56, 109-143`
**Race:** `LOCKOUT_STORAGE_KEY` is keyed in localStorage without a `storage` event listener. Tab A locks out, tab B opens login page — it reads `readFailures()` once on mount, then never updates until the user interacts. Tab B's state is stale; a successful login in tab A should clear the failures but tab B still shows "locked out".
**Symptom:** Confusing UX — user unlocks in one tab and the other still refuses to let them try.
**Fix:** `window.addEventListener("storage", ...)` and re-read `failures` when the key changes.

---

### [P2] `_INMEM_ATTEMPTS.clear()` in auth.py wipes everyone mid-attack
**File:** `backend/api/routes/auth.py:85-104`
**Race:** When `_INMEM_ATTEMPTS` hits `_INMEM_MAX_KEYS=10_000` during a credential-stuffing burst, the entire dict is cleared. A real attacker's IP counts are wiped alongside everyone else's. Since this runs per-worker, the clear is non-atomic relative to `setdefault`/`append`.
**Symptom:** Rate limit resets for everyone every time the dict fills. An attacker who spreads across 10k IPs (cheap on cloud vendors) resets the limit on themselves with each new IP they rotate in.
**Fix:** LRU eviction rather than wholesale `clear()`. `OrderedDict` with `move_to_end` + `popitem(last=False)` when over size.

---

### [P2] `ToastProvider` `timersRef` cleanup on unmount races with `dismissToast`
**File:** `frontend/src/components/ui/toast.tsx:90-119`
**Race:** On unmount, the useEffect cleanup iterates `timersRef.current` and clears all timers. If a `dismissToast(id)` runs between the iteration start and the `.clear()`, the iterator sees a shrunk Map; for-of on Map is tolerant but the semantic is unclear. Under React 19 Strict Mode's double-invocation, the ToastProvider can mount, unmount, remount rapidly, and the first unmount's cleanup may cancel timers that the remount's state expects alive.
**Symptom:** Toasts that should persist get dismissed immediately after a Strict-Mode double-render in dev. Doesn't affect production builds (no double-invoke).
**Fix:** Snapshot `timersRef.current` into a local `const` before iterating.

---

### [P2] `PriceAlertToastBridge` + `useNotifications` — two handlers fire for the same event
**File:** `frontend/src/lib/providers.tsx:55-68`; `frontend/src/hooks/useNotifications.ts:128-144`
**Race:** Price-alert WS messages fan out to `useDataPipeline` (which dispatches `alphadesk:price-alert`), which `PriceAlertToastBridge` catches and toasts. Simultaneously `useNotifications` subscribes to the same `alerts` channel and calls `maybePush`. Two distinct state paths update for one event — ordering and de-dup is not guaranteed. If the Zustand alert id generator collides (see toast-id P1), a double notification is visible.
**Symptom:** Occasional duplicate toast + notification for the same triggered alert.
**Fix:** Pick one path as the source of truth for toasts — the `alphadesk:price-alert` event bridge, or the direct `onMessage("alerts", ...)` — don't do both.

---

### [P2] `_DEMO_SYMBOLS` lazy singleton — worker-local, not cross-worker consistent
**File:** `backend/api/routes/symbols.py:1827-1835`
**Race:** `_get_demo_symbols()` memoises per-worker via module-level `_DEMO_SYMBOLS`. Under a multi-worker deployment each worker re-builds the list on first hit. Not a race per se, but a consistency issue: if `_build_demo_symbols` uses any time-based seeding, different workers return different lists. Quick scan shows it's deterministic, so this is low-priority.
**Symptom:** None observed; preventive flag.
**Fix:** Build at import time (module-level) if cost is low.

---

### [P2] Trade-history endpoint reads `ledger._data["trades"]` — triggers full table scan on every call
**File:** `backend/api/routes/trades.py:547-596`
**Race:** Not a race, but concurrency hot spot: every `GET /trades/history` call does `ledger._data.get("trades", [])` which is the `_LegacyDataView.__getitem__`, which calls `ledger._list_all()`, which does `SELECT * FROM trade_ledger`. Under dashboard polling + multiple clients, this hammers the DB. Not a correctness race but a throughput / lock-contention risk.
**Symptom:** DB-pool exhaustion under load; p99 latency explosion.
**Fix:** Push filter+limit+order into the SQL query rather than loading everything and filtering in Python (the `list()` helper already supports column allowlisting).

---

## Top 15 (by hit probability)

| # | Prio | Title | File |
|---|------|-------|------|
| 1 | P0 | VRP `_PENDING_HTTP` global clobbered by concurrent chain fetches | `backend/strategies/vrp_harvest/provider.py:311-329` |
| 2 | P0 | `realtime_scanner` dict mutated during iteration from handler + scanner + cleanup | `backend/data/ingestion/realtime_scanner.py:63-118` |
| 3 | P0 | `publish()` mutates caller's dict (adds `_ts`) | `backend/core/redis.py:51-56` |
| 4 | P0 | `_check_exits` calls missing `ledger._persist()` + ephemeral in-mem mutation | `backend/data/ingestion/daily_pipeline.py:473-510` |
| 5 | P0 | `@cached` async branch holds `threading.Lock` across `await` | `backend/data/providers/cache.py:188-200` |
| 6 | P0 | `toggle_strategy` read/modify/write non-atomic in Redis | `backend/api/routes/strategies.py:1337-1359` |
| 7 | P1 | `useWebSocket` setTimeout re-subscribe sends on closed socket | `frontend/src/hooks/useWebSocket.ts:84-103` |
| 8 | P1 | `_execute_approved_orders` — 10 s fill-poll window leaves position naked | `backend/data/ingestion/daily_pipeline.py:288-426` |
| 9 | P1 | `useDataPipeline` initial fetch effect has `[]` deps but reads `enabled` | `frontend/src/hooks/useDataPipeline.ts:39-130` |
| 10 | P1 | MasterAgent `_SHARED_MOMENTUM_DATA` + `_MOMENTUM_GATE_WARNED` class-level mutables | `backend/data/ingestion/master_agent.py:41-57, 416-417` |
| 11 | P1 | Duplicate exit path: `_check_exits` manual sell + bracket stop race | `backend/data/ingestion/daily_pipeline.py:429-570` |
| 12 | P1 | `alpaca_stream` `_current_symbols` race between refresh loop + reconnect | `backend/data/ingestion/alpaca_stream.py:141-195` |
| 13 | P1 | `is_token_revoked` cache: non-atomic `clear()` + `setitem` | `backend/core/auth.py:97-130` |
| 14 | P1 | Toast id collision under burst (`Date.now()+Math.random(36)^4`) | `frontend/src/components/ui/toast.tsx:101-112` |
| 15 | P1 | alpaca stream `refresh_task` orphaned on early-throw reconnect path | `backend/data/ingestion/alpaca_stream.py:249, 329-334` |

---

## Summary

The three biggest-hit issues are all module-level mutable state being shared across concurrent async paths. The VRP `_PENDING_HTTP` global is the clearest P0 — any pipeline run that triggers two VRP signals in parallel (the norm via `asyncio.gather` in `_run_pipeline_inner`) will either crash with a `RuntimeError` or cross-wire HTTP clients. The realtime scanner's `_pending_setups` dict is read by the HTTP `get_realtime_setups` endpoint directly while the scanner loop mutates it on every tick — the endpoint will raise `RuntimeError: dictionary changed size during iteration` under any real market-hours load.

The publish dict-mutation bug is insidious because it's subtle — callers don't realize `publish(channel, data)` mutates their object, and any caller who then iterates `data` or republishes it will see garbage. This pattern appears on every alert, quote, and portfolio update.

The missing `ledger._persist()` call in trailing-stop logic is a dormant bug the prior ledger-migration round missed. It fires silently inside a `try/except Exception`, so operators don't see the failure, but trailing stops don't trail.

The `@cached` decorator's `threading.Lock`-across-`await` is the most dangerous latent deadlock — it appears in every provider method decorated with `@cached`, which is most of them. Under a slow Polygon fetch with two concurrent callers on the same key, the event loop blocks for the duration of the network round-trip.

Frontend-side, the biggest real-world hit is the WebSocket `setTimeout(100ms)` re-subscription — on a flaky connection, the socket can close before the timeout fires, and the resulting `InvalidStateError` is uncaught, bubbling out of the onopen handler and potentially wedging the useEffect cleanup. Combined with the visibility-change reconnect path which doesn't cancel the pending reconnect timer, a tab switch under poor network produces duplicate sockets and double-quote events.

The order-placement flow keeps a naked position on the broker for the 10s fill-poll window before placing brackets — a circuit-breaker moment or a gap during that window is unbounded-loss territory. This has always been the case; it's not new to this round, but it's worth re-flagging because round 3's fix of stop-order placement didn't restructure the atomicity of the entry-plus-bracket sequence.

Recommendation: land P0 fixes 1-6 in a single sweep (all are short, surgical changes). P1 fixes 7-15 can batch for a follow-up. The `@cached` lock fix is the trickiest because it touches every provider's cache behavior — gate on a feature flag and monitor p99 latency before and after.
