# AlphaDesk QA Round 10 - Full Bug Report

**Date:** 2026-04-13  
**Environment:** https://tradingalpha.net (production)  
**Login:** admin / alphaDesk2025!  
**Method:** API-level testing replicating all frontend data flows

---

## CRITICAL BUGS (P0 - Fix Immediately)

### BUG-R10-01: Strategy toggle does not persist - always resets to original status
- **Severity:** P0 (CRITICAL)
- **Location:** `backend/api/routes/strategies.py` line 608-630
- **Steps to reproduce:**
  1. Call `POST /api/v1/strategies/pead/toggle`
  2. Response says `{"previous_status":"active","new_status":"paused"}`
  3. Call `GET /api/v1/strategies/` immediately after
  4. PEAD still shows `"status":"active"`
  5. Toggle again - response again says `{"previous_status":"active","new_status":"paused"}`
  6. The toggle response always shows `previous_status: active`, meaning the Redis override is never read back by the list endpoint
- **Root cause:** The `_set_strategy_status_override()` writes to Redis with `ttl_seconds=0`, but the `cache_set` function may interpret 0 as "no TTL" differently than expected, or the Redis `cache_get` at read time is failing silently. The `_get_strategy_data()` function reads the override and the toggle endpoint uses it, but the list endpoint at line 474 calls `_get_strategy_data()` which should work. There may be a race condition or the Redis cache_set with ttl=0 is expiring immediately.
- **Impact:** Users cannot pause/resume strategies. The UI will show incorrect status. Strategy execution cannot be stopped.

### BUG-R10-02: Pipeline uses stale screener prices for stop/take-profit, not actual fill prices
- **Severity:** P0 (CRITICAL - FINANCIAL RISK)
- **Location:** Pipeline execution logic
- **Evidence:**
  - WMT: Screener price $177.26, Alpaca fill price $124.23 (42.6% gap!)
  - Stop loss calculated from screener: $166.62 (34% ABOVE entry)
  - Take profit calculated from screener: $194.99
  - Result: Stop loss at $166.62 will never trigger on a $124.23 long position
- **Root cause:** The pipeline strategy analysis uses cached/stale prices from the screener data provider. When the order executes on Alpaca at the actual market price ($124.23), the stop/take-profit levels ($166.62/$194.99) computed from the screener price ($177.26) are nonsensical.
- **Impact:** Risk management is broken. Stop losses are ineffective. Positions can run losses without any safety net.

### BUG-R10-03: Market orders rejected with "Cannot determine price" 
- **Severity:** P0 (CRITICAL)
- **Location:** `backend/api/routes/trades.py` line 570-592
- **Steps to reproduce:**
  1. Place a market buy order: `POST /api/v1/trades/orders` with `{"legs":[{"symbol":"AAPL","side":"buy","qty":5,"order_type":"market"}],"time_in_force":"day"}`
  2. Response: `{"detail":"Cannot determine price for AAPL. Use a limit order."}`
- **Root cause:** The `_get_current_price()` function only checks Redis cache (`quote:{symbol}`). If no cached quote exists, it returns 0.0, which fails the risk check. The function has no fallback to fetch a live price from Alpaca.
- **Impact:** Users cannot place market orders. The "Order" tab's primary use case (quick market orders) is broken.

### BUG-R10-04: Anthropic API key is invalid/expired - Claude-powered strategies fail silently
- **Severity:** P0 (CRITICAL)
- **Location:** Pipeline Claude agent calls
- **Evidence:** Pipeline log shows:
  ```
  "error": "Error code: 401 - {'type': 'error', 'error': {'type': 'authentication_error', 'message': 'invalid x-api-key'}}"
  ```
  Affects: `momentum_quality` and `claude_alpha` strategies
- **Impact:** Two strategies that depend on Claude analysis produce zero trade signals. The errors are logged in the pipeline history but not surfaced to the user on the dashboard.

---

## HIGH BUGS (P1 - Fix This Sprint)

### BUG-R10-05: Chart/bar data is from April 2025 (one year stale)
- **Severity:** P1 (HIGH)
- **Location:** `GET /api/v1/market/bars/{symbol}`
- **Evidence:**
  - AAPL daily bars return dates `2025-04-14` through `2025-04-21`
  - AAPL 1-minute bars return `2025-04-14T08:00:00Z`
  - Today is `2026-04-13`
  - AAPL close price in bars: $193.16 (April 2025) vs live quote: $258.59
- **Root cause:** The Alpaca free-tier data plan only provides data up to ~1 year ago. The `effective_start` defaults to `date.today() - 365 days` which is April 2025. The bars are returning the only data available in that range.
- **Impact:** The TradingView chart on the Trade page shows year-old data while the quote header shows the current price. This is extremely confusing and could lead to incorrect trading decisions.

### BUG-R10-06: MRK stop order submitted with null stop_price
- **Severity:** P1 (HIGH)
- **Location:** Pipeline order submission
- **Evidence:** Order `402234ed...`:
  ```json
  {"symbol":"MRK","side":"sell","qty":43.0,"order_type":"stop","limit_price":null,"stop_price":null}
  ```
  A stop order with no stop_price is meaningless. Alpaca will either reject it or treat it unpredictably.
- **Impact:** The "stop loss" protection for the MRK PEAD position is non-functional.

### BUG-R10-07: Sector YTD returns are all 0.0%
- **Severity:** P1 (HIGH)
- **Location:** `backend/api/routes/market_overview.py` line 208-214
- **Evidence:** All 11 sectors show `ytd_pct: 0.0` despite live sector change data being present
- **Root cause:** When live Alpaca data is available, the code only computes `change_pct` (daily) but hardcodes `ytd_pct=0.0` (line 211). The demo fallback data has proper YTD values but they're never used when live data succeeds.
- **Impact:** The sector treemap's YTD column is useless. Dashboard lacks a key market context signal.

### BUG-R10-08: VIX data inconsistency - indices show 16.5 (demo) while regime uses VIXY at 28.6 (live)
- **Severity:** P1 (HIGH)
- **Location:** `backend/api/routes/market_overview.py`
- **Evidence:**
  - Indices endpoint: VIX = $16.50, is_demo: true
  - Regime endpoint: vix_level = 28.6, is_demo: false (uses VIXY ETF as proxy)
  - Regime says "Bull - High Volatility" (because VIXY > 20)
  - But the indices widget shows VIX at 16.5 suggesting low volatility
- **Root cause:** The indices endpoint cannot fetch real VIX data (not available on Alpaca) so it falls back to hardcoded demo data at 16.5. The regime endpoint uses VIXY (an ETF) as a proxy, which reads $28.6. These two sources disagree.
- **Impact:** Contradictory volatility signals on the dashboard. User sees "VIX 16.5" in one widget and "High Volatility" regime classification in another.

### BUG-R10-09: Equity curve uses index-based x-axis instead of dates
- **Severity:** P1 (HIGH)
- **Location:** `GET /api/v1/portfolio/performance`
- **Evidence:** The equity_curve array returns `{"index": 0, "cumulative_pnl": 6.18}` but the PortfolioHero component expects `{"date": "...", "value": ...}` format
- **Root cause:** The performance endpoint returns index-based entries while the frontend `PortfolioHero.tsx` (line 16-39) filters by date using `filterByPeriod()`. With no `date` field, the period buttons (1W/1M/3M/YTD) won't filter correctly, and the chart may not render.
- **Also:** The performance data is flagged `is_demo: true`, meaning it's synthetic, not computed from actual trades.

### BUG-R10-10: Analysis data uses stale/wrong prices in trade ideas
- **Severity:** P1 (HIGH)
- **Location:** `GET /api/v1/analysis/analysis/{symbol}`
- **Evidence for AAPL:**
  - Live quote: $258.59
  - Analysis trade idea: "Buy AAPL at $230.0 with stop at $218.5"
  - Technical EMA20: $227.86
  - Fundamental summary says "revenue growth of 13% YoY" but detail field says 34.1%
- **Impact:** Technical levels, trade ideas, and fundamental summaries are based on outdated prices. The fundamental text summary contradicts its own detail data.

---

## MEDIUM BUGS (P2)

### BUG-R10-11: Sector leader_change_pct equals sector change_pct
- **Severity:** P2 (MEDIUM)
- **Location:** `backend/api/routes/market_overview.py` line 213
- **Evidence:** Every sector's `leader_change_pct` exactly matches the sector `change_pct` (e.g., Technology: sector=2.01%, NVDA=2.01%). This is because `leader_change_pct=change_pct` is hardcoded.
- **Expected:** NVDA's individual change should differ from XLK's ETF change.
- **Impact:** Minor data accuracy issue in sector treemap tooltips.

### BUG-R10-12: Pipeline screened/analyzed counts show 0 in history list
- **Severity:** P2 (MEDIUM)
- **Location:** `GET /api/v1/pipeline/history`
- **Evidence:** The list view shows `screened=0, analyzed=0` for all runs, but the detail view (`/history/2026-04-13`) reveals `strategies_run` data with actual counts (e.g., pead: screened=14, analyzed=2).
- **Root cause:** The history list endpoint returns the top-level `screened`/`analyzed` fields which are empty arrays, while the actual data is nested under `strategies_run`.
- **Impact:** The pipeline history list appears empty/broken in the frontend.

### BUG-R10-13: NKE limit sell order at $105.96 is 147% above current price ($42.79)
- **Severity:** P2 (MEDIUM - same root cause as BUG-R10-02)
- **Evidence:** Several open orders have limit prices calculated from stale screener prices, making them unreachable:
  - NKE: limit sell $105.96 vs current $42.79 (147% gap)
  - WMT: limit sell $194.99 vs current $124.28 (57% gap)
  - PG: limit sell $188.40 vs current $143.42 (31% gap)
- **Impact:** These orders will never fill. Capital is tied up in positions with no realistic exit plan.

### BUG-R10-14: Many strategies show 0% return, 0 positions, win_rate=-1 despite being "active"
- **Severity:** P2 (MEDIUM)
- **Evidence:** 9 of 13 strategies have zero invested, zero positions, zero returns. Only PEAD, Earnings Vol, and Regime Adaptive have any data.
- **Expected:** For newly deployed strategies, this is expected. But the UI should distinguish "never traded" from "trading with 0% return".
- **Impact:** The strategy grid is mostly empty/useless tiles. The `win_rate: -1.0` sentinel should display as "N/A" in the frontend.

### BUG-R10-15: Screener prices are stale/cached (MRK shows $113.84 vs live $120.09)
- **Severity:** P2 (MEDIUM)
- **Location:** Screener data source
- **Evidence:** MRK screener price $113.84 matches the trade ledger entry_price from April 8, not the current market price. WMT shows $177.26 which doesn't match any known reference price.
- **Impact:** Screener results present misleading price data.

---

## LOW BUGS (P3)

### BUG-R10-16: Portfolio performance is synthetic demo data
- **Severity:** P3 (LOW)
- **Evidence:** `GET /api/v1/portfolio/performance` returns `is_demo: true` with synthetic metrics (Sharpe 4.55, Sortino 5.92, 70% win rate). These don't reflect actual trading performance.
- **Impact:** Dashboard performance metrics are aspirational, not real. Users may trust these numbers.

### BUG-R10-17: Pipeline order_placed/closed entries have null/missing fields
- **Severity:** P3 (LOW)
- **Evidence:** `orders_placed[0]` and `orders_closed[0]` in the latest pipeline run have `qty: None`, `price: None`, `symbol: None` in the top-level format, requiring nested access.
- **Impact:** Activity feed may show "Bought None None @ $NaN" entries.

### BUG-R10-18: MSFT search returns MSFT as 4th result, not 1st
- **Severity:** P3 (LOW)
- **Evidence:** Searching "MSFT" returns MSFD, MSFL, MSFO before MSFT itself.
- **Expected:** Exact symbol match should be ranked first.
- **Impact:** Minor UX friction in command palette search.

### BUG-R10-19: Strategy sparklines use deterministic pseudo-random data, not actual performance
- **Severity:** P3 (LOW)
- **Location:** `frontend/src/components/dashboard/StrategyGrid.tsx` line 108
- **Evidence:** `generateSparkData(strategy.id.length * 31 + strategy.id.charCodeAt(0), 30)` generates fake sparkline data based on strategy ID hash, not actual equity curve.
- **Impact:** Strategy cards show fake performance sparklines.

---

## OBSERVATIONS (Not Bugs)

### OBS-01: Login and authentication work correctly
- JWT auth with HttpOnly cookies + Bearer token
- Rate limiting configured (15 attempts / 5 min)
- Token refresh and revocation work

### OBS-02: Limit orders work correctly
- Placed AAPL limit buy at $250, received order ID, cancelled successfully
- Order appeared in orders list with correct status

### OBS-03: Invalid symbol handling works
- `ZZZZ` quote returns `{"detail":"Symbol 'ZZZZ' not found"}` (404)
- `ZZZZ` search returns `{"count":0,"results":[]}` (proper empty)

### OBS-04: Rapid symbol switching works
- 5 symbols queried in rapid succession (AAPL, MSFT, GOOGL, AMZN, TSLA)
- All returned correct, distinct data with no cross-contamination

### OBS-05: Options chain returns realistic data
- AAPL options: 132 contracts across 6 expirations
- Prices, greeks, IV all plausible (deep ITM calls ~$25, OTM puts ~$0.01)
- IV data endpoint returns proper term structure and skew

### OBS-06: News feed returns real articles
- 10 articles from real financial news sources
- Timestamps current (2026-04-13)
- Not demo data (`is_demo: false`)

### OBS-07: Pipeline risk management (master agent) works well
- 8 rejections with clear reasons and actionable remediation advice
- Momentum gate, duplicate detection, allocation limits, risk/reward checks all functioning

### OBS-08: P&L consistency verified
- Sum of position P&Ls (-$109.40) matches portfolio unrealized_pnl (-$108.78) within rounding tolerance

### OBS-09: Positions match reality
- 4 positions: MRK (86), NKE (62), PG (35), WMT (61)
- Live prices, market values, and P&L all internally consistent
- Alpaca source confirmed (`is_demo: false`)

---

## PRIORITY FIX ORDER

1. **BUG-R10-02** + **BUG-R10-06**: Fix pipeline to use actual fill prices for stop/TP (FINANCIAL RISK)
2. **BUG-R10-03**: Fix market orders by adding live price fallback in risk check
3. **BUG-R10-04**: Rotate/refresh Anthropic API key
4. **BUG-R10-01**: Fix strategy toggle persistence
5. **BUG-R10-05**: Upgrade Alpaca data plan or add Polygon as primary bar source
6. **BUG-R10-08**: Unify VIX data source (either use VIXY everywhere or compute from options)
7. **BUG-R10-07** + **BUG-R10-11**: Fix sector YTD and leader change data
8. **BUG-R10-09**: Fix equity curve date format in performance endpoint
9. **BUG-R10-10**: Refresh analysis cache or compute from live prices
10. **BUG-R10-12** - **BUG-R10-19**: Lower priority fixes
