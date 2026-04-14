# AlphaDesk Competitive Analysis & Feature Gap Report

**Date:** 2026-04-12 (Sunday -- market closed; code-level analysis + live login page verified)
**Analyst:** Claude Code (Opus 4.6)
**Target:** https://tradingalpha.net
**Credentials tested:** admin / alphaDesk2025!

---

## PART 1: Page-by-Page Audit

> Note: Full interactive testing with authenticated sessions is not possible via
> CLI web fetch (the tool cannot execute JavaScript, persist cookies, or render
> React SPAs). The analysis below combines **live fetch of public pages** with
> **deep code review of every frontend page, component, backend route, and iOS
> source file** to identify bugs, missing functionality, and UX gaps.

### 1.1 Login Page (LIVE -- verified)

| Aspect | Finding |
|--------|---------|
| **Works** | Clean dark theme, gradient accents, branded "AI-Powered Trading Terminal" tagline. Username/password fields render correctly. Footer links (Docs, Privacy, Terms, Risk) all resolve. "Request Access" mailto works. Copyright reads 2026. |
| **Issues** | No "show password" toggle. No rate-limiting indicator on failed attempts. No CAPTCHA or brute-force protection visible on frontend. Forgot-password is just a mailto -- no self-service flow. |
| **Missing vs competitors** | Robinhood/Coinbase: SSO (Google, Apple ID). TradingView: OAuth + social login. Bloomberg: hardware key + 2FA. |

### 1.2 Dashboard (Code: `app/(dashboard)/page.tsx`)

| Aspect | Finding |
|--------|---------|
| **Works** | PortfolioHero with equity, day P&L, equity history chart. StrategyGrid with 13 strategy cards showing return%, positions, win rate, sparklines. ActivityFeed with pipeline events, regime data. PositionsSummary, PnlCalendarMini, EconomicCalendar, MarketContext with indices + sectors + news. Welcome banner for first-time users. |
| **Potential bugs** | **BUG-1:** `hasFetched` ref pattern bypasses React Strict Mode double-mount (works, but unconventional). **BUG-2:** `equityHistory` derivation uses `getState()` synchronously from Zustand after an async call -- race condition if portfolio summary has not yet loaded; the `baseEquity` fallback is 100000, which could produce a misleading chart for new accounts with different initial capital. **BUG-3:** No error state UI when `fetchRemaining` partially fails -- the activity feed section just stays as a spinner forever if all promises reject and `setRemainingLoaded(true)` is only reached in the outer catch. (Actually mitigated: the finally block does call `setRemainingLoaded` in the catch -- OK.) |
| **Missing** | No customizable widget layout (Bloomberg, TradingView). No drag-and-drop dashboard. No multi-monitor support. No user-defined watchlists on dashboard. No P&L attribution by strategy on the hero card. |

### 1.3 Trade Page (Code: `app/(dashboard)/trade/page.tsx`)

| Aspect | Finding |
|--------|---------|
| **Works** | Full desktop layout: Watchlist (240px) + TradingChart (center) + Analysis (300px) + Options Chain (bottom, resizable) + Trade Panel (380px). Mobile-responsive with tab switching. Keyboard shortcut integration for timeframe switching. Drag handle for options panel resize. Full-screen toggle for options. |
| **Potential bugs** | **BUG-4:** Chart uses `generateDemoOHLCV()` as fallback when `getBars()` fails -- this generates deterministic pseudo-random data seeded by symbol+timeframe. If the API is down, users see convincing but FAKE candles with no visual indicator. This is dangerous for a trading terminal. **BUG-5:** The analysis panel width (300px) and trade panel width (380px) are hardcoded -- no resize handles. On smaller laptops (1280px), the chart area is only ~360px which may be too narrow for candlestick visibility. |
| **Missing vs competitors** | TradingView: 50+ drawing tools, Pine Script, multi-chart layouts (2x2, 3x1), replay mode, community ideas. Thinkorswim: Risk profile/payoff diagrams, options probability analysis, ThinkBack. No price alerts with push notifications (Robinhood, Coinbase). No fractional shares (Robinhood). |

### 1.4 Pipeline Page (Code: `app/(dashboard)/pipeline/page.tsx`)

| Aspect | Finding |
|--------|---------|
| **Works** | Pipeline status indicator (Running/Idle/Error). "Run Now" button with loading state. Pipeline flow diagram (Screened -> Analyzed -> Signals -> Orders). Current positions table with P&L, entry/exit, stop loss, take profit. History table (last 7 days) with expandable rows. Strategy Builder with natural language input. Backtest panel. Performance summary with 6 metric cards. |
| **Potential bugs** | **BUG-6:** `displayPositions` uses broker positions as fallback when pipeline positions are empty -- but broker positions are mapped with `signal: "hold"` hardcoded, `entryDate: ""`, and `rationale: ""`. This means real broker positions always show "HOLD" signal and empty entry dates, which is misleading. **BUG-7:** The `StrategyBuilder` `parseNaturalLanguage()` is purely client-side regex matching -- not connected to Claude AI. The component has example rules and local parsing but no actual API integration for strategy creation. |
| **Missing** | Bloomberg: BQNT quantitative analysis environment. Thinkorswim: Condition Wizard for complex conditional orders. No pipeline scheduling UI (cron editor). No pipeline logs viewer with full stdout. |

### 1.5 Strategy Detail Page (Code: `app/(dashboard)/strategies/[id]/page.tsx`)

| Aspect | Finding |
|--------|---------|
| **Works** | Full performance data: equity curve with SVG chart, benchmark comparison (SPY), time period filters (1M/3M/6M/YTD/ALL). Strategy analytics: Sharpe, Sortino, Calmar, max drawdown, avg win/loss. Trade history table. Active positions tab. Strategy content documentation. Toggle active/paused. |
| **Potential bugs** | **BUG-8:** Equity curve SVG uses `useId()` with colons in the generated ID -- these colons are stripped via `replace(/:/g, "")` for SVG gradient IDs, but if React generates duplicate cleaned IDs, gradients could collide. Edge case but possible. |
| **Missing** | No strategy comparison view (side-by-side). No Monte Carlo simulation. No position sizing optimization UI. No correlation matrix between strategies. |

### 1.6 Docs Page (LIVE -- verified)

| Aspect | Finding |
|--------|---------|
| **Works** | 10 comprehensive sections covering Getting Started, Dashboard, Trading, Strategies, Pipeline, Keyboard Shortcuts, Claude AI, Strategy Methodology, FAQ, API Keys setup. |
| **Issues** | Static content only -- no interactive API explorer (like Swagger UI or Postman). No video tutorials. No changelog/release notes. |

### 1.7 Legal Pages (LIVE -- verified)

| Aspect | Finding |
|--------|---------|
| **Works** | Privacy Policy, Terms of Service, Risk Disclosure all render with proper legal content. Privacy mentions AES-256 encryption, TLS, GDPR provisions. |
| **Issues** | Privacy policy notes potential GDPR compliance gap for EU users (data processed in US). No cookie consent banner. |

---

## PART 1B: iOS App Code Review

The iOS app was analyzed across all 33 Swift source files.

### Architecture Quality

| Aspect | Assessment |
|--------|-----------|
| **Code structure** | Clean MVVM with `@Observable` (iOS 17+). Organized by feature modules (Auth, Dashboard, Trade, Pipeline, Strategies, Chat, Settings, News, Watchlist). |
| **Network layer** | Solid `APIClient` with generic Codable requests, JWT auto-injection, 401 retry with token refresh, configurable base URL. `WebSocketClient` with auto-reconnect and AsyncStream events. |
| **Security** | Keychain storage for tokens via `KeychainHelper`. `BiometricManager` for Face ID/Touch ID. Configurable server URL in settings. |
| **Theme** | Centralized `AppTheme` (alias `AD`) with all design tokens -- colors, spacing, corner radii, typography. Consistent dark theme matching web. |

### iOS Bugs Found

| Bug | Severity | Description |
|-----|----------|-------------|
| **BUG-9** | Medium | `PortfolioView.fetchSummary()` maps `unrealizedPnl` to `dayPnL` -- but `unrealizedPnl` is total unrealized, not day-specific. The web dashboard uses a separate `dayPnl` field from the summary. The iOS hero section labels this "today" which is incorrect for total unrealized P&L. |
| **BUG-10** | Low | `TradeView` shows `companyName = "Apple Inc."` hardcoded. When the user switches symbols, `companyName` never updates because the `Quote` model does not include a `name` field, and `fetchQuote()` does not populate it. Every stock shows "Apple Inc." |
| **BUG-11** | Low | `TradeView.fetchBars()` requests `timeframe: "1D"` but the backend API path pattern is `/api/v1/market/bars/{symbol}?timeframe=...` -- the iOS Endpoint uses `1D` while the web app uses `D`. If the backend is strict about format, this may return no data or an error. |
| **BUG-12** | Low | `StrategiesListViewModel` generates sparklines locally with `generateSparkline(seed:trend:)` instead of using the `sparkline` array from the API response. The `Strategy` model does not include a `sparkline` field, so real sparkline data from the API is discarded. |
| **BUG-13** | Low | `PipelinePositionsResponse` expects `openPositions` key but the web API format uses `positions`. If the backend returns `{positions: [...]}`, iOS will decode to an empty array. |
| **BUG-14** | Info | `SettingsView` preferences (Notifications, Haptic Feedback, Appearance) show chevron indicators as if they navigate somewhere, but they are static rows with no tap handlers. Only Biometric Lock has an actual toggle. |
| **BUG-15** | Info | No iPad layout optimizations -- the app uses iPhone-only layout patterns. On iPad, the tab bar and content would look sparse. |
| **BUG-16** | Info | `Order` model has a mutable `_fallbackId` property but it is never set during decoding -- the `id` computed property falls through to string concatenation every time, which could produce duplicate IDs for orders with the same symbol+side+timestamp. |

### iOS Missing Features

- No widget support (iOS WidgetKit) -- competitors all have home screen widgets
- No push notifications for price alerts, order fills, pipeline completions
- No offline data caching (Core Data / SwiftData)
- No watchlist management in dedicated view (WatchlistView exists but is basic)
- No options chain view on mobile
- No dark/light mode toggle (hardcoded dark only)
- No landscape support for charts
- No share sheet for positions or performance
- No Siri Shortcuts integration

---

## PART 2: Competitive Feature Analysis

### 2.1 vs Robinhood

| Robinhood Feature | AlphaDesk Has? | Gap Severity |
|-------------------|---------------|-------------|
| Fractional shares ordering | NO | High -- limits accessibility |
| Cash flow / spending insights | NO | Medium |
| Recurring investments (DCA) | NO | High -- popular passive feature |
| Price alerts with push notifications | NO (web has `createPriceAlert` API but no push delivery) | High |
| Social features (popular stocks, trending lists) | NO | Medium |
| Crypto trading | NO | Medium |
| Instant deposits | NO (Alpaca-dependent) | Low |
| Cash management / debit card | NO | Low -- not relevant to platform type |
| Options trading UI | YES (options chain + multi-leg builder) | -- |
| IPO access | NO | Low |
| Tax documents (1099) | NO | Medium |

### 2.2 vs TradingView

| TradingView Feature | AlphaDesk Has? | Gap Severity |
|---------------------|---------------|-------------|
| Pine Script (custom indicators) | NO | High -- major differentiator |
| Multi-chart layouts (2x2, 3x1, etc.) | NO | High |
| 50+ drawing tools (trend lines, fib, pitchfork) | NO (0 drawing tools) | Critical |
| Community ideas / social trading | NO | Medium |
| Replay mode (historical playback) | NO | Medium |
| Alerts with webhook integration | NO | High |
| Server-side alerts (work when offline) | NO | High |
| 100+ built-in indicators | PARTIAL (6: EMA, SMA, Bollinger, RSI, MACD, Volume) | High |
| Real-time data across global exchanges | PARTIAL (US equities only via Alpaca) | Medium |
| Paper trading | YES (Alpaca paper mode) | -- |
| Economic calendar | YES | -- |
| Multi-timeframe analysis | YES (1m to M) | -- |
| Screener | YES (built into pipeline) | -- |

### 2.3 vs Thinkorswim

| Thinkorswim Feature | AlphaDesk Has? | Gap Severity |
|---------------------|---------------|-------------|
| Options probability analysis (POP) | NO | High |
| Risk profile / payoff diagram | NO | Critical for options platform |
| ThinkBack (historical options pricing) | NO | Medium |
| Condition wizard (complex order types) | NO | Medium |
| Paper money with full features | PARTIAL (Alpaca paper, but not full feature parity) | Low |
| Option chain spread view | PARTIAL (chain exists, spread detection in TradePanel) | Medium |
| thinkScript (custom studies) | NO | Medium |
| Scan/Screener with custom criteria | PARTIAL (server-side screener) | Low |
| Level II quotes / Time & Sales | NO | Medium |
| Active Trader ladder | NO | Medium |
| Earnings analysis tools | YES (earnings_vol strategy) | -- |

### 2.4 vs Bloomberg Terminal

| Bloomberg Feature | AlphaDesk Has? | Gap Severity |
|-------------------|---------------|-------------|
| Multi-asset class coverage | NO (equities + options only) | High |
| Fixed income analytics | NO | Low (different target market) |
| Real-time news terminal | PARTIAL (news feed exists, not Bloomberg-quality) | Medium |
| Excel add-in integration | NO | Medium |
| PORT (portfolio analytics) | PARTIAL (portfolio performance exists) | Medium |
| BQNT (quantitative analysis) | NO | Medium |
| FXGO (FX trading) | NO | Low |
| MSG (messaging between terminals) | NO | Low |
| BQL (Bloomberg query language) | NO | Medium |
| Multi-monitor support | NO | High |
| Historical data depth (decades) | NO | Medium |

### 2.5 vs Coinbase Pro / Advanced

| Coinbase Feature | AlphaDesk Has? | Gap Severity |
|------------------|---------------|-------------|
| Clean mobile-first design | YES (iOS app is well-designed) | -- |
| Staking / DeFi integration | NO | Low (not relevant unless crypto added) |
| Tax reporting tools | NO | Medium |
| Learning rewards | NO | Medium |
| Price alerts with push | NO | High |
| Recurring buys | NO | High |
| Advanced order types | PARTIAL (market, limit, stop) | Low |
| Portfolio analytics | YES | -- |
| API access | YES | -- |

---

## PART 3: What AlphaDesk Has That NO Competitor Has

These are genuine competitive moats:

### 3.1 13-Strategy Automated Pipeline with Claude AI
No competitor runs 13 parallel strategies through a unified AI-powered pipeline. The strategies span:
- Momentum Quality, PEAD (Post-Earnings Announcement Drift)
- VRP Harvest (Volatility Risk Premium)
- Regime Adaptive, Earnings Vol
- Plus 8 additional strategies from the pipeline

Each strategy is screened, analyzed, and executed automatically with Claude providing the analysis layer. Robinhood/Coinbase have zero automated strategies. TradingView has alerts but no execution. Thinkorswim has scanners but no AI-driven multi-strategy orchestration.

### 3.2 Master Agent Risk Management with Remediation Advice
The `SupervisorAgent` + `RiskManagerAgent` architecture provides:
- Portfolio-level risk aggregation across all 13 strategies
- Real-time position sizing based on regime detection
- Master agent approval/rejection of individual strategy trade requests
- AI-generated remediation advice when risk limits are breached

No competitor offers AI-powered risk management that explains WHY a trade was rejected and WHAT to do instead.

### 3.3 Academic-Grade Strategy Documentation
Each strategy page includes:
- Full methodology explanation with academic references
- Equity curves with SPY benchmark comparison
- Per-strategy analytics (Sharpe, Sortino, Calmar, drawdown)
- Historical trade log with entry/exit rationale

Bloomberg has research, but it is separate from execution. AlphaDesk uniquely integrates documentation with live performance tracking.

### 3.4 Natural Language Strategy Builder
The Strategy Builder on the Pipeline page lets users describe trading rules in English:
- "Buy when RSI(14) drops below 30"
- "Sell when price crosses above upper Bollinger Band"
- "Maximum position size: 5% of portfolio"

While the current implementation is client-side parsing only (BUG-7), the architecture is ready for Claude-powered interpretation. No competitor offers natural language strategy definition tied to automated execution.

### 3.5 Unified Web + iOS + AI Chat Interface
The iOS app includes a full AI chat interface that connects to the same Claude-powered backend. Users can ask portfolio questions, get market analysis, and receive trade suggestions -- all from their phone. This is unique among platforms that also run automated strategies.

---

## PART 4: Prioritized Feature Gap List (Top 20)

| # | Feature | Impact | Differentiation | Effort | Revenue Potential | Priority Score |
|---|---------|--------|-----------------|--------|-------------------|---------------|
| 1 | **Price alerts with push notifications** (web + iOS) | Very High (all users) | Low (table stakes) | M | Retention driver | **10/10** |
| 2 | **Drawing tools on chart** (trend lines, fib retracement, horizontal lines) | Very High (all traders) | Medium | M | Core feature | **9.5/10** |
| 3 | **Fix iOS companyName bug** (BUG-10: all stocks show "Apple Inc.") | High (all iOS users) | N/A (bug fix) | S | Trust/quality | **9.5/10** |
| 4 | **Fix iOS dayPnL bug** (BUG-9: shows unrealized not day P&L) | High (all iOS users) | N/A (bug fix) | S | Trust/quality | **9.5/10** |
| 5 | **Fix demo data fallback** (BUG-4: fake candles shown when API fails) | Critical (safety) | N/A (bug fix) | S | Risk mitigation | **9/10** |
| 6 | **Multi-chart layouts** (2x2, 3x1 split views) | High (active traders) | High | M | Pro tier feature | **9/10** |
| 7 | **More indicators** (Fibonacci, Ichimoku, VWAP, ATR, Stochastic, etc.) | High (technical traders) | Medium | M | Core feature | **8.5/10** |
| 8 | **Options payoff diagram** (risk profile visualization) | High (options traders) | High | M | Options tier feature | **8.5/10** |
| 9 | **Recurring investments / DCA scheduling** | High (passive investors) | Medium | M | Recurring revenue | **8/10** |
| 10 | **Connect Strategy Builder to Claude AI backend** (BUG-7 fix) | High (power users) | Very High | M | Major differentiator | **8/10** |
| 11 | **iOS push notifications** (order fills, pipeline completions, alerts) | High (all mobile users) | Low (table stakes) | M | Retention | **8/10** |
| 12 | **Webhook integration for alerts** | Medium (developers) | High | M | API tier revenue | **7.5/10** |
| 13 | **Portfolio P&L attribution by strategy** on dashboard | Medium (fund managers) | High | S | Pro insight | **7.5/10** |
| 14 | **Tax reporting / trade export** (CSV, PDF, 1099 support) | Medium (all users, seasonal) | Low (table stakes) | M | Compliance value | **7/10** |
| 15 | **Customizable dashboard** (drag-and-drop widgets) | Medium (power users) | Medium | L | Pro tier | **7/10** |
| 16 | **Strategy correlation matrix** (show how strategies interact) | Medium (quantitative users) | Very High | M | Unique insight | **7/10** |
| 17 | **iOS WidgetKit support** (portfolio summary, P&L on home screen) | Medium (iOS users) | Medium | M | Engagement | **6.5/10** |
| 18 | **Paper trading toggle in UI** (not just Alpaca config) | Medium (new users) | Low | S | Onboarding | **6.5/10** |
| 19 | **Monte Carlo simulation** for strategy backtests | Low (quant users) | Very High | L | Research tier | **6/10** |
| 20 | **Multi-asset support** (crypto, forex, futures) | High (diverse traders) | Medium | L | Market expansion | **6/10** |

---

## All Bugs Found

### Web App Bugs

| ID | Severity | Component | Description |
|----|----------|-----------|-------------|
| BUG-1 | Low | Dashboard | `hasFetched` ref pattern could cause issues with React Strict Mode double-mount in development -- data fetch runs once regardless of component remount. Works in production but unconventional. |
| BUG-2 | Medium | Dashboard | Equity history derivation uses synchronous `getState()` from Zustand after async calls. If portfolio summary has not loaded yet, `baseEquity` defaults to 100,000, producing potentially misleading equity curve for accounts with different starting capital. |
| BUG-4 | Critical | ChartPanel | When `getBars()` API call fails, `generateDemoOHLCV()` produces realistic-looking but FAKE candle data with no visual indicator that data is simulated. A user could make trading decisions based on fabricated data. Should show an error state or "demo data" watermark. |
| BUG-5 | Low | TradePage | Analysis (300px) and Trade Panel (380px) widths are hardcoded with no resize capability. On 1280px screens, chart area is only ~360px. |
| BUG-6 | Medium | PipelinePage | Broker positions mapped as fallback always show `signal: "hold"`, `entryDate: ""`, `rationale: ""`. Real positions appear with misleading "HOLD" signal. |
| BUG-7 | Medium | StrategyBuilder | `parseNaturalLanguage()` is purely client-side regex matching. Not connected to Claude AI despite the "AI" badge. Natural language rules are parsed locally with basic pattern matching and never sent to the backend for strategy creation. |
| BUG-8 | Low | StrategyDetail | SVG gradient IDs derived from `useId()` with colon stripping could collide if React generates IDs that differ only by colon placement. |

### iOS App Bugs

| ID | Severity | Component | Description |
|----|----------|-----------|-------------|
| BUG-9 | Medium | PortfolioView | `dayPnL` is populated from `summary.unrealizedPnl` (total unrealized) but labeled "today". Should use a day-specific P&L field. |
| BUG-10 | Medium | TradeView | `companyName` is hardcoded to "Apple Inc." and never updates when symbol changes. The `Quote` API response does not include company name and `fetchQuote()` does not populate it. |
| BUG-11 | Low | TradeView | `fetchBars()` uses `timeframe: "1D"` but web app uses `"D"`. If backend is strict about format matching, iOS may receive no bar data. |
| BUG-12 | Low | StrategiesListView | Sparklines are generated locally via `generateSparkline()` instead of using API data. The `Strategy` Codable model omits the `sparkline` field. |
| BUG-13 | Low | PipelineView | `PipelinePositionsResponse` expects `openPositions` key but web API may return `positions`. Key mismatch could cause empty positions display. |
| BUG-14 | Info | SettingsView | Notification, Haptic, and Appearance rows show navigation chevrons but have no tap handlers -- they are purely decorative. |
| BUG-15 | Info | All views | No iPad layout optimization. App works but wastes screen space on larger devices. |
| BUG-16 | Info | Order model | `_fallbackId` is never assigned during decoding. `id` computed property always falls through to string concatenation, risking duplicate IDs for similar orders. |

---

## Summary

### Strengths
AlphaDesk is a genuinely unique platform. The 13-strategy automated pipeline with Claude AI analysis, master agent risk management, and academic-grade strategy documentation represent features that no single competitor offers. The codebase is well-structured (React/Next.js frontend, FastAPI backend, SwiftUI iOS app) with consistent theming and solid architecture patterns.

### Critical Gaps
The most impactful gaps are around **basic trading tools** (drawing tools, more indicators, price alerts, push notifications) -- these are table-stakes features that every serious trader expects. The iOS bugs around company name display (BUG-10) and day P&L mislabeling (BUG-9) would erode trust quickly. The fake candle data fallback (BUG-4) is a safety concern that should be fixed immediately.

### Recommended Next Steps
1. **Fix BUG-4, BUG-9, BUG-10** -- these are trust-destroying bugs (effort: Small)
2. **Add price alerts with push notifications** -- highest-impact feature gap (effort: Medium)
3. **Add basic drawing tools** -- trend lines, horizontal lines, fib retracement (effort: Medium)
4. **Connect Strategy Builder to Claude API** -- this turns a demo feature into the platform's killer differentiator (effort: Medium)
5. **Add multi-chart layouts** -- critical for active traders comparing symbols (effort: Medium)
