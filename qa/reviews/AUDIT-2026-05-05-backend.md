# AlphaDesk Backend Security & Quality Audit — 2026-05-05

**Scope:** `backend/api/`, `backend/core/`, `backend/services/`, `backend/strategies/`, `backend/data/`, `backend/agents/`, `backend/main.py`
**Branch:** `feature/deployment` @ `bc37a59b`
**Auditor:** Claude Sonnet 4.6 (automated)

---

## P0 — Critical (must fix before next live-trading session)

### P0-1 — Daily pipeline routes ALL orders through global Alpaca credentials

**File:** `backend/data/ingestion/daily_pipeline.py:468–498`

`_alpaca_headers()` returns `settings.ALPACA_API_KEY` / `settings.ALPACA_SECRET_KEY` — the server-wide environment credentials. Every order placed by the pipeline (`_place_order`, `_place_bracket_order`, `_place_stop_order`, `_place_limit_order`) and every open-order query (`_ensure_stop_orders` at line 762) uses these helpers without any per-user lookup. The platform stores per-user Alpaca credentials in the `BrokerConnection` table and correctly plumbs them through the HTTP trade handler via `_alpaca_credentials_or_503(username)` in `api/routes/trades.py:774–789`, but the automated pipeline path has no equivalent lookup.

**Consequence:** In a multi-user deployment every automated order (pipeline, bracket, stop) hits whichever account is in the `.env` file, not the requesting user's account. A user whose scheduled strategy fires gets their signal executed on a different live account. This is also an account-isolation security breach.

**Fix:** Replace `_alpaca_headers()` / `_base_url()` in `daily_pipeline.py` with an async helper that calls `services.broker_connections.get_alpaca_credentials(username)` (already importable). Pass `username` down from `run_pipeline(username)` → `_place_order(..., username=username)` → headers. Mirror the pattern from `trades.py:_alpaca_credentials_or_503`.

---

### P0-2 — Gross-notional risk gate queries the wrong Alpaca account in multi-user deployments

**File:** `backend/api/routes/trades.py:3231–3250`

`_get_todays_gross_notional()` and `_get_account_equity()` (lines 3255–3275) both build Alpaca headers directly from `settings.ALPACA_API_KEY` / `settings.ALPACA_SECRET_KEY`. These functions are called by `_enforce_risk_limits()` which gates every order by daily notional cap and equity-based loss limit. In a multi-user system, the function returns totals for the server's `.env` account, not the user submitting the order — so a heavy trading day by User A leaves User B's notional ceiling fully unconstrained, while User A's actual open orders are measured against whatever account the env key points to.

**Consequence:** The daily notional gate and loss-limit gate are effectively bypass-able by any user whose account differs from the env-level credentials. The per-order cap (`_MAX_ORDER_NOTIONAL`) still applies, but the aggregate guard does not.

**Fix:** Thread `username` into `_get_todays_gross_notional(username)` and `_get_account_equity(username)`, then call `get_alpaca_credentials(username)` inside each function to build per-user headers. Update `_enforce_risk_limits(payload, username)` to pass the username down.

---

### P0-3 — `_READYZ_FULL_CACHE` dict updated in two non-atomic statements with no asyncio.Lock

**File:** `backend/main.py:619, 690–699, 777–797`

`_READYZ_FULL_CACHE` is a module-level plain dict. The cache is written at the end of `readyz_full()` in two separate statement groups: first `_READYZ_FULL_CACHE["snapshot"] = dict(snapshot)`, then `_READYZ_FULL_CACHE["ts"] = now`, then `_READYZ_FULL_CACHE["status"] = ...`. Between the snapshot write and the timestamp write, a concurrently executing coroutine reaches line 694 (`if _READYZ_FULL_CACHE["snapshot"] is not None and age < ttl`): it finds a fresh snapshot but the old timestamp (`ts` still pointing to the last cycle's time). The `age` calculation therefore returns a very large number, bypassing the TTL guard and triggering a full recompute — including live calls to FMP and Anthropic — on what should have been a cache hit.

**Consequence:** Under moderate request concurrency (curl-loop monitoring, dashboard polling), every request that arrives in the sub-millisecond window between the two dict writes hammers paid external APIs. In the worst case this loops unboundedly until the next successful full write closes the window.

**Fix:** Add `_READYZ_FULL_LOCK: asyncio.Lock = asyncio.Lock()` at module level. Wrap the read+write section of `readyz_full()` under `async with _READYZ_FULL_LOCK:` and atomically write all three keys before releasing.

---

### P0-4 — Non-atomic Redis GET + SET for auth counter bumps allows token-reuse after password change

**File:** `backend/core/auth.py:108–133, 154–168`

`bump_password_version(username)` and `bump_session_epoch(username)` perform non-atomic GET → Python increment → SET. Between the two steps, another coroutine may concurrently execute the same three steps. Both writers compute `current + 1` from the same base and both write the same value. The token-invalidation invariant requires that the bumped counter be strictly greater than the value embedded in any token currently in flight. If two concurrent password-change requests both read `current=1` and both write `2`, tokens minted at epoch `2` during the first bump remain valid after the second bump, defeating the second revocation.

**Fix:** Replace the GET → Python incr → SET pattern with Redis `INCR` on a pre-seeded key. Also add `ex=90*24*3600` (90 days) on the SET / after the INCR to bound memory.

---

## P1 — High

### P1-1 — Fill reconciler queries Alpaca positions with global credentials

**File:** `backend/data/ingestion/fill_reconciler.py:143–154`

`_fetch_pre_fill_qty()` uses `settings.ALPACA_API_KEY` / `settings.ALPACA_SECRET_KEY` to call `/v2/positions/{symbol}`. This function is used to classify fills as `long_open`/`long_close`/`short_open`/`short_close`. In multi-user deployments the position lookup returns data for the wrong account.

**Fix:** Surface the `username` or `account_id` from the Alpaca trade_update event and look up per-user credentials before the GET.

### P1-2 — `_check_duplicate_order` silently skips dedup when Redis is unavailable

**File:** `backend/api/routes/trades.py:2370–2375`

If `get_redis()` returns `None`, the dedup is skipped. The idempotency-key path raises 503 on Redis failure. The dedup path silently accepts duplicates. **Fix:** Raise `HTTPException(503)` when `redis is None`.

### P1-3 — Order rate limiter uses tumbling window, not sliding window

**File:** `backend/api/routes/trades.py:950–987`

`INCR + EXPIRE NX` allows 60+60=120 orders in 2 seconds across a window boundary. **Fix:** Replace with Redis sorted-set sliding window: `ZADD key now now; ZREMRANGEBYSCORE key 0 (now-60); ZCARD key`.

### P1-4 — `_get_todays_gross_notional` fails open on errors

**File:** `backend/api/routes/trades.py:3197–3252`

When both ledger and broker fail, `total=0.0` and the risk gate approves every order. **Fix:** Add a monotonic last-known-good cache; fail closed beyond a stale threshold.

### P1-5 — `get_trade_history` has no `username` filter

**File:** `backend/api/routes/trades.py:2129–2183`

GET `/api/v1/trades/history` accepts `symbol` and `strategy` filters but not `username`. Any authenticated user can enumerate all other users' trade history.

**Fix:** Add `username: str = Depends(require_auth)`. Pass into ledger query's WHERE clause.

### P1-6 — `_async_lock_for` acquires `threading.Lock` synchronously in async context

**File:** `backend/data/providers/cache.py:94–106`

`_ASYNC_LOCKS_GUARD` is a `threading.Lock` acquired with `with _ASYNC_LOCKS_GUARD:` from async code. Under contention, this stalls the event loop. **Fix:** Use `asyncio.Lock` or eliminate the guard via `setdefault`.

### P1-7 — `register_setup` does not acquire `_setups_lock`

**File:** `backend/data/ingestion/realtime_scanner.py:191–230`

`_setups_lock: asyncio.Lock` exists for "serialise mutations of _pending_setups" but `register_setup()` is sync and mutates via `clear() + update()` without acquiring the lock. Concurrent readers see an empty dict between clear and update.

**Fix:** Make `register_setup` async and wrap mutation with `async with _setups_lock`.

---

## P2 — Medium

- **P2-1** `sector_rotation` strategy missing from `_STRATEGY_ID_TO_CANONICAL` (`backend/core/trading_gate.py:49–75`) — orders rejected with 400
- **P2-2** `_ensure_stop_orders` builds query string by concatenation (`backend/data/ingestion/daily_pipeline.py:762`)
- **P2-3** `DAILY_LOSS_LIMIT_FRACTION` hardcoded with TODO (`backend/api/routes/trades.py:3363–3365`)
- **P2-4** `_REVOCATION_CACHE.clear()` causes dog-pile on Redis
- **P2-5** `password_version:` / `session_epoch:` Redis keys have no TTL
- **P2-6** Cancel-order idem-cache cleanup uses Redis SCAN O(N keyspace)
- **P2-7** Claude budget kill-switch is soft-cap only; should be opt-in hard-cap
- **P2-8** Parquet provider cache has no size bound
- **P2-9** `_liquidity_cache` dict in realtime_scanner unbounded
- **P2-10** Sync FMP HTTP client used from async paths blocks event loop

## P3 — Low / Technical Debt

- **P3-1** `entry_time` fabricated as `datetime.now()` in `get_trade_history`
- **P3-2** `_poll_fill_price` busy-polls with no backoff
- **P3-3** `_ID_TO_LEDGER_NAME` rebuilt on every call
- **P3-4** `periodic_reconciler` lock release compares decoded bytes vs string
- **P3-5** Audit log writes from `_audit_reject` are fire-and-forget with no error surfacing
- **P3-6** `_REVOCATION_CACHE` stale-fallback unreachable after eviction

---

## Summary Table

| ID | File | Line | Severity | Title |
|----|------|------|----------|-------|
| P0-1 | `daily_pipeline.py` | 468–498 | P0 | Global Alpaca creds for all pipeline orders |
| P0-2 | `trades.py` | 3231–3275 | P0 | Risk gate queries wrong Alpaca account |
| P0-3 | `main.py` | 619, 690–799 | P0 | `_READYZ_FULL_CACHE` non-atomic multi-key write |
| P0-4 | `auth.py` | 108–168 | P0 | Non-atomic Redis GET+SET for auth counters |
| P1-1 | `fill_reconciler.py` | 143–154 | P1 | Fill classifier uses global Alpaca creds |
| P1-2 | `trades.py` | 2370–2375 | P1 | Dedup silently disabled when Redis unavailable |
| P1-3 | `trades.py` | 950–987 | P1 | Rate limiter is tumbling window, not sliding |
| P1-4 | `trades.py` | 3197–3252 | P1 | Gross-notional gate fails open on errors |
| P1-5 | `trades.py` | 2129–2183 | P1 | Trade history lacks per-user filter |
| P1-6 | `cache.py` | 94–106 | P1 | `threading.Lock` acquired in async context |
| P1-7 | `realtime_scanner.py` | 191–230 | P1 | `register_setup` bypasses `_setups_lock` |
| P2-1 | `trading_gate.py` | 49–75 | P2 | `sector_rotation` missing from strategy allowlist |
| P2-2 | `daily_pipeline.py` | 762 | P2 | Query string concatenation instead of params |
| P2-3 | `trades.py` | 3363–3365 | P2 | Hardcoded `DAILY_LOSS_LIMIT_FRACTION` |
| P2-4 | `auth.py` | 346–347 | P2 | Revocation cache full-clear thundering herd |
| P2-5 | `auth.py` | 128–168 | P2 | Auth counter keys have no TTL |
| P2-6 | `trades.py` | 1936–1954 | P2 | Cancel idem-cache cleanup uses O(N) SCAN |
| P2-7 | `claude_client.py` | 254–266 | P2 | Budget kill-switch is soft-cap only |
| P2-8 | `cache.py` | module | P2 | Parquet cache unbounded disk growth |
| P2-9 | `realtime_scanner.py` | 76 | P2 | `_liquidity_cache` unbounded in-memory dict |
| P2-10 | `_fmp_http.py` | backoff path | P2 | Sync FMP client blocks async event loop |
| P3-1 | `trades.py` | 2191–2193 | P3 | `entry_time` fabricated as `datetime.now()` |
| P3-2 | `daily_pipeline.py` | 801–830 | P3 | `_poll_fill_price` fixed-delay busy-poll |
| P3-3 | `trades.py` | 2144–2158 | P3 | `_ID_TO_LEDGER_NAME` rebuilt on every request |
| P3-4 | `periodic_reconciler.py` | 140–142 | P3 | Redis lock release bytes-vs-str comparison |
| P3-5 | `trading_gate.py` | 231 | P3 | Audit write task not retained, failures silenced |
| P3-6 | `auth.py` | 343–375 | P3 | Revocation cache stale-fallback unreachable after eviction |
