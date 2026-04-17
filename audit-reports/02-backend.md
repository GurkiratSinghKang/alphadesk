# Backend Audit — AlphaDesk
Auditor: Senior Backend Engineer (25 yrs)
Date: 2026-04-17

## Executive Summary

AlphaDesk's backend is a FastAPI monolith that ostensibly puts a trading platform in front of an Alpaca paper account. It has the right shape on paper (routers, JWT auth, Redis cache, Pydantic models, a "master agent" gatekeeper), but the internals are **not financial-grade**. Money is tracked in IEEE-754 floats throughout; the system-of-record for trades is a single pretty-printed JSON file on local disk manipulated by multiple tasks and workers with zero cross-process locking; IDs are assigned by `len(trades) + 1`; the Alpaca paper account is treated as the source of truth and is repeatedly polled and mirrored into that JSON file in destructive ways. A handful of findings — the trade ledger's non-durable writes (F-01), `len()+1` primary keys under concurrent writers (F-02), and the ledger's `sync_with_alpaca` silently closing real positions on any Alpaca API hiccup (F-03) — are P0s that can lose or fabricate trades in production. Authentication is better than the rest but still has gaps (JWT fallback secret, no CSRF despite cookie auth, dev docs left open in non-prod modes). Several routes remain honeypots for demo/random data (portfolio performance, market bars, screener composite scores), so even "live" dashboards are partially synthesized — an audit failure waiting to happen.

**Top 3 risks:**
1. **Non-atomic JSON "ledger" as system-of-record** for P&L, positions, journal, strategy attribution, drawdown — single file, thread-lock only (not process-lock), losing writes under Gunicorn workers (F-01, F-02).
2. **`TradeLedger.sync_with_alpaca` writes to disk on every API tick and will mark *every* open position `closed` if Alpaca returns an empty/partial positions list** — a transient 200 with `[]` silently destroys the books (F-03).
3. **`is_token_revoked` fails closed**, but `_check_rate_limit` fails *open*, and JWT falls back to a hardcoded `"dev-insecure-secret-change-me"` if `JWT_SECRET` is missing in non-prod — trivial token forgery on any misconfigured stage (F-04, F-14).

## Severity Legend
P0 = data-corruption or security risk, P1 = correctness bug, P2 = quality issue, P3 = nice-to-have

## Findings

### [P0] F-01 — Trade ledger is a single JSON file with no durable, atomic, cross-process write story
**Where:** `backend/data/ingestion/trade_ledger.py:18-53`, used by `backend/api/routes/trades.py:449-497`, `backend/api/routes/portfolio.py:474-510`, `backend/api/routes/strategies.py:606-620`, `backend/data/ingestion/daily_pipeline.py:641,918`, `backend/data/ingestion/alpaca_stream.py:91-97`, `backend/api/routes/pipeline.py:234-277`, `backend/api/routes/risk.py:167-183,432-507`.
**What:** Every trade, entry, exit, P&L calculation, drawdown, journal entry, strategy attribution, and open-position query routes through `TradeLedger`, which:

- Reads the entire `pipeline_logs/ledger.json` into memory on every construction (`__init__`: `self._data = _load()`).
- Instantiates a new `TradeLedger()` per HTTP request in route after route (`portfolio.py:479`, `portfolio.py:751`, `strategies.py:585-613`, `strategies.py:725,838`, `risk.py:169,435,550`, `pipeline.py:238`, etc.).
- Persists via `self._persist()` → `_save(data)` which writes a temp file and `tmp.replace()`s it. Guarded only by `threading.Lock()`.
- Is imported and mutated from an async FastAPI worker process, from the Alpaca stream task, from the pipeline task, from the scheduler task, from the realtime scanner — and from every HTTP handler that calls `sync_with_alpaca`.

Concretely:
- `threading.Lock` does nothing across Gunicorn workers (multi-proc). Dockerfile/requirements include `gunicorn>=23.0.0` (`requirements.txt:3`) — deploy with `-w 2` and the lock is a placebo.
- Even within one process, `get_trade_history` (`trades.py:449`) mutates `ledger._data` indirectly through other calls that re-read the file. A request that races `sync_with_alpaca` with `record_entry` loses the entry: both read the file, one writes, the other overwrites with stale data.
- `tmp.replace(LEDGER_PATH)` is atomic on POSIX for the rename, but the caller holds an in-memory copy (`self._data`) that is out of sync after any concurrent write. There is no read-modify-write guard: whoever writes last wins.
- No `fsync` on the temp file — power loss mid-write = truncated ledger on next boot (the `_load` path silently catches the JSON error and returns `{"trades": [], "version": 1}` at line 33-35 — **the ledger simply forgets all history**).

**Why it matters:** This is the system-of-record for P&L, positions, and trade journal. Corruption or loss is undetectable (silently treated as fresh install). Under load or crash, expect: silently lost trades, double-booked trades, deleted open positions, fake "new" trades when history is wiped.

**Fix:** Move to the already-provisioned Postgres (`data/storage/models.py:Trade`, `Position`) with proper transactions and optimistic locking. Short-term: replace `threading.Lock` with an OS-level `fcntl.flock` on a dedicated lock file, `fsync(tmp_fd)` before rename, and make `TradeLedger` a process-level singleton with re-read-on-modification. Long-term: drop the JSON ledger entirely and write directly to Postgres.

---

### [P0] F-02 — Trade IDs are `len(self._data["trades"]) + 1`, which collides under concurrency
**Where:** `backend/data/ingestion/trade_ledger.py:70`, `backend/data/ingestion/trade_ledger.py:277`.
```python
trade = { "id": len(self._data["trades"]) + 1, ... }
```
**What:** Two callers that each load a ledger with 100 trades and then call `record_entry`/`sync_with_alpaca` will *both* assign `id=101`. There is no uniqueness check, no DB sequence, no UUID. When one write lands and the other overwrites it, the first trade disappears entirely (see F-01) — but even if both lands, duplicate IDs now exist in the file. `_match_strategy_for_symbol` walks by id (`trade_ledger.py:324`) and will misattribute orders.

**Why it matters:** IDs referenced in `TradeHistoryEntry.id` (`trades.py:144`), journal entries (`portfolio.py:74`), and agent analysis. Duplicate IDs = wrong journal, wrong strategy attribution, wrong audit trail.

**Fix:** Use `uuid.uuid4().hex` for the ID or migrate to DB auto-increment. If you must keep ints, compute `max(t["id"] for t in trades) + 1` — still racy but at least monotonic under a proper lock.

---

### [P0] F-03 — `sync_with_alpaca` closes every open ledger position when Alpaca returns empty list
**Where:** `backend/data/ingestion/trade_ledger.py:220-310`, called from `strategies.py:611,728,841` on *every* GET to `/strategies/`, `/strategies/leaderboard`, `/strategies/{id}/performance`.
**What:** The sync logic:
```python
for trade in self._data["trades"]:
    if trade["status"] != "open":
        continue
    sym = trade["symbol"]
    ...
    if sym in alpaca_by_sym:
        # update shares
    else:
        # Position no longer exists on Alpaca -- mark closed
        trade["status"] = "closed"
        trade["exit_time"] = ...
        trade["exit_reason"] = "alpaca_sync_closed"
```
Now look at how `alpaca_by_sym` is built in the caller (`strategies.py:591-603`):
```python
try:
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(..., /v2/positions, ...)
        if resp.status_code == 200:
            alpaca_positions = resp.json()
except Exception:
    logger.warning("Failed to fetch Alpaca positions ...")

ledger = TradeLedger()
if alpaca_positions:           # <-- only guards empty, not error
    ledger.sync_with_alpaca(alpaca_positions)
```
Good, `if alpaca_positions:` guards the empty-list case — but **`sync_with_alpaca` is also called in `list_strategies` without any such guard** for the case where Alpaca returns 200 with `[]` (e.g., positions momentarily cleared, or Alpaca rate-limits and returns empty structure). The `if alpaca_positions:` check is a footgun: today it short-circuits on empty, but inside `sync_with_alpaca` itself there is no sanity check. Any caller that forgets the guard (or passes partial data) wipes the book. And `sync_with_alpaca` writes to `ledger.json` when it makes any change (`trade_ledger.py:301`). Every `GET /api/v1/strategies/` from the frontend thus reads Alpaca, potentially ghost-closes ledger trades, and writes to disk — with every trade's strategy attribution, P&L, exit reason overwritten.

Additionally: `record_entry` returns pre-fill estimates of entry_price that are later updated via `update_entry_price` (`trade_ledger.py:92-111`) — but `update_entry_price` only updates the *most recent* open trade for the symbol. If two strategies buy the same symbol (which shouldn't happen per Check 1 in `MasterAgent.request_trade` but *does* happen when the risk monitor is disabled, see F-05), the update hits the wrong trade.

**Why it matters:** The very act of loading the strategies dashboard mutates the system-of-record. A 200 OK with empty positions from Alpaca (common during paper-account maintenance windows) silently marks every open trade as closed with zero P&L and reason `"alpaca_sync_closed"`. There is no undo and no audit log of the mutation beyond a single INFO line per symbol.

**Fix:** `sync_with_alpaca` must be idempotent and safe against partial inputs: require explicit `authoritative_snapshot=True` kwarg before closing any trade; otherwise only create/update, never close. Move sync out of GET handlers entirely — it's a side-effecting mutation posing as a read. Log and require manual reconciliation for discrepancies.

---

### [P0] F-04 — JWT falls back to a hardcoded secret in non-prod, and `is_token_revoked` fails closed while `_check_rate_limit` fails open
**Where:** `backend/core/config.py:93-98`, `backend/core/auth.py:62-71`, `backend/api/routes/auth.py:32-55`.
**What:**
```python
# core/config.py
@property
def jwt_secret_value(self) -> str:
    val = self.JWT_SECRET.get_secret_value()
    if not val and self.is_production:
        raise ValueError("JWT_SECRET must be set in production")
    return val or "dev-insecure-secret-change-me"
```
If `ENVIRONMENT != prod` and `JWT_SECRET` is unset (easy: the `.env` template doesn't force it), all tokens are signed with `"dev-insecure-secret-change-me"`. Staging and dev deploys are therefore forgeable by anyone reading the source. In addition:

- `is_token_revoked` fails closed (good — `core/auth.py:70-71`), but combined with F-15 (WebSocket leaking Redis downtime), a Redis blip logs out every user.
- `_check_rate_limit` fails open (`auth.py:53-55`): a Redis outage *disables* rate limiting on login. Attacker can trivially brute-force the bcrypt hash during the window by taking Redis down (or just waiting for any blip).
- `_RATE_LIMIT_MAX = 15` (comment says 5, constant is 15) — typo/drift between spec and code (`auth.py:26-29`).
- Access tokens last 8 hours (`config.py:78`); refresh tokens 30 days. An 8-hour access token with no device binding + cookie storage + `allow_credentials=True` CORS + no CSRF token is a wide risk window.

**Why it matters:** Forgeable staging tokens are a compliance fail. Login rate limit that disappears under Redis outage is a brute-force invitation against a single admin account.

**Fix:** Remove the dev-fallback entirely — require `JWT_SECRET` in every environment and fail fast. Make `_check_rate_limit` fail closed like `is_token_revoked`. Reconcile constant and comment. Shorten access token to ≤60 min and issue CSRF tokens for cookie-based auth.

---

### [P0] F-05 — `toggle_risk_monitor` is an unauthenticated endpoint that disables all pre-trade risk checks
**Where:** `backend/api/routes/strategies.py:950-981`, router mounted under `dependencies=[Depends(require_auth)]` but the endpoint itself takes `enabled: bool = True` as an unvalidated query param and mutates a **class-level** attribute on `MasterAgent`.
**What:**
```python
@router.post("/admin/risk-monitor", response_model=RiskMonitorState)
async def toggle_risk_monitor(enabled: bool = True) -> RiskMonitorState:
    from data.ingestion.master_agent import MasterAgent
    previous = MasterAgent.RISK_MONITOR_ENABLED
    MasterAgent.RISK_MONITOR_ENABLED = enabled
```
The router-level `Depends(require_auth)` does protect this behind a login, but:
- There is no admin/role check — any logged-in user can flip it.
- Mutating a class attribute in an async multi-worker deployment affects only one Gunicorn worker. The state is inconsistent across workers and lost on restart.
- When `RISK_MONITOR_ENABLED = False`, `MasterAgent.request_trade` (`master_agent.py:349-369`) bypasses P1-P4 (drawdown halts, sector limits, regime deployment, VaR), rejects only duplicate symbols, and logs a warning. Combined with `POST /trades/orders` (`trades.py:175-274`) which only does a crude $50k notional check, the risk stack collapses to "don't buy the same symbol twice".
- Frontend (or any authenticated user) can call `POST /api/v1/strategies/admin/risk-monitor?enabled=false` and the pipeline will start approving every trade for the remainder of that worker's life.

**Why it matters:** For a "risk engine" this is the single biggest hole — one toggle disables everything.

**Fix:** Require an explicit `X-Risk-Override-Token` plus a second admin role, persist the state in Redis with a TTL, and broadcast to all workers via Redis pub/sub. Log the change with full audit trail (who, when, why). Default to enabled after any worker restart.

---

### [P1] F-06 — Money everywhere is `float`; P&L, notional, margins, drawdowns all use binary floating-point
**Where:** Pervasive; examples `backend/data/ingestion/trade_ledger.py:126` (`round((price - entry_price) * shares, 2)`), `backend/api/routes/portfolio.py:437-441`, `backend/data/ingestion/master_agent.py:119-122`, `backend/api/routes/trades.py:91` (`qty: float`).
**What:** Every P&L, notional, market value, drawdown, Sharpe, Sortino, VaR, CVaR, and position size in the codebase is an IEEE-754 `float`. No `decimal.Decimal` anywhere (verified via grep). Rounding to 2 decimals with `round()` is lossy and banker's-rounding-dependent: `round(2.675, 2)` returns `2.67`, not `2.68`. Summing hundreds of fractional P&Ls accumulates error; `sum(pnl_pcts) / len(pnl_pcts)` (`trade_ledger.py:188`) compounds it.
**Why it matters:** Cumulative error in reported P&L, wrong VaR checks at the boundary, "did we hit the 30% sector limit?" flips based on rounding. For a paper-account demo the blast radius is low; for a live account the correctness complaints start on day one and are extremely painful to retrofit.

**Fix:** `Decimal` at the boundary of every money field. Pydantic v2 has first-class `Decimal` support. Define a `Money` type alias with `DecimalContext(prec=28, rounding=ROUND_HALF_EVEN)` and use it everywhere.

---

### [P1] F-07 — Shares stored as float; `OrderLeg.qty: float` allows fractional shares that Alpaca options don't accept, and ledger mixes `int(...)` and float
**Where:** `backend/api/routes/trades.py:91` (`qty: float = Field(..., gt=0, le=100000)`), `backend/data/ingestion/trade_ledger.py:59-91` (`shares: int`), `backend/data/ingestion/trade_ledger.py:248` (`int(float(... ))`), `backend/data/ingestion/daily_pipeline.py:145-179` (`qty: int`).
**What:** `OrderLeg.qty` is a `float`; the ledger's `record_entry` signature is `shares: int`; `sync_with_alpaca` does `int(float(alpaca_by_sym[sym].get("qty", 0)))`. Alpaca's fractional-share orders only work for equities, not options, and the multi-leg branch in `_submit_to_broker` (`trades.py:843-861`) serializes `qty` as `str(leg.qty)` — a fractional value will be rejected by Alpaca with a generic 4xx that the code translates to an opaque 502 "Broker rejected order" (`trades.py:867-872`) with no detail bubbled back.
**Why it matters:** Confusing error UX for users; data drift between broker ("qty=2") and ledger ("shares=2") when Alpaca's fractional fills arrive.

**Fix:** Split `EquityOrderLeg` (allows fractional) from `OptionsOrderLeg` (int only); propagate Alpaca's actual 4xx body back to the user in the 502 detail (safely redacted).

---

### [P1] F-08 — `POST /trades/orders` persists trade to DB *after* submitting to broker, with no rollback if DB write fails
**Where:** `backend/api/routes/trades.py:222-274`.
**What:**
```python
order_id = await _submit_to_broker(request, settings)       # live order placed
...
try:
    if not _s.SKIP_DB_INIT:
        ...
        db.add(trade); await db.flush(); await db.commit()
except Exception:
    logger.warning("Failed to persist trade record to DB ...", exc_info=True)
```
Order lands at broker. DB write fails. We warn and return 201 to the user as if everything was fine. The trade is not in the DB, is not in the ledger (the ledger only gets writes from the automated pipeline, not from this handler), and has no local record at all. Next `GET /trades/history` won't see it until the ledger happens to sync with Alpaca and auto-create a "manual-discretionary" entry (`trade_ledger.py:285`) — with `entry_time=datetime.now(timezone.utc)` instead of the actual submission time, destroying the audit trail.
**Why it matters:** Orphan orders. Incorrect entry time. No journal record. Audit impossible to reconstruct.

**Fix:** Either (a) DB-first, broker-second with a compensating cancel on DB rollback, or (b) an outbox pattern: write intent record first with status=pending_submit, submit to broker, update record. The current order of operations is the worst of both worlds.

---

### [P1] F-09 — `_check_duplicate_order` hashes only `symbol/side/qty/type` — different-priced orders collide, and there is no idempotency key from the client
**Where:** `backend/api/routes/trades.py:549-568`.
**What:**
```python
order_key = hashlib.sha256(
    json.dumps(
        [{"s": l.symbol, "sd": l.side.value, "q": l.qty, "t": l.order_type.value} for l in request.legs],
        sort_keys=True,
    ).encode()
).hexdigest()
```
Does not include `limit_price`, `stop_price`, `strategy`, `notes`, or `time_in_force`. Two legitimate orders for the same symbol/side/qty placed back-to-back at *different* limit prices are rejected with 409 for 30 seconds. Meanwhile, a client that simply changes `limit_price` by 1¢ can bypass the check entirely. And there is no client-supplied idempotency key — a retried HTTP request after a timeout will be treated as a new order if >30s have passed.
**Why it matters:** False 409s during scaling in/out positions with laddered limit orders. Real duplicates not caught on retry.

**Fix:** Hash the full leg payload including prices. Accept an optional `Idempotency-Key` header, persist it in Redis for 24 h, and use it (not the content hash) as the canonical dedup key.

---

### [P1] F-10 — Market-hours check in `create_order` uses naive hour comparisons and ignores market holidays
**Where:** `backend/api/routes/trades.py:198-209`.
**What:**
```python
et_now = datetime.now(ZoneInfo("America/New_York"))
if (
    et_now.weekday() >= 5
    or et_now.hour < 9
    or (et_now.hour == 9 and et_now.minute < 30)
    or et_now.hour >= 16
):
    raise HTTPException(...)
```
- Doesn't account for holidays (Thanksgiving, July 4, MLK, etc.) — sends a market order on a holiday that Alpaca will reject with an unclear error.
- Doesn't handle early close days (day after Thanksgiving, Christmas Eve — market closes at 1:00 PM ET).
- `et_now.hour >= 16` blocks orders at exactly 4:00 PM instead of before 4:00 PM; technically correct but an off-by-one waiting to happen at 3:59:59.
- Extended hours/pre-market market orders are blocked even when Alpaca supports them via `extended_hours: true` (never passed here).

**Why it matters:** Legitimate orders rejected; confusing errors on holidays; not a correctness disaster but user-hostile.

**Fix:** Call `GET /v2/clock` from Alpaca (already used in `market.py:662-684`) or use `pandas_market_calendars` / a small XNYS calendar lib. Respect early closes.

---

### [P1] F-11 — `_submit_to_broker` "paper-only" safety check uses substring match and can be bypassed
**Where:** `backend/api/routes/trades.py:815-820`, `backend/data/ingestion/daily_pipeline.py:108-114`.
**What:**
```python
if "paper" not in base_url.lower():
    raise HTTPException(status_code=403, detail="Live trading is not enabled. ...")
```
`"paper"` anywhere in the URL passes. Someone sets `ALPACA_BASE_URL=https://api.alpaca.markets/paper_fake` or `https://paper-backdoor.alpaca.markets` and the check trivially passes despite pointing at the live endpoint. The canonical live host is `api.alpaca.markets`; canonical paper is `paper-api.alpaca.markets`. A whitelist, not a substring match, is the right check.
**Why it matters:** Defense-in-depth matters most when someone fat-fingers an env var.

**Fix:** `settings.ALPACA_BASE_URL in ("https://paper-api.alpaca.markets",)` — allowlist, not substring.

---

### [P1] F-12 — `get_portfolio_summary` silently falls back to demo data on Alpaca failure
**Where:** `backend/api/routes/portfolio.py:386-458`.
**What:**
```python
except Exception:
    logger.warning("Failed to fetch portfolio summary from Alpaca, falling back to demo", exc_info=True)
    return _demo_portfolio_summary()
```
The demo portfolio reports `equity=100_000`, `cash=100_000`, `buying_power=200_000`, `is_demo=True`. The frontend surfaces `is_demo` as a badge, but a user who's watching their dashboard during an Alpaca outage sees their equity snap to $100k. The same pattern appears in `get_morning_brief` (`portfolio.py:1191-1193`) and `get_performance` (`portfolio.py:600-602`).
**Why it matters:** Stale → wrong portfolio display during exactly the moments when users most want live data (market stress, API outage). Worse, if a trader glances at equity during a crash and sees $100k, they think they're fine.

**Fix:** Return HTTP 503 "Broker temporarily unavailable" on upstream Alpaca failure — don't fabricate a portfolio. Reserve demo data for the explicit no-API-key path.

---

### [P1] F-13 — `get_performance` equity curve is fabricated: DB path builds dates backwards from today with one date per trade, not per day
**Where:** `backend/api/routes/portfolio.py:560-595`.
**What:**
```python
n_points = len(cumulative)
equity_curve_data = []
for i, c in enumerate(cumulative):
    d = today_d - timedelta(days=(n_points - 1 - i))
    ...
    equity_curve_data.append({"date": d_str, ...})
```
If the user has 40 closed trades from the last 3 months, this builds an equity curve of 40 data points, one per day counting back from today — not the real exit dates. Trades that closed on the same day are given distinct fake dates; trades spread across months are squashed into the last 40 days. Then `_compute_enhanced_metrics` computes rolling 30-day Sharpe *on these fake dates*.
**Why it matters:** Sharpe, Calmar, drawdown peak/trough dates, rolling-30d Sharpe — all reported from fabricated timestamps. This is in the "real data" code path (not labeled `is_demo`).

**Fix:** Group trade P&L by actual exit date (as the ledger path already does in `portfolio.py:487-499`) and emit one equity-curve point per trading day. The ledger path is correct; the DB path is broken.

---

### [P1] F-14 — CORS `allow_origins` + `allow_credentials=True` + no CSRF token
**Where:** `backend/main.py:133-147`.
**What:**
```python
cors_origins = ["http://localhost:3000", "http://127.0.0.1:3000"]
if settings.PRODUCTION_ORIGIN:
    cors_origins.append(settings.PRODUCTION_ORIGIN)
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    ...
)
```
Combined with `set_cookie(..., samesite="strict", httponly=True)` (`auth.py:57-77`), CSRF risk is low but not zero — `samesite=strict` is a partial mitigation, but `POST /trades/orders`, `POST /trades/halt`, `POST /agents/chat` have no CSRF tokens and no double-submit defence. If an attacker finds any XSS in the frontend (easier than it sounds — `ai_summary` text is rendered from an LLM), they execute trades as the logged-in user. The `/api/v1/webhooks/tradingview` is explicitly unauthenticated (`main.py:158`) and relies on a single shared secret for anyone in the organization.
**Why it matters:** Trading actions behind pure cookie auth without CSRF is against institutional practice.

**Fix:** Add a CSRF token tied to the session, validated on every state-changing endpoint. Consider a separate mTLS-secured broker-action endpoint for the highest-risk actions.

---

### [P1] F-15 — `_check_rate_limit` doesn't handle Redis `pipe.expire(... nx=True)` semantics
**Where:** `backend/api/routes/auth.py:32-50`.
**What:**
```python
pipe.incr(key)
pipe.expire(key, _RATE_LIMIT_WINDOW, nx=True)
results = await pipe.execute()
count = results[0]
```
- `expire ... nx=True` only sets TTL if there's no existing TTL. Fine on first request. But then counting windows get stuck at the first 5-minute boundary. After 5 minutes of no requests, Redis expires the key; the next request creates it fresh with NX-TTL — correct.
- **But** during a clock-skew between frontend and Redis host or a key that lingers without TTL (happens if `expire` fails silently on cluster repartition), `incr` keeps counting forever and the rate limit never lifts.
- Fails open on any Redis error — see F-04.

**Why it matters:** Brittle rate limiting on the most sensitive endpoint.

**Fix:** Use a Lua script for atomic `INCR + EXPIRE` with a Redis TTL that's always set on first write. Fail closed.

---

### [P1] F-16 — `_is_trading_halted` fail-closed state is held under the same Redis key as `cache_get("trading:halted")`, but clear path is inconsistent
**Where:** `backend/api/routes/trades.py:26-51`.
**What:** `_set_trading_halted(True)` uses `cache_set("trading:halted", {"halted": True}, ttl_seconds=86400)` → JSON-serialized through `orjson`. `_set_trading_halted(False)` uses `redis.delete("trading:halted")` — a raw key delete. But `_is_trading_halted` calls `cache_get` which `orjson.loads` the value. If a future change persists a scalar directly via `redis.set`, the reader will return `None` silently. Also, the `resume_trading` flow at `trades.py:643-665` *reads* `redis.get("trading:halted")` raw, bypassing the JSON serializer — testing truthiness of a bytes/None mixture that has already been JSON-serialized. Fragile.
**Why it matters:** Halts can silently not-halt or not-resume due to mismatched (de)serialization.

**Fix:** One serializer for the key. Use `cache_get`/`cache_set` everywhere, or a dedicated typed halt-state helper.

---

### [P1] F-17 — `check_alerts_for_symbol` reads the entire Redis hash of alerts on every tick
**Where:** `backend/api/routes/trades.py:766-806`, called from `backend/data/ingestion/alpaca_stream.py:44-47` on *every* price tick.
**What:**
```python
async def _maybe_publish(...):
    ...
    try:
        from api.routes.trades import check_alerts_for_symbol
        await check_alerts_for_symbol(symbol, price)
    except Exception:
        pass
```
And:
```python
async def check_alerts_for_symbol(symbol: str, price: float) -> None:
    ...
    alerts = await _get_all_alerts()           # HGETALL every tick
    for alert in alerts:
        if alert["symbol"] != symbol or alert.get("triggered"):
            continue
        ...
```
At 100 symbols × multiple ticks/sec in market hours, this is hundreds of `HGETALL`s per second, deserializing every alert every time. Redis can handle the throughput, but the Python-side loop is O(alerts × ticks). A user who creates 10k alerts cripples the WebSocket feed.
**Why it matters:** Performance cliff under load; alert check is the hot path.

**Fix:** Index alerts by symbol: `HSET price_alerts:<SYMBOL> <id> <json>`. Only HGETALL the per-symbol key on each tick. Or maintain an in-memory index rebuilt on alert CUD.

---

### [P1] F-18 — `TradeLedger.record_exit` closes the *first* open trade for a symbol regardless of strategy; partial fills double-count
**Where:** `backend/data/ingestion/trade_ledger.py:113-139`.
**What:**
```python
for trade in self._data["trades"]:
    if trade["symbol"] == symbol and trade["status"] == "open":
        trade["exit_price"] = price
        ...
        return trade
```
- Closes the *first* open trade for the symbol (insertion order), not the one from the strategy that's actually exiting.
- `trade["shares"] = shares` (line 127) overwrites the original share count with the exit quantity — partial exits destroy the original position size.
- P&L calc: `(price - entry_price) * shares` uses the post-overwrite shares (the exit qty), so partial-fill P&L is wrong; second partial exit tries to close the same trade and fails (already closed).
- No matching by order_id. No matching by strategy. Two strategies accidentally holding the same symbol (possible when risk monitor is off, F-05) blow up here.

**Why it matters:** Wrong P&L on partial fills and any exit where two strategies share a symbol. Exit attributed to wrong strategy → wrong strategy leaderboard.

**Fix:** Match by strategy and remaining shares. Support partial closes by creating child trades (`parent_id`). Ideally use broker order_id as the join key.

---

### [P1] F-19 — `sync_with_alpaca` creates new ledger entries with `entry_time = datetime.now()` — overwrites history
**Where:** `backend/data/ingestion/trade_ledger.py:276-293`.
**What:** When an Alpaca position exists that the ledger doesn't know about, the sync creates an entry with:
```python
"entry_time": datetime.now(timezone.utc).isoformat(),
```
The actual position entry time is `pos["acquired_at"]` (Alpaca does return this via `/v2/account/activities` but this sync only pulls `/v2/positions`). So every auto-created trade gets an "entry_time" of "right now" — P&L pct calculations, hold-time analytics, drawdown peak/trough dates all reference the sync time, not the actual entry.
**Why it matters:** Strategy analytics (`/strategies/{id}/analytics` hold_time_stats, monthly returns) use `entry_time`. This field is silently wrong.

**Fix:** Pull `/v2/account/activities?activity_types=FILL` to find the true fill time for the symbol; or, at minimum, mark auto-created trades with a flag so analytics can filter them out.

---

### [P1] F-20 — `_poll_fill_price` polls 10 times × 1 s = 10 s; stop-loss and take-profit are placed *before* the fill completes
**Where:** `backend/data/ingestion/daily_pipeline.py:256-285` (`_poll_fill_price`), 330-384 (the sequence).
**What:** The order of operations in `_execute_approved_orders`:
1. Place market buy.
2. Record pre-trade estimate in ledger.
3. Poll for fill (up to 10 s).
4. Update ledger entry_price.
5. Recalculate stop/target from fill.
6. Place stop-loss order.
7. Place take-profit limit order.

But the Alpaca market buy fills instantly in paper mode; in real life, it may take seconds. Steps 6–7 place SELL orders that, if the buy *isn't yet filled*, become naked shorts. Alpaca rejects, the code logs an error, but no compensating action — the position now has no stop-loss.
Meanwhile, if the poll times out (line 357–362), the ledger keeps the pre-trade estimate as entry_price, but the stop/target were calculated against that estimate too — so the "5% below entry" stop is 5% below a *guess*, not the fill. Plus, if the actual fill was unfavourable (slippage), the stop triggers at a different P&L than logged.

**Why it matters:** Inconsistent stop levels, orphan positions without stop protection.

**Fix:** Use Alpaca's bracket orders (`order_class=bracket`) to submit the parent + stop + limit atomically, eliminating the race. Or at minimum, only place the exit orders after a confirmed fill.

---

### [P1] F-21 — `_check_exits` cancels *all* open stop/limit sell orders for the symbol, including unrelated positions in the same symbol from other accounts/strategies
**Where:** `backend/data/ingestion/daily_pipeline.py:525-551`.
**What:** After firing an exit sell:
```python
resp = await client.get(f"{_base_url()}/v2/orders?status=open&symbols={sym}", ...)
...
for open_order in resp.json():
    otype = open_order.get("type", "")
    oside = open_order.get("side", "")
    oid = open_order.get("id")
    if oside == "sell" and otype in ("stop", "limit") and oid:
        await client.delete(f"{_base_url()}/v2/orders/{oid}", ...)
```
No filter on `client_order_id` prefix (e.g., this strategy's orders only). Every stop and limit sell for that symbol on the whole account is cancelled, across all strategies. If a manual order is open, it disappears.
**Why it matters:** Collateral damage during exit; orphans stops for unrelated positions.

**Fix:** Filter by `client_order_id.startswith(strategy_name)` or track order IDs per position.

---

### [P1] F-22 — `_get_vix_level` uses `VIX` ticker on Polygon, which doesn't trade as an equity; comparison `last < 100` is a weak sanity filter
**Where:** `backend/data/ingestion/daily_pipeline.py:53-81`.
**What:** VIX is an index, not a stock; `api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/VIX` will 404 or return an empty ticker (the real ticker is `I:VIX` on Polygon's indices endpoint). The fallback `16.5` is also in `_detect_regime` (`master_agent.py:188-197`), so any time Polygon is absent, the portfolio defaults to "bull_low_vol" regime with 80% deployment. The sanity check `last < 100` would also accept negative or zero values silently.
**Why it matters:** Regime detection (which drives `max_deployment`) defaults to the most aggressive regime. In a crash, VIX is unavailable → system assumes bull market → deploys more capital at the worst moment.

**Fix:** Use `/v3/snapshot/indices/I:VIX` on Polygon or `^VIX` on a reliable feed. Default to the most *conservative* regime (`"crisis"`, 10% deployment) when data is unavailable, not the most aggressive.

---

### [P1] F-23 — `_portfolio_var` uses a simple 0.7 diversification factor regardless of actual correlations
**Where:** `backend/data/ingestion/master_agent.py:208-217`.
**What:**
```python
def _portfolio_var(self) -> float:
    individual_vars = [...]
    if not individual_vars:
        return 0
    return sum(individual_vars) * 0.7
```
This is wrong under any realistic portfolio (SPY + QQQ has correlation 0.95, not 0.3 implied here). When positions are highly correlated, actual VaR is close to sum(individual VaRs), not 0.7 * sum. Combined with the `MAX_PORTFOLIO_VAR = 0.02` check, the system allows too many positions in correlated names.
**Why it matters:** The risk budget is not a risk budget. Claims "2% daily VaR limit" while undersizing portfolio VaR.

**Fix:** Compute correlation matrix from actual return history (you already have the bars endpoint). Use the sqrt(w' Σ w) form. If infeasible, use a conservative 1.0 factor (sum-of-VaRs) as the worst case.

---

### [P1] F-24 — `/api/v1/portfolio/morning-brief` regex fallback for regime is broken
**Where:** `backend/api/routes/portfolio.py:1152-1167`.
**What:**
```python
try:
    from core.redis import cache_get
    cached_regime = await cache_get("market:regime")
    if cached_regime and isinstance(cached_regime, dict):
        regime_label = cached_regime.get("regime", "Unknown")
except Exception:
    # Infer from VIX level if cache unavailable
    if vix_price > 25:
        regime_label = "High Volatility"
    ...
```
The `except` block's fallback logic only runs when *importing* `cache_get` fails, not when the cache has no key. In practice `cache_get` catches its own exceptions and returns `None`, so `except` is unreachable; the code path for "cache has no key" skips the VIX-based fallback and reports `regime_label = "Unknown"`. The template-based `_generate_brief_summary` then outputs no regime guidance.
**Why it matters:** Morning brief constantly says "Unknown" regime in practice.

**Fix:** Move the VIX-based fallback outside the except block; check if `cached_regime` is falsy.

---

### [P1] F-25 — `options.py:_demo_spot` calls sync `httpx.get(...)` inside an async route
**Where:** `backend/api/routes/options.py:114-145`.
**What:**
```python
def _demo_spot(symbol: str) -> float:
    ...
    try:
        headers = _alpaca_headers()
        resp = httpx.get(f"https://data.alpaca.markets/v2/stocks/{s}/trades/latest", ...)
```
Sync `httpx.get` in an async route blocks the event loop for up to 5 s per call. Called from `_demo_chain` per contract, which iterates strikes × expiries → dozens of sync network calls in one request → the uvicorn worker is frozen. Other users see the whole API stall.
**Why it matters:** A single `/options/chain/TSLA` hit pauses the entire worker.

**Fix:** Make `_demo_spot` async and use `httpx.AsyncClient`. Hoist the one spot fetch outside the loop — it's constant per underlying.

---

### [P1] F-26 — `strategies.py` — `TradeLedger` loaded and `sync_with_alpaca` called on every hit of `GET /strategies/`, `/leaderboard`, `/{id}/performance`
**Where:** `backend/api/routes/strategies.py:608-620,725-733,838-845`.
**What:** Three separate GET handlers each:
1. Fetch Alpaca positions (10 s timeout).
2. Construct a TradeLedger (entire ledger JSON read from disk).
3. Call `sync_with_alpaca` — mutates and writes disk.
4. Reconstruct another TradeLedger (another disk read).
5. Compute stats.

Three GETs from a single page load = 3 Alpaca API calls + 6 disk reads + up to 3 disk writes. Concurrent users with one Gunicorn worker = serialized requests. Dashboard load time is visible (seconds). Under higher concurrency this becomes a bottleneck and amplifies the F-01/F-03 corruption risks.

**Why it matters:** Performance and data-integrity amplifier. Also: GET should be idempotent by HTTP spec — these ones mutate state.

**Fix:** Make sync a background job (scheduler, not per-request). Cache the result in Redis for N seconds. Return the cached snapshot.

---

### [P2] F-27 — `decode_token` returns 401 on any JWT error, but never distinguishes expired from malformed
**Where:** `backend/core/auth.py:49-59`.
**What:** Frontend cannot tell whether to refresh the token or force re-login.
**Fix:** Catch `jwt.ExpiredSignatureError` separately and return a body `{"error": "token_expired"}` with 401, so the frontend can trigger a refresh flow.

---

### [P2] F-28 — `POST /pipeline/run` has no auth scope, no idempotency, no throttle
**Where:** `backend/api/routes/pipeline.py:22-56`.
**What:** A single curl loop can run the pipeline continuously — it's protected by `_pipeline_lock` (`daily_pipeline.py:603`) and returns `{"error": "Pipeline already running"}` after the first, but the lock is per-worker. Multi-worker = multiple pipelines stomping on the same ledger.
**Fix:** Use a Redis-backed `SET NX` distributed lock. Add an admin-only check.

---

### [P2] F-29 — `webhooks.py` always requires `TRADINGVIEW_WEBHOOK_SECRET` (correct) but stores it in SecretStr with hardcoded default `SecretStr("")`; real deployments that forget to set it return 503, which many deploys will paper over
**Where:** `backend/api/routes/webhooks.py:73-81`, `backend/core/config.py:68-69`.
**What:** Empty default means a misconfigured deploy returns 503 Service Unavailable to TradingView, which will retry indefinitely. No alert is surfaced. Webhook starts dropping real trading signals silently.
**Fix:** Require at config-load time if `ENVIRONMENT=prod`. Also, webhooks are POST-only (`/tradingview`), but GET returns 405 without a clear message; add a minimal health endpoint so monitoring can probe.

---

### [P2] F-30 — Redis pool with `decode_responses=True` and `max_connections=50` but no `socket_keepalive`, `socket_timeout`, or `health_check_interval`
**Where:** `backend/core/redis.py:18-27`.
**What:** Long-lived connections behind a load balancer (Caddy → Gunicorn → Redis) will hit half-open states after idle. Add `socket_keepalive=True`, `health_check_interval=30`.
**Fix:** Set `socket_keepalive`, `socket_connect_timeout=5`, `socket_timeout=10`, `health_check_interval=30`.

---

### [P2] F-31 — Every handler does `from core.config import settings` inside the function body
**Where:** examples at `backend/api/routes/trades.py:164, 211, 237, 285, 361, 581, 631`, `backend/api/routes/portfolio.py:114, 394, 476, 520`, everywhere.
**What:** Not technically wrong, but the pattern signals circular imports once existed. The repeated import cost is trivial, but the proliferation of `from X import settings` inside handlers makes testing/patching more error-prone — you can't simply monkeypatch the module-level `settings`.
**Fix:** Hoist all imports to the top of the module; use `importlib.reload` or FastAPI dependency injection to swap settings in tests.

---

### [P2] F-32 — `data/storage/models.py` uses `_define_models` lazy-init pattern that runs on first attribute access; concurrent first-accesses will race
**Where:** `backend/data/storage/models.py:14-209`.
**What:**
```python
def _define_models() -> dict[str, Any]:
    if _models_cache:
        return _models_cache
    ...
    _models_cache.update({...})
    return _models_cache
```
No lock. Two async workers calling `from data.storage.models import Trade` simultaneously will both execute `_define_models`, producing two distinct `Trade` classes registered on the same `Base.metadata`. SQLAlchemy will error with "Table is already defined".
**Why it matters:** Rare but would reproducibly crash on startup under concurrent first-access. The Dockerfile's lifespan startup is sequential, so it's less likely in practice, but any lazy access during request handling is at risk.
**Fix:** Move models to module level. There is no actual benefit to lazy-defining SQLAlchemy models — the import cost is one-time.

---

### [P2] F-33 — `TimescaleDB hypertable` creation in `init_db` runs every startup
**Where:** `backend/core/database.py:101-113`.
**What:** `SELECT create_hypertable('ohlcv_bars', 'timestamp', if_not_exists => TRUE)` — OK idempotent, but the `create_all` call above it (line 98) doesn't know about hypertables. If the table schema drifts, `create_all` won't migrate it. Alembic is listed in `requirements.txt:20` but no `alembic.ini`, `env.py`, `versions/` exists (verified). The claim of "institutional-grade" migrations is false — `create_all` is a prototyping pattern.
**Why it matters:** Schema changes in production require either manual SQL or destroying tables. No rollback story. `create_all` can't add columns.
**Fix:** Initialize Alembic. Stop using `create_all` for anything but first-boot dev.

---

### [P2] F-34 — `sync_database_url` replaces `+asyncpg` naively — works for the default URL but breaks on anything else
**Where:** `backend/core/config.py:89-91`.
**What:** `self.DATABASE_URL.replace("+asyncpg", "")`. If `DATABASE_URL=postgresql+asyncpg://user:pass@host/db?ssl=require`, fine. If it's `postgres://...` (no driver suffix, which is what Heroku-style URLs use), the replacement is a no-op and the result is still an async URL.
**Fix:** Use `sqlalchemy.engine.URL.create` or at least regex-based suffix removal.

---

### [P2] F-35 — `get_trade_history` fallback DB path computes pnl_pct against entry_price * qty but stores a second qty variable `qty = t.legs[0].get("qty", 1)`
**Where:** `backend/api/routes/trades.py:520-538`.
**What:**
```python
qty = t.legs[0].get("qty", 1) if t.legs else 1
...
pnl_pct=round(t.pnl / (t.entry_price * qty) * 100, 2)
       if t.pnl is not None and t.entry_price and t.entry_price > 0 else None,
```
`qty` is not validated; `t.legs[0]` may not have a `qty` key; `qty` may be a string (the trade creation stores `str(leg.qty)` sometimes). Defaulting to 1 silently understates P&L% by 10x for a 10-share trade.
**Fix:** Store qty explicitly on `Trade` model (it only lives in the `legs` JSONB blob right now). Validate type.

---

### [P2] F-36 — `websocket/handler.py` — `_listener_task` singleton is shared across the process but subscribes to all channels including `quotes` (the highest-volume channel)
**Where:** `backend/api/websocket/handler.py:101-152`.
**What:** Every connected client subscribes all channels once (lines 113, `ALL_CHANNELS`). High-frequency quote messages are broadcast to every client's `manager.broadcast`, which filters by the per-client subscription set. That's fine, but the per-channel filter is done *per message, per client, serially* with a 2-second timeout each — a single slow client (`self._send` waits 2 s before declaring the socket dead). During a price spike, tens of thousands of messages × hundreds of clients = O(N*M) throughput ceiling.
**Fix:** Split the listener by channel or use the asyncio broadcast pattern (`asyncio.gather` with timeouts) for fan-out; drop messages to slow clients sooner.

---

### [P2] F-37 — `/api/v1/agents/chat` accepts arbitrary-length `conversation_history` via Redis cache
**Where:** `backend/api/routes/agents.py:130-138, 152-153`.
**What:** Each chat turn appends to `history` in Redis with a 1-hour TTL. `history[-20:]` caps context but not storage — a bot that spams `/chat` with the same conversation_id grows the Redis list indefinitely until TTL refreshes. No length cap on each history entry beyond `max_length=4000` on the *input* field; assistant responses are unbounded.
**Fix:** Cap history storage at e.g. 40 turns × 8k chars. Truncate old turns when appending.

---

### [P2] F-38 — `OrderLeg.symbol` regex `^[A-Z]{1,10}$` rejects valid tickers like `BRK.B`, `BF.B`, `RDS-A`
**Where:** `backend/api/routes/trades.py:89`.
**What:** Only A-Z. But the codebase includes `BRK.B` in demo stocks (`market.py:106`) and even in the valid demo symbols set (`market.py:106`). A legitimate order for Berkshire B shares is blocked with a Pydantic validation error.
**Fix:** `^[A-Z][A-Z0-9.-]{0,9}$` or use a proper ticker validator.

---

### [P2] F-39 — `POST /api/v1/strategies/{id}/toggle` is not idempotent (toggle semantics) and provides no reason field
**Where:** `backend/api/routes/strategies.py:916-938`.
**What:** "Toggle" endpoint is a classic anti-pattern — stateful calls where the client doesn't know the post-condition. A retry flips it again.
**Fix:** Replace with `PUT /strategies/{id}/status` with explicit body `{"status": "paused"}`.

---

### [P2] F-40 — `/api/v1/risk/var` computes VaR with a "zero-correlation as conservative" comment that is actively wrong
**Where:** `backend/api/routes/risk.py:360-367`.
**What:**
```python
# Portfolio vol (simplified — assumes zero correlation as conservative estimate)
weighted_var_sq = 0.0
for sym, vol in position_vols.items():
    mv = abs(market_values.get(sym, 0))
    weighted_var_sq += (mv * vol) ** 2
portfolio_vol_dollar = math.sqrt(weighted_var_sq)
```
"Zero correlation" is the *least* conservative assumption (best diversification). Conservative is correlation = 1.0 → `sum(mv * vol)`. The comment and the math are backward: this underestimates VaR.
**Why it matters:** A risk report labeled "parametric VaR" that systematically understates risk.

**Fix:** Either implement a correlation-aware VaR or use the sum-of-absolute-VaRs form (`sum(mv * vol * 2.33)`) and label it "conservative upper bound".

---

### [P3] F-41 — Logging uses structured `logger.info` but no request_id propagation into the agent subprocess, ledger writes, etc.
**Where:** `backend/main.py:180-186`, `backend/data/ingestion/daily_pipeline.py`, `backend/data/ingestion/trade_ledger.py`.
**What:** Each HTTP request gets an `X-Request-ID`, but the ledger writes, broker calls, and Claude subprocess invocations don't carry it. Correlating an HTTP 201 with the resulting broker order and ledger entry requires grep.
**Fix:** Use contextvars to propagate request_id; include in every log line.

---

### [P3] F-42 — `symbols.py` is 116 KB / ~2800 lines (didn't fully read; largest module in the repo)
**Where:** `backend/api/routes/symbols.py`.
**What:** The size alone suggests hardcoded demo data and mixed concerns. Hardcoded `_build_demo_symbols` is used as the **sector lookup** in `strategies.py:1019-1025` and `risk.py:118-125`, meaning sector exposure analytics are driven by a static demo list, not live data.
**Fix:** Separate data (sector lookups) from code; load from `data/reference/` at startup.

---

### [P3] F-43 — `data/processing/` directory exists but is empty (only `__init__.py`)
**Where:** `backend/data/processing/`.
**What:** Scaffolding for unused code paths. Indicates aborted refactor; every empty dir is context-rot for future readers.
**Fix:** Delete.

---

### [P3] F-44 — No tests
**Where:** `backend/`, `alphadesk/`.
**What:** Verified — only `qa-*.mjs` Playwright-ish frontend tests at the repo root. Zero Python unit tests, zero integration tests, zero contract tests for broker flow. Refactoring anything here is a roll of the dice.
**Fix:** Start with a pytest suite for `TradeLedger.record_entry`/`record_exit`/`sync_with_alpaca` (the P0 surface area). Then the auth flow. Then the critical portfolio/risk math.

---

### [P3] F-45 — `/health` endpoint omits DB/Redis status in production
**Where:** `backend/main.py:190-198`.
**What:** `return {"status": "ok"}` in prod. A load balancer thinks the service is healthy even when DB and Redis are down. Observed via WebFetch: https://tradingalpha.net/health returns a long marketing blob (`"platform": "AlphaDesk", ...`) — not from this `/health` handler. There's reverse-proxy rewriting that obscures liveness checks entirely. The code's `/health` is probably only reachable via `/api/v1/health` or another route not defined here.
**Fix:** `/health` should check DB + Redis and return 503 on failure. `/livez` for the Caddy probe; `/readyz` for orchestration.

---

## What's actually good

- **Fail-closed posture in `_is_trading_halted` and `is_token_revoked`** (`trades.py:26-37`, `auth.py:62-71`) — prioritizing safety over availability on the most consequential checks.
- **Ghost-position rollback in `_execute_approved_orders`** (`daily_pipeline.py:398-417`) — when a broker submit fails, explicitly removes from `master.existing_positions` and restores cash. Rare to see this level of care for compensating logic.
- **Circuit breaker on daily P&L** (`daily_pipeline.py:660-680`) — a real guardrail that halts further pipeline runs when -2% threshold breached.
- **HttpOnly + SameSite=strict cookies** (`auth.py:57-77`) — correct for modern cookie-based auth (weakened only by F-14).
- **Refresh token rotation with replay detection** (`auth.py:126-148`) — the refresh endpoint revokes the old JTI on rotation. Better than most.
- **SIP feed over IEX** (`alpaca_stream.py:59`) — paying for real-time SIP instead of the free 15-minute-delayed IEX feed. Correct prioritization.
- **Explicit paper-only safety in pipeline** (`daily_pipeline.py:108-114`) — raises `RuntimeError` if `ALPACA_BASE_URL` doesn't contain "paper", even if F-11 shows it's bypassable.

## Overall Backend Score: 38/100

Breakdown:
- **Correctness /30 → 8.** Float money, ID collisions, `sync_with_alpaca` destroying positions, exit logic matching wrong trade, fabricated equity curve timestamps, wrong-direction "conservative" VaR assumption. The happy path mostly works; the unhappy paths silently corrupt.
- **Data Integrity /25 → 6.** No DB transactions for trades (JSON file). No Alembic migrations despite the import. Stale in-memory ledger views racing disk writes. Class-level state (`RISK_MONITOR_ENABLED`) in a multi-worker deployment. Lazy model definition race. No fsync. This is the weakest axis and drives the P0 findings.
- **API Design /20 → 11.** Good resource shape, HttpOnly cookies, decent Pydantic models, correct 201/204/401/429 usage in most places. Loses points for: toggle endpoints, silent demo fallbacks pretending to be real data, GETs that mutate state, no pagination on history endpoints, no idempotency keys for order creation, CORS `allow_credentials=True` with implicit CSRF risk.
- **Security /15 → 8.** Auth itself is decent (refresh rotation, revocation, fail-closed revocation check). Loses points for: dev fallback JWT secret, rate-limit fails open, unauthenticated risk-monitor toggle (well, authenticated but no role), no CSRF, missing admin role concept entirely. `ALPACA_BASE_URL` substring check is sloppy.
- **Code Quality /10 → 5.** Consistent style, type hints, reasonable modularity, good docstrings. Loses points for: no tests at all, empty directory scaffolding, late imports in handlers, dead demo data co-located with production logic, Alembic listed but absent, one giant 116 KB symbols file hiding static data that other modules depend on.

**Total: 38/100.** This is "ambitious prototype wearing production clothes". Recommended before any real money touches it: migrate ledger to Postgres with Alembic (F-01, F-02, F-33), remove the demo fallbacks from money-touching routes (F-12, F-13, F-42), fix `sync_with_alpaca` to never close trades without explicit authority (F-03), and close the JWT dev-fallback + rate-limit fail-open holes (F-04, F-15).
