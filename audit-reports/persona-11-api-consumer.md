# Persona 11 — API Consumer / External Integrator

**Date:** 2026-04-19
**Persona:** Dev building a Discord bot / Python tax script / REST client against AlphaDesk
**Base URL:** `https://tradingalpha.net/api/v1`

---

## TL;DR — Would I integrate against this?

**No, not without a wrapper.** The endpoints work and the auth is fine, but the API is inconsistent in shape, casing, pagination, and timestamps across neighbouring endpoints. There is no OpenAPI spec in prod, no outbound webhooks, no documented rate limits, no idempotency keys, and money is returned as `float`. I would build the integration but I'd hate it every time a new endpoint surprises me.

## Top 10 items, 400 words

**1. No machine-readable API contract in production.** `docs_url` and `redoc_url` are gated on `settings.is_production` in `backend/main.py:128-135`. In prod `/openapi.json`, `/docs`, `/redoc` all 404. There is no public API reference, no client-generation path (openapi-generator, Orval, etc.), no versioning story beyond the `/api/v1` prefix. As an external dev I'm spelunking `backend/api/routes/*.py` to find paths.

**2. Field casing is inconsistent — sometimes inside the same domain.** `Quote.changePct` is camelCase (`market.py:30`) but `IndexData.change_pct`, `SectorData.change_pct` are snake_case (`market_overview.py:24,36`). Any cross-endpoint P&L dashboard needs per-endpoint mapping. Pick one and enforce it.

**3. List responses have four different shapes.** `GET /strategies/` → bare `[...]`. `GET /market-overview/indices` → `{indices:[...]}`. `GET /symbols/search` → `{count, results}`. `GET /news/latest` → `{articles:[...]}`. `GET /trades/orders` → bare `[...]`. No `total`/`limit`/`offset`, no `X-Total-Count`, no Link header. Unbounded bare arrays on growing resources (`/trades/orders`, `/trades/history`) are a DoS/UX timebomb.

**4. Timestamps are three formats.** `...Z` (most endpoints), `+00:00` (`/pipeline/summary.last_run`), `-04:00` wall-clock Eastern (`/pipeline/scheduler_state.next_scheduled_run`), AND a naive space-separated `"2026-04-19 02:40:09"` on `/news/latest.published_at`. Parsing correctly across all of them needs care.

**5. Money is `float`, not string/Decimal.** Every `pnl`/`equity`/`price` model (`portfolio.py`, `trades.py`, `strategies.py`) types money as `float`. `unrealized_pnl_pct:2.641136285327327` leaks IEEE-754 noise. Tax-accurate clients need `Decimal`; they'll get rounding surprises.

**6. Order placement has no true idempotency.** `Idempotency-Key` header is silently ignored. `trades.py:843` dedupes on a payload hash for 30s and returns `409` — so a legitimate client retrying a timed-out `POST /orders` either double-places (after 30s) or gets 409 with no way to retrieve the original order id.

**7. No outbound webhooks.** `webhooks.py` only handles INBOUND TradingView alerts. There is no event subscription for fills, pipeline completion, risk breaches, strategy toggles. Bots must poll `/pipeline/status`, `/trades/positions`, `/portfolio/summary`.

**8. Rate limits are unpublished and sparse.** Only `/auth/login` (5/5min, Retry-After ✓) and `/pipeline/run` (1/min, Retry-After ✓) are rate-limited. `/market/quotes/AAPL` × 20 in a burst — all 200. No `X-RateLimit-Limit`, no `X-RateLimit-Remaining`. Consumers can't self-regulate.

**9. WebSocket exists but is undocumented.** `/ws` supports `auth` → `subscribe(channel)` for `quotes|portfolio|alerts|agents|signals` but channel names, message envelope (`{channel, data}`), close codes (4001, 1008) are only discoverable by reading `api/websocket/handler.py`.

**10. No OpenAPI metadata on 69 route decorators.** `grep summary=|description=` on route decorators: **0/69**. Docstrings exist but don't surface in an OpenAPI spec (which doesn't exist anyway). Even re-exposing `/docs` behind an admin flag wouldn't give nice docs.

---

## Detailed findings

### 1. Discoverability

| Endpoint | Status | Notes |
|---|---|---|
| `/docs` | HTTP 200 but serves the Next.js SPA (61KB HTML) | Gated by `docs_url="/docs" if not settings.is_production else None` in `backend/main.py:133` |
| `/openapi.json` | 404 JSON | Same gate |
| `/redoc` | 404 JSON | Same gate |
| `/api/v1/openapi.json` | 404 JSON | Doesn't exist |

There is no public API reference page. The only way to find endpoints is reading `backend/api/routes/*.py`. A build-time job to dump `openapi.json` to an `/api-reference` static page would solve this without re-enabling `/docs` in prod. See `backend/main.py:128-135`.

### 2. Authentication

**Login works and is well-shaped** (`auth.py:299-348`):
```
POST /api/v1/auth/login  body: {username, password}
→ 200 {access_token, refresh_token, token_type:"bearer", expires_in:28800}
+ Set-Cookie: access_token (HttpOnly, Max-Age=28800, Path=/)
+ Set-Cookie: refresh_token (HttpOnly, Max-Age=2592000, Path=/api/v1/auth)
```
Access TTL = 8h (`ACCESS_TOKEN_EXPIRE_MINUTES`), refresh TTL = 30d. Tokens are JWT (HS256) with `sub`, `exp`, `type`, `jti`.

**Refresh works and rotates** (`auth.py:351`):
```
POST /api/v1/auth/refresh  body: {refresh_token}
→ 200 {access_token, refresh_token, expires_in}
```
Old refresh is revoked before the new pair is minted (good). 401 `{"detail":"Invalid token"}` on junk.

**No API-key or client-credentials flow.** Bots that shouldn't hold user passwords have nowhere to go. Typical broker-style integrations expect `X-API-Key` + `X-API-Secret` headers or OAuth2 client_credentials. Not implemented.

**Logout** (`/auth/logout`) revokes both tokens and deletes cookies.

**Login rate-limit** is the only one documented (by behaviour): 5 attempts / 5 min per IP, Redis-backed with in-memory fallback. Returns `429 + Retry-After: 300`. Works.

### 3. Endpoint inventory (what actually exists)

I walked every real path. All successful responses were `application/json`; I saw no HTML-on-error.

| Route | Status | Shape |
|---|---|---|
| `GET /market/quotes/{sym}` | 200 | object, camelCase `changePct` |
| `GET /market/bars/{sym}` | 200 | **bare array** of Bar |
| `GET /market/snapshot/{sym}` | 200 | object |
| `GET /market/market-status` | 200 | object |
| `GET /market-overview/indices` | 200 | `{indices:[...]}`, snake_case `change_pct` |
| `GET /market-overview/sectors` | 200 | `{sectors:[...]}` |
| `GET /market-overview/regime` | 200 | `{regime:{...}}` |
| `GET /screener/presets` | 200 | **bare array** |
| `POST /screener/screen` | — | JSON body screening |
| `GET /options/chain/{sym}` | 200 | `{underlying, contracts:[...]}` |
| `GET /options/iv/{sym}` | 200 | object |
| `POST /trades/orders` | 201 | object; **dedupe 409** on payload hash for 30s |
| `GET /trades/orders` | 200 | **bare array**, no pagination |
| `GET /trades/positions` | 200 | **bare array**, `unrealized_pnl` |
| `GET /trades/history` | 200 | **bare array**, `pnl` |
| `DELETE /trades/orders/{id}` | 204 | — |
| `GET /trades/alerts` | 200 | **bare array** |
| `GET /portfolio/summary` | 200 | object, `unrealized_pnl`, `realized_pnl_today` |
| `GET /portfolio/performance` | 200 | object |
| `GET /portfolio/greeks` | 200 | object |
| `GET /portfolio/calendar` | 200 | `{days:[...]}` |
| `GET /portfolio/journal` | 200 | **bare array** |
| `GET /portfolio/morning-brief` | 200 | object |
| `POST /agents/chat` | 200 | `{conversation_id, message, actions_taken, suggestions, timestamp}` |
| `GET /agents/status` | 200 | `{agents:[...]}` |
| `GET /symbols/search?q=` | 200 | `{count, results:[...]}` |
| `GET /strategies/` | 200 | **bare array** |
| `GET /strategies/leaderboard` | 200 | `{leaderboard:[...]}` |
| `GET /risk/dashboard` | 200 | object |
| `GET /risk/correlation` | 200 | `{strategies, matrix, pairs}` |
| `GET /risk/var` | 200 | object |
| `POST /pipeline/run` | 202 | `{run_id, status}`; **rate-limited 1/min** |
| `GET /pipeline/status` | 200 | object |
| `GET /pipeline/history` | 200 | **bare array** |
| `GET /news/latest` | 200 | `{articles:[...]}` |
| `POST /webhooks/tradingview` | 200 | INBOUND webhook handler |

### 4. Response shape inconsistencies (concrete)

**P&L fields**
- `trades.py:220-221` Position → `unrealized_pnl`, `unrealized_pnl_pct`
- `trades.py:236-237` TradeHistoryEntry → `pnl`, `pnl_pct`
- `portfolio.py:25-27` PortfolioSummary → `unrealized_pnl`, `unrealized_pnl_pct`, `realized_pnl_today`
- `strategies.py:150-151` StrategyPosition → `unrealized_pnl`, `unrealized_pnl_pct`
- `strategies.py:1625-1628` RiskMonitor → `total_pnl`, `best_trade_pnl`, `worst_trade_pnl` (no `_pct` partner)

A client merging "my positions P&L" across portfolio+strategy endpoints writes two mappers.

**Change percentage**
- `market.py:30` Quote → `changePct` (camelCase)
- `market_overview.py:24,36` IndexData/SectorData → `change_pct` (snake_case)

Same concept, two field names, two cases.

**`is_demo` flag** is scattered across 15+ models (`analysis.py:53`, `market.py:35/46/56/66`, `market_overview.py:26/45/60`, `portfolio.py:30/60/105/342/1028`, `news.py:46/53`). It's a leaky internal concept (demo vs live mode) that every external client must learn or ignore. Better in a top-level response envelope or an `X-Alphadesk-Mode` header.

### 5. Error shapes

FastAPI default is respected everywhere I checked. Consistent and parseable:

| Status | Body shape |
|---|---|
| 401 no auth | `{"detail":"Not authenticated"}` |
| 401 bad token | `{"detail":"Invalid token"}` |
| 404 unknown path | `{"detail":"Not Found"}` |
| 404 missing resource | `{"detail":"Symbol 'X' not found"}` |
| 405 wrong method | `{"detail":"Method Not Allowed"}` |
| 409 dedup | `{"detail":"Duplicate order detected..."}` |
| 422 missing field | `{"detail":[{"type","loc","msg","input"}]}` |
| 422 bad JSON | same shape |
| 429 login lockout | `{"detail":"Too many login attempts..."}` + `Retry-After: 300` |
| 429 pipeline | `{"detail":{"error":"rate_limited","message":"...","retry_after":60}}` + `Retry-After: 60` |

**Inconsistency**: `/pipeline/run` 429 nests `{error, message, retry_after}` inside `detail` while login 429 and all other 4xx put a plain string in `detail`. Pick one shape. I didn't trigger any 5xx in the audit (that's good — but also no 5xx sample to confirm it doesn't leak tracebacks; code-path review suggests the default FastAPI handler returns JSON without trace, which is safe).

No `X-Request-ID` echoed in body — but it IS in response headers (`x-request-id: f8fb...`) which is fine.

### 6. Pagination

- **None of the list endpoints use `limit`/`offset` consistently.**
- `/symbols/search?q=&limit=3` → honoured (`{count:3, results:[..3..]}`)
- `/news/latest?limit=2` → looks honoured but body shape `{articles:[...]}` has no total/cursor
- `/trades/orders?limit=5` → query param ignored, full list returned
- `/trades/history?limit=2&offset=0` → query param ignored
- `/pipeline/history?days=3` → uses `days=` not limit
- No `X-Total-Count`, no `Link`/rel=next, no cursor.

A power user who placed 10,000 orders over a year will discover `/trades/orders` returns 10,000 records in one response.

### 7. Timestamps

Four formats observed in a single session:

| Endpoint | Field | Sample |
|---|---|---|
| `/market/quotes/AAPL` | `timestamp` | `2026-04-19T14:43:40.554799Z` |
| `/portfolio/summary` | `last_updated` | `2026-04-19T14:43:40.851549Z` |
| `/trades/history` | `entry_time` | `2026-04-18T05:42:24.899652Z` |
| `/pipeline/summary` | `last_run` | `2026-04-19T14:42:28.513746+00:00` |
| `/pipeline/scheduler_state` | `next_scheduled_run` | `2026-04-20T09:35:00-04:00` |
| `/news/latest` | `published_at` | `"2026-04-19 02:40:09"` (**no T, no tz**) |

Three serialization forms + one "date string, good luck" on news. Any timezone-aware parser (Python `datetime.fromisoformat` pre-3.11) chokes on `...Z`; JS `new Date(...)` chokes on the space-separated news form.

### 8. Money precision

All money fields are `float`. `portfolio.py:25` `unrealized_pnl: float`. Live response: `unrealized_pnl:1506.916768`, `unrealized_pnl_pct:2.641136285327327` — full IEEE-754 mantissa leaks out. For a tax-report use case I'd want `Decimal` serialized as string, or at minimum rounded to 8dp.

### 9. Idempotency

- No `Idempotency-Key` header support anywhere (grep confirms).
- `POST /trades/orders` has a 30s payload-hash dedupe (`trades.py:843-881`) — returns 409 on duplicate. This is a **safety net**, not idempotency:
  - A legitimate client retry after 30s double-submits.
  - A client retry within 30s gets 409 with no way to retrieve the original order id.
  - The correct pattern: client-supplied `Idempotency-Key`, server stores `(key → response)` for N minutes, replays the original response on retry.
- `client_order_id` exists internally (`data/ingestion/daily_pipeline.py:299`) but is generated by the backend, not accepted from the client.
- `DELETE /trades/orders/{id}` is marked "distinguishably idempotent" in the code (line 585) — second delete returns a different response than first, so client can tell "I cancelled it" from "it was already cancelled". Good.

### 10. Webhooks

**Only INBOUND.** `webhooks.py` is a TradingView receiver (`POST /webhooks/tradingview`) that converts alerts into agent-driven orders.

**No outbound webhook system.** There is no `webhooks/` endpoint to register a bot URL for push events. Events that a bot would care about (`order_filled`, `position_closed`, `pipeline_completed`, `risk_breach`, `strategy_signal`) are only observable by either:
1. Polling REST endpoints
2. Connecting to the `/ws` WebSocket and subscribing to `quotes|portfolio|alerts|agents|signals` channels

That's OK-ish, but it means every bot needs a persistent WS connection. A simple "register URL + HMAC secret, receive JSON posts" system (similar to TradingView but outbound) would cover 80% of external bot use cases without requiring WS.

### 11. Rate limiting

Global audit:

| Endpoint | Limited? | Policy | Retry-After? | Headers? |
|---|---|---|---|---|
| `POST /auth/login` | yes | 5 fails / 5 min / IP | yes (300) | none |
| `POST /pipeline/run` | yes | 1 / min / global | yes (varies) | none |
| Everything else | **no** | — | — | — |

I blasted 20× `GET /market/quotes/AAPL` in a second — all 200. `POST /agents/chat` with an empty message — 200. Upstream providers (Alpaca, Polygon, news) HAVE rate limits that AlphaDesk proxies (`options.py:451`, `news.py:127-155` handle upstream 429) but they're absorbed into backend responses rather than surfaced as 429s to the client.

No `X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset` anywhere. No documented policy. A well-behaved bot has no way to self-regulate.

### 12. WebSocket

Endpoint: `wss://tradingalpha.net/ws` (exists, CSP `connect-src` allows it).

Auth (`api/websocket/handler.py:195-244`):
- Option A: HttpOnly cookie `access_token` carried by the handshake — server reads it before first message.
- Option B: first message `{"action":"auth", "token":"<jwt>"}` within 5s, else server closes with code 4001.

Protocol:
```json
→ {"action":"subscribe","channel":"quotes"}
← {"type":"subscribed","channel":"quotes"}
→ {"action":"unsubscribe","channel":"quotes"}
→ {"action":"ping"}
← {"type":"pong"}
← {"channel":"quotes","data":{...}}   # broadcast from Redis pub/sub
```

Channels (`core.redis.ALL_CHANNELS`): `quotes`, `portfolio`, `alerts`, `agents`, `signals` (based on grep; exact list lives in `backend/core/redis.py`). Close codes: 1008 revoked, 4001 auth failed/timeout.

**Nothing about this is documented anywhere** outside the source file. A bot author is reading `handler.py` line-by-line.

### 13. Documentation quality

- **0 of 69** route decorators use `summary=` or `description=` kwargs — so even if `openapi.json` were exposed, the paths would be labelled with Python function names.
- Docstrings DO exist on most handlers (often very good — e.g. `auth.py:231-286` is thorough). They don't make it into OpenAPI without moving to decorator kwargs, which is a simple mechanical change.
- `response_model=` is used on most routes — so shape WOULD be well-typed in a generated spec.
- Tags are set properly at include-router time (`main.py:175-189`).

### 14. Miscellaneous

- `X-Request-ID` echoed on every response — good for support tickets and client-side error reporting.
- `X-Alphadesk-Warning: db-skipped; results may be empty` present on every response in the current deploy (Wave 15 `SKIP_DB_INIT=True` state) — an external client MUST look for this or they'll see 200 OK responses with genuinely-empty arrays and think there's no data. This is a really nice feature — bake it into a permanent `X-Alphadesk-Mode` header even in normal operation (live/paper/demo/degraded).
- CORS allows `localhost:3000` + `PRODUCTION_ORIGIN`. Any third-party web app will need to be proxied through their own backend; they can't call the API from the browser directly.
- Strict CSP / HSTS / XFO / XCTO all set — security posture is good.
- `access_token` cookie `Max-Age=28800` (8h) and `refresh_token` `Max-Age=2592000` (30d) — reasonable.

---

## Concrete recommendations (priority order)

| Prio | Fix | Effort |
|---|---|---|
| P0 | Generate `openapi.json` at build, serve at `/api/v1/openapi.json` (public, static). Add a `/api-reference` static Redoc page. | S |
| P0 | Normalise list responses. Pick `{items, total, limit, offset}` OR bare array + `X-Total-Count` header. Apply everywhere. | M |
| P0 | Rename `Quote.changePct` → `change_pct`. Snake-case everything. Breaking change — bump to `/api/v2` OR dual-emit for one release. | S |
| P0 | Accept `Idempotency-Key` on `POST /trades/orders` (and all state-mutating POSTs). Store `(key → response)` in Redis for 24h. | M |
| P1 | Serialize timestamps as `...Z` everywhere (one serializer, one json_encoders override). Fix `news.published_at` format. Fix `scheduler_state.next_scheduled_run` to UTC. | S |
| P1 | Serialize money as `Decimal` → string, or at minimum `round(x, 8)`. | S |
| P1 | Add outbound webhook subscriptions (`/webhooks/subscriptions` + HMAC-signed POSTs). Bonus: add API-key auth for bots. | L |
| P1 | Add `X-RateLimit-*` headers to all endpoints. Add a global limiter (`slowapi` or FastAPI middleware). Document policy. | M |
| P1 | Move route docstrings into `@router.get(..., summary=..., description=...)` kwargs so they appear in the OpenAPI spec. | S |
| P2 | Document the WebSocket protocol (`/ws`) in the OpenAPI `info.description` block. List channels, message envelopes, close codes. | S |
| P2 | Consistent 429 body shape (pipeline/run differs from login). | XS |
| P2 | Replace per-model `is_demo: bool` fields with a response envelope or `X-Alphadesk-Mode` header. | M |

---

## Files referenced

- `/Users/GK/Downloads/alphadesk/backend/main.py` — app bootstrap, router includes, docs gating
- `/Users/GK/Downloads/alphadesk/backend/api/routes/auth.py` — login/refresh/logout, login rate limit
- `/Users/GK/Downloads/alphadesk/backend/api/routes/trades.py` — orders, positions, history, dedupe logic (`:843`)
- `/Users/GK/Downloads/alphadesk/backend/api/routes/portfolio.py` — summary, performance, greeks, calendar, journal, morning-brief
- `/Users/GK/Downloads/alphadesk/backend/api/routes/market.py` — quotes/bars/snapshot; `Quote.changePct` camelCase (`:30`)
- `/Users/GK/Downloads/alphadesk/backend/api/routes/market_overview.py` — indices/sectors/regime; snake_case `change_pct`
- `/Users/GK/Downloads/alphadesk/backend/api/routes/pipeline.py` — run/status/history, Retry-After on 429
- `/Users/GK/Downloads/alphadesk/backend/api/routes/webhooks.py` — INBOUND TradingView only
- `/Users/GK/Downloads/alphadesk/backend/api/routes/news.py` — articles with naive `published_at` timestamp
- `/Users/GK/Downloads/alphadesk/backend/api/websocket/handler.py` — WS protocol, channels, close codes
- `/Users/GK/Downloads/alphadesk/backend/api/routes/strategies.py` — strategies list, leaderboard, admin routes
