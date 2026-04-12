# AlphaDesk Final Trading Product Rating

**Reviewer**: Quantitative Trader / Portfolio Manager  
**Date**: April 10, 2026  
**URL**: https://tradingalpha.net  
**Method**: Playwright automated navigation of every feature, visual screenshot review, data integrity cross-checks  
**Evidence**: 26 screenshots in `/qa-screenshots/final-rating/`

---

## Test Summary

| Metric | Value |
|--------|-------|
| Total automated checks | 63 |
| PASS | 58 (92%) |
| WARN | 5 (8%) |
| CRITICAL | 0 |
| Console errors | 0 |
| Network failures | 0 |
| Average page load | ~4.2s |

---

## Category Ratings (1-10)

### 1. Dashboard Value (3-Second Test) -- 8/10

The dashboard passes the three-second test convincingly. On load you immediately see:

- **$100,061.68** portfolio value front and center, large green font
- Equity curve trending upward in a clean sparkline
- **12/12 strategies** in a card grid, each with sparkline, return %, status badge (Active/Paused), and position count
- Non-zero returns displayed across multiple strategies (17 data points with real percentages)
- Market regime label ("Bull - Low Volatility"), S&P/VIX context bar
- P&L calendar heatmap for April with green/red day cells and cumulative +$1,154 shown
- Activity feed with pipeline events, regime changes, and market news
- Economic calendar (Non-Farm Payrolls, CPI, FOMC, Jobless Claims) with dates
- Sector breakdown and allocation donut chart
- Open positions table (MRK visible with entry, current, P&L)

**What works**: Information density is high without feeling cluttered. The dark theme with green/red accents is Bloomberg-influenced. You can glance and know regime, P&L, and which strategies are running. This is legitimately better than what most retail platforms show on their home screens.

**Shortcomings**: The "Day P&L" reads $0.00, which should show the intraday change or be hidden if markets are closed. Portfolio shows $0.00 for day P&L despite having open positions -- this is misleading. The dashboard does not scroll to reveal additional content beyond the initial viewport, suggesting the bottom strategies (Pairs Trading, Dividend Capture, Sector Rotation, Gap Fill) are partially cut off and require scrolling.

---

### 2. Trading Workflow (Idea to Order) -- 7.5/10

The trade page is a well-designed single-screen terminal layout:

- **Left**: Watchlist panel with 9 symbols (AAPL, MSFT, SPY, GOOGL, AMZN, NVDA, TSLA, META, QQQ) showing live prices and change percentages. Search bar with filter/screener toggle at top.
- **Center**: Full candlestick chart with volume bars. Timeframe selectors (1m, 5m, 15m, 1H, 4H). Drawing tools toolbar (Horizontal Line, Trendline, Fibonacci retracement). Chart type switching. BUY/SELL buttons overlaid on chart at current price. Price alert button in toolbar.
- **Right**: Analysis panel with tabs for Technical, Fundamental, Sentiment, Chat (Claude AI), and Order. The Technical tab shows momentum, resistance/support levels. Fundamental tab shows P/E, ROE, PEG, margins. Sentiment tab shows news items and sentiment gauge. Order tab shows Market/Limit selector, quantity input, and a green "Buy 10 AAPL @ Market" action button.
- **Bottom**: Options chain with calls/puts, strikes, Greeks (Delta, IV, Theta), DTE, and expiration date selector.

**Workflow tested**: Click AAPL in watchlist -> chart updates -> review Technical tab -> check Sentiment tab -> switch to Order tab -> configure Market order, 10 shares -> "Buy 10 AAPL @ Market" button ready. This is a clean idea-to-execution flow.

**Drawing tools verified**: Horizontal line placement works -- clicked toolbar button, clicked on chart, line appeared at price level with tooltip. Trendline and Fibonacci listed in toolbar.

**What works**: The single-screen layout keeps everything visible without tab switching. Symbol selection propagates to chart, analysis, and options chain simultaneously. The order entry is contextual (shows the selected symbol). Chart quality with volume bars is professional.

**Shortcomings**: No stop-loss or take-profit fields in the order form -- you can set Market or Limit, quantity, but no bracket orders. No trailing stop. The screener is present as a mode toggle but not a full multi-criteria scanner like TradingView's. No keyboard shortcuts visible for rapid order entry. The "Chat" tab (Claude AI) shows an input field but the panel is mostly blank until you type -- could pre-populate with an AI summary.

---

### 3. Data Quality -- 6.5/10

- **Equity prices**: Real, current prices for all watchlist symbols. AAPL at $260.43, SPY at $668.97/$671.27 -- these are plausible current-day values.
- **OHLCV data**: High, Low, Volume all present on chart and in data bar. Candlestick bodies and wicks render correctly.
- **Bid/Ask spread**: Present and visible, suggesting real L1 data feed.
- **Technical indicators**: RSI, MACD available. Resistance/Support levels shown in the Technical tab.
- **Fundamentals**: P/E, ROE, PEG ratio, margins visible per symbol. Different values per symbol (verified AAPL vs MSFT vs NVDA show different data).
- **Cross-symbol validation**: Chart panels confirmed different per symbol -- not template data.

**Issues found**:
- **37 instances of $0.01 in options chain** -- deep OTM puts all show $0.01, which could be real (penny options exist) but the density suggests many are placeholder/stale. A live options feed would show varied penny prices or $0.00.
- **Sentiment news appears templated** -- "Analysts raise price target following earnings beat" may be reused across symbols. Real sentiment feeds should show different headlines per ticker.
- **Strategy returns mostly show +0.00%** on the detail pages despite the dashboard showing non-zero sparklines. PEAD shows +0.00% ($123.04 total return) on its detail page while the sparkline on the dashboard shows an upward trend. This is a data consistency issue.
- No real-time WebSocket price streaming visible -- prices appear to be snapshot-based, not streaming tick-by-tick.

---

### 4. Portfolio View -- 7/10

The portfolio view is integrated into the dashboard:

- Portfolio value $100,061.68 displayed prominently
- Open Positions table shows MRK with entry price ($131.09), current price ($131.41), shares (63), P&L ($0.49), max P&L, min P&L, entry date
- P&L Calendar heatmap showing daily returns for April
- Allocation donut chart
- Sector breakdown

**What works**: The P&L calendar is a standout feature -- seeing daily performance as a heatmap is something even Bloomberg charges for separately. Positions table is clean and shows key fields.

**Shortcomings**: Only 1 open position (MRK) visible -- with 12 strategies supposedly running, there should be more positions or a clear explanation of why most are flat. Day P&L shows $0.00 which is inconsistent with having a position that has unrealized P&L. No portfolio-level Greeks aggregate. No correlation matrix. No sector exposure heat map relative to benchmark. No margin utilization display.

---

### 5. Strategy Suite (12 Strategies) -- 8/10

All 12 strategies are present in the grid and navigable:

1. **Momentum + Quality** -- Cross-sectional momentum with quality screen
2. **PEAD** -- Post-Earnings Announcement Drift
3. **VRP Harvesting** -- Systematic volatility risk premium (short options)
4. **Earnings Vol** -- Earnings volatility premium capture
5. **Regime Adaptive** -- HMM-based regime detection for allocation
6. **Claude Alpha** -- AI-driven alpha generation using Claude
7. **Mean Reversion** -- Statistical mean reversion
8. **VCP Breakout** -- Volatility Contraction Pattern breakouts
9. **Pairs Trading** -- Statistical arbitrage pairs
10. **Dividend Capture** -- Ex-dividend capture strategy
11. **Sector Rotation** -- Sector momentum rotation
12. **Gap Fill** -- Overnight gap fill intraday

**What works**: This is an impressive breadth of strategies for a single platform. Each has an academic thesis, parameter documentation, universe definition, and regime notes. The strategy detail pages include About, Positions, Sector Exposure, Correlation, and Analytics tabs. Time-period filters (1M, 3M, 6M, YTD, ALL) on equity curves. Active/Paused toggle per strategy. This is more like a multi-strategy pod setup than a retail app.

**Shortcomings**: Most strategies show +0.00% total return and "Awaiting data" for their equity curves on the detail page, despite the dashboard sparklines showing upward trends. This disconnect between dashboard and detail page suggests the strategies are architecturally defined but not yet producing live signals at scale. Only PEAD appears to have a real equity curve. The other strategies lack trade history entries. Without live P&L flowing through, this is more of a framework than a proven system.

---

### 6. Pipeline Transparency -- 6/10

The pipeline page shows:

- Current Positions table (same MRK position)
- "Today's Pipeline Run" section with zero counts across columns
- Strategy Builder section with NLP input and rule cards
- Backtesting section
- History (Last 7 Days) section

**What works**: The concept of showing the pipeline stages (Screened -> Analyzed -> Signals -> Orders) is excellent for a quant platform. The Strategy Builder NLP input and the inline backtester are genuinely useful features if they work. The pipeline history provides an audit trail.

**Shortcomings**: The pipeline flow visualization did not render the stage counts (all showed 0). "Today's Pipeline Run" shows zero across all stages -- either the pipeline has not run today or the visualization is broken. For a quant trader, seeing "0 screened, 0 analyzed, 0 signals, 0 orders" every day would be concerning. The Strategy Builder tab wasn't found as a separate clickable tab (it appears inline on the page but the automated test couldn't locate the tab button). Pipeline transparency is the core differentiator claim, but the empty pipeline runs undermine confidence.

---

### 7. Options Chain -- 6/10

The options chain is visible at the bottom of the trade page:

- Calls and Puts displayed in a dual-column layout
- Strikes listed with prices
- Greeks present: Delta, IV, Theta
- DTE (Days to Expiration) shown
- Expiration date selector with multiple dates

**What works**: Having an integrated options chain on the same page as the equity chart is a good workflow -- no separate window needed. Greeks are displayed. Multiple expirations selectable.

**Shortcomings**: 37 instances of $0.01 pricing across the chain -- many OTM options appear to have placeholder prices. No Gamma or Vega displayed (only Delta, IV, Theta). No options P&L calculator or strategy builder (covered call, iron condor, etc.). No implied volatility surface or skew visualization. No volume/open interest columns visible. Compared to Thinkorswim's options chain, this is bare-minimum. You cannot construct multi-leg strategies. No probability analysis.

---

### 8. AI Features (Strategy Builder, Claude Analysis) -- 6.5/10

**Strategy Builder NLP**:
- Accepts natural language rules like "Buy when RSI(14) drops below 30"
- Parses into structured rule cards showing Action (BUY), Indicator (RSI), Operator, Value
- "AI Refine" button present for Claude-powered strategy refinement
- Multiple rules can be stacked

**Claude Chat Tab**:
- Available on the trade page as a tab in the analysis panel
- Shows a text input for asking Claude about the selected symbol
- Panel is empty by default (no proactive analysis summary)

**Claude Alpha Strategy**:
- A dedicated strategy that uses Claude for position sizing and entry signals
- Has its own detail page with thesis documentation
- Described as combining technical and fundamental factors via AI

**What works**: The NLP strategy builder is a genuinely novel feature -- typing "Buy when RSI drops below 30" and having it parsed into a structured rule is impressive UX. The AI Refine button suggests Claude can suggest improvements to user-defined strategies. Having a Claude chat tab alongside technical/fundamental analysis is a good integration point.

**Shortcomings**: The Chat tab is empty until the user types -- there should be a pre-generated AI briefing for the selected symbol (e.g., "AAPL: Sentiment neutral, RSI at 52, approaching resistance at $265, earnings in 18 days"). The AI Refine button was present but the actual refinement output was not captured (may require API key configuration). Claude Alpha strategy shows +0.00% return -- the AI strategy hasn't generated meaningful alpha yet. No evidence of Claude generating real-time trade signals that flow through the pipeline.

---

### 9. Backtesting -- 5.5/10

The backtest panel is embedded in the pipeline page:

- Symbol input (defaulted to SPY)
- Fast SMA and Slow SMA period inputs
- Initial Capital field
- "Run Backtest" button
- Results show: equity curve SVG, but Total Return metric did not display in the structured output
- After running: showed -$153.30 return, 0% win rate, -2.6% drawdown, -0.01 Sharpe, 1 trade

**What works**: The backtester actually runs -- it fetches real OHLCV data for SPY, runs an SMA crossover strategy, and produces an equity curve. The computation is client-side using real bar data from the API. Sharpe ratio and drawdown metrics are calculated.

**Shortcomings**: Only supports SMA crossover -- no custom strategy backtesting, no indicator combinations, no entry/exit rule builder integration with the Strategy Builder. The backtest produced only 1 trade on SPY, which suggests the lookback period is too short or the parameters need tuning. No benchmark comparison (SPY vs strategy). No trade-by-trade log. No commission/slippage modeling. No Monte Carlo simulation. No walk-forward analysis. Compared to QuantConnect, Backtrader, or even TradingView's Pine Script backtester, this is extremely basic. A quant trader would need at minimum: custom indicator support, transaction cost modeling, multiple strategy types, and statistical significance testing.

---

### 10. Competitive Position (vs TradingView Free / Thinkorswim) -- 6.5/10

| Feature | AlphaDesk | TradingView Free | Thinkorswim |
|---------|-----------|-------------------|-------------|
| Charting | Good candlestick + volume, 5 timeframes, drawing tools | Excellent, 100+ indicators, 8 chart types, multi-chart | Excellent, fully customizable |
| Watchlist | 9 symbols, live prices | Up to 30, streaming | Unlimited, streaming |
| Options | Basic chain, 3 Greeks | Limited (Pro only) | Full chain, all Greeks, strategy builder |
| Order Entry | Market/Limit, basic | Paper trading only (free) | Full suite, OCO, bracket, conditional |
| Backtesting | SMA crossover only | Pine Script (powerful) | thinkScript (powerful) |
| AI/NLP | Strategy Builder, Claude chat | None | None |
| Multi-Strategy | 12 strategies, pipeline | None (charting only) | Strategy scanning, no multi-strat |
| Price | N/A (private) | Free / $12.95-$59.95/mo | Free with TD account |
| Data Feed | Snapshot-based | Real-time (delayed on free) | Real-time streaming |
| Mobile | iOS app exists | Excellent mobile | Good mobile |

**Where AlphaDesk wins**: The multi-strategy pod concept with regime-aware allocation, NLP strategy builder, and Claude AI integration are unique. No free or mid-tier platform offers 12 quantitative strategies managed from a single dashboard. The pipeline transparency concept (seeing the flow from screener to order) is institutional-grade thinking in a retail package.

**Where AlphaDesk loses**: Charting depth, indicator library, backtesting power, options analysis, and data feed quality all lag behind both TradingView and Thinkorswim. A quant who needs to test a custom mean-reversion strategy with transaction costs and walk-forward validation cannot do it here. A trader who needs bracket orders with OCO triggers cannot do it here.

---

## Score Summary

| # | Category | Score |
|---|----------|-------|
| 1 | Dashboard Value (3-Second Test) | **8/10** |
| 2 | Trading Workflow (Idea to Order) | **7.5/10** |
| 3 | Data Quality | **6.5/10** |
| 4 | Portfolio View | **7/10** |
| 5 | Strategy Suite (12 Strategies) | **8/10** |
| 6 | Pipeline Transparency | **6/10** |
| 7 | Options Chain | **6/10** |
| 8 | AI Features (Strategy Builder, Claude) | **6.5/10** |
| 9 | Backtesting | **5.5/10** |
| 10 | Competitive Position | **6.5/10** |
| | **OVERALL** | **6.8/10** |

---

## Top 5 Shortcomings

### 1. Backtesting is a toy (5.5/10)
The SMA-crossover-only backtester produced 1 trade on SPY and returned -$153. A quantitative trader needs custom indicators, transaction cost modeling, walk-forward validation, and statistical significance testing. Without these, the platform cannot be used for strategy development -- only strategy monitoring. This is the single biggest gap for the target user persona.

### 2. Pipeline runs are empty -- the engine is not firing (6/10)
Every pipeline stage showed 0 today. Twelve strategies are defined but only one position (MRK, 63 shares) exists. The architecture is impressive but the system is not generating daily signals. For a quant PM, a pipeline that never fires is like a factory with no raw materials. The dashboard sparklines imply activity that the pipeline page contradicts.

### 3. Strategy detail pages contradict the dashboard (Data Consistency)
The dashboard shows non-zero returns and upward-trending sparklines for strategies like Momentum, Claude Alpha, and VRP Harvesting. But clicking into any of these detail pages shows "+0.00% ($0.00)" total return and "Awaiting data for equity curve." This inconsistency would immediately erode trust with any trader managing real capital. Either the dashboard sparklines are decorative or the detail pages are not pulling the same data source.

### 4. Options chain lacks depth for real options trading (6/10)
No multi-leg strategy construction. No Gamma or Vega. No volume/open interest. No probability calculator. No IV surface or skew chart. With 37 $0.01 entries that may be stale, the chain is not reliable enough for live options trading. Thinkorswim and even Robinhood Legend offer significantly more here.

### 5. No advanced order types or risk management (7.5/10 workflow ceiling)
Market and Limit orders only. No stop-loss, take-profit, bracket (OCO), trailing stop, or conditional orders. No portfolio-level risk dashboard (VaR, stress test, correlation matrix, max drawdown alert). A trader managing $100K across 12 strategies needs automated risk controls, not just a buy/sell button.

---

## Would I Use This to Manage My Own Portfolio?

**Not yet -- but I would watch it closely.**

Here is the honest assessment: AlphaDesk has the right *architecture* for a serious quantitative trading platform. The 12-strategy pod concept with regime-aware allocation, the pipeline transparency model, the NLP strategy builder, and the Claude AI integration are ideas that no other retail or semi-professional platform is attempting. The dashboard is genuinely impressive for a three-second read. The dark-theme terminal aesthetic is well-executed.

But architecture is not the same as production readiness. The platform currently fails the "would I move $100K from Schwab to here" test for several concrete reasons:

1. **Trust gap**: The dashboard shows returns that the detail pages do not corroborate. If I cannot trust the P&L numbers, I cannot trust the platform with capital.

2. **Pipeline is dormant**: Twelve strategies are defined but essentially idle. One MRK position at 63 shares is not a multi-strategy hedge fund -- it is a single stock trade. Until the pipeline is generating daily signals, evaluating candidates, and executing across multiple strategies, this is a monitoring dashboard for strategies that are not running.

3. **Risk management is absent**: No stop-losses, no position limits enforced by the system, no drawdown circuit breakers, no portfolio-level VaR. Managing $100K across 12 strategies without automated risk controls is a recipe for a blowup.

4. **Backtesting cannot validate strategies**: If I wanted to add a 13th strategy or modify the SMA parameters on Mean Reversion, I cannot rigorously test it. The backtester produces 1 trade on SPY. This is not usable for strategy R&D.

**What would change my answer to "yes"**:
- Pipeline generating real signals daily with an audit trail showing the full screen -> analyze -> signal -> order flow
- Strategy detail pages showing real, reconciled P&L matching the dashboard
- Backtest engine supporting at least 5 indicator types, custom entry/exit rules, transaction costs, and out-of-sample testing
- Bracket orders with automated stop-losses at the portfolio level
- A 90-day paper trading track record demonstrating the strategies work in aggregate

The product is at a **6.8/10** -- meaningfully above average for a solo/small-team project, with genuine innovation in the multi-strategy and AI integration layers. It needs another iteration focused on production data flow and risk management to cross the threshold from "interesting demo" to "trusted tool."

---

## Technical Quality Notes

- Zero console errors during the full test session -- excellent stability
- Zero network failures -- API endpoints all responding
- Page loads averaging ~4.2 seconds (acceptable but not fast; TradingView loads in <2s)
- No horizontal overflow or layout clipping at 1920x1080
- Chart rendering is smooth with proper candlestick bodies and volume bars
- Cross-symbol data updates correctly (not serving template data for all symbols)

---

*Generated by automated Playwright evaluation at /Users/GK/Downloads/alphadesk/qa-final-trading-rating.mjs with 26 evidence screenshots.*
