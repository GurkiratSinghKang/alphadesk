# Backend Adversarial Findings (2026-05-05)

Auditor: Claude (1M context, opus-4.7)
Scope: backend/, focus on changes since 2026-04-18 (kill-switch B.4/B.5, multi-leg ledger B.1, Plan C strategies, broker connections, ticker_context, periodic_reconciler, user-rights endpoints).
Methodology: read prior reports first (audit-reports/02-backend.md, security-audit-r3.md), only ship findings backed by file:line evidence in current code.

## Summary
- 14 findings: 3 P0, 7 P1, 4 P2

## Findings (grouped by theme)

---

### Theme 1: Multi-tenant data leakage (NEW since /api/v1/user + /api/v1/broker shipped)

#### F1 — `POST /api/v1/user/erase` deletes EVERY user's rows, not just the caller's
**Severity:** P0
**File:** `backend/api/routes/user.py:653-691`
**Evidence:**
```python
for model, key in (
    (Trade, "trades"),
    (Position, "positions"),
    (Watchlist, "watchlists"),
    (ScreenerPreset, "screener_presets"),
    (Alert, "alerts"),
    (StrategySignal, "strategy_signals"),
):
    res = await session.execute(delete(model))   # NO WHERE CLAUSE
    deleted[key] = int(res.rowcount or 0)
```
The comment at line 651 says "Single-admin deployment" but this same module added `POST /admin/users` at line 95 that creates *additional non-admin users*. The legitimate-non-admin paths exist (`role="user"` allowed at line 104), and the GDPR endpoints are hung off `Depends(require_auth)` not `require_admin` (line 587). A second user calling `POST /api/v1/user/erase` with their password wipes the **admin's** trades, positions, alerts, etc.
**Impact:** Catastrophic data loss + 17a-4 retention failure. A vandal user erases the operator's books in a single call after entering their own password.
**Fix:** Add `.where(model.username == username)` to every delete statement (Trade, Position, Watchlist, ScreenerPreset, Alert, StrategySignal). Same for `_collect_export_bundle` (lines 303-319) which currently dumps every user's data into the requesting user's export bundle.

---

#### F2 — `_collect_export_bundle` exports every user's trades / positions / alerts to the requesting user
**Severity:** P0
**File:** `backend/api/routes/user.py:303-319`
**Evidence:**
```python
rows = (await session.execute(select(Trade))).scalars().all()
bundle["trades"] = [_row_to_dict(r) for r in rows]
rows = (await session.execute(select(Position))).scalars().all()
bundle["positions"] = [_row_to_dict(r) for r in rows]
rows = (await session.execute(select(Alert))).scalars().all()
bundle["alerts"] = [_row_to_dict(r) for r in rows]
# ... etc — no .where(*.username == username) anywhere
```
Trades, Positions, Alerts, Watchlists, StrategySignals all queried with no per-user filter. A second user calling `POST /api/v1/user/export` downloads a JSON bundle containing the admin's full ledger plus every other user's data.
**Impact:** GDPR Art. 5 (purpose-limitation) violation; PII / trading-strategy disclosure to any authenticated tenant.
**Fix:** Add `.where(model.username == username)` to each select. (Note: `Trade`, `Alert`, `BrokerConnection` already have `username` columns per `models.py:246, 296, 305`; the export just doesn't use them.)

---

### Theme 2: Kill-switch wire-up and concurrency (Plan B.4/B.5)

#### F3 — Kill-switch is NOT actually consulted by the production runner — TODO left in pipeline_runner
**Severity:** P0
**File:** `backend/strategies/_core/runners/pipeline_runner.py:362-370`
**Evidence:**
```python
# TODO(kill-switch-wire-up): replace this call with
# invoke_strategy_with_kill_switch(strategy=self._strategy, input=input,
# params=params, kill_switch=self._kill_switch,
# kill_switch_context=KillSwitchContext(peak_nav=..., current_nav=...,
# alloc_capital=..., realized_today=...)). Deferred from Task 9 because
# peak_nav/alloc_capital/realized_today require plumbing through
# master_agent + trade_ledger; the wrapper itself is unit-tested in
# test_kill_switch_pipeline.py.
result = self._strategy.run(input, params)
```
The three-layer kill-switch (`KillSwitch.is_enabled`) ships with API endpoints (`POST /strategies/{id}/emergency-disable`, `POST /strategies/{id}/re-enable`) and a pretty UI panel — **but the runner never calls it**. Every emergency-disable click writes a row to `strategy_disabled_events` but the next pipeline run dispatches `self._strategy.run(input, params)` directly, bypassing every layer.
**Impact:** Operators believe the kill-switch is live (UI panel + admin endpoints suggest it works). When they hit "emergency disable" during a market event, the strategy keeps trading until the next deploy. The plan B.4/B.5 ship status is misleading.
**Fix:** Replace line 370 with `invoke_strategy_with_kill_switch(...)`; build `KillSwitchContext` from `master_agent.strategy_peaks[name]`, `strategy_current[name]`, and a per-strategy realized P&L from the ledger. If the context fields aren't ready yet, at least wire layer-3 (manual disable) — that's a single SQL read with no plumbing required.

---

#### F4 — `PostgresDisabledEventsRepo` sync facade calls `asyncio.get_event_loop().run_until_complete()` — deadlocks under FastAPI
**Severity:** P1
**File:** `backend/strategies/_core/kill_switch.py:409-425`
**Evidence:**
```python
def insert(self, event: DisabledEvent) -> DisabledEvent:
    import asyncio
    return asyncio.get_event_loop().run_until_complete(self.insert_async(event))

def latest_unresolved_for_strategy(...) -> DisabledEvent | None:
    import asyncio
    return asyncio.get_event_loop().run_until_complete(...)
```
`KillSwitch.is_enabled()` is sync; the Postgres-backed repo's sync facade falls through `asyncio.get_event_loop().run_until_complete(coro)`. From inside a running FastAPI handler the loop is already running, so this raises `RuntimeError: This event loop is already running` (or hangs in older Python versions). Today F3 hides this by never calling the kill-switch from the runner — but **`POST /strategies/{id}/emergency-disable` itself doesn't go through this path** (it uses raw `text(...)` SQL inline — see strategies.py:2540-2571), so the repo facade is currently unreachable. The minute someone wires F3 properly with the Postgres repo as drafted, every kill-switch check inside an async route will raise.
**Impact:** Trap door: once the F3 wire-up lands with this repo, the very first live drawdown check explodes the request handler.
**Fix:** Make `KillSwitch.is_enabled` async (the unit tests would still pass with `pytest.mark.asyncio`), or have the repo present an `AsyncDisabledEventsRepo` Protocol from the start and drop the sync facade entirely.

---

#### F5 — `emergency_disable_strategy` SELECT-then-INSERT is a TOCTOU race against the partial-unique-index — IntegrityError leaks as 500
**Severity:** P2
**File:** `backend/api/routes/strategies.py:2540-2572`, partial unique idx in `backend/alembic/versions/0014_strategy_disabled_events.py:44-50`
**Evidence:**
```python
existing_result = await session.execute(text("""
    SELECT id FROM strategy_disabled_events
    WHERE strategy = :strategy AND layer = 3 AND resolved_at IS NULL
    ORDER BY triggered_at DESC, id DESC LIMIT 1
"""), ...)
existing_row = existing_result.fetchone()
if existing_row is not None:
    return EmergencyDisableResponse(success=False, ..., message="already_disabled")
insert_result = await session.execute(text("""
    INSERT INTO strategy_disabled_events ...
    RETURNING id
"""), ...)
```
The partial unique index `ix_sde_strategy_unresolved_manual` (alembic 0014:44-50) prevents two unresolved layer-3 rows; Postgres will raise `UniqueViolation` for the second concurrent INSERT. The handler doesn't catch it — it will propagate as a generic 500 + the global exception handler (`main.py:388-403`) will swallow the type, leaving the second admin staring at "Internal Server Error" when "already_disabled" is the right semantics.
**Impact:** Worst-case false alarm during incident response when two operators race the kill button.
**Fix:** `INSERT … ON CONFLICT … DO NOTHING RETURNING id`, then if `RETURNING` is empty re-SELECT and return `success=False, message="already_disabled"`. Removes the race entirely.

---

### Theme 3: TLS / KDF / secret handling

#### F6 — `verify_ibkr_connection` uses `httpx.AsyncClient(verify=False)` — TLS validation disabled for IBKR Client Portal Gateway
**Severity:** P1
**File:** `backend/services/broker_connections.py:263`
**Evidence:**
```python
async with httpx.AsyncClient(timeout=10.0, verify=False) as client:
    resp = await client.get(f"{base_url}/iserver/auth/status")
```
Even though `_validate_ibkr_gateway_url` (line 244) restricts the host to loopback / docker, `verify=False` disables certificate validation for the IBKR brokerage session check — a man-in-the-middle on the host network (or a compromised sibling container) can return a fake `authenticated: true` and pass the connection-verify gate. Loopback-only restriction is not a substitute for TLS pinning when the response decides whether to store live broker credentials.
**Impact:** Defense-in-depth gap. If the IBKR Client Portal Gateway's CA cert is expired or self-signed, the operator gets no warning; if a sibling container hijacks the loopback bind (rare but possible in some docker network modes), credentials are accepted against a fake responder.
**Fix:** Drop `verify=False`. The IBKR gateway ships with a self-signed cert; document the runbook step to register the cert into the python truststore via `SSL_CERT_FILE` instead of disabling verification globally.

---

#### F7 — Broker-credential encryption derives AES-256 key with a single `sha256(passphrase)` — no KDF, no salt
**Severity:** P1
**File:** `backend/core/crypto.py:16-22`
**Evidence:**
```python
def _derive_key() -> bytes:
    raw = settings.BROKER_CREDENTIAL_ENCRYPTION_KEY.get_secret_value()
    if not raw:
        raise EncryptionKeyUnavailable(...)
    return hashlib.sha256(raw.encode("utf-8")).digest()
```
`BROKER_CREDENTIAL_ENCRYPTION_KEY` is loaded from env (operator-chosen). One round of SHA-256 is not a KDF — a weak passphrase ("alphadesk2026", "changeme", a name + year) is brute-forced offline trivially given any captured ciphertext (e.g., a stolen `broker_connections` table dump). AES-GCM's authenticated encryption doesn't help when the key search space is human-memorable.
**Impact:** If the Postgres dump leaks (recall F-02 of the prior audit: `POSTGRES_PASSWORD` defaulted to `alphadesk_dev`), every encrypted Alpaca / IBKR / Schwab credential is recoverable in CPU-hours, not centuries.
**Fix:** Use `cryptography.hazmat.primitives.kdf.scrypt.Scrypt(salt=settings.ENCRYPTION_SALT, length=32, n=2**14, r=8, p=1)` or Argon2id. Salt can live in env alongside the passphrase. Add a one-shot migration that re-encrypts existing rows with the new KDF.

---

### Theme 4: Multi-tenant request fan-out and async DB races

#### F8 — `TickerContextService.get_many` is serial — N+1 explosion at 50 symbols × 4 needs
**Severity:** P1
**File:** `backend/services/ticker_context.py:308-325, 327-347, 349-397`
**Evidence:**
```python
async def get_many(self, symbols, *, needs=None, ...):
    contexts = {}
    for symbol in list(...):
        contexts[symbol] = await self.get(symbol, needs=normalized_needs, ...)  # ← serial await
    return TickerContextResponse(symbols=contexts)

async def get(self, symbol, *, needs=None, ...):
    for need in [_normalize_need(n) for n in needs]:
        envelope, warnings = await self._get_or_refresh_fact(symbol, spec, ...)  # ← serial await
        ...
```
At the documented 50-symbol cap (line 97), with the default 4 needs, **a single `POST /api/v1/tickers/context` triggers up to 200 sequential round-trips**: per (symbol, need) pair: 1 cache read + 1 DB read + sometimes 1 HTTP fetch. The `TickerContext` strategy hook (`pipeline_runner.py:300`) calls this with `list(symbols)` from each strategy's universe — a 30-symbol pairs-trading run blocks the event loop for tens of seconds while it serially polls Redis + Postgres + Alpaca + FMP.
**Impact:** Any handler/strategy depending on `ticker_context` becomes a worst-case sequential pipeline; the WebSocket fan-out (which shares the event loop) stalls during it.
**Fix:** Replace the serial loops with `await asyncio.gather(*[self._get_or_refresh_fact(...) for need in needs])` — and at the outer level, gather across symbols too. Cap parallelism with an `asyncio.Semaphore(8)` to avoid hammering FMP (provider-side rate limit).

---

#### F9 — `_LOCAL_FACT_LOCKS` is module-level dict — grows without bound for the life of the process
**Severity:** P2
**File:** `backend/services/ticker_context.py:34, 370, 423`
**Evidence:**
```python
_LOCAL_FACT_LOCKS: dict[str, asyncio.Lock] = {}
...
lock = _LOCAL_FACT_LOCKS.setdefault(lock_key, asyncio.Lock())
```
Lock key is `f"{symbol}:{spec.namespace}:{spec.key}"`. With S&P 500 universe + 6 fact specs, that's 3000 entries. With less-restricted symbol sources (FMP universe scans, Polygon screener results) the dict grows monotonically — locks are never garbage-collected because the dict holds a strong reference. A long-running process accumulates tens of thousands of stale locks.
**Impact:** Slow memory creep over weeks; not catastrophic but visible in container OOM after multi-week uptime.
**Fix:** `WeakValueDictionary` doesn't work for `asyncio.Lock` (no `__weakref__`); use a bounded `LRU` (e.g. `cachetools.LRUCache(maxsize=512)`) or a periodic sweep that drops locks not held in the last N seconds.

---

#### F10 — `cache_set` swallows ALL exceptions — silent Redis writes loss
**Severity:** P2
**File:** `backend/core/redis.py:270-279`
**Evidence:**
```python
async def cache_set(key: str, data: Any, ttl_seconds: int = 300) -> None:
    try:
        r = await get_redis()
        if ttl_seconds <= 0:
            await r.set(key, orjson.dumps(data).decode())
        else:
            await r.set(key, orjson.dumps(data).decode(), ex=ttl_seconds)
    except Exception:
        pass        # ← no log, no metric, no trace
```
A failed cache write (Redis OOM, MAXMEMORY policy `noeviction` rejecting writes, network blip) is invisible. Compare with `cache_get` (lines 244-267) which logs corrupt JSON and deletes the key — `cache_set` is silent. Combined with `_set_trading_halted`'s comment that "Redis is a cache" (trades.py:122-141): a halt that fails to land in Redis is reflected in the next response from cache after Postgres commits (good), but you have no metric to know the cache failed.
**Impact:** Silent cache misses cascade into stale data being served — and the only way to know is to wait for a user report.
**Fix:** Log at WARNING + emit a Redis counter `metrics:cache_set_failed:{key_prefix}`. Mirror the pattern already present at `cache_get` line 260-264.

---

#### F11 — `cache_incr` does INCR then EXPIRE as separate round-trips — TTL leaked on crash between calls
**Severity:** P2
**File:** `backend/core/redis.py:282-302`
**Evidence:**
```python
async def cache_incr(key: str, *, ttl_seconds: int = 86_400) -> int | None:
    try:
        r = await get_redis()
        new = await r.incr(key)
        if ttl_seconds > 0:
            await r.expire(key, ttl_seconds)   # ← separate call, no atomicity
        return int(new)
    except Exception:
        return None
```
If the worker crashes between `incr` and `expire`, the key has no TTL and persists forever (Redis default behavior). With many distinct counter keys (per-IP, per-user, per-symbol) this is a slow leak. The function's docstring claims atomicity but Lua/MULTI is needed.
**Impact:** Slow Redis memory creep over the long tail of metric counters.
**Fix:** Use a Lua eval: `r.eval("local n = redis.call('INCR', KEYS[1]); redis.call('EXPIRE', KEYS[1], ARGV[1]); return n", 1, key, ttl_seconds)`. Single round-trip, atomic.

---

### Theme 5: Rate-limit and surveillance gaps on new endpoints

#### F12 — `POST /api/v1/broker/connections/*` and `POST /api/v1/broker/reconciliation/run` have no rate limit
**Severity:** P1
**File:** `backend/api/routes/broker.py:65-106, 154-167`
**Evidence:**
```python
@router.post("/connections/alpaca", status_code=201)
async def save_alpaca_connection(request, username=Depends(require_auth)):
    # → upsert_broker_connection → verify_alpaca_credentials → httpx.AsyncClient(...).get(/v2/account)
```
Every call to `POST /api/v1/broker/connections/alpaca` (or `/{provider}` for ibkr/etrade/schwab) makes an outbound HTTP call to the broker (Alpaca/IBKR/E*TRADE/Schwab) to verify credentials. Same for `POST /broker/reconciliation/run` which fan-outs `_reconcile_last_24h` against the user's Alpaca connection. No rate limit anywhere — a stolen cookie can spray credential-verification attempts at 4 different broker auth endpoints, exhausting any rate-limit budget the broker offers (Schwab in particular has a 120-req/min global limit per app).
**Impact:** Anthropic-spend equivalent for broker quota: a runaway client (or compromised token) can burn the operator's broker rate-limit allowance, getting *legitimate* trading orders rate-limited by the broker. Schwab/IBKR/E*TRADE OAuth refresh-token paths can also lock the OAuth app on repeated rejections.
**Fix:** Reuse `_enforce_chat_rate_limit` pattern from `agents.py:72-109` — bind to `username`, e.g., 10 verify-attempts per 5min, 6 reconcile-runs per hour. Fail closed on Redis unavailable.

---

#### F13 — `agent_chat` exception handler interpolates `str(exc)[:200]` into response body
**Severity:** P2
**File:** `backend/api/routes/agents.py:322-330`
**Evidence:**
```python
except Exception as exc:
    conversation_id = request.conversation_id or str(uuid.uuid4())
    return ChatResponse(
        conversation_id=conversation_id,
        message=f"Agent system encountered an error: {str(exc)[:200]}. Please check your configuration.",
        ...
    )
```
A SQLAlchemy `OperationalError` carries the database hostname; an `httpx.HTTPStatusError` carries the URL (which may include API keys in the path; FMP and Polygon historically used `?apikey=` in the query string). 200 chars is plenty for `OperationalError: connection failed: host=timescaledb port=5432`. The same anti-pattern was caught in security-audit-r3 #7-8 for `portfolio.py:408` and `webhooks.py:68,89`; the fix didn't propagate to `agents.py`.
**Impact:** Information disclosure to authenticated users. Lower-blast-radius than the prior portfolio leak (this is post-auth) but still hands an attacker internal infrastructure details.
**Fix:** Log the exception server-side (`logger.error("agent_chat raised", exc_info=True)`); return a stable `"message": "Agent system encountered an error. See request_id %s in logs."` to the client.

---

### Theme 6: Background tasks and async safety

#### F14 — `MasterAgent.update_drawdown` schedules persistence with naked `loop.create_task(coro)` — no reference held, GC may collect
**Severity:** P2
**File:** `backend/data/ingestion/master_agent.py:601-612`
**Evidence:**
```python
def _schedule(coro: Any) -> None:
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            loop.create_task(coro)            # ← return value discarded
        else:
            coro.close()
    except RuntimeError:
        coro.close()

if peak_changed:
    _schedule(self._persist_peak(strategy, peak))
```
Per Python 3.11+ docs: "Save a reference to the result of [`create_task`], to avoid a task disappearing mid-execution. The event loop only keeps weak references to tasks." Without retaining the task object, Python's GC may collect it before `_persist_peak` finishes its `await`s — silently dropping the persistence. Also, exceptions raised inside the task are never observed (no `add_done_callback` to surface them), violating audit-reports/observability-audit-r4 P0 #4 about silent task death.
**Impact:** Drawdown peak may not persist on the rare GC interleave; silent failures during Redis blips (the `_persist_peak` raises but no one notices). Combined with kill-switch F3 wire-up landing later, peak_nav becomes stale → kill-switch sees wrong numbers.
**Fix:** Use the same `core.supervised_task.create_supervised_task(coro, name=...)` helper that `periodic_reconciler.py:208` uses — it tracks the task in a process-level set and surfaces errors at ERROR.

---

## Cross-cutting recommendations

1. **Multi-tenancy retrofit (F1, F2):** sweep every `select(Trade)` / `delete(Position)` etc. in routes for missing `where(*.username == username)`. The DB columns exist (models.py:212-269); the queries just don't use them. Same review for Alert, Watchlist, ScreenerPreset, StrategySignal, ReconciliationIssue.

2. **Kill-switch acceptance test (F3, F4):** add an integration test that hits `POST /strategies/momentum_quality/emergency-disable`, then dispatches a pipeline run, and asserts the strategy returned `kill_switch_disabled=True`. Today's tests verify the helper in isolation but not the wire-up.

3. **Brokers vs rate-limit (F12):** the prior audit's #6 (`/agents/chat`, `/agents/refine-strategy`) got a rate limiter (`_enforce_chat_rate_limit`); the same pattern needs to land on every endpoint that triggers an outbound paid-API call. Inventory: `broker.py` (Alpaca/IBKR/E*TRADE/Schwab), `news.py`, `tradingagents.py` (Anthropic + tooling spend), `screener.py` (FMP fundamentals).

4. **Re-encrypt broker credentials (F7):** one-time migration to swap SHA-256 → scrypt/Argon2id. Old ciphertext format `v1:` becomes `v2:` with a salt prefix; decrypt path supports both during the rollover.
