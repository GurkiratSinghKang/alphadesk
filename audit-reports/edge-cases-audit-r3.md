# AlphaDesk — Edge-Case & Error-Recovery Audit (Round 3)

Scope: weekends, holidays, DST, stale data, delisted tickers, WS reconnects,
backend outages, input extremes, concurrency races, long-running sessions,
mobile recoveries. Files referenced are absolute paths on disk.

Summary of top-15 findings (ranked by real-user impact per month) appears
at the bottom of this report.

---

## A. Market / time edge cases

### [P0] Holiday-on-weekday: back-end order-time guard uses `weekday()` only — a user can submit a market order on Christmas Day (Monday, Dec 25 2028) and it passes the time gate

**Files:**
- `/Users/GK/Downloads/alphadesk/backend/api/routes/trades.py:244-255`
- `/Users/GK/Downloads/alphadesk/backend/data/calendar.py` (correct holiday-aware calendar exists but is NOT used by `create_order`)
- `/Users/GK/Downloads/alphadesk/backend/data/ingestion/pipeline_runner.py:173-174` (`_is_weekday` — same flaw)
- `/Users/GK/Downloads/alphadesk/backend/data/ingestion/continuous_monitor.py:159` (hour check only)
- `/Users/GK/Downloads/alphadesk/backend/data/ingestion/alpaca_stream.py:119-121` (weekday only)

**What happens today:** `trades.py` rejects market orders outside 09:30–16:00 ET and outside Mon–Fri:
```python
if et_now.weekday() >= 5 or et_now.hour < 9 or ...: raise 400
```
But it never asks `USMarketCalendar.is_trading_day(today)`. On New Year's Day, Christmas, MLK Day, Presidents' Day, July 4th (weekday), Labor Day, Thanksgiving, Good Friday, Juneteenth — all fall on weekdays — a market order passes the backend gate and gets sent to Alpaca, which rejects it with a much uglier 422/4XX. The pipeline scheduler also fires strategy windows on holidays because `_is_weekday()` ignores them.

**What should happen:** Replace `weekday()` checks with `USMarketCalendar.is_trading_day(now.date())` (the calendar already exists and is tested — see `backend/data/providers/tests/test_calendar.py`). On non-sessions, return HTTP 400 with message "Market is closed (US holiday)."

**Fix:**
```python
from data.calendar import USMarketCalendar
_cal = USMarketCalendar()
if not _cal.is_trading_day(et_now.date()):
    raise HTTPException(400, "Market is closed today (US holiday / weekend)")
```
Apply the same pattern in `pipeline_runner.py::_is_weekday`, `continuous_monitor._run_monitor`, and `alpaca_stream._is_market_hours`.

---

### [P1] Early-close days (day after Thanksgiving, Christmas Eve, July 3rd): scheduler's 3:30 PM close-window fires AFTER the market has already closed at 1 PM ET

**Files:**
- `/Users/GK/Downloads/alphadesk/backend/data/ingestion/pipeline_runner.py:243-297`

**What happens today:** `WINDOWS["close"]` is hard-coded to `15:30` (3:30 PM) and the scheduler has no half-day awareness. On the day after Thanksgiving, market closes at 13:00 ET — the close-window strategies (`RSI-2 MOC`, `VRP`, `Earnings Vol`, mean-rev) kick off at 15:30 ET against a closed market, generate MOC orders that will never fill, and log them as staged trades.

**What should happen:** On early-close days, all close-window strategies should run ~1.5 hours earlier (around 12:30 ET) or be skipped entirely. Use `USMarketCalendar.is_early_close(today)` to shift timings.

**Fix:** In `_scheduler_loop`, detect early-close days and either run close-window strategies against a 12:45 trigger, or tag the day as a "no-close-window" day and log skipped strategies.

---

### [P1] `isMarketOpen()` client helper is DST-correct but lies on US holidays

**Files:**
- `/Users/GK/Downloads/alphadesk/frontend/src/lib/marketHours.ts:49-56`
- Used by `frontend/src/app/(dashboard)/page.tsx:193` for the "Market · open" status pill

**What happens today:** Desk page renders "Market · open" on a holiday weekday because the frontend helper only checks weekday + hour range. The doc comment even acknowledges this: *"This helper does not know about NYSE-observed US holidays"*. On MLK Day (a Monday), users see a green "Market · open" pill all day while the broker is closed — confusing, and may prompt orders that then get rejected by Alpaca.

**What should happen:** Hit `/api/v1/market/market-status` (already exists and proxies Alpaca's `/v2/clock` which is holiday-aware). Cache for 60s. Treat the backend response as source of truth and fall back to the local heuristic only if it fails.

**Fix:** Add a `useMarketStatus()` React Query hook that polls the backend. Use that instead of `isMarketOpen()` in the Desk page status pill and OrderBar gating. Keep `isMarketOpen()` as a sync helper but call it only as a fallback when the server answer is unknown.

---

### [P1] Morning-brief status helper: weekday check can report wrong day around midnight ET

**Files:**
- `/Users/GK/Downloads/alphadesk/frontend/src/components/dashboard/MorningBrief.tsx:18-31`

**What happens today:** `getMarketStatus()` does `new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }))`. The intermediate string is parsed as *local* time. If the user is in Japan at 1 AM JST on a Sunday, the ET string is "Sat 11:00" — parses fine, `getDay()` returns 6, so "Closed". But if the user is in California at 9:01 PM Friday PT (midnight Saturday ET, Sat 00:01), the ET string is "Sat 00:01" which in the user's local PT would parse to Fri 9:01 → `getDay()` returns 5 (Fri) → shows "Closed" correctly. The edge happens when the ET string straddles a date that's formatted ambiguously in a non-US locale's runtime. On Chrome/Safari `toLocaleString` with "en-US" is stable, but Firefox and Edge sometimes format "12:00:00 AM" where Safari emits "00:00:00", and the resulting `new Date(...)` in Firefox might fail to parse when the locale drops AM/PM.

**What should happen:** Use `Intl.DateTimeFormat.formatToParts` to extract weekday/hour/minute in ET directly, the way `marketHours.ts` already does. Don't round-trip through `new Date(locale string)`.

**Fix:** Replace `getMarketStatus()` with a call that reuses `getMarketSession()` from `marketHours.ts`.

---

### [P2] DST transition nights: `pipeline_runner._scheduler_loop` uses 30-second sleeps, so a window that straddles the 2→3 AM jump can miss or double-fire

**Files:** `/Users/GK/Downloads/alphadesk/backend/data/ingestion/pipeline_runner.py:253-297`

**What happens today:** On the spring-forward Sunday (2 AM → 3 AM ET), any strategy window scheduled for 2:30 AM would be skipped. None of AlphaDesk's windows are between 2–3 AM ET today (earliest is 6 AM premarket), so this is theoretical — but also: `state_key=f"last_{window_name}"` is cleared only by setting `today` to a new date. The fall-back Sunday (3 AM → 2 AM) creates a 2:30 AM window twice; the state check prevents re-run same day, so this one is fine. Net: no current bug, but fragile to any timing change.

**What should happen:** Track last-run by *ET wall-clock timestamp* (not just date) so the scheduler is resilient to future 2–4 AM additions.

---

### [P2] Pre/post market handling: desk page has no visual cue for extended hours

**Files:** `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/page.tsx:191-198`, `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/_desk/selectors.ts:336-370`

**What happens today:** The `Market · open / closed` pill is binary. During the 4 AM–9:30 AM ET pre-market window and 4 PM–8 PM ET after-hours window, the pill says "Market · closed" even though SIP data still streams and limit orders can be placed (with correct TIF). Users may not realise quotes are real.

**What should happen:** Three-state pill: `Pre-market`, `Open`, `After-hours`, `Closed`. `getMarketSession()` in `marketHours.ts` already computes this — just wire the return value through.

---

## B. Data staleness

### [P0] Quote "staleness" is invisible: if the SIP WebSocket dies, the Desk's price label keeps displaying the last tick indefinitely with no freshness indicator

**Files:**
- `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/page.tsx:176-189` (`lastTickSec` computed but only used for a footer pill)
- `/Users/GK/Downloads/alphadesk/frontend/src/components/composites/PriceChartPanel.tsx` (header price cell)
- `/Users/GK/Downloads/alphadesk/frontend/src/stores/market.ts:40-64` (quote updates)

**What happens today:** Quote data carries no age. `PriceChartPanel` shows a ~36pt mono price with a profit/loss delta. If the SIP stream drops and stays down for 10 minutes, that price stays lit as if live. The StatusBar pill says "Last tick 612.44s" but that's at the very bottom of the screen; the trader's eye is on the big number. If the tick is >60s old there should be a visual signal (dim the price, add a "stale" dot, replace the delta with an em-dash).

**What should happen:** When `lastTickSec > 15` (regular hours) or `> 300` (pre/post/closed), render the quote price at 50% opacity with a subtle "stale" badge and suppress the % delta. When the WS re-connects, snap back to full-opacity.

**Fix:** Thread `quoteStale: boolean` through `PriceChartPanel`'s `Quote` prop; `TickerStrip`, `WatchlistPanel`, and `OrderBar` should do the same. Gate by computing `age = Date.now() - quote.timestamp`.

---

### [P1] Redis-backed quote cache: when SIP stream dies, `_get_current_price` in `trades.py` falls through to Alpaca REST and stamps a new `timestamp` of `datetime.now(utc)`, erasing real age

**Files:**
- `/Users/GK/Downloads/alphadesk/backend/api/routes/trades.py:635-665`
- `/Users/GK/Downloads/alphadesk/backend/api/routes/market.py:368-380` (Alpaca snapshot path)

**What happens today:** A position's "current price" can be a 3-hour-old snapshot but the record's `timestamp` is `now`. The frontend has no way to distinguish a fresh SIP tick from a stale REST poll.

**What should happen:** Preserve Alpaca's `latestTrade.t` (trade timestamp) in the `Quote.timestamp` field; stamp `receivedAt` separately if useful.

**Fix:** In `market.py:374` and `market.py:619`, use `lt.get("t")` (Alpaca returns RFC-3339) instead of `datetime.now(utc)`.

---

### [P1] 1D range on a holiday/weekend: chart falls through to empty series, shows a retry button instead of yesterday's intraday chart

**Files:**
- `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/page.tsx:102-133, 351-362`
- `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/trade/page.tsx:65-76`

**What happens today:** `rangeToLimit("1D") == 2`. On a holiday, Alpaca returns zero daily bars for today. The chart's `series` ends up with at most one bar (yesterday's) and renders nearly-flat. Worse: between 04:00 and 09:30 ET intraday "today" bars don't exist yet, so "1D" renders empty → error CTA.

**What should happen:** When the user picks "1D" and market is closed/holiday/pre-open, fall through to previous session's intraday bars. Backend already supports this — the frontend is passing a daily timeframe for the 1D range when it should use `"5m"` or `"15m"` intraday with an explicit `start` = previous session open.

**Fix:** In `page.tsx`, map `"1D"` → intraday timeframe + explicit session window. Use `useMarketStatus()` to know whether we're pre-open, live, or post.

---

## C. Delisted / suspended / halted symbols

### [P1] Delisted / halted status from Alpaca is never surfaced to the UI — a user can still submit orders for a halted stock

**Files:**
- `/Users/GK/Downloads/alphadesk/backend/api/routes/trades.py:97-104` (`OrderLeg` — no halt check)
- `/Users/GK/Downloads/alphadesk/backend/api/routes/market.py:306-394` (`get_quote` — no tradable/halted flag in response)
- `/Users/GK/Downloads/alphadesk/backend/api/routes/portfolio.py:453-466` (positions — no halt field surfaced)

**What happens today:** Alpaca's `/v2/assets/{symbol}` endpoint returns `tradable`, `status` (`active` / `inactive`), and `fractionable` flags. Neither `get_quote` nor `list_positions` looks these up. The order flow just forwards to Alpaca and relies on the broker rejecting — which works, but users see a generic 4XX error rather than "AAPL is currently halted (LULD Level 1)."

**What should happen:** Add a `halted: bool` field to the Quote model, populated from Alpaca's asset endpoint (cache 60s). OrderBar should visually disable the "Stage" button and show a halt banner when `quote.halted === true`. On delisted tickers, the ticker-search and watchlist should mark them as "Delisted" and block "Trade" actions.

---

### [P2] Mergers / spinoffs / ticker renames: historical trades reference old symbol, current trade ledger never updates

**Files:** `/Users/GK/Downloads/alphadesk/backend/data/ingestion/trade_ledger.py` — no symbol rename logic

**What happens today:** If a user bought FB in 2021 and still held it through the 2022 META rename, the trade_ledger would still list `FB` in `entry`/open rows. There's no rename map in the ledger. The backend's Alpaca sync will now return `META` in positions, so `sync_with_alpaca` would mark the old `FB` row as "absent" and close it at `exit_price=null, pnl=null` (silent corruption). In practice, Alpaca auto-renames tickers in API responses, so the ledger probably closed FB on the rename date — leaving a "phantom" closed trade and a new "phantom" META entry.

**What should happen:** Maintain a `symbol_alias` map (historical renames) and have `sync_with_alpaca` rename rather than close + reopen.

---

## D. Network failures + recovery

### [P0] WebSocket reconnect: the UI doesn't show a "reconnecting" banner; users think the app is fine while quotes silently freeze

**Files:** `/Users/GK/Downloads/alphadesk/frontend/src/hooks/useWebSocket.ts`, `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/_desk/selectors.ts:336-370`

**What happens today:** `useWebSocket` does exponential backoff (1s→2s→4s→…→30s, up to 10 retries). `isConnected` is exposed but no top-level banner/toast fires when disconnected. After 10 retries it gives up silently and the user has no affordance to trigger a manual reconnect short of refreshing the page.

**What should happen:**
- On `isConnected=false` for > 5s, emit a toast or a sticky yellow ribbon at the top: "Reconnecting to live feed…".
- After exhausting 10 retries, show a persistent red banner with a "Reconnect" button that resets the retry counter and calls `connect()`.
- Also plumb `isConnected` into the StatusBar so the existing "Alpaca paper · connected" pill can go to `offline` when the WS is dead, not just when the broker has no keys.

---

### [P1] `fetchPortfolioData` polls every 30s but has zero backoff on sustained 503s — during a backend outage the browser bangs on 503 endpoints every 30s forever

**Files:** `/Users/GK/Downloads/alphadesk/frontend/src/hooks/useDataPipeline.ts:81-124`, `/Users/GK/Downloads/alphadesk/frontend/src/hooks/useQueries.ts`

**What happens today:** React Query `retry: 2` fires 2 quick retries, then `refetchInterval: 60_000` keeps hammering. The 30s `portfolioInterval` in `useDataPipeline` does the same. No exponential backoff when the backend is clearly unhealthy (many consecutive 503s). Also every 30s we re-dispatch an `alphadesk:api-error` event that toasts "API error (503)" — spammy.

**What should happen:** When 3 consecutive requests fail with 503/5xx, back off to 60s, then 120s, up to 5min. Stop toasting after the first 503 in a run and only toast recovery.

---

### [P1] `fetchPortfolioData` timeout mismatch: all four parallel calls share a single store but each has its own 15s timeout — if one times out while the others succeed, the UI is left in a mixed state (positions updated, summary stale)

**Files:** `/Users/GK/Downloads/alphadesk/frontend/src/hooks/useDataPipeline.ts:81-119`

**What happens today:** Positions might show 12 rows while the summary still reflects yesterday's equity. No consistency check.

**What should happen:** Either drive all four from a single `Promise.allSettled` that commits atomically to the store, or add a "last refresh" timestamp to the store so the UI can label a mixed-state dashboard.

---

## E. Input extremes

### [P0] Symbol regex inconsistency between frontend and backend: BRK.B, BF.B, RDS-A fail at the backend even though the frontend permits them

**Files:**
- `/Users/GK/Downloads/alphadesk/backend/api/routes/trades.py:98` → `pattern=r"^[A-Z]{1,10}$"`
- `/Users/GK/Downloads/alphadesk/backend/api/routes/trades.py:740` (CreateAlertRequest) — same too-strict regex
- `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/page.tsx:226` → `^[A-Z][A-Z0-9.\-]{0,9}$`
- `/Users/GK/Downloads/alphadesk/frontend/src/components/panels/WatchlistPanel.tsx:850` → same relaxed regex
- `/Users/GK/Downloads/alphadesk/backend/api/routes/market.py:106` — BRK.B is in the *valid demo symbol* set already, proving the inconsistency

**What happens today:** A user adds BRK.B to the watchlist (works), selects it on the desk (quote fetch works, since `get_quote` accepts any symbol), clicks Stage Order on BRK.B → backend validates against `^[A-Z]{1,10}$` and returns a 422 like "String should match pattern". Frontend displays "API 422: Unprocessable Entity" with no actionable advice. Same bug blocks price alerts for BRK.B.

**What should happen:** Backend regex should match the frontend: `^[A-Z][A-Z0-9.\-]{0,9}$`. Also apply to `CreateAlertRequest.symbol`.

**Fix:** One-liner in `trades.py:98` and `trades.py:740`.

---

### [P1] Order notional guard: the only risk check is a single `$50,000 per-order` notional cap — users can still place N sequential $49,999 orders in a minute

**Files:** `/Users/GK/Downloads/alphadesk/backend/api/routes/trades.py:668-686`

**What happens today:** No daily/intraday accumulation limit, no concentration limit, no correlation-aware limit. 30s dedup catches *identical* orders but not legitimate sequential orders against the same ticker.

**What should happen:** Track rolling 5-minute / 1-hour notional per user in Redis; reject when cumulative exceeds a sensible bound.

---

### [P2] Order with stop > limit (or limit > stop on sell) — no cross-validation

**Files:** `/Users/GK/Downloads/alphadesk/backend/api/routes/trades.py:97-119`, `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/page.tsx:230-242`

**What happens today:** Pydantic validates each price > 0 individually but not the relationship between them. A stop-limit `buy` with `stop=$100` + `limit=$95` is nonsensical (can never fill) but the backend accepts it and sends to Alpaca, which then rejects with a cryptic error.

**What should happen:** In `OrderLeg.model_validator`, assert:
- buy stop-limit: `limit_price >= stop_price` (willing to pay at least the stop)
- sell stop-limit: `limit_price <= stop_price`

---

### [P2] Price with 10 decimals: sent as `124.9876543210` → Alpaca likely rounds silently or rejects

**Files:** `/Users/GK/Downloads/alphadesk/frontend/src/components/composites/OrderBar.tsx:92`

**What happens today:** `price ? Number(price) : undefined` lets through any float. Backend has no rounding. Alpaca has its own validation but error messages are terse.

**What should happen:** Round to 2 decimals for stocks ≥ $1 and 4 decimals for < $1 (matches Alpaca price-precision rules).

---

## F. Concurrency

### [P1] Fast double-click on Stage Order: guarded by a 30s Redis SET NX dedup **only when legs hash identically** — a user can double-click within ~50ms and *occasionally* get two orders when both requests hit different workers before Redis round-trip

**Files:** `/Users/GK/Downloads/alphadesk/backend/api/routes/trades.py:613-632`, `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/page.tsx:213-268`

**What happens today:** Frontend has `submittingOrder` boolean guard that returns early on second click — good. Backend's Redis SET NX is atomic. But if worker A processes click 1 and worker B processes click 2 simultaneously, both might see the Redis SET succeed if the second request hits before A completed. The submit button does prevent re-click during the in-flight promise, so this is a theoretical race made worse by extremely fast networks.

**What should happen:** Add a client-side idempotency key (`crypto.randomUUID()`) to the order payload and have the backend dedup on that UUID with TTL 60s. Idempotent by design.

---

### [P2] Two browser tabs: watchlist edits in tab A don't propagate to tab B until tab B refreshes

**Files:** `/Users/GK/Downloads/alphadesk/frontend/src/stores/market.ts:82-87`, `/Users/GK/Downloads/alphadesk/frontend/src/stores/preferences.ts:85-87`

**What happens today:** Zustand `persist` writes to localStorage on change but other tabs don't listen for the `storage` event. Tab A removes AAPL from watchlist → tab B still shows AAPL until a manual reload.

**What should happen:** Enable cross-tab sync via the `storage` event or zustand's `createJSONStorage`. 10 LOC.

---

### [P2] Order filled-then-cancelled race: the UI shows cancelled state briefly before the broker webhook says "actually filled"

**Files:** `/Users/GK/Downloads/alphadesk/backend/api/routes/trades.py:403-426`, no webhook handler listed

**What happens today:** Optimistic cancel-order UI sets local state to "cancelled" the moment the DELETE call returns 204, even though Alpaca's actual response is async (the fill may have already happened). The authoritative state arrives later via /orders refresh — until then the UI lies.

**What should happen:** Don't set local state to "cancelled" until a webhook or the next poll confirms.

---

## G. Empty / boundary states

### [P1] Account with zero / negative equity (margin call): no UI path — divisions by equity render `NaN%` in the ContextBar

**Files:** `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/_desk/selectors.ts:147-238`

**What happens today:** `exposurePct = equity > 0 ? (gross / equity) * 100 : 0` — handles zero. But `dayPnlPct = lastEquity > 0 ? ...` in `api.ts:574` — what if `dayPnl > equity` and `lastEquity` is negative? Returns 0 silently. A margin-call day might display "Day P&L: -$50,000 · 0.00%" which is wrong.

**What should happen:** When equity ≤ 0, render an explicit "Margin call" banner and suppress `%` deltas entirely.

---

### [P1] First-login onboarding: watchlist pre-populated with 10 mega-caps the user may not care about; preferences defaults never explained

**Files:** `/Users/GK/Downloads/alphadesk/frontend/src/stores/market.ts:5`

**What happens today:** DEFAULT_WATCHLIST = AAPL/MSFT/GOOGL/…. A new user sees 10 unrelated tickers on their first load. `OnboardingTour` is referenced in `layout.tsx:19` but I didn't verify it covers watchlist customisation.

**What should happen:** Skip DEFAULT_WATCHLIST on first-login, show an empty-watchlist CTA with a ticker-search affordance.

---

### [P2] Settings → notification prefs: disabling all four toggles yields zero in-app notifications ever — no confirmation that this is intentional

**Files:** `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/settings/page.tsx:397-423`

**What happens today:** User toggles everything off → silence. No copy says "You've disabled all alert channels. Order fills and price alerts will still appear in the Alerts page but won't notify you."

**What should happen:** Add a subtle warning banner when all four are off.

---

## H. Long-running session

### [P0] Access token (8 hrs) expires silently: the user is kicked to `/login` mid-session with no "your session is expiring" warning — there is NO client-side refresh flow

**Files:**
- `/Users/GK/Downloads/alphadesk/backend/core/config.py:82-83` — `ACCESS_TOKEN_EXPIRE_MINUTES: int = 480  # 8 hours`
- `/Users/GK/Downloads/alphadesk/backend/api/routes/auth.py:159-193` — `/api/v1/auth/refresh` endpoint exists
- `/Users/GK/Downloads/alphadesk/frontend/src/lib/api.ts` — NO refresh helper, NO scheduled refresh
- Only logic on 401: `apiFetch` calls `POST /api/v1/auth/logout` and `window.location.href = "/login"` (`api.ts:92-111`)

**What happens today:** A trader leaves the app open overnight. After 8 hours, the next API call comes back 401. The app immediately redirects to `/login` without warning — losing whatever was on screen (order drafts, unsaved notes, scroll position). The `/api/v1/auth/refresh` endpoint is wired on the backend but never called by the frontend. The refresh_token cookie is set for 30 days.

**What should happen:** Schedule a silent refresh at `access_token.exp - 60s` using the refresh cookie. Failure modes:
- Refresh succeeds → user never sees a login prompt in any 30-day session.
- Refresh fails → clear UI warning "Your session will expire in X seconds. Re-authenticate?" rather than silent redirect.

**Fix:** Add a `AuthRefreshProvider` that reads `access_token.exp` from a non-HttpOnly parallel cookie (set by `/login`) or decodes the issued-at side-channel, then `setTimeout` a refresh call 60s before expiry.

---

### [P1] DeskClock updates every 1s for 24 hrs = 86 400 setState calls. Minor memory overhead + renders, but works; however the ticker-strip animation + chart re-render compound

**Files:** `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/_desk/useDeskClock.ts:12-39`

**What happens today:** `setInterval(tick, 1000)` + React state update triggers a re-render of the TopBar every second. Over 24 hours that's 86k re-renders of the top bar. No observed leak but the tick heartbeat (page.tsx:172, 2s cadence) also forces memo recomputes. Battery/perf will degrade on a mobile device left open.

**What should happen:** Pause the clock when the tab is hidden (`visibilitychange` listener — pause on `"hidden"`, resume + tick once on `"visible"`).

---

### [P2] WebSocket reconnect storms are bounded to 10 attempts then silent — after a long outage the user must refresh to re-enter the retry loop

**Files:** `/Users/GK/Downloads/alphadesk/frontend/src/hooks/useWebSocket.ts:122-130`

**What happens today:** 10 retries with exponential backoff caps at `1s * 2^9 = 512s`, exceeding the 30s `MAX_DELAY` after a few retries. After the 10th failed attempt, no further reconnect until the tab becomes hidden and then visible (`visibilitychange` handler resets retries). Users who keep the tab focused during a long outage get permanently disconnected.

**What should happen:** After MAX_RETRIES, schedule a final check every 60s until connected — or expose a "Reconnect now" button (see D/P0 above).

---

## I. Form-validation gaps

### [P1] Login form: doesn't trim whitespace before validating username or comparing — a trailing space causes "Invalid username"

**Files:** `/Users/GK/Downloads/alphadesk/frontend/src/app/login/_login/LoginForm.tsx:178-183`, `/Users/GK/Downloads/alphadesk/backend/api/routes/auth.py:134-142`

**What happens today:** User copy-pastes "admin " from a password manager — backend compares strict-equal against `ADMIN_USERNAME`, rejects, counts a failure, lockout ticks closer. Frustrating.

**What should happen:** `.trim()` on both client and server.

---

### [P2] Create-price-alert: negative/zero price field accepts via native `type="number"` but no "price must be > 0" inline error — the error message is a toast that fades

**Files:** `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/alerts/page.tsx:50-70`

**What happens today:** `parseFloat("-5")` passes `!isNaN` check → the `p <= 0` guard catches it. Good. But the failure path shows a toast rather than an inline error anchored to the input.

**What should happen:** Move to inline field-error state with `aria-describedby`.

---

### [P2] OrderBar: no validation of `type="market"` + `pre/post market` combination — will hit the backend's 400 only after submit

**Files:** `/Users/GK/Downloads/alphadesk/frontend/src/components/composites/OrderBar.tsx`, `/Users/GK/Downloads/alphadesk/backend/api/routes/trades.py:244-255`

**What happens today:** User submits a market buy at 6 AM ET, gets "Market orders can only be placed during regular trading hours". Better to grey out `Market` in the type selector when not in session.

**What should happen:** Disable the `Market` option when the market is closed; tooltip explains why.

---

## J. Mobile-specific edge cases

### [P2] Airplane-mode toggle: WS reconnects, but there's no single place the React Query cache is invalidated — portfolio polling resumes after 60s

**Files:** `/Users/GK/Downloads/alphadesk/frontend/src/hooks/useWebSocket.ts:157-169`, `/Users/GK/Downloads/alphadesk/frontend/src/lib/providers.tsx`

**What happens today:** `visibilitychange` → `hidden` → `visible` triggers WS reconnect but React Query only refreshes at its `refetchInterval`. For up to ~60s after un-airplaning, the portfolio summary is stale.

**What should happen:** On `visibilitychange=visible`, call `queryClient.invalidateQueries()` for critical keys.

---

### [P2] Long mutual-fund / ETF names (e.g. `Vanguard Total World Stock ETF`): truncation inconsistent across `TickerStrip`, `WatchlistPanel`, and `PriceChartPanel.symbol.name` falls back to ticker

**Files:** `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/_desk/selectors.ts:264-269`

**What happens today:** `toMarketSymbol` returns `{ ticker, name: ticker, venue: "—" }` — the real company/fund name is never fetched. The chart header shows the ticker twice. On mobile there's no overflow, so not catastrophic, but wastes vertical space.

**What should happen:** Fetch from the symbol-search endpoint (`/api/v1/symbols/search`) once per symbol and cache in the `market` store.

---

# TOP-15 PRIORITIZED EDGE CASES (by expected monthly user-hit rate)

Ranking factors: frequency (how many calendar events per month — holidays, late nights, double-clicks), user impact (silent corruption > broken flow > cosmetic), number of users affected (every user vs. power users).

| # | P | Scenario | Expected monthly hit-rate driver |
|---|---|---|---|
| 1 | **P0** | **Access-token silent expiry → kicked to `/login` after 8 hrs** (H/P0) | Every user every day if they leave tab open ≥ 8 hrs. `/Users/GK/Downloads/alphadesk/frontend/src/lib/api.ts:92-111`, `/Users/GK/Downloads/alphadesk/backend/api/routes/auth.py:159-193`. |
| 2 | **P0** | **Quote staleness has no visual indicator** — SIP stream drop displays a dead price (B/P0) | Every quote feed hiccup. `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/page.tsx:176`, `/Users/GK/Downloads/alphadesk/frontend/src/components/composites/PriceChartPanel.tsx`. |
| 3 | **P0** | **Backend regex `^[A-Z]{1,10}$` rejects BRK.B / BF.B / RDS-A, frontend permits them** (E/P0) | Anyone trading Berkshire, Brown-Forman, etc. `/Users/GK/Downloads/alphadesk/backend/api/routes/trades.py:98,740`. |
| 4 | **P0** | **Order-time weekday-only check missing holiday awareness** — Christmas Monday etc. (A/P0) | Roughly 10 US holidays/year fall on weekdays → 10+ user-visible rejections. `/Users/GK/Downloads/alphadesk/backend/api/routes/trades.py:247-251`. |
| 5 | **P0** | **WebSocket silent disconnect — no reconnecting banner, no user-triggerable retry** (D/P0) | Every flaky wifi session. `/Users/GK/Downloads/alphadesk/frontend/src/hooks/useWebSocket.ts:122-130`. |
| 6 | **P1** | **`isMarketOpen()` lies on US holidays** — status pill says "Market · open" while market is closed (A/P1) | Every holiday weekday. `/Users/GK/Downloads/alphadesk/frontend/src/lib/marketHours.ts:49-56`. |
| 7 | **P1** | **Sustained 503 spam: no backoff, toasts every 30s** (D/P1) | Every backend outage. `/Users/GK/Downloads/alphadesk/frontend/src/hooks/useDataPipeline.ts:124`. |
| 8 | **P1** | **1D chart range empty on holidays / pre-market** (B/P1) | Holidays + every pre-open. `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/page.tsx:353`. |
| 9 | **P1** | **Early-close days: scheduler fires close-window strategies at 3:30 PM after the 1 PM close** (A/P1) | 3–4 half-days/year. `/Users/GK/Downloads/alphadesk/backend/data/ingestion/pipeline_runner.py:245`. |
| 10 | **P1** | **Double-submit order: 50ms race can slip past Redis dedup on multi-worker deploy** (F/P1) | Anyone who double-clicks. `/Users/GK/Downloads/alphadesk/backend/api/routes/trades.py:613-632`. |
| 11 | **P1** | **Login username not trimmed — trailing space = auth failure** (I/P1) | Anyone using a password manager. `/Users/GK/Downloads/alphadesk/backend/api/routes/auth.py:134-142`. |
| 12 | **P1** | **Halted / delisted tickers never blocked — UI lets user stage an order** (C/P1) | Rare but high-severity. `/Users/GK/Downloads/alphadesk/backend/api/routes/market.py:306-394`. |
| 13 | **P1** | **Portfolio polling mixed-state: one call fails, others succeed → inconsistent dashboard** (D/P1) | Every network hiccup. `/Users/GK/Downloads/alphadesk/frontend/src/hooks/useDataPipeline.ts:81-119`. |
| 14 | **P1** | **Margin call / zero equity renders `NaN%` and "Day P&L: 0.00%"** (G/P1) | Rare but catastrophic. `/Users/GK/Downloads/alphadesk/frontend/src/lib/api.ts:574`, `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/_desk/selectors.ts:147-238`. |
| 15 | **P1** | **Ticker rename / merger (FB→META)**: ledger closes silent then re-opens under new name (C/P2) | Rare (~1–3/year) but P0-severity silent data corruption. `/Users/GK/Downloads/alphadesk/backend/data/ingestion/trade_ledger.py:757`. |

### Cross-cutting recommendations

1. **Adopt `USMarketCalendar` everywhere** — replace `if weekday() < 5` with `is_trading_day()` in `trades.py`, `pipeline_runner.py`, `continuous_monitor.py`, `alpaca_stream.py`, and `marketHours.ts` (via backend API).
2. **Add a `QuoteFreshness` component** — single source of truth for "this price is N seconds old; dim/halt UI accordingly". Reuse in PriceChartPanel, TickerStrip, WatchlistPanel, ContextBar.
3. **Client-side token refresh** — schedule a `/auth/refresh` call at `exp - 60s`, fall back to login only when refresh genuinely fails. Removes ~2 user-session breaks per week.
4. **Unify the symbol regex** — one source, shared between FE and BE, matching Alpaca's tradable-symbol rules.
5. **Circuit-breaker for the API fetch layer** — after 3 consecutive 5xx, stop polling; show a single sticky banner; expose a manual retry. Stops the 503-toast storm.
