# AlphaDesk Iteration 18 Research: Path to 10/10

**Date:** 2026-04-12
**Method:** Full codebase audit (frontend, backend, iOS), prior QA review, competitive gap analysis
**Current Score:** ~7.5/10 (up from 6.5 at last evaluation)
**Target Score:** 10/10

---

## CURRENT STATE SUMMARY

AlphaDesk has 65+ features across web and iOS. The foundation is strong:

**What works well:**
- Dashboard passes the 3-second test (equity, P&L, regime, strategies visible instantly)
- 5 real trading strategies with MasterAgent risk gating
- Alpaca brokerage integration (paper + live)
- Command palette (Cmd+K), keyboard shortcuts, ticker tape
- 6-page web app: Dashboard, Trade, Analytics, Alerts, Pipeline, Reports
- iOS app with 11 feature modules (Portfolio, Trade, Strategies, Alerts, Chat, etc.)
- Options chain with Greeks, payoff diagram, multi-leg builder
- Backtest engine with transaction costs, benchmark comparison, walk-forward
- AI chat via Claude (supervisor + 11 specialist agents)
- P&L calendar heatmap, market movers, economic calendar, market breadth
- Export to CSV, share trades as images
- WebSocket live data feed, notification center
- Full legal pages (Terms, Privacy, Risk Disclosure)
- Accessibility: skip-to-content, sr-only labels, focus-visible, prefers-reduced-motion

**What was fixed since last evaluation:**
- React Query caching on all major queries (staleTime, refetchInterval)
- Trade page mobile responsive (tabbed layout below lg breakpoint)
- Multi-chart layout (1x1, 2x1, 1x2, 2x2)
- Order confirmation dialog
- Index sparklines endpoint
- Glow effects increased to 0.6 opacity
- Card hover glow increased to 0.12 opacity
- Welcome banner for first-time users
- Equity curve height increased to 120px
- Toast error system for API failures
- Trading mode badge in StatusStrip

---

## THE TOP 10 THINGS TO BUILD NEXT

Prioritized by: (Impact on user retention) x (Competitive differentiation) x (Feasibility)

---

### 1. REAL-TIME STREAMING QUOTES (WebSocket)

**Problem:** Every quote on the dashboard, watchlist, and trade page is fetched via REST polling. The WebSocket handler exists (`backend/api/websocket/handler.py`) but the frontend only uses it for connection status. Prices update at 30-60s intervals, not in real-time.

**Why it matters:** This is the single biggest gap vs. TradingView and Robinhood. A trader watching NVDA during earnings sees stale data for up to 60 seconds. In a professional terminal, prices must tick in real-time.

**What to build:**
- Push live quotes through the existing WebSocket connection
- Frontend: subscribe to symbols in the watchlist + selected chart
- Flash green/red on price change (the CSS animations `flash-profit`/`flash-loss` already exist but are unused)
- Update positions P&L in real-time (not polling)

**Effort:** Medium | **Impact:** Highest (makes the app feel "alive")

**Files involved:**
- `/backend/api/websocket/handler.py` -- add quote broadcasting
- `/backend/data/ingestion/alpaca_stream.py` -- pipe Alpaca stream to WS
- `/frontend/src/lib/providers.tsx` -- consume WS messages
- `/frontend/src/stores/market.ts` -- update quotes in store

---

### 2. SOCIAL SHARING + PORTFOLIO SHOWCASE

**Problem:** There is no way for a user to share their performance publicly. The ShareTrade button exists but only generates a static image of a single trade. There is no shareable portfolio page, no leaderboard, no public profile.

**Why it matters:** This is what would make AlphaDesk go viral. TradingView's social features drive their entire growth flywheel. A user who just made +15% on their PEAD strategy wants to flex. Give them a URL to share.

**What to build:**
- Public portfolio page at `/u/{username}` showing equity curve, strategy breakdown, monthly returns
- Shareable strategy performance cards (open graph meta for link previews)
- Optional: leaderboard of top-performing users (even if it is only the demo account at first)
- Social meta tags so shared links render rich previews on Twitter/Discord/iMessage

**Effort:** Large | **Impact:** Highest (viral growth mechanism)

---

### 3. WATCHLIST ALERTS + SMART NOTIFICATIONS

**Problem:** Price alerts are basic (above/below a price). There are no alerts for:
- Indicator crossovers (RSI crosses below 30)
- Volume spikes (3x average volume)
- Earnings dates (AAPL reports in 2 days)
- Strategy signals (PEAD just fired a BUY on MSFT)
- Position P&L thresholds (your NVDA position is down 5%)

The notification center exists but only shows system events. Alerts are a separate page with no push delivery.

**Why it matters:** Alerts are the #1 reason traders keep an app open. TradingView's alert system is their stickiest feature. AlphaDesk has the AI advantage -- Claude could generate natural-language alert summaries ("NVDA dropped 3% on high volume after Fed comments, your VRP strategy might want to close the put spread").

**What to build:**
- Indicator-based alerts (RSI, MACD crossover, Bollinger breach)
- Strategy signal alerts (push when pipeline generates a new signal)
- Earnings calendar alerts (pre-earnings warning for held positions)
- Push notifications to iOS app
- Email digest (daily summary of triggered alerts + P&L)

**Effort:** Large | **Impact:** High (retention + engagement)

**Files involved:**
- `/backend/api/routes/trades.py` -- alert types expansion
- `/frontend/src/app/(dashboard)/alerts/page.tsx` -- richer alert creation form
- `/ios/AlphaDesk/Features/Alerts/AlertsView.swift` -- push notification support

---

### 4. DARK/LIGHT THEME + THEME CUSTOMIZATION

**Problem:** Settings page says "Theme customization coming soon." The app is dark-only. While dark is correct for a trading terminal, there is no customization. The color system (`globals.css`) is well-architected with CSS custom properties, making theme support technically straightforward.

**Why it matters:** A hedge fund PM using AlphaDesk in a bright conference room wants light mode. A user who prefers green-on-black (Bloomberg style) or orange accents (TradingView style) cannot customize. Personalization drives ownership and stickiness.

**What to build:**
- Light theme CSS variables (already structured for easy swapping)
- Theme picker in Settings: Dark (default), Light, Bloomberg, High Contrast
- Accent color picker (primary color swap: blue, green, orange, purple)
- Persist preference in localStorage + sync to profile

**Effort:** Medium | **Impact:** Medium-High (retention, accessibility)

**Files involved:**
- `/frontend/src/app/globals.css` -- add `:root.light` and `:root.bloomberg` variants
- `/frontend/src/app/(dashboard)/settings/page.tsx` -- theme picker UI
- `/frontend/src/stores/ui.ts` -- persist theme preference

---

### 5. JOURNAL / TRADE NOTES

**Problem:** Trades have a `notes` field in the schema (`StrategyTrade.notes`) but there is no UI to write or read notes. The Reports page can export trades as CSV but there is no journaling workflow. Professional traders live in their journal -- it is how they improve.

**Why it matters:** Every serious trader journals. TraderSync and Tradervue charge $30-50/month just for journaling. AlphaDesk could offer this for free and capture a massive underserved market.

**What to build:**
- Trade journal page (new route `/journal`)
- After each trade closes, prompt to add notes: "What was your thesis? What would you do differently?"
- Auto-tag trades with strategy, outcome, sector, hold time
- Weekly/monthly review with AI-generated insights: "Your win rate on PEAD trades held >5 days is 72% vs. 45% for trades held <2 days"
- Screenshot annotation (attach chart screenshots to journal entries)

**Effort:** Large | **Impact:** High (differentiation, retention, education)

---

### 6. MULTI-TIMEFRAME ANALYSIS PANEL

**Problem:** The AnalysisPanel shows technical, fundamental, and sentiment scores as single-number gauges. There is no multi-timeframe view. A trader looking at AAPL on the daily chart cannot simultaneously see the weekly trend, the 4H momentum, and the 15m entry setup.

**Why it matters:** Multi-timeframe analysis is a core workflow for every technical trader. TradingView users create it manually with multi-chart layouts. AlphaDesk could automate it with a dedicated panel.

**What to build:**
- Multi-timeframe summary widget: show RSI, MACD, trend direction across 5m/1H/4H/D/W
- "Traffic light" system: green/yellow/red per timeframe per indicator
- Integration with the 2x2 chart layout (each chart could auto-set to a different timeframe)
- AI synthesis: "AAPL is bullish on daily (RSI 62, above 20 EMA) but overbought on weekly (RSI 74). Consider waiting for a pullback to $228 support."

**Effort:** Medium | **Impact:** Medium-High (power user feature)

**Files involved:**
- `/frontend/src/components/panels/AnalysisPanel.tsx` -- add MTF tab
- `/backend/api/routes/analysis.py` -- multi-timeframe endpoint

---

### 7. STRATEGY MARKETPLACE / TEMPLATES

**Problem:** The Strategy Builder lets users define rules in natural language ("Buy when RSI drops below 30") and Claude refines them. But there is no way to browse, clone, or share strategies. Each user starts from zero.

**Why it matters:** A marketplace of pre-built strategies (curated by AlphaDesk or shared by users) would dramatically lower the barrier to entry. New users could "Install" a strategy with one click and immediately start paper trading it.

**What to build:**
- Strategy template library: 20 curated strategies with descriptions, historical backtests, and risk profiles
- "Use this strategy" one-click activation
- Community strategy sharing (once social features exist)
- Strategy performance comparison chart (overlay 2-3 strategies)
- Categories: Momentum, Mean Reversion, Event-Driven, Options Income, etc.

**Effort:** Large | **Impact:** High (acquisition, activation)

---

### 8. FULL SETTINGS PAGE

**Problem:** The settings page at `/settings` is a set of 5 static info cards with no interactive controls. Users cannot change anything. Trading mode, API keys, notifications, appearance -- all say "contact admin" or "coming soon."

**Why it matters:** A settings page with zero controls feels unfinished. It actively hurts trust. Users expect to control their own experience.

**What to build:**
- API key management (enter/update Alpaca credentials)
- Notification preferences (toggle email, push, in-app per category)
- Trading mode toggle (paper/live with confirmation dialog)
- Default position sizing preferences
- Chart preferences (default timeframe, chart type, indicators)
- Account management (change password, sessions, 2FA)
- Data export/import (backup portfolio, import from another broker)

**Effort:** Medium | **Impact:** Medium (trust, completeness)

**Files involved:**
- `/frontend/src/app/(dashboard)/settings/page.tsx` -- full rewrite
- `/backend/api/routes/auth.py` -- password change endpoint
- `/backend/core/config.py` -- user-level settings storage

---

### 9. PORTFOLIO STRESS TESTING / SCENARIO ANALYSIS

**Problem:** The Risk Dashboard shows current metrics (drawdown, VaR, exposure) but has no forward-looking scenario analysis. The VaR endpoint returns `null` when there is insufficient history. There is no "what if SPY drops 10%" analysis.

**Why it matters:** This is what a hedge fund PM would demand first. Knowing your current drawdown is table stakes. Knowing how your portfolio would perform in a 2020-style crash, a 2022-style rate hike, or a sector rotation is the difference between a toy and a tool.

**What to build:**
- Scenario simulator: "What happens if SPY drops 10%?"
- Pre-built scenarios: 2008 Financial Crisis, 2020 COVID, 2022 Rate Hike, Black Monday
- Monte Carlo simulation: 10,000 paths over 30/90/252 days
- Factor sensitivity: show portfolio beta to SPY, QQQ, TLT, VIX, DXY
- Stress test table: scenario name | portfolio impact | worst position | recommended hedge

**Effort:** Large | **Impact:** High (institutional credibility, differentiation)

**Files involved:**
- `/backend/api/routes/risk.py` -- scenario + Monte Carlo endpoints
- `/frontend/src/app/(dashboard)/analytics/page.tsx` -- scenario analysis tab
- `/frontend/src/components/dashboard/RiskDashboard.tsx` -- stress test widget

---

### 10. ONBOARDING FLOW + INTERACTIVE TUTORIAL

**Problem:** The welcome banner exists ("Use Cmd+K to search symbols, ? for keyboard shortcuts") but there is no guided tour. A new user logs in and sees 15+ widgets, 6 nav items, and dozens of data points. It is overwhelming.

**Why it matters:** Onboarding is the #1 predictor of retention. A user who understands the 3 key workflows (Dashboard overview -> Trade page -> Pipeline automation) in their first 2 minutes will come back. A user who bounces off the complexity will not.

**What to build:**
- 5-step interactive tooltip tour: (1) "This is your portfolio value", (2) "Click any strategy card to dive deeper", (3) "Use Cmd+K to search any symbol", (4) "This is your AI pipeline -- it runs daily", (5) "Set alerts to never miss a move"
- Progressive disclosure: hide advanced panels (Risk, Analytics, Strategy Builder) until user completes basics
- "Quick Start" modal on first login with 3 paths: "I want to explore strategies", "I want to trade manually", "I want to automate everything"
- Achievement badges: "First trade placed", "First alert set", "Pipeline run completed"

**Effort:** Medium | **Impact:** High (activation, retention)

---

## ADDITIONAL FINDINGS (ISSUES OBSERVED IN CODEBASE)

### UX Friction

**A. generateSparkData still returns flat arrays.**
The `Sparkline.tsx` file's `generateSparkData()` function still returns `Array(count).fill(100)`. While the dashboard now has real index sparklines from the API, strategy cards that use `generateSparkData` as a fallback still show flat/dashed lines. The sparkline data comes from the backend strategy endpoint (`sparkline` field) but if it returns an empty array, the fallback is a flat line.

- File: `/frontend/src/components/dashboard/Sparkline.tsx:64-67`
- Fix: Remove `generateSparkData` entirely or generate a realistic seeded curve as fallback

**B. Options chain uses a demo data generator (`generateChain`).**
The `OptionsPanel.tsx` has a `generateChain()` function (line 37) that creates synthetic options data using a seeded RNG. While the `useOptionsChain` hook fetches real data, the component falls back to generated data. The seeded RNG produces implausible IV values and volumes.

- File: `/frontend/src/components/panels/OptionsPanel.tsx:37-95`
- Fix: Show a proper loading/empty state when real data is unavailable

**C. Chart panel has demo data fallback.**
`ChartPanel.tsx:44-81` has a `generateDemoOHLCV()` function that generates synthetic price data. When the Alpaca API returns data, it is used; otherwise, fake candles are shown. There is no indication to the user that they are seeing fake data.

- File: `/frontend/src/components/panels/ChartPanel.tsx:44-81`

**D. No confirmation on "Delete All" alerts.**
The alerts page has a "Delete All" button that fires immediately without a confirmation dialog. Destructive actions should require confirmation.

- File: `/frontend/src/app/(dashboard)/alerts/page.tsx:306-323`

### Missing Data

**E. Correlation matrix returns empty.**
The `/api/v1/risk/correlation` endpoint always returns an empty matrix (`strategies: [], matrix: [], pairs: []`) with the comment "No real strategy correlation data available." The StrategyCorrelation dashboard component renders but shows nothing useful.

- File: `/backend/api/routes/risk.py:172-183`

**F. VaR returns all nulls.**
The `/api/v1/risk/var` endpoint returns null for all VaR values with `method: "none"`. The risk dashboard widget shows "--" for VaR.

- File: `/backend/api/routes/risk.py:211-225`

**G. Sector exposure is hardcoded.**
The `/api/v1/risk/exposure` endpoint returns hardcoded sector allocations (Technology 28.5%, Healthcare 15.2%, etc.) regardless of actual positions.

- File: `/backend/api/routes/risk.py:186-208`

### Visual / UX Issues

**H. Settings page is non-functional.**
Every settings section says "Contact admin" or "coming soon." There are zero interactive controls. This is the weakest page in the app.

- File: `/frontend/src/app/(dashboard)/settings/page.tsx`

**I. StatusStrip overflow on narrow viewports.**
The StatusStrip has 5 sections (P&L, Regime, VIX, Connection, Trading Mode) side by side with no wrapping or responsive behavior. At 768px-1024px, the text truncates awkwardly.

- File: `/frontend/src/components/layout/StatusStrip.tsx`

**J. No loading state between page navigations.**
The `loading.tsx` and `template.tsx` files exist but the page transition animation is minimal. Navigating from Dashboard to Trade shows a brief white flash as the chart loads.

### Data Freshness

**K. Watchlist sparklines are generated, not real.**
The `WatchlistPanel.tsx:23-69` generates sparklines using a seeded RNG based on the symbol name. These are deterministic but fake -- they never change regardless of actual price movement.

- File: `/frontend/src/components/panels/WatchlistPanel.tsx:23-69`

**L. News timestamp is display-only.**
The news feed shows "Published at" timestamps but they come from the API. If the news API is slow or returns cached results, stale headlines appear current.

### Mobile Gaps (375px)

**M. Trade page mobile tabs work but Analysis tab is dense.**
The AnalysisPanel at 375px width shows the AI chat, score gauges, and position sizer in a narrow column. The gauges overlap at very narrow widths.

**N. Economic calendar rows overflow on mobile.**
The EconomicCalendar table has columns (Date, Time, Event, Impact, Previous, Forecast) that do not wrap. At 375px, horizontal scroll is required.

---

## WHAT WOULD MAKE A ROBINHOOD/TRADINGVIEW USER SWITCH?

1. **The AI edge.** No competitor has Claude AI integrated into every workflow. The supervisor agent, strategy builder, and natural-language analysis are genuinely unique. But they need to be more prominent -- a user who never clicks the chat tab never discovers the AI.

2. **Automated strategies.** Robinhood users trade manually. TradingView users chart manually. AlphaDesk's 5-strategy automated pipeline is a fundamentally different value proposition. But the pipeline page needs better visualization and the strategies need to show real-time signals.

3. **Everything in one place.** Robinhood has no backtesting, no options chain, no risk analytics. TradingView has no brokerage, no P&L calendar, no portfolio management. AlphaDesk has all of it. This all-in-one value needs to be communicated clearly on the landing page.

---

## WHAT WOULD A HEDGE FUND PM WANT?

1. **Stress testing** -- "Show me what happens to my book if rates go up 100bps" (see item #9)
2. **Factor attribution** -- "How much of my return came from beta vs. alpha?" (partially built but not exposed in UI)
3. **Execution analytics** -- "What was my average slippage? How much am I paying in spread?" (data exists in trade ledger but no UI)
4. **Audit trail** -- "Show me every decision the MasterAgent made and why" (pipeline history has this but it is buried)
5. **Risk limits dashboard** -- "What are my current utilizations vs. limits?" (MasterAgent has limits but no visualization)

---

## WHAT WOULD MAKE THIS GO VIRAL?

1. **Social portfolio sharing** (item #2) -- a shareable URL with your equity curve and strategy performance
2. **Strategy marketplace** (item #7) -- "Install this strategy with one click"
3. **AI-generated daily market brief** -- "Good morning. Here is what happened overnight and what your strategies are doing today." Delivered as a push notification.
4. **Public leaderboard** -- even with just paper trading accounts, gamification drives engagement
5. **Discord/Slack integration** -- post trade alerts and pipeline results to a channel

---

## THE #1 THING HOLDING IT BACK FROM 10/10

**The app feels like a dashboard, not a cockpit.**

The data is there. The strategies are there. The AI is there. But the user is a passive observer, not an active operator. There is no sense of urgency, no real-time pulse, no "something is happening right now."

Fixing this requires:
1. **Real-time streaming quotes** (item #1) -- prices must tick, not poll
2. **Push alerts on strategy signals** (item #3) -- the pipeline fires, the user should know instantly
3. **Live activity feed** -- not a static list of past events, but a scrolling feed of what is happening NOW (prices moving, alerts triggering, strategies signaling)

When a user opens AlphaDesk and sees prices ticking, alerts popping, and strategies actively working -- THAT is when the app goes from 7.5 to 10.

---

## PRIORITIZED SUMMARY

| Rank | Feature | Impact | Effort | Category |
|------|---------|--------|--------|----------|
| 1 | Real-time streaming quotes (WebSocket) | Highest | Medium | Core experience |
| 2 | Social sharing + portfolio showcase | Highest | Large | Viral growth |
| 3 | Smart notifications + indicator alerts | High | Large | Retention |
| 4 | Dark/Light theme + customization | Medium-High | Medium | Polish |
| 5 | Trade journal + notes | High | Large | Differentiation |
| 6 | Multi-timeframe analysis panel | Medium-High | Medium | Power users |
| 7 | Strategy marketplace / templates | High | Large | Acquisition |
| 8 | Full settings page (interactive) | Medium | Medium | Trust |
| 9 | Portfolio stress testing / scenarios | High | Large | Institutional |
| 10 | Onboarding flow + interactive tutorial | High | Medium | Activation |

---

## QUICK WINS (ship in a day)

1. Remove `generateSparkData` function and show empty state instead of fake flat lines
2. Add confirmation dialog to "Delete All" alerts button
3. Remove `generateChain` demo fallback in OptionsPanel (show loading/empty state)
4. Add `aria-label` attributes to remaining unlabeled icon buttons
5. Make StatusStrip responsive (hide Regime/VIX text on small screens, show icons only)
6. Compute real correlation matrix from strategy trade history
7. Compute real sector exposure from actual Alpaca positions
8. Add rel="noopener noreferrer" to external news links
9. Add loading skeleton to trade page chart area (currently shows pulse div)
10. Surface the AI chat more prominently (add a floating "Ask Claude" button on dashboard)

---

*Research conducted via full codebase audit of frontend (Next.js), backend (FastAPI), and iOS (SwiftUI) codebases. Cross-referenced with previous QA evaluations, competitive analysis, and trading domain expertise.*
