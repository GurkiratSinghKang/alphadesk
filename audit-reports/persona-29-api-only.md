# Persona 29 — API-Only User (curl + Python, never the UI)

**Date:** 2026-04-18
**Persona:** A quant / devops-minded user who only ever hits AlphaDesk via `curl`, `httpx`, `requests`, `jq`, cron. Never opens `https://tradingalpha.net` in a browser.
**Base:** `https://tradingalpha.net/api/v1`
**Cross-ref:** persona-11 (generalist API consumer) — this audit focuses on the script-ergonomics layer beneath persona-11's shape/contract findings.

---

## Summary (250 words)

persona-11 already nailed the shape inconsistencies (casing, list envelopes, timestamps, money-as-float). What this audit adds is the **operational pain** you only notice when the CLI is your only surface.

The auth model is the single biggest friction. `POST /auth/refresh` takes the refresh token in the JSON **body** — not a header, not a cookie it can read — and returns the new tokens in the body with **no Set-Cookie** on the response (unlike login which sets cookies). A cron script must parse JSON, persist two secrets to disk, and re-parse on every run. The refresh rotates (old revoked before new minted), so you must write both tokens atomically or you'll brick the script. Access TTL is 8h, so an hourly cron refresh-then-run is fine, but daily crons across a 30d refresh window still need safe token persistence. There is **no API-key / client-credentials flow** (persona-11 #2 also flagged this) so every bot holds a user password hash or a long-lived refresh token.

Beyond auth, the biggest ergonomic holes are: no server-side streaming anywhere (`/agents/chat` is request/response, no SSE, no `stream=true`); no CSV/NDJSON export despite `notes` having CSV-injection defences already wired in; no batched `/bars` (only `/snapshots`); pagination that can't scroll past offset 1500 on `/trades/orders` because bounds are 500+1000 with no `total` or `next_page_token`; and CORS `allow_headers` whitelist doesn't include `Idempotency-Key` so even the workaround for the broken dedup story is closed to browser callers. The 30s payload-hash dedupe on `POST /orders` actively fights legitimate retries. Webhooks are inbound-only, so every bot is forced onto the undocumented WebSocket.

## Top 10 findings

### 1. `/auth/refresh` returns tokens in body but does NOT refresh cookies
`auth.py:351-399`: `refresh()` returns `TokenResponse` JSON but has no `_set_token_cookies(response, ...)` call. Login (`:347`) does. A curl user who logged in with cookies and then called `/refresh` gets a stale `access_token` cookie still holding the OLD token — subsequent cookie-auth calls fail with 401. Forces every script author to handle tokens as bearer headers AND understand that `/login`'s cookies are a red herring for scripting. **Fix:** wrap `/refresh` in the same cookie-setting helper.

### 2. Refresh rotation is atomic on server but requires atomic write on client
`auth.py:378-391`: server revokes the OLD refresh token BEFORE minting the new one. If a client reads the response, writes `access_token` to disk, then crashes before writing `refresh_token`, the bot is bricked — the server has no record of the old refresh token anymore and the client has no new one. Document this failure mode or add a grace window (keep old refresh valid for 60s after new pair issued).

### 3. No Idempotency-Key anywhere + browser-origin Idempotency-Key is CORS-blocked
persona-11 #6 covered server-side absence. `main.py:149` `allow_headers=["Authorization", "Content-Type", "X-Requested-With"]` — third-party browser clients literally **cannot** send `Idempotency-Key` even if the server ever adds it. Scripts hitting directly are fine; the browser path would require a CORS preflight expansion. The 30s payload-hash dedupe in `trades.py:843-881` returns **409 with no body pointer to the original order id**, so a retry within 30s has zero recovery path.

### 4. `POST /trades/orders` payload requires a `legs` array for a simple market buy
`trades.py:175-184`: `CreateOrderRequest{legs:[{symbol, side, qty, order_type, ...}], time_in_force, strategy, notes}`. A bash one-liner to buy 1 share AAPL is:
```bash
curl -X POST -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
  -d '{"legs":[{"symbol":"AAPL","side":"buy","qty":1,"order_type":"market"}]}' \
  https://tradingalpha.net/api/v1/trades/orders
```
The `legs` wrapper is only meaningful for ≥2-leg option spreads. 95% of equity orders pay the nesting tax. Accept a flat top-level order body for single-leg and keep `legs` for multi-leg.

### 5. No batched `/market/bars` — only `/market/snapshots`
`market.py:398` `GET /market/bars/{symbol}` is single-symbol. `market.py:822` `GET /market/snapshots?symbols=A,B,C` is batched (100 max, good). A Python user pulling 500-bar daily history for a 50-ticker universe must issue 50 serial requests. Alpaca's upstream `/v2/stocks/bars` accepts comma-separated symbols — expose that as `/market/bars?symbols=A,B,C&timeframe=1D&limit=500`.

### 6. Bars endpoint caps at `limit=5000` with no `next_page_token`
`market.py:404` bounds `limit` to 5000 hard. `data/providers/alpaca.py:169-192` threads `page_token` internally but strips it before returning. A user requesting 10 years of 1-minute SPY bars (~1M rows) can't get past 5000 and has no cursor. Return `{bars:[...], next_page_token:"..."}` (persona-11 #3 also flagged list-shape chaos here).

### 7. `/agents/chat` has no streaming
Grep for `StreamingResponse|EventSourceResponse|text/event-stream` across `backend/api/routes/` returns zero matches. A script that wants to `curl --no-buffer` or Python that wants `async for chunk in response.aiter_lines()` can't — it blocks on the full response. For conversational agent calls this kills the CLI UX. Add `/agents/chat?stream=true` returning NDJSON or SSE.

### 8. No CSV / NDJSON export anywhere
Zero `Content-Disposition`/`attachment` headers anywhere in `backend/api/`. The code at `trades.py:147-151` even explicitly defends against CSV injection in the `notes` field ("CSV exports of the trade ledger"), implying an export path was planned — but the endpoint doesn't exist. A tax script must: list orders, paginate (capped at 1500 total rows — see #9), marshal JSON → CSV locally. Add `GET /trades/history?format=csv` returning a streamed CSV with proper `Content-Disposition: attachment; filename="history-2026-04-18.csv"`.

### 9. `/trades/orders` pagination truncates at offset=1000 with no total count
`trades.py:439-440`: `limit: Query(50, ge=1, le=500)` + `offset: Query(0, ge=0, le=1000)`. A user with 2000 orders fetches `?limit=500&offset=0`, `?limit=500&offset=500`, `?limit=500&offset=1000`, then hits the offset cap at 1500 records total. No `X-Total-Count`, no `next_page_token`. Further, `offset` is applied **client-side after** Alpaca's `limit` (`:566-567`) — so `?limit=50&offset=200` returns an empty array (50 rows → offset past the end). Script authors think they've reached the end when they haven't.

### 10. No outbound webhooks → scripts must maintain a persistent WebSocket
persona-11 #7 (webhook subscriptions) + #9 (WS undocumented) compound here specifically for the script persona. A Python cron that wants "tell me when my order fills" has to either poll `/trades/orders?status=all` every 5s (adds load, delayed) OR implement a long-lived `websockets` client with JSON-envelope discovery from `api/websocket/handler.py`. For a shell-script-only user, the WS path isn't realistic. Add a `POST /webhooks/subscriptions {url, events:["order.filled","pipeline.completed","risk.breach"], secret}` returning a subscription id, and POST HMAC-signed events to the registered URL.

---

## Script-ergonomics recommendations (priority order)

| Prio | Fix | Effort |
|---|---|---|
| P0 | Accept `Idempotency-Key` on POSTs; store `(key → response)` in Redis for 24h. Replay the response body + status on retry. Expand CORS `allow_headers` to include it. | M |
| P0 | Make `/refresh` set the fresh `access_token` + `refresh_token` cookies on its response (parity with `/login`). Document in the response docstring that cookie-auth clients don't need to parse the body. | XS |
| P0 | Add `GET /market/bars?symbols=A,B,C` batched variant (100 symbols max, same bounds as single-symbol). | S |
| P0 | Accept `{symbol, side, qty, order_type, ...}` at the top of `POST /orders` as a single-leg shorthand; keep `legs:[...]` for options. | S |
| P1 | Add `X-Total-Count` header on `/trades/orders`, `/trades/history`, `/trades/positions`, `/strategies/`. Wire a `next_page_token` on `/market/bars`. | M |
| P1 | Add `?format=csv` support to `/trades/history`, `/trades/orders`, `/portfolio/journal`, `/pipeline/history`. Stream via `StreamingResponse` with `Content-Disposition`. | M |
| P1 | Add `POST /webhooks/subscriptions` (outbound) with HMAC signing, retry/backoff, and delivery audit log. Cover at minimum: `order.filled`, `order.rejected`, `pipeline.completed`, `risk.breach`, `strategy.signal`. | L |
| P1 | Add `stream=true` to `POST /agents/chat` returning SSE or NDJSON. | M |
| P2 | Add a stable API-key auth path (`X-API-Key`) for bots so they don't hold long-lived refresh tokens or user passwords. Scoped keys (read-only vs trading). | L |
| P2 | On order-dedup 409, include the original `order_id` in the response body so a legitimate retry can reconcile without polling `/trades/orders`. | S |

---

## Files referenced

- `/Users/GK/Downloads/alphadesk/backend/main.py` — CORS `allow_headers` at `:149`
- `/Users/GK/Downloads/alphadesk/backend/api/routes/auth.py` — `/login` sets cookies (`:347`), `/refresh` does NOT (`:351-399`)
- `/Users/GK/Downloads/alphadesk/backend/core/auth.py` — `require_auth` accepts Bearer header OR cookie (`:149-161`)
- `/Users/GK/Downloads/alphadesk/backend/api/routes/trades.py` — order schema (`:97-141`, `:175-184`), dedupe (`:843-881`), pagination (`:439-440`, `:564-567`)
- `/Users/GK/Downloads/alphadesk/backend/api/routes/market.py` — single-symbol bars (`:398-541`), batched snapshots (`:822-874`)
- `/Users/GK/Downloads/alphadesk/backend/data/providers/alpaca.py` — internal `page_token` handling (`:169-192`) never exposed to API clients
- `/Users/GK/Downloads/alphadesk/backend/api/routes/pipeline.py` — only endpoint besides login with Retry-After wired (`:100-109`)
- `/Users/GK/Downloads/alphadesk/backend/api/routes/news.py` — bare `published_at: str` type (`:42`), whatever-upstream-returns serialization (`:186`)
- `/Users/GK/Downloads/alphadesk/audit-reports/persona-11-api-consumer.md` — generalist API audit (cross-ref)
