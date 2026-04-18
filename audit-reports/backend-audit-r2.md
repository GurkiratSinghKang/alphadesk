# AlphaDesk Backend Audit — Round 2

Auditor scope: FastAPI/SQLAlchemy backend at `backend/`. Runs in Docker on Hetzner 2vCPU/2GB VPS; traffic goes through Caddy. JWT-auth, Alpaca paper trading, multi-strategy pipeline.

Severity legend:
- **P0**: production-breaking / data-corrupting / security critical — fix now.
- **P1**: correctness or security bug that is likely to bite; not yet catastrophic.
- **P2**: code smell, maintainability, minor/latent bug.

---

## Route correctness

### [P0] Blocking sync HTTP call inside async event loop (options.py)
**File:** backend/api/routes/options.py:127
**Issue:** `_demo_spot()` is called from `async def` handlers (chain/iv/greeks at lines 645/672/731). It executes `httpx.get(...)` — the **synchronous** client — with a 5 s timeout. On a 2 vCPU VPS every such call blocks the event loop for up to 5 s, freezing every other request (quotes, portfolio, auth, WebSocket heartbeats).
**Impact:** A single slow Alpaca response tanks site-wide latency. At steady state the handler is also uncacheable across routes. Users report "site freezes randomly". Combined with the existing `_real_spot_cache` of 60 s that key is read/written without locking — benign under GIL, but the blocking call is the headliner.
**Fix:** Use `httpx.AsyncClient` (already imported) and `await client.get(...)`. Move the whole `_demo_spot` to `async def _demo_spot(symbol)` and `await` it from the routes. Same patch pattern used in `portfolio.py`.

### [P0] Unauthenticated alert mutations via `check_alerts_for_symbol`
**File:** backend/api/routes/trades.py:775 (function); backend/data/ingestion/alpaca_stream.py callers
**Issue:** `check_alerts_for_symbol` reads & writes the `price_alerts` Redis hash and calls `_save_alert` on trigger, but the `GET/POST/DELETE /alerts` endpoints themselves gate on `require_auth` only; the Alpaca stream fires `check_alerts_for_symbol` with no user context and has no per-user scoping. The single-user terminal hides it today, but the alert model has no owner field — if you ever add a second user, every user can trigger/clear/see every other's alerts.
**Impact:** Alert leakage across users; alerts can be silently force-marked triggered by any process that publishes to the Redis quote bus (which is not itself ACL-gated).
**Fix:** Add `user_id` to alert record; key Redis hash by user (`price_alerts:{user}`); scope all CRUD accordingly. Short term, document as single-tenant.

### [P1] `GET /api/v1/trades/history` swallows and eats strategy filter mismatches
**File:** backend/api/routes/trades.py:461-466
**Issue:** Hyphenated strategy IDs get mapped via `_ID_TO_LEDGER_NAME`, but any value not in the dict falls through to `strategy=strategy` — which silently returns an empty list when it doesn't match the underscore-form ledger column. No 400 or warn.
**Impact:** Frontend filter for a valid strategy returns empty without indication it was a typo. Masked bug; quiet data loss in UI.
**Fix:** When `strategy` is provided and not in the map, try both forms, else return 400 `unknown strategy`.

### [P1] `TradeHistoryEntry.side` defaults to `"buy"` — wrong for half the ledger
**File:** backend/api/routes/trades.py:494
**Issue:** Ledger rows don't store a `side` field (entry vs exit tracked via `status`). The history endpoint defaults `side` to `"buy"` for every row, including exits. Frontend trade-history filters and P&L attribution that key on side will always see long-only.
**Impact:** Short positions + sells appear as buys. Misreads ledger data.
**Fix:** Derive side from signal stored in trade (ledger has no side field today); add a `side` column via migration, or infer from strategy (long-only strategies vs pairs/shorts).

### [P1] `list_orders` returns `[]` on every broker error (200 OK)
**File:** backend/api/routes/trades.py:354-358
**Issue:** `list_orders` catches generic exceptions and returns `[]` with HTTP 200. A broker outage is indistinguishable from "no orders".
**Impact:** Users see "no orders" during outages; automation that polls `GET /orders` can't tell.
**Fix:** On non-`HTTPException` catch, return 503 with `{"detail": "broker unavailable", "retry": true}`. Same pattern for `list_positions` (line 425-429).

### [P1] `GET /orders` `status` enum accepts per-order states that Alpaca rejects
**File:** backend/api/routes/trades.py:83-94
**Issue:** `OrderStatus` enum mixes Alpaca-compatible filter values (`open/closed/all`) with per-order states (`pending/submitted/filled/cancelled/rejected`). Route passes the raw value through to Alpaca: `params["status"] = status.value`. Calling `GET /orders?status=filled` sends `status=filled` to Alpaca which *does* accept it (undocumented) but `?status=pending` hits a 400.
**Impact:** 400 leaks through as 502, confuses frontend.
**Fix:** Add a `_FILTER_STATUSES = {OPEN, CLOSED, ALL}` set; map intermediate states to `closed` before dispatching to Alpaca.

### [P1] No UUID/format validation on path params
**File:** backend/api/routes/trades.py:362 (`cancel_order`), backend/api/routes/strategies.py:1154, 1278, 1404, 1582
**Issue:** Path params are `str` — the route accepts anything, forwards to Alpaca, and trusts the response. `cancel_order("../etc/passwd")` or `cancel_order("abc")` both reach Alpaca.
**Impact:** Resource enumeration / probing; error messages may leak info. Low risk in practice (Alpaca won't misinterpret) but bad input hygiene.
**Fix:** Add `Path(..., regex=r"^[A-Za-z0-9-]{8,64}$")` on `order_id`; add explicit allowlist check on `strategy_id` before DB/ledger calls.

### [P1] `GET /alerts` not paginated
**File:** backend/api/routes/trades.py:733
**Issue:** `_get_all_alerts()` loads *every* alert from the Redis hash and returns them all. No `limit`/`offset`/`cursor`.
**Impact:** If alerts accumulate over months, this becomes an O(N) response on every call (and O(N) JSON parse per alert on trigger check).
**Fix:** Auto-prune triggered alerts older than 7 days; paginate response.

### [P1] `pipeline/history` route-name collision risk
**File:** backend/api/routes/pipeline.py:72 vs 214
**Issue:** `GET /history` and `GET /history/{date}` coexist; FastAPI routes `/history/something` to the `{date}` variant. The date regex check then 400s — fine — but the `pipeline_history` returns `list` while `pipeline_history_date` returns `dict`. Both named `pipeline_history*` and registered under the same router is confusing, and any frontend that hits `/history/` (trailing slash) depends on FastAPI's redirect behaviour.
**Impact:** Very minor; works today.
**Fix:** Rename `pipeline_history_date` -> `get_pipeline_run`.

### [P1] `POST /pipeline/run` has no rate limit or auth role check
**File:** backend/api/routes/pipeline.py:22
**Issue:** Auth dep passes any authenticated user. `run_daily_pipeline()` is very expensive (dozens of Alpaca+Polygon calls, Claude CLI spawns via `request_trade_smart`). Endpoint is user-triggerable without cost control. The source comment at `auth.py:25-27` acknowledges this TODO remains open.
**Impact:** A malicious or panicked user can trigger 12 strategies' worth of work by holding down a button — blows through Polygon quota (10k/min limit on paid tier, much lower on free).
**Fix:** Same Redis-pipeline per-IP rate limit used for login; stricter here (1 per 5 min). Also reuse the existing `_pipeline_lock` to return 409 if already running rather than the current `{"error": ...}` dict.

### [P1] `POST /pipeline/run` returns 200 with `{"error": "Pipeline already running"}`
**File:** backend/data/ingestion/daily_pipeline.py:604
**Issue:** Returns a dict with `error` key but HTTP 200. Client code can't distinguish.
**Impact:** Frontend displays success when pipeline is locked.
**Fix:** Raise `HTTPException(status_code=409, detail="Pipeline already running")`.

---

## Auth & session

### [P0] JWT signing uses a **shared singleton** with no key rotation
**File:** backend/core/config.py:75-111, backend/core/auth.py:43-71
**Issue:** `JWT_SECRET` is loaded once into `settings` at process start. Revocation relies on Redis; if Redis is unreachable the code `fail[s] open` (comment at auth.py:77, implemented at auth.py:112-130). This is deliberate, but combined with 8-hour access tokens and 30-day refresh tokens, a single JWT leak cannot be revoked during a Redis outage.
**Impact:** Single-user deployment survives; as soon as the admin token is exposed (accidentally paste to Sentry, leak in browser extension) the key is valid until natural expiry.
**Fix:** Two-secret JWT scheme (active + next); rotate weekly via env. Short-circuit `require_auth` to 503 on Redis outage *only for sensitive routes* (orders, halt, risk-monitor toggle).

### [P0] `logout` deletes access cookie but refresh cookie path is `/api/v1/auth`
**File:** backend/api/routes/auth.py:90-110, 184-197
**Issue:** `_set_token_cookies` sets the refresh-token cookie with `path="/api/v1/auth"`, but `logout` calls `response.delete_cookie("refresh_token", path="/api/v1/auth", ...)` — which does match. However, the `refresh` endpoint takes the refresh token from the **JSON body** (`RefreshRequest.refresh_token`), not the cookie. The cookie is never read. So: issuing logout *revokes the access* token (via blocklist), but the client's JS-held refresh token is still valid — `POST /refresh` will mint a new access token and the user is back in. `logout` only looks invalidates the *current access token* jti, never the refresh jti.
**Impact:** Logout is not logout. User ends session but attacker with refresh token can resume indefinitely until refresh TTL. Also means "log out everywhere" is impossible.
**Fix:** In `logout`, read `refresh_token` from cookie (fall back to body), decode it, and `await revoke_token(...)` on its jti. Also revoke `access_token`'s jti (already done).

### [P1] Rate limit key uses first `x-forwarded-for` IP — spoofable
**File:** backend/api/routes/auth.py:131
**Issue:** `client_ip = req.headers.get("x-forwarded-for", "").split(",")[0].strip() or (req.client.host ...)`. Since the CORS/trusted-host middleware allows `ProxyHeadersMiddleware(trusted_hosts=["*"])` (main.py:148), any client can set `X-Forwarded-For: 1.2.3.4` and bypass the 5-per-5-min login limit by rotating the header.
**Impact:** Credential stuffing works if attacker knows Caddy is upstream and uses a raw socket or circumvents Caddy. On Hetzner with public port 80/443 through Caddy only, this *should* be fine, but `trusted_hosts=["*"]` is a code smell.
**Fix:** Set `trusted_hosts=["127.0.0.1"]` (or Caddy's IP) on ProxyHeadersMiddleware. Use `req.client.host` exclusively once Caddy strips headers.

### [P1] bcrypt cost defaults to library-default 12
**File:** backend/core/auth.py:39-40
**Issue:** `bcrypt.gensalt()` without explicit `rounds=` produces the library default (12). Fine for today, but no review/upgrade knob surfaced in settings.
**Impact:** Latent; single-admin account means total cost is tiny.
**Fix:** Optional. `bcrypt.gensalt(rounds=settings.BCRYPT_ROUNDS)` with 12 default.

### [P1] `refresh` endpoint: old refresh token is revoked *after* new tokens are minted
**File:** backend/api/routes/auth.py:159-181
**Issue:** The sequence is: decode → check revoked → create new access/refresh tokens → `await revoke_token(request.refresh_token)`. If `revoke_token` fails (Redis blip), the old token remains valid. Minor but reachable in a race if the outage happens in the ~ms window.
**Impact:** Short window for replay.
**Fix:** Reorder: decode → revoke (under try) → if revoke fails, abort with 503. Else mint new tokens.

### [P2] Admin password hash stored in env; no rotation workflow
**File:** backend/core/config.py:77-78
**Issue:** `ADMIN_PASSWORD_HASH: str = ""` empty default — if unset, `login` rejects every attempt ("Invalid username or password"). No documented way to rotate aside from editing `.env` and restarting.
**Impact:** Rotation is a deploy. Acceptable for single-user, noted.
**Fix:** Add a one-shot `/admin/rotate-password` endpoint gated on old password.

---

## Strategy execution & ingestion

### [P0] `strategy_runner.get_screener_results` runs an event loop inside a thread pool
**File:** backend/data/ingestion/strategy_runner.py:125-136
**Issue:** When called inside a running event loop (which is *always* the case from the daily pipeline), the code does `ThreadPoolExecutor(max_workers=1).submit(asyncio.run, _collect()).result()`. This blocks the outer event loop on the thread pool future, and spins up a brand new event loop inside the thread — bypassing the primary loop's pool of already-open httpx connections. Every call = new connection pool.
**Impact:** Severe connection churn on every pipeline tick; also creates a window where the outer loop is blocked. In dev/test this silently "works" because blocking the outer loop is not observed; in prod it causes Alpaca stream reconnects (alpaca_stream.py timeouts trigger) during pipeline runs.
**Fix:** Make `get_screener_results` async; callers (`daily_pipeline.py:722`) already run in an async context. Remove the sync bridge entirely.

### [P0] `TradeLedger._next_id()` fallback uses non-atomic `MAX(id)+1`
**File:** backend/data/ingestion/trade_ledger.py:341-361
**Issue:** When the sequence call fails (transient DB error, sequence missing), fallback executes `SELECT COALESCE(MAX(id), 0) + 1 FROM trade_ledger` outside a transaction. Two concurrent writers hit the same id, the `INSERT` with `PRIMARY KEY (id)` fails for one with `UniqueViolation`, and `record_entry` catches the exception, logs warning, and **falls back to `self._memory.append(trade)`** — a lost trade that only lives in that worker's memory.
**Impact:** Trade records silently drop; ledger grows divergent across gunicorn workers.
**Fix:** Remove the `MAX(id)+1` branch. If sequence fails, raise so the caller sees it. Better: let the DB autogenerate via `SERIAL`/`IDENTITY` (currently `id INTEGER PRIMARY KEY` without default).

### [P0] `TradeLedger._memory` fallback is per-instance, mixed with DB path
**File:** backend/data/ingestion/trade_ledger.py:309-339
**Issue:** Each call site does `ledger = TradeLedger()` (see `trades.py:460, 520, 751; strategies.py:971, 1082, 1190, 1369, 1414, 1612; portfolio.py:479, 751; risk.py:169, 436, 551; pipeline.py:238` — dozens of sites). If DB is up, fine. If DB is down on construction for *some* callers but up for others, some instances use the in-memory list (empty) and some use the DB — views diverge.
Additionally, every construction does `_ensure_schema()` + `_run_migration()` at least once per process (global `_migration_done` flag guards it after), but the DDL uses `CREATE INDEX IF NOT EXISTS ...` on a TimescaleDB `trade_ledger` table — runs a round trip on *every* construction until the migration sets `_migration_done = True`, then only the `_ensure_schema` half still runs (it's wrapped in a `with engine.begin()` and does 5 statements per instantiation).
**Impact:** Data divergence + latency. On the 2 GB VPS, the DDL round trips add up.
**Fix:** Make `TradeLedger` a process-wide singleton (lazy). Cache schema check on module level. Never fall back to `_memory` silently — either the instance has a DB or it raises.

### [P1] `TradeLedger.get_closed_trades(start_date, end_date)` uses lexicographic string comparison on ISO timestamps
**File:** backend/data/ingestion/trade_ledger.py:676-686
**Issue:** Comparison is `t["exit_time"] >= start_date`. The ledger stores `entry_time` as full ISO (with T and offset) but `start_date` is passed as `"YYYY-MM-DD"` in some callers and `"YYYY-MM-DDTHH:MM:SS"` in others (`portfolio.py:482` passes `iso()`; `portfolio.py:756` passes `"YYYY-MM-DD"`, `portfolio.py:757` passes `"YYYY-MM-DD...T23:59:59"`). String comparison happens to work for ISO 8601 but breaks if any timestamp has a timezone suffix (`Z` vs `+00:00`) — `2025-01-01T00:00:00Z` < `2025-01-01T00:00:00+00:00`.
**Impact:** Subtle, off-by-timezone bugs at date boundaries.
**Fix:** Parse both sides with `datetime.fromisoformat` and compare tz-aware. Reject strings that can't parse rather than silently matching none.

### [P1] `sync_with_alpaca` re-opens/auto-creates positions for symbols Alpaca returns after manual close
**File:** backend/data/ingestion/trade_ledger.py:831-858
**Issue:** If Alpaca returns a symbol with `qty > 0` and it's NOT in the ledger, a ledger row is auto-created with `entry_price = avg_entry_price, conviction=0, rationale="Auto-created..."`. But `_match_strategy_for_symbol` looks only at the last 50 trades (`_list_all()[-50:]`). Under the competition strategy model, a symbol closed months ago and re-bought as a manual trade gets misattributed to the previous strategy.
**Impact:** Strategy leaderboard/P&L gets scrambled after enough time.
**Fix:** When no match within a reasonable time window (say 7 days), default to `"manual"` instead of taking the most-recent-ever.

### [P1] `_momentum_gate_exempt` silently fails open on registry lookup error
**File:** backend/data/ingestion/master_agent.py:364-374
**Issue:** If `get_meta` raises *anything* (not just KeyError), the function returns `False` (not exempt → gate applies). Good default. But silent: no log. If the registry genuinely fails to load, every pairs/options/intraday trade is rejected by the momentum gate with zero visibility.
**Impact:** Multi-hour debug of "why doesn't pairs trading produce any signals?"
**Fix:** Log a warning once per strategy name when meta lookup fails.

### [P1] Competition equal-alloc hardcoded for 15 strategies; actual registry has 12
**File:** backend/data/ingestion/master_agent.py:53-74
**Issue:** `STRATEGY_LIMITS` has 15 entries at 0.0667 summing to 1.0005. Strategies not in the dict fall through to `0.10` default in `request_trade` (line 481). The registry builds `ALL_STRATEGIES` dynamically (`strategy_runner.py:47`) from the 12 registered packages. `claude_alpha`, `mean_reversion`, `vcp_breakout` are in the limits dict but not in the registry — they never run but reserve notional. Conversely, anything added to the registry without also editing `STRATEGY_LIMITS` gets 10 %, blowing the portfolio deployment limit.
**Impact:** Budget math assumes 15 strategies; real capital goes to 12 active. The 3 "ghost" strategies reserve 20 % of the conceptual pool but don't actually use any of it.
**Fix:** Build `STRATEGY_LIMITS` dynamically from registered strategies at startup. Drop hardcoded dict.

### [P1] Missing OOS metric file returns `None` for all metrics — strategy appears broken
**File:** backend/api/routes/strategies.py:610-645
**Issue:** `_load_oos_for` returns `{"sharpe": None, ...}` when the JSON file doesn't exist. The route's `StrategyPerformance` response allows `None`. Frontend then renders "N/A" for Sharpe/DD on e.g. `dual-momentum`, `kama-breakout` which *never* shipped OOS JSONs. User reads this as "broken" not "no backtest yet".
**Impact:** UX/trust hit.
**Fix:** Add a distinguishing field like `oos_available: bool`; frontend can show "backtest pending" vs "N/A".

### [P1] `LiveStrategyAdapter.analyze` looks up price from Alpaca on missing candidate, one symbol at a time
**File:** backend/data/ingestion/strategy_adapter.py:363-376
**Issue:** Falls back to `_latest_daily_prices(ctx.bar_provider, [sig.symbol], asof)` per-signal. On strategies that emit many signals for symbols not in the original universe, that's N serial HTTP calls.
**Impact:** N+1-style blowup; pipeline latency.
**Fix:** Batch: collect all symbols needing lookup; one Alpaca bars call.

### [P2] `request_trade` adds the symbol to `existing_positions` *before* the broker confirms the order
**File:** backend/data/ingestion/master_agent.py:632-637
**Issue:** This is intentional (so the next strategy in the loop can't double-buy) but creates the "ghost position" problem the pipeline works around with manual rollback (daily_pipeline.py:398-417). The rollback only runs on exceptions; on partial fills, the master thinks it owns the position at full notional while Alpaca only filled some.
**Impact:** Portfolio accounting drifts on partial fills.
**Fix:** Reconcile with Alpaca `filled_qty` post-order and patch `master.existing_positions[sym]`. The `_sync_ledger_with_alpaca` loop reconciles the ledger but not the master agent's in-memory state (which is discarded per-pipeline-run anyway — so minor, but confusing for manual orders).

---

## Database

### [P1] `get_db` commits session on every successful request
**File:** backend/core/database.py:77-86
**Issue:** Dependency commits on `yield` success. Any reader route that happens to call `db.add(...)` as a side effect (none today, but there's no type-checker enforcement) gets committed. More importantly, using autocommit-on-exit conflicts with routes that want to commit explicitly (e.g. `trades.py:263` commits inside the route, then `get_db` tries to commit again — no-op but confusing).
**Impact:** Works today; fragile going forward.
**Fix:** Use read-only pattern by default; require routes to opt into `session.commit()` themselves.

### [P1] `SKIP_DB_INIT` silently makes many routes return `[]`
**File:** backend/api/routes/portfolio.py:866-868, trades.py:511-512
**Issue:** `settings.SKIP_DB_INIT=True` returns empty trade history / journal without any indicator. Anyone debugging a "why is my journal empty" sees nothing.
**Impact:** Debug time.
**Fix:** Log a warning once at startup; add `X-DB-Skipped: true` response header.

### [P1] Missing composite index on `(symbol, entry_time)` for `Trade`
**File:** backend/data/storage/models.py:88-107
**Issue:** Only single-column indexes on `symbol`, `strategy`, `status`, and a composite on `(strategy, status)`. Trade history queries filter on `symbol` AND order by `entry_time` — two index scans or a sort. Low cardinality in dev, but ledger grows.
**Impact:** Slow history pages after enough rows.
**Fix:** `Index("ix_trades_symbol_entry_time", "symbol", "entry_time")`.

### [P1] `TradeLedger.list(filter)` interpolates column names into SQL (line 640)
**File:** backend/data/ingestion/trade_ledger.py:640
**Issue:** `where = " AND ".join(f"{k} = :{k}" for k in filter)` uses dict keys as column identifiers — then parameterised for values. If any caller passes `{"1=1 OR symbol": "x"}`, the column is unquoted. No callers do today (all are internal), but it's a latent injection if a route ever passes user input as a filter dict.
**Impact:** Latent SQL injection.
**Fix:** Allowlist columns: `if k not in ALLOWED_COLUMNS: continue`.

### [P2] `TradeLedger` uses raw `text()` SQL everywhere; bypasses the ORM's `Trade` model
**File:** backend/data/ingestion/trade_ledger.py all
**Issue:** There are two parallel Trade systems: `trade_ledger` (raw SQL on `trade_ledger` table) and `data.storage.models.Trade` (ORM on `trades` table). Some routes read both. Over time they will drift.
**Impact:** Code duplication; two sources of truth.
**Fix:** Long-term, unify. Short-term, document the split.

---

## Config & secrets

### [P1] `ENVIRONMENT` defaults to `DEV`
**File:** backend/core/config.py:32
**Issue:** Default value is `Environment.DEV`. `is_production` checks `== PROD`, so `/docs` is enabled by default (main.py:129-130), cookies are not secure by default (auth.py:98 `secure=is_prod`), health endpoint returns verbose data. A production deploy that forgets `ENVIRONMENT=prod` silently runs in dev mode.
**Impact:** Insecure prod deployment waiting to happen.
**Fix:** Make `ENVIRONMENT` a required setting with no default. Hard-fail startup if missing.

### [P1] `PRODUCTION_ORIGIN` empty default — CORS allows localhost only
**File:** backend/core/config.py:82-83, main.py:133-146
**Issue:** When `PRODUCTION_ORIGIN` is empty and `ENVIRONMENT != prod`, CORS allows `http://localhost:3000` and `http://127.0.0.1:3000` *and* `allow_credentials=True`. If `is_production` isn't set, cookies aren't secure, and CSRF is feasible from `http://localhost:3000` loaded by any side project running on the dev's machine.
**Impact:** CSRF vector in dev environments; prod OK assuming `ENVIRONMENT=prod`.
**Fix:** Only enable credentialed CORS when all three are set (origin, prod env, secret).

### [P1] `ProxyHeadersMiddleware(trusted_hosts=["*"])`
**File:** backend/main.py:148
**Issue:** Trust every client for `X-Forwarded-For`. Makes IP-based rate limiting spoofable (see auth section).
**Impact:** Rate limit bypass.
**Fix:** Narrow to Docker bridge / Caddy upstream IP.

### [P1] `SAFETY: ALPACA_BASE_URL must contain 'paper'` — raises at runtime
**File:** backend/data/ingestion/daily_pipeline.py:108-114
**Issue:** The guard is a runtime `RuntimeError` inside `_base_url()` called on every order. A misconfiguration means the very first pipeline tick errors out with a traceback in logs but the pipeline scheduler continues; every subsequent run repeats the error.
**Impact:** Noisy logs; silent degradation.
**Fix:** Check at startup in `lifespan()` and refuse to boot if prod credentials point at live URL without an explicit `ALLOW_LIVE=true`.

### [P2] `JWT_SECRET` hard-fails on access — but in `jwt_secret_value` property
**File:** backend/core/config.py:95-111
**Issue:** The property raises `ValueError` on first access, not at startup. So the process starts, binds ports, logs "Starting AlphaDesk", then 500s on the first authenticated request. Slightly better to fail at startup.
**Impact:** Bad UX for debugging.
**Fix:** Call `settings.jwt_secret_value` once in `lifespan` startup to validate.

---

## Logging & stdout hygiene

### [P1] `data/calendar.py`, `data/providers/alpaca.py`, `data/providers/polygon.py`, `data/providers/fmp.py`, `data/providers/cache.py` contain `print(...)` under `__main__`
**File:** backend/data/calendar.py:109-121; backend/data/providers/alpaca.py:283-285; backend/data/providers/polygon.py:34-53; backend/data/providers/fmp.py:26-43; backend/data/providers/cache.py:239
**Issue:** All inside `if __name__ == "__main__":` so not wired to the running service. Benign but suggests these were dev scripts not cleaned up. Smoke-backtest scripts under `strategies/*/tests/` also print freely.
**Impact:** None at runtime; code-review smell.
**Fix:** Replace with `logging.debug` or move to CLI tools.

### [P2] `backend/tuner/runner.py` and `backtest/cli.py` print to stdout
**File:** backend/tuner/runner.py:286-295, backend/backtest/cli.py:126,166,185
**Issue:** CLI modules — expected.
**Impact:** None.

### [P2] No sensitive-data logging detected — passwords/tokens are never logged. JWT jti is not sensitive.

---

## Concurrency

### [P1] `strategy_runner.ALL_STRATEGIES` built at module import — `build_all_strategies()` calls `load_all()` which imports every strategy package
**File:** backend/data/ingestion/strategy_runner.py:47
**Issue:** Strategy imports at service start. A broken strategy package that raises on import fails silently (logged inside registry's `load_all`), but can deregister other strategies if there's name collision at re-registration. Multi-worker uvicorn re-runs this N times.
**Impact:** Slow cold-start; brittle to strategy breakage.
**Fix:** Lazy-load strategies at first use; add health check endpoint that reports loaded strategy count.

### [P1] `MasterAgent.MOMENTUM_DATA` is a class attribute mutated by `set_momentum_data` (classmethod)
**File:** backend/data/ingestion/master_agent.py:38-51
**Issue:** Class-level mutable state shared across all MasterAgent instances in the process. Daily pipeline sets it once per run; anything else that instantiates `MasterAgent` (e.g. `risk.py:563` `get_factor_crowding`) sees stale or empty momentum data.
**Impact:** Crowding route sees stale momentum gates; risk checks inconsistent with pipeline.
**Fix:** Move to instance attribute; pass in via constructor.

### [P1] `alpaca_stream.py` background task can be canceled but holds the WebSocket reference; no reconnect backoff
**File:** backend/data/ingestion/alpaca_stream.py:326
**Issue:** `_stream_task = asyncio.create_task(_run_stream())` — if `_run_stream` exits cleanly on network error, nothing restarts it. The lifespan guard only catches the task creation failure, not runtime exit.
**Impact:** Alpaca quotes silently stop flowing after a network blip until process restart.
**Fix:** Wrap `_run_stream` in a supervisor loop with exponential backoff and max-retry-then-alert.

---

## External providers

### [P1] Alpaca bar fetcher: `feed="sip"` hardcoded with IEX fallback, retries all status codes
**File:** backend/data/providers/alpaca.py:164-229
**Issue:** Retry logic is good (429 + 5xx + 403 fallback), but the fallback swaps `params["feed"] = "iex"` and continues the *same* retry loop — if the 403 repeats for a different reason, attempts burn. More importantly, the `iex` fallback mutates `params` mid-loop so next retry still sends `iex`, hiding whether the original call was SIP-entitled — no diagnostic.
**Impact:** Hard to tell if SIP is working. Minor.
**Fix:** Log explicitly on the IEX fallback once per process; re-check SIP entitlement periodically (not on every call).

### [P1] `newsdata.io` rate-limit cooldown uses a module-level float
**File:** backend/api/routes/news.py:94-135
**Issue:** `_rate_limited_until` is module-global, not per-worker-safe in a multi-worker uvicorn setup. Each worker has its own cooldown; under Gunicorn+N, you'll hit the limit N times as fast.
**Impact:** 429 multiplied by worker count.
**Fix:** Move to Redis key `news:rate_limited_until`.

### [P1] `_get_current_price` for risk check falls through to 0, which propagates as 400 "cannot determine price"
**File:** backend/api/routes/trades.py:580-610
**Issue:** Cached quote is used if present (stale up to TTL) — fine. On cache miss it hits Alpaca trades/latest. Returns 0 on any error (including "symbol doesn't exist"). Risk check then throws 400.
**Impact:** User submitting a limit order for a valid symbol on a bad network second gets a confusing "Cannot determine price" — but they provided the limit price themselves! The risk check computes `total_notional = leg.limit_price * leg.qty` when limit is set, so this path is only hit for market orders. Still unclear wording.
**Fix:** Say "market price unavailable, use a limit order".

---

## Structural

### [P2] Per-worker in-memory state: `_INMEM_ATTEMPTS`, `_REVOCATION_CACHE`, `_real_spot_cache`, `_pending_setups` (realtime_scanner), `_pairs_setups`, `_pipeline_status`, `MOMENTUM_DATA`
**Files:** backend/api/routes/auth.py:35, backend/core/auth.py:15, backend/api/routes/options.py:100, backend/data/ingestion/realtime_scanner.py, backend/data/ingestion/master_agent.py:38
**Issue:** All are per-process, leading to divergent behaviour when Gunicorn spawns >1 worker. Comments explicitly acknowledge this in places but the implementation doesn't centralise on Redis.
**Impact:** With multi-worker deployment, rate limits / momentum data / setups are per-worker.
**Fix:** Move to Redis-backed structures where durability matters; document the divergence where it doesn't.

### [P2] `portfolio.py` is 1193 lines, `strategies.py` is 1660 lines, `symbols.py` is 1919 lines
**Issue:** Route file grew organically; each now mixes demo-data generators with real business logic.
**Fix:** Split demo helpers into `*/_demo.py` modules.

### [P2] Duplicate `_alpaca_keys_empty` helpers in portfolio.py, trades.py, market.py
**Issue:** Same function body copy-pasted 4+ times.
**Fix:** Move to `core/providers.py` or similar.

---

## Summary: top P0/P1 issues by impact

1. **Logout doesn't invalidate refresh token** (auth.py:184) — session continues via refresh.
2. **`options.py` blocking httpx.get in async context** (options.py:127) — event loop freeze.
3. **`strategy_runner.get_screener_results` runs event loop inside thread pool** (strategy_runner.py:125) — connection churn and main-loop block.
4. **`TradeLedger._next_id` non-atomic fallback → silent trade drop** (trade_ledger.py:341).
5. **`TradeLedger._memory` per-instance fallback → diverging data per call site** (trade_ledger.py:309).
6. **`ENVIRONMENT` defaults to DEV → insecure prod if misconfigured** (config.py:32).
7. **`MasterAgent.MOMENTUM_DATA` is class-level mutable state** (master_agent.py:38).
8. **`STRATEGY_LIMITS` hardcoded 15 entries but registry has 12** (master_agent.py:53).
9. **JWT refresh: old token revoked after new one minted** (auth.py:159).
10. **`list_orders`/`list_positions` return `[]` on broker failure** (trades.py:354/425).
11. **`alpaca_stream` has no reconnect-on-exit supervision** (alpaca_stream.py:326).
12. **`_momentum_gate_exempt` fails open silently** (master_agent.py:364).
13. **`ProxyHeadersMiddleware(trusted_hosts=["*"])` + x-forwarded-for trust** (main.py:148, auth.py:131).
14. **`sync_with_alpaca` re-creates positions with possibly-wrong strategy** (trade_ledger.py:831).
15. **`TradeLedger.list()` interpolates column names** (trade_ledger.py:640) — latent SQLi if a route ever passes user input.
