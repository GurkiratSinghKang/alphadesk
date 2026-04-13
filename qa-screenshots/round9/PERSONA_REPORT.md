# AlphaDesk QA Round 9 -- 20 Persona Test Report

**Date:** 2026-04-13  
**URL:** https://tradingalpha.net  
**Build:** feature/deployment branch, commit c13165e  

---

## Job 1: Pipeline Risk Fix Summary

**Root cause:** All trades were rejected due to multiple overlapping risk checks that were too restrictive for a small portfolio (1 position, ~$100K equity).

**Fixes applied:**

| Parameter | Before | After | Reason |
|-----------|--------|-------|--------|
| `MAX_PER_POSITION` | 5% ($4,996) | 6% ($5,995) | $4,999 positions were rejected for being $3 over limit |
| `MAX_POSITION_DOLLAR` | $5,000 | $6,000 | Aligned with position % change |
| `MIN_CONVICTION` | 60 | 50 | Claude analysis can return lower-but-valid scores |
| `MIN_REWARD_RISK_RATIO` | 1.5:1 | 1.2:1 | Mean reversion's 7%/8% stops gave 1.14:1, all rejected |
| `ANALYZE_TOP_N` | 15 | 40 | Only 2 candidates per strategy analyzed (15/8=1.875) |
| Absolute momentum gate | < 0% | < -5% | AVGO rejected for -0.9% (noise, not a downtrend) |
| 6-month momentum gate | < 0% | < -10% | Too many legitimate stocks blocked |
| Sector concentration | Always enforced | Only at 3+ positions | With 1 position, any new stock = 50% sector, always rejected |
| Mean reversion stop/target | 7% stop / 8% target | 5% stop / 10% target | Now gives 2:1 R/R ratio |

**Result:** Pipeline went from 0/9 approved to 3/17 approved (PG, WMT, NKE placed successfully).

---

## Job 2: 20 Persona Test Results

### Persona-by-Persona Findings

#### 1. Day Trader
- **Tried:** Fast chart switching, 1m/5m timeframes, quick order entry
- **Worked:** Trade view has full candlestick chart with 1m, 5m, 15m, 1h, 4h, D, W timeframes; watchlist with real-time prices
- **Issues:** No quick "BUY" / "SELL" hotkey or one-click order entry visible on the chart view itself. Trader must navigate to an order form.

#### 2. Swing Trader
- **Tried:** Daily/weekly charts, RSI, MACD, support/resistance
- **Worked:** D and W timeframe buttons present; RSI and MACD indicators visible in the right-side panel; Bollinger Bands and EMA overlays available
- **Issues:** None significant -- the Trade view is well-suited for swing trading

#### 3. Options Trader
- **Tried:** Find options chain, IV data, multi-leg strategies
- **Worked:** SPY options chain is displayed at the bottom of the Trade view with strikes, calls, puts, bid/ask; IV data visible on screener
- **Issues:** Only SPY options chain shown (single underlying). No multi-leg strategy builder (spreads, condors). Cannot select arbitrary tickers for options.

#### 4. Portfolio Manager
- **Tried:** Dashboard overview, allocation charts, P&L
- **Worked:** Dashboard shows portfolio value ($99,929.10), day P&L (-$132.58), open positions with per-stock P&L, April P&L calendar heatmap, 8 strategy cards with active/inactive status
- **Issues:** No allocation donut/pie chart showing sector or strategy breakdown visually. The "Loading portfolio..." spinner appeared on one test (possible timing issue).

#### 5. Quant/Algo Trader
- **Tried:** Strategy pages, backtest, pipeline
- **Worked:** Pipeline view has Strategy Builder with natural language input ("My Custom Strategy"), Backtesting section with SMA Crossover strategy selector and parameter controls
- **Issues:** Navigation uses top buttons (Dashboard/Trade/Pipeline) not sidebar links -- the automated test looking for `<a href>` links could not find them because they are `<button>` elements. Strategy Builder appears to be a form but unclear how to save/deploy a custom strategy.

#### 6. Risk Manager
- **Tried:** Exposure data, drawdown, VaR, regime indicator
- **Worked:** Top bar shows "Regime: Bear - High Volatility" and "VIX 29.0". Pipeline view shows stop-loss and take-profit for each position.
- **Issues:** No dedicated risk dashboard showing VaR breakdown, drawdown chart, sector exposure heatmap, or factor concentration metrics. Risk data exists in the backend (master_agent.py calculates all of this) but is not surfaced in the UI.

#### 7. New User (First Time)
- **Tried:** Understand landing page, sign up, find docs
- **Worked:** Landing page clearly explains "Institutional-grade trading terminal powered by Claude AI" with 4 feature cards (AI Analysis, Multi-Strategy Pipeline, Real-Time Trading, Portfolio Management). Footer has Docs, Privacy Policy, Terms of Service, Risk Disclosure links.
- **Issues:** No sign-up form -- only "Request Access" (mailto link) and "Invite-only platform" text. No onboarding tour or getting-started guide after login.

#### 8. Mobile User (375px)
- **Tried:** Login, dashboard, navigation on iPhone viewport
- **Worked:** Login page renders correctly on mobile. Dashboard loads with portfolio value and activity feed visible. Navigation (hamburger/collapsed) is present.
- **Issues:** Horizontal scroll detected -- content overflows the 375px viewport. Open Positions table and P&L calendar are cramped.

#### 9. Keyboard-Only User
- **Tried:** Tab through the entire app using only keyboard
- **Worked:** Can Tab to login form inputs. 11 interactive elements are focusable. Focus indicators are visible (browser default outlines).
- **Issues:** None detected -- keyboard navigation works adequately.

#### 10. Screen Reader User
- **Tried:** Check ARIA labels, heading structure, landmarks
- **Worked:** 1 h1 heading found, 9 total headings, ARIA landmarks present (nav element)
- **Issues:** 1 out of 12 buttons has no accessible label (likely an icon-only button). No `aria-live` regions for real-time price updates.

#### 11. Impatient User
- **Tried:** Rapidly click through pages without waiting for data
- **Worked:** App does not crash during rapid navigation
- **Issues:** Page shows "Error" text after rapid navigation (likely a transient API error displayed). No loading skeletons or spinners visible during transitions -- the user sees a blank area then content suddenly appears. "Loading portfolio..." text appears to hang in some cases.

#### 12. Data-Skeptical PM
- **Tried:** Verify P&L values, check data consistency
- **Worked:** Found 10 dollar values and 10 percentage values on dashboard. All values appear realistic for a $100K paper account. Position P&L matches (NKE: -$2.19, MRK: -$14.88, etc.).
- **Issues:** None -- data appears consistent and realistic.

#### 13. Compliance Officer
- **Tried:** Legal pages, risk disclaimers, audit trail
- **Worked:** /privacy, /terms, /legal, and /disclaimer pages all exist and return 200. Risk Disclosure link in footer works.
- **Issues:** No /risk-disclosure dedicated page (the link goes to /risk). No visible risk disclaimers within the app itself (only accessible via footer links). No trade audit trail page showing historical trades with timestamps.

#### 14. API Power User
- **Tried:** Test key API endpoints with authentication
- **Worked:** POST /api/v1/auth/login returns valid JWT token. GET /api/v1/trades/positions, /api/v1/pipeline/status, and /api/v1/strategies all return 200.
- **Issues:** GET /api/v1/screener returns 404 (wrong path -- the screener endpoint may use a different route). GET /api/v1/market-overview returns 404. No API documentation page (e.g., Swagger/OpenAPI).

#### 15. Backtester
- **Tried:** Find backtest page, run backtests with different parameters
- **Worked:** Pipeline view has a Backtesting section with strategy selector (SMA Crossover), ticker input, and parameter controls. "Run Backtest" button present.
- **Issues:** The automated test could not find the backtest page because it searched for `<a>` links (the Pipeline view is accessed via a `<button>`). Backtest functionality is hidden under the Pipeline tab, not discoverable.

#### 16. News Trader
- **Tried:** Find news section, activity feed, headline freshness
- **Worked:** Activity Feed on dashboard shows real news headlines with timestamps (e.g., "Sompo vs Everest Group Head-To-Head Contrast", "Brokerages Set Texas Capital Bancshares PT at $100.75"). Headlines link to real news sources.
- **Issues:** No dedicated News page. Activity feed mixes pipeline status messages with news headlines. No filtering by ticker or category.

#### 17. Multi-Monitor Trader (2560x1440)
- **Tried:** Check layout at ultrawide resolution
- **Worked:** Content stretches to fill 2560px width. Dashboard layout uses available space without excessive whitespace.
- **Issues:** Login page has lots of dead space at 2560px (content is centered in a small area). Could benefit from multi-panel layout at ultrawide.

#### 18. Strategy Researcher
- **Tried:** Check all 8+ strategy detail pages, read thesis/parameters
- **Worked:** Dashboard shows 8 strategy cards: Momentum + Quality, PEAD, VRP Harvesting, Earnings Vol, Regime Adaptive, Claude Alpha, Mean Reversion, VCP Breakout. Each card shows active/inactive status and recent return %.
- **Issues:** No clickable strategy detail pages. Strategy cards show summary info but do not link to detailed pages with thesis documentation, parameters, historical performance, or backtesting results. The user cannot drill into any strategy.

#### 19. Weekend Planner
- **Tried:** Check what works when market is closed, data staleness
- **Worked:** App loads and functions outside market hours. Screener, portfolio, and backtest all accessible.
- **Issues:** No "Last updated" or data freshness timestamps on prices -- user cannot tell if prices are from Friday close or real-time. No "Market Closed" banner or status indicator on the main dashboard (though the top bar shows regime/VIX info).

#### 20. Security Auditor
- **Tried:** Auth security, headers, rate limiting, tokens, cookies
- **Worked:** All protected routes redirect to login. All 5 security headers present (X-Frame-Options, X-Content-Type-Options, Strict-Transport-Security, Content-Security-Policy, X-XSS-Protection). Invalid tokens properly rejected (401). Rate limiting active on failed login attempts (429 after threshold). Cookies set with HttpOnly and Secure flags.
- **Issues:** None -- security posture is solid.

---

## Prioritized Issue List (Deduplicated)

### P0 -- Critical (Broken Functionality)

1. **Pipeline rejected all trades before fix** -- Position size rounding, mean reversion R/R ratio, sector concentration with < 3 positions, and aggressive momentum gates combined to reject every single trade. [FIXED]

2. **Claude API authentication fails on server** -- `ANTHROPIC_API_KEY` returns 401 (invalid x-api-key). Claude CLI also fails (missing `/root/.claude.json`). Strategies that depend on Claude analysis (momentum_quality, claude_alpha) produce no trades because analysis returns errors. The pipeline falls back gracefully but these strategies are effectively disabled.

### P1 -- High (Significantly Impacts User Experience)

3. **No strategy detail pages** -- Strategy cards on dashboard have no click-through to detailed pages with thesis, parameters, historical performance, or configuration. Strategy researchers cannot drill into any strategy. (Personas: 5, 18)

4. **"Loading portfolio..." hangs** -- The portfolio loading spinner appears but never resolves on some page transitions, leaving a blank area. (Personas: 11, 13, 16)

5. **No trade audit trail / history page** -- No way to view historical trades, fills, or execution logs. Critical for compliance and debugging. (Personas: 13, 5)

6. **No risk dashboard** -- VaR, sector exposure, drawdown, and factor crowding data exist in the backend but are not exposed in the UI. Risk managers have no way to monitor portfolio risk. (Persona: 6)

### P2 -- Medium (Notable Gaps)

7. **Mobile horizontal overflow** -- Content overflows the viewport at 375px width, causing horizontal scrollbar. Tables (Open Positions, P&L calendar) are the primary offenders. (Persona: 8)

8. **No loading states / skeleton screens** -- When navigating between views, content area goes blank before data appears. No loading skeletons, spinners, or progress indicators during transitions. (Persona: 11)

9. **No market status indicator** -- Dashboard does not show whether the market is open, closed, pre-market, or after-hours. The top bar shows VIX/regime but not trading session status. (Persona: 19)

10. **No data freshness timestamps** -- Prices and P&L values have no "as of" timestamp. Users cannot tell if data is current, from last close, or stale. (Persona: 19)

11. **API endpoint discoverability** -- /api/v1/screener and /api/v1/market-overview return 404. No Swagger/OpenAPI documentation page. (Persona: 14)

12. **Options chain limited to SPY** -- Only SPY options are shown. Cannot select other underlyings. No multi-leg strategy builder. (Persona: 3)

13. **No dedicated news page** -- News headlines appear only in the Activity Feed, mixed with pipeline status messages. No filtering, searching, or ticker-specific news view. (Persona: 16)

### P3 -- Low (Polish / Nice-to-Have)

14. **No sign-up flow** -- Landing page says "Invite-only" with a mailto link. No self-service registration. (Persona: 7)

15. **1 unlabeled button** -- One icon-only button lacks an `aria-label`, affecting screen reader users. (Persona: 10)

16. **Login page layout at ultrawide** -- Significant dead space on 2560px monitors. Content is a small centered box. (Persona: 17)

17. **No quick order entry on chart** -- Day traders want a BUY/SELL button directly on the chart view, not a separate order form. (Persona: 1)

18. **No onboarding tour** -- After first login, users are dropped on the dashboard with no guided walkthrough. (Persona: 7)

19. **Backtest buried in Pipeline tab** -- Backtesting is not discoverable from the main navigation. Users must click Pipeline, then scroll down past positions and strategy builder to find it. (Persona: 15)

20. **Activity feed not filterable** -- Cannot filter news vs pipeline events, or by ticker. (Persona: 16)

---

## Screenshots

All screenshots saved to `/Users/GK/Downloads/alphadesk/qa-screenshots/round9/`:

| File | Description |
|------|-------------|
| `full_dashboard.png` | Main dashboard with all sections |
| `view_trade.png` | Trade view with chart, watchlist, options |
| `view_pipeline.png` | Pipeline view with positions, backtest |
| `01_daytrader_dashboard.png` | Day trader perspective |
| `08_mobile_dashboard.png` | Mobile (375px) view |
| `08_mobile_nav.png` | Mobile navigation test |
| `07_newuser_landing.png` | Landing page (unauthenticated) |
| `17_ultrawide_dashboard.png` | Ultrawide (2560px) login page |
| `13_compliance.png` | Loading portfolio spinner issue |
| Plus 16 more persona-specific screenshots |

---

## Test Methodology

- 20 personas tested via Playwright (headless Chromium)
- Each persona simulated specific workflows matching their role
- Screenshots captured at each step
- Issues deduplicated and prioritized across all personas
- Security tests included auth bypass attempts, header checks, rate limiting, and token validation
