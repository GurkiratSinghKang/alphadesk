# Persona 9 — Adversarial Tester (real holes a normal user falls through)

**Date**: 2026-04-18 (Sunday) | **Tester**: Persona 9 | **Target**: tradingalpha.net (live)

The platform is hardened well at the API boundary — Pydantic guards qty bounds, symbol regex, leg count, body shape, JSON parsing. Ratelimits, market-closed gating, dedup hashes, dual-token JWT with HttpOnly+Secure+SameSite=strict, and the WS reconnect banner all behave correctly. Below are the **real-world failure modes a non-malicious user can stumble into**, ranked by user-visible severity.

## Top 10 holes

### 1. Login rate-limit counts SUCCESS as well as FAILURE — five total attempts per 5 min per IP, then locked out
`auth.py:_check_rate_limit` calls `pipe.incr(key)` *before* the auth result is known. A user who succeeds on attempt 1, signs out, signs back in, then hits the form a third time after a 502 page reload, etc. burns through 5 of 5 in legitimate use. **Repro**: I logged in successfully, then attempted a 2nd login from a parallel session and got `429 Too many login attempts. Please try again in a few minutes.` with `Retry-After: 300`. Fix: only `INCR` on failed attempts (or use a separate success counter with a much higher cap).

### 2. Token refresh dies on page reload, user kicked to /login at the 8-hour mark
`frontend/src/lib/api.ts:425` keeps the refresh token in a module-local variable (`let refreshToken`) and not in any storage by design (XSS hardening). The comment at line 412–416 acknowledges: "page reload loses the in-memory token → next refresh cycle becomes a no-op → user falls through to the 401 redirect." So a user who logs in at 9 AM, reloads the dashboard at 10 AM (e.g. after a deploy), then leaves the tab open until 5 PM gets booted to /login mid-task. The Wave 14/19 scheduler only protects users who never reload.

### 3. Toggle race actually does NOT fully serialize — concurrent toggles produce visibly inconsistent "previous_status" reads
Sent four parallel `POST /api/v1/strategies/momentum-quality/toggle`. All returned 200 but the audit trail came back: `R1 active→paused, R2 paused→active, R3 paused→active, R4 active→paused`. Two responses both report the same starting state ("paused→active"), meaning either WATCH is racing on a missing key or the canonical fall-back at `strategies.py:1374` ignores the WATCH. Net effect: a user double-clicking from two tabs sees toast messages that lie about what the previous state was, and the final state is non-deterministic.

### 4. Zustand persist stores ship without a `version` / `migrate` — a future schema change silently corrupts state
All four persisted stores (`market.ts`, `preferences.ts`, `notifications.ts`, `ui.ts`) call `persist(...)` with only `{ name, partialize, skipHydration }`. No `version`, no `migrate`. Any field rename or default change reads stale localStorage and hydrates broken state — at best a UI glitch, at worst a runtime crash inside a `set` reducer. Adding `version: 1, migrate: (state, ver) => …` is one line each and prevents users from having to manually clear `alphadesk.*` from devtools after a release.

### 5. `/api/v1/trades/orders?offset=-5` and `?offset=abc` are SILENTLY IGNORED — pagination footgun
`list_orders` (`trades.py:392`) declares `status` and `limit` query params but **not `offset`**. FastAPI/Pydantic drops unknown query params — so the UI's paginator can pass any value and get the same first page back. Compare to `/trades/alerts` which correctly enforces `offset: int = Query(0, ge=0)` and returns 422 on `-5`. The orders endpoint should match.

### 6. A market order sent at 2 AM ET produces a clean message, but `AAPL.TO` (Canadian ticker) and a tick-size violation (`limit_price=1.123456789`) both produce opaque `502 Broker rejected order. Check order parameters and try again.`
The Pydantic regex passes `AAPL.TO` and `1.123456789`, then Alpaca rejects them and the user gets nothing actionable. The error message should call out (a) "this exchange isn't supported" or (b) "limit price must be in increments of $0.01 (or $0.0001 below $1.00)". A user who pasted a TSX symbol from a research note has no idea why it failed.

### 7. `/strategies/<bad-id>` returns HTTP 200 (with editorial "Strategy not found" copy), so SEO/integrations/CDN treat it as a live page
`strategies/[id]/page.tsx:445-479` has correct user-visible "Strategy not found" copy (Wave 26), but the route still returns 200. Anything (analytics, error trackers, CI link-checkers, sitemaps) that distinguishes 200 from 404 will be misled. Should call `notFound()` from `next/navigation` so Next emits a real 404 status.

### 8. `notes` field accepts NUL bytes, control chars, and CSV-injection payloads (`=cmd|/c calc!A1`) without sanitization
`POST /trades/orders` with `"notes": "line1\nline2\u0000\u0007"` returns 201 and the value is persisted. Same for `"=cmd|/c calc!A1"`. While the `OrderResponse` doesn't echo `notes` in `list_orders` (so XSS is moot), a future CSV export of trade history, a Slack notification template, or any DB-text view that doesn't quote-prefix `=`/`+`/`-`/`@` will spawn an Excel formula on the analyst's laptop. Either strip control chars + leading `=+-@` at validation, or annotate the field as untrusted.

### 9. Double-cancel of an order returns `204` twice — user can't tell their click "did" anything
`DELETE /api/v1/trades/orders/{id}` from two parallel calls both returned 204. The second one should return `409 Already cancelled` so the UI toast can say "Already cancelled" instead of the same "Order cancelled" twice. Same idea for the order-not-found case: cancelling an unknown id returns the generic `422 Failed to cancel order` with no detail — a user who clicks Cancel on a row that just filled gets a useless 422 instead of "This order was already filled".

### 10. The pipeline rate limit is essentially "1 click then 429 for a while" with no UI hint of when the cooldown ends
`POST /api/v1/pipeline/run` succeeded once, then returned `429` for the next 7 attempts in the same second. The 429 body lacks a `Retry-After` header (unlike `/auth/login` which provides 300s). A user who clicks Run twice — perhaps because the first click looked frozen — has no idea whether to wait 10 seconds or 10 minutes. Add `Retry-After` and surface a per-button cooldown timer.

## Honourable mentions (not in top 10 but worth noting)

- **Empty bars for `UNKNOWN_SYMBOL_XYZ`** returns `[]` HTTP 200, not 404 — the chart will render a blank canvas with no error messaging.
- **`GET /api/v1/strategies/{id}` (singular)** returns 404 — only `/{id}/performance` works. Any third-party integration would assume the strategy doesn't exist.
- **`limit_price=1e308`** explodes into a 600-digit risk-check error message ("Order notional $100,000,000,000,…"). Cap notional formatting at, say, "Order notional exceeds $1B; please use a sane price."
- **Frontend `/?strategy=../../etc/passwd` returns 200** — harmless but the dashboard still tries to switch to that "strategy". Should validate against `STRATEGY_META` keys before accepting.
- **Lowercase / trailing-space symbol** correctly 422s, but the error is a Pydantic regex dump (`String should match pattern '^[A-Z][A-Z0-9.\-]{0,9}$'`). The UI should normalize (uppercase + trim) on the client before submitting; the typing user shouldn't ever see this message.

## What works well (sanity check)

- 422 errors for qty=0, qty=-5, qty=1e10 (capped at 100k), emoji symbol, missing legs
- Sunday-market gate with a clean message
- Dedup hash (Wave 28) correctly catches identical limit orders within 30s with 409
- Dual-token JWT cookies are `HttpOnly; Secure; SameSite=strict; Path=/api/v1/auth` for refresh — strong CSRF posture
- WsStatusBanner with explicit Reload button on `failed`
- `notFound()` rendering for `/totally-nonexistent-page-xyz` (real 404)
- Strategy detail page handles unknown slug with editorial copy (Wave 26)

— Persona 9
