# AlphaDesk Trading Domain Review

**Reviewer Profile:** Quantitative trader / fintech PM with Bloomberg Terminal, TradingView, Thinkorswim, and Robinhood Legend experience  
**Date:** 2026-04-10  
**Build Reviewed:** tradingalpha.net (production deployment)  
**Method:** Source code analysis of every frontend component, review of all automated QA screenshots (28 prior findings across 3 audit passes), full DOM text dumps, and evaluation of every backend API endpoint and AI agent module  

---

## Executive Summary

AlphaDesk is an ambitious attempt to build a Bloomberg-like command center for quantitative, strategy-driven trading with AI integration. The design vocabulary is genuinely professional -- dark theme, proper information density, clean typography, tabular numerics. The architecture is sound: real Alpaca paper trading integration, 8 quantitative strategies with academic-grade thesis documentation, Claude AI agent infrastructure, real-time WebSocket feeds, and an options chain with IV/Greeks. The product demonstrates genuine trading domain knowledge.

However, this is currently a **polished prototype, not a production trading tool**. The data layer is unreliable -- statistics contradict across pages, most strategies show zero activity, the options puts side displays placeholder prices, and the AI analysis falls back to deterministic placeholder data when the API is unavailable. A trader would notice these issues within 30 seconds and lose trust.

**Would I use this to manage my own portfolio?** Not today. But the bones are here for something genuinely interesting, and it is closer to real than most fintech demos I have seen.

---

## 1. Dashboard Value

**The 3-Second Test: PARTIAL PASS**

What works well:
- Portfolio value ($100,032.10) is large, prominent, immediately visible -- this is correct
- Day P&L with percentage is right where it should be
- Equity curve sparkline gives instant portfolio trajectory
- Activity Feed shows pipeline events, regime changes, and news in a single stream -- good information fusion
- Strategy grid with 8 cards gives a portfolio-of-strategies overview I have never seen outside institutional tools

What fails the 3-second test:
- **Status strip contradiction:** The thin status strip below the nav shows `P&L -$83.76 (-0.08%)` but the hero area shows the *same data differently*. On one load, the strip showed `$--.--` placeholder while the hero had real data. A trader glancing at two conflicting numbers will not trust either
- **Regime/VIX placeholders:** Status strip showed `Regime ---` and `VIX --.-` while the hero card below it correctly displayed `Bull - Low Volatility` and `VIX 16.5`. This is a race condition -- the status strip and hero fetch the same data independently
- **Strategy cards are mostly empty:** 6 of 8 strategies show `+0.00%` and `0 pos`. Only PEAD (+6.60%, 1 pos) and Earnings Vol (-15.50%, Paused) have data. This makes the grid look like a mockup
- **Missing PEAD and VCP sparklines:** These two cards have SVG elements but no path data -- blank sparklines next to cards that do have them

What is missing:
- **Buying power / margin available** -- essential for any trader to know what they can do next
- **Pending orders count** -- I need to know if something is working in the background
- **Market hours indicator** -- is the market open, pre-market, after-hours?
- **Today's trades count and P&L** -- distinct from portfolio-level P&L
- **Benchmark comparison** -- how am I doing vs SPY today?

**Score: 6/10** -- Layout is right, data reliability kills it

---

## 2. Trading Workflow

**Idea-to-Order Path Analysis:**

1. See opportunity in Activity Feed or news item (Dashboard)
2. Click to Trade page (1 click)
3. Type symbol in watchlist search or click existing symbol (1 click)
4. View chart + analysis panel simultaneously (0 clicks, auto-loads)
5. Click strike in options chain to build spread (1 click per leg)
6. Review in Trade Builder, click Place Order (1 click)

**Total: 4-5 clicks. This meets the target.**

The workflow is actually well-designed. Specific observations:

**Strengths:**
- Watchlist with live prices and sparklines on the left is Bloomberg-standard
- Chart auto-updates when you switch symbols -- no manual refresh
- Options chain is visually integrated below the chart -- TOS-style layout
- Click a strike in the chain and it populates the Trade Builder automatically
- Trade Builder auto-detects strategy type (Bull Call Spread, Iron Condor, etc.) from leg configuration -- this is a sophisticated feature
- Keyboard shortcuts for timeframes (1-8 keys) -- power user aware
- Command palette (Ctrl+K) for quick symbol/command access

**Friction Points:**
- **Right panel tab overflow:** The 5 tabs (Tech / Fund / Sent / Chat / Order) overflow the viewport by 37px. The "Order" tab is clipped to "Orde". This means the order entry panel -- the most critical tab -- is partially hidden
- **No quick-trade shortcut:** There is no way to place a market order from the watchlist (right-click > Buy/Sell). Every trade requires navigating to the full order form
- **No hotkeys for buy/sell:** Bloomberg has F1/F3 for buy, F2/F4 for sell. No equivalent here
- **Chart lacks drawing tools:** No trendlines, no Fibonacci, no horizontal levels. A trader cannot annotate the chart. This is a deal-breaker for many technical traders
- **No crosshair with price display on chart hover** -- standard feature in every charting tool
- **Single monitor only:** No pop-out windows, no multi-chart layout. Bloomberg Terminal, TOS, and TradingView all support multi-window/multi-monitor workflows

**Score: 7/10** -- Core flow is tight, missing power-user features

---

## 3. Data Quality

**This is the most serious problem area.**

**Prices -- MOSTLY REAL:**
- Watchlist prices (AAPL $260.43, MSFT $370.82, SPY $679.35) appear to be real Alpaca data
- Chart candlesticks render with real OHLCV data from the bars API
- Quotes update via WebSocket when connected

**Options Chain -- MIXED:**
- **Calls side: real or reasonable.** Prices (60.88, 55.75, 50.69 for deep ITM calls) follow a proper moneyness curve. IV ranges 15-18%, deltas from 0.97 to +1.00 -- plausible
- **Puts side: FAKE.** Every put shows Last=0.01, Bid=0.01, Ask=0.01 across all strikes. Delta values (-0.00 to -0.03) are present but inconsistent with the flat pricing. This is the `generateChain()` fallback producing unrealistic puts data
- **IV Rank 47.6, IV Pctl 53.2** -- these appear to be hardcoded fallback values (the code uses `{ ivRank: 42, ivPctl: 38 }` as defaults)
- **Expected Move +/-$21.74** -- calculated as `spotPrice * 0.032` (3.2% constant), not from actual IV. This is useless for options traders

**Analysis Panel -- DETERMINISTIC PLACEHOLDER:**
- Technical Score uses `(40 + rng() * 50)` seeded by symbol character codes -- not calculated from actual indicators
- Key Levels (Resistance/Support) are just `currentPrice +/- 3%` -- no actual pivot point, Fibonacci, or volume profile calculation
- Indicators (RSI, MACD, EMA, BB Width, ADX, OBV) show plausible-looking values but are all derived from a single score variable, not from actual technical calculations
- F-Score in the Fundamentals tab is derived from `rng()` seeded by symbol, not from actual financial data
- P/E, ROE, Debt/Equity, etc. are all `rng()`-generated -- completely fictional

**Sentiment -- HARDCODED:**
- Options flow items ("Large call sweep SPY 600C Jan 2027, $2.4M") are identical for every symbol
- News items use template literals (`${symbol}: Analysts raise price target following earnings beat`) -- the headline just substitutes the ticker name
- "2h ago", "4h ago", "6h ago" timestamps are static strings, not actual times

**Strategy Performance -- INCONSISTENT:**
- PEAD shows +6.60% on the dashboard card but `+0.00% ($0.00)` on its own strategy detail page
- PEAD Positions tab says "No open positions" while the Pipeline page shows MRK (43 shares, +$325.08) as an active PEAD position
- All stat blocks (Total Return, Sharpe, Max Drawdown, Win Rate, Calmar Ratio) show "N/A" or "No data" on strategy detail pages despite equity curves rendering
- Analytics tabs show all zeros for monthly returns, streaks, hold times, conviction distribution

**Verdict:** A trader would spot the fake data within one minute. The puts side of the options chain at 0.01 across the board is the most immediately obvious tell. The sentiment "news" being identical for every stock is the second.

**Score: 3/10** -- Real prices on equities, but options/analysis/sentiment are mostly theatrical

---

## 4. Portfolio View

**What exists:**
- Portfolio value: $100,032.10 (on $100K paper account)
- Day P&L: -$83.76 (-0.08%)
- Single position: MRK, 43 shares, entry $113.84, current $121.40, +$325.08 (+6.64%)
- P&L calendar heatmap showing daily returns in April
- Strategy allocation visible via the 8 strategy cards

**Risk Exposure Assessment: INADEQUATE**

What a trader needs to assess risk at a glance:
- **Sector exposure breakdown** -- available in the strategy detail analytics tab, but shows all zeros
- **Beta-adjusted exposure** -- not available anywhere
- **Options Greeks (portfolio level)** -- not visible. Individual legs show Delta/Gamma/Theta/Vega in the Trade Builder, but no portfolio-level Greeks rollup
- **Concentration risk** -- with only 1 position, this is trivially visible, but there is no warning system for when concentration exceeds thresholds
- **Correlation matrix** -- exists in strategy detail but shows all zeros
- **Drawdown chart** -- not visible; only the equity curve
- **VaR / Expected Shortfall** -- not present
- **Margin utilization** -- not present

**P&L Analysis:**
- The calendar heatmap is a nice touch -- inspired by GitHub contribution graphs. Shows green/red squares per day
- Daily P&L values are visible in the calendar
- But there is no P&L attribution -- I cannot tell which strategy or position drove today's P&L
- No intraday P&L curve
- Pipeline Performance Summary shows Total P&L: -$419.44, which contradicts the +$325.08 shown for the MRK position. Where is the other -$744.52? (It appears to be a closed losing trade, but this is not obvious)

**Score: 4/10** -- Displays the basics but lacks every risk metric a real trader needs

---

## 5. Strategy Management

**The 8 Strategies:**

| Strategy | Status | Return | Positions | Data Quality |
|---|---|---|---|---|
| Momentum + Quality | Active | +0.00% | 0 | No equity curve, no data |
| PEAD | Active | +6.60% | 1 (MRK) | Equity curve renders but stats say N/A |
| VRP Harvesting | Active | +0.00% | 0 | Sparkline but no trades |
| Earnings Vol Premium | Paused | -15.50% | 0 | Has data (red sparkline) |
| Regime Adaptive | Active | +0.00% | 0 | No data |
| Claude Alpha | Active | +0.00% | 0 | No data |
| Mean Reversion | Active | +0.00% | 0 | No data |
| VCP Breakout | Active | +0.00% | 0 | No sparkline |

**Strategy Thesis Quality: EXCELLENT**

This is the strongest part of the product. Each strategy has a `STRATEGY_CONTENT` object with:
- Multi-paragraph thesis grounded in academic research (citations to Jegadeesh & Titman 1993, Piotroski 2000, Bernard & Thomas 1989, Daniel & Moskowitz 2016)
- Clear edge description
- Risk profile with level and narrative description
- Explicit parameters: rebalance frequency, universe, position sizing, entry/exit criteria, max positions

The PEAD thesis alone cites 6 academic papers and explains the economic rationale for post-earnings announcement drift with institutional-quality depth. This is not chatGPT filler -- this reads like a strategy spec from a quant fund's research team.

**Strategy Logic Understanding: GOOD**
- The About tab shows thesis, edge, risk, and parameters clearly
- Toggle Active/Paused is available
- Equity curve with benchmark comparison (SPY) when data exists
- Time period filters (1M, 3M, 6M, YTD, ALL) for the equity curve
- Trade History table with entry/exit prices, P&L, conviction scores

**Strategy Performance Understanding: POOR**
- 7 of 8 strategies have no performance data
- The one strategy with data (PEAD) has contradictory statistics between pages
- No Sharpe ratio, no max drawdown, no Calmar ratio displayed despite UI elements existing
- No comparison across strategies (which is outperforming which?)
- No risk-adjusted return ranking

**Score: 6/10** -- Outstanding thesis documentation, but performance data is empty/broken

---

## 6. Pipeline

**Architecture: WELL-DESIGNED**

The pipeline page shows:
- Header: `Trading Pipeline | Idle | Run Now` button
- Current Positions table (1 MRK position with full details including stop loss $108.15, take profit $125.22)
- Today's Pipeline Run: 4-stage funnel (Screened -> Analyzed -> Signals -> Orders)
- History (Last 7 Days): expandable rows per day
- Performance Summary: Total P&L, Win Rate, Total Trades, Active Positions, Best Trade, Worst Trade

**Transparency: MODERATE**

What works:
- The pipeline flow diagram (Screened -> Analyzed -> Signals -> Orders) is the right abstraction
- Activity Feed on Dashboard shows "Pipeline completed: 0 screened, 0 analyzed, 0 trades approved" and "Risk manager rejected 9 trade(s)" -- this is genuinely useful operational transparency
- Risk rejection reasons are visible: "MRK already held by strategy pead", "WMT: Strategy pead would exceed allocation (9858 > 9006)", "INTC: Absolute momentum gate" -- these show real risk management logic

What does not work:
- Today's Pipeline Run shows all zeros (0/0/0/0). Either the pipeline did not run today or the data is not loading
- History shows only 2 dates with "No activity" / "Click to expand"
- Win Rate shows N/A despite 2 total trades
- Total P&L shows -$419.44 which includes a -$744.52 worst trade that is not explained anywhere visible

**Trust Assessment:**

Would I trust this pipeline with real money?
- **No.** The pipeline ran once (2 trades: 1 winner, 1 loser netting -$419.44) and has shown zero activity since
- The risk manager rejecting 9 trades is actually reassuring -- it shows guardrails exist
- But the pipeline does not explain WHY it entered the MRK trade or the losing trade
- No backtest results are shown for any strategy
- No confidence intervals on expected performance
- No kill switch criteria visible

**Score: 5/10** -- Good design, but untested and opaque on reasoning

---

## 7. Options Chain

**Layout: PROFESSIONAL**

The options chain follows the standard TOS/Bloomberg format:
- Calls on left, Puts on right, Strike in center
- Columns: Last, Bid, Ask, Vol, OI, IV, Delta
- Expiration tabs across the top with DTE shown (e.g., "Apr 25 (15d)")
- IV Rank and IV Percentile badges
- Expected Move display
- Click-to-select for building spreads in the Trade Builder

**Data Quality: POOR**

- Calls side renders reasonable data (deep ITM calls priced at $50-60 for SPY $530-$550 strikes when spot is ~$680)
- **Puts side is uniformly 0.01 for Last/Bid/Ask across all strikes** -- this is the `generateChain()` fallback function producing garbage. Deep ITM puts at strike $550 with SPY at $680 should be worth ~$0 (which is fine), but OTM puts at the same strikes should have meaningful prices
- IV column shows the same percentages on both sides (16.2%, 18.1%, etc.) which is suspicious -- IV should differ between calls and puts (skew)
- Expected Move is calculated as a flat 3.2% of spot price -- not derived from actual IV
- No IV surface / skew visualization
- No put-call parity check

**Missing for Options Trading:**
- No probability of profit calculation
- No payoff diagram for constructed spreads
- No IV rank history chart
- No unusual options activity alerts (the Sentiment tab mentions "Large call sweep SPY 600C" but this is hardcoded)
- No options flow (Unusual Whales / Market Chameleon style)
- No theoretical value vs market price comparison
- Cannot filter by moneyness range
- No color coding for ITM/OTM strikes (background highlighting exists but is subtle)

**Score: 4/10** -- Framework is solid, data is unreliable, missing key options analytics

---

## 8. News & Sentiment

**News Feed: MIXED**

- Dashboard Activity Feed shows real news items from what appears to be a news API: "Muthoot Finance Jumps 3% After Board Approves 300% Dividend", "CPI: Inflation rose to 3.3%", "iShares Emerging Markets Equity Factor ETF..."
- These appear to be real financial news items with actual sources (Inc Business, The Lincolnian Online)
- Timestamps are present ("1:39 PM", "1:30 AM")
- **Problem:** The news items are market-wide, not filtered to watchlist or portfolio holdings. I am seeing Indian ETF news when my portfolio is all US equities

**Sentiment Panel on Trade Page: ENTIRELY FAKE**

- Sentiment Score gauge shows "50" with "Moderately bullish sentiment. Analysts positive, options flow mixed." -- this text is identical for every symbol
- Options Flow items are hardcoded (same 3 items for every stock):
  - "Large call sweep SPY 600C Jan 2027, $2.4M"
  - "Put buying in XLF sector ETF, $1.1M"
  - "Unusual volume in AAPL 250C, $890K"
- News items use template literals: `${symbol}: Analysts raise price target following earnings beat` -- just substitutes the ticker
- Timestamps "2h ago", "4h ago", "6h ago" are static strings

**Fundamentals Panel: ALSO FAKE**

- Piotroski F-Score is generated from `rng()` seeded by symbol character codes
- P/E, P/S, EV/EBITDA, Profit Margin, ROE, Debt/Equity, FCF Yield, Revenue Growth are all random numbers
- The text "SPY has strong fundamentals with high profitability and improving financial health" is a static template -- it says the same thing for SPY (an ETF with no "profitability") and for individual stocks

**Score: 2/10** -- Real news on dashboard, but sentiment/fundamentals panels are theater

---

## 9. Missing Features -- Next Sprint Priorities

**Critical (blocks real trading):**
1. **Real options data on puts side** -- fix the Polygon API integration or use a different data provider. The 0.01 placeholder destroys credibility
2. **Fix strategy data consistency** -- PEAD showing different returns on dashboard vs detail page, positions missing on detail page. This is likely a backend API issue where strategy-specific endpoints are not returning the same data as the portfolio summary endpoint
3. **Real fundamental data** -- use FMP, Polygon, or Alpha Vantage for actual P/E, ROE, etc. The random number generator approach is immediately detectable
4. **Fix status strip race condition** -- the strip should use the same data store as the hero section, not make a separate API call

**High Priority (real traders need these):**
5. **Buying power / margin available** -- add to status strip or hero section
6. **Portfolio-level Greeks** -- aggregate Delta, Gamma, Theta, Vega across all positions
7. **Chart drawing tools** -- trendlines, horizontal levels, Fibonacci at minimum
8. **Real sentiment data** -- integrate an actual news sentiment API (Benzinga, StockNews, NewsAPI) instead of hardcoded items
9. **Stop loss / take profit on the order form** -- the pipeline positions show these but the manual order form does not have fields for them
10. **Trade journal with actual notes** -- the Journal tab exists but entries are truncated and there is no way to add new journal entries

**Medium Priority (competitive necessities):**
11. **Alerts system** -- price alerts, strategy signal alerts, portfolio threshold alerts. The bell icon exists but shows "No alerts yet"
12. **Backtesting interface** -- let me see how each strategy would have performed historically
13. **Multi-chart layout** -- at least 2x2 chart grid for comparing symbols
14. **Screener functionality** -- the Screener tab exists in the watchlist but functionality is unclear
15. **P&L attribution** -- break down daily P&L by strategy and by position

---

## 10. Competitive Position

### vs TradingView Free Tier

| Feature | AlphaDesk | TradingView Free | Edge |
|---|---|---|---|
| Charting | Basic candlestick, volume | Full TradingView with 50+ drawings, 100+ indicators | TV by a mile |
| Real-time data | Yes (Alpaca) | Delayed 15min on free | AlphaDesk |
| Options chain | Present but broken | None on free tier | AlphaDesk (concept) |
| Strategy management | 8 quant strategies | Pine Script community strategies | AlphaDesk (for quant approach) |
| Order execution | Integrated (Alpaca paper) | Requires broker connection | AlphaDesk |
| Alerts | Stub only | 1 alert on free | Tie |
| AI analysis | Present (placeholder) | None | AlphaDesk (concept) |
| Community/Social | None | Massive community | TV by a mile |
| Screener | Stub | Basic (3/day on free) | Tie |
| Multi-chart | No | Yes (1 on free) | TV |

**Score vs TradingView Free: 4/10**

TradingView's charting alone is 10x more capable. AlphaDesk's advantages are in the quant strategy framework and integrated execution, but TradingView Free is more useful for a typical trader today.

### vs Thinkorswim

| Feature | AlphaDesk | Thinkorswim | Edge |
|---|---|---|---|
| Charting | Basic | Institutional-grade (thinkScript, 400+ studies) | TOS by miles |
| Options chain | Broken puts | Complete with probability, Greeks, analyze tab | TOS by miles |
| Options analysis | None | Probability analysis, risk profile, what-if | TOS by miles |
| Paper trading | Yes (Alpaca) | Yes (full simulation) | Tie |
| Strategy automation | 8 quant strategies + pipeline | Conditional orders, TOS scripts | AlphaDesk (different approach) |
| AI integration | Claude agents | None | AlphaDesk |
| Fundamental data | Fake | Real (from TD Ameritrade data) | TOS |
| Scanning/Screener | Stub | Full stock + options scanner | TOS |
| Customization | Fixed layout | Fully customizable workspaces | TOS |
| Learning curve | Low | Very high | AlphaDesk |

**Score vs Thinkorswim: 2/10**

TOS is a 20-year-old professional platform. The comparison is not fair -- but it is the competitive reality. AlphaDesk's only defensible advantage is the AI-agent-driven strategy management concept, which TOS does not have.

---

## AI / Claude Integration Evaluation

### Is the AI Analysis Adding Value?

**Backend Architecture: GENUINE**

The codebase has a real multi-agent architecture:
- `BaseAgent` class using Claude CLI subprocess or Anthropic API fallback
- `StrategyResearchAgent` using Claude Opus for strategy design with a detailed system prompt covering hypothesis generation, factor analysis, backtesting methodology
- `agents/supervisor.py`, `agents/strategy.py` for coordinating agent workflows
- `data/ingestion/daily_pipeline.py` and `master_agent.py` for automated daily runs
- MCP server integration for market data access

**Frontend Execution: PLACEHOLDER**

The analysis panel tries to call `analyzeSymbol()` which hits `/api/v1/analysis/analyze/${symbol}`, but when this fails (timeout, API unavailable), it falls back to:
```javascript
const techScore = Math.round(40 + rng() * 50);
const fundScore = Math.round(35 + rng() * 55);
const sentScore = Math.round(-20 + rng() * 70);
```

This means in practice, users are seeing deterministic random scores, not Claude output. The indicators (RSI, MACD, EMA values) are all derived from the single techScore variable, not from actual technical calculations.

The Chat tab calls `chatWithAgent()` which hits `/api/v1/agents/chat`, but the error fallback generates a hardcoded response about MACD crossovers. The chat tab was also found to be **completely empty** in one QA pass -- no input field, no messages, just a blank panel.

### Would I Trust Claude's Stock Picks with Real Money?

**Not in current form. Here is why:**

1. **The picks are not visible.** Claude Alpha is listed as a strategy but shows 0 positions, 0 trades, +0.00% return. There is no evidence Claude has made any investment decisions
2. **The pipeline ran once.** 2 trades total (1 win, 1 loss), net -$419.44. Sample size is meaningless
3. **No backtest.** There is no historical simulation showing how Claude's picks would have performed
4. **No explanation.** The pipeline does not show WHY it entered the MRK trade or the losing trade. For me to trust AI with capital, I need to see the reasoning chain
5. **Fallback to random data.** When the AI is unavailable, the app shows random scores as if they were real analysis. This is dangerous -- a user might make a trade based on a "Technical Score: 78" that was generated by `rng()`

### What AI Features are Actually Useful vs Gimmicky?

**Potentially Useful (if connected to real data):**
- Multi-agent analysis architecture (technical + fundamental + sentiment + options agents each scoring independently, then a composite) -- this is a sound framework
- Strategy Research Agent with Opus for deep reasoning about novel strategies -- the system prompt is genuinely sophisticated
- Risk manager rejecting trades ("MRK already held", "would exceed allocation", "absolute momentum gate") -- this is real risk management logic, not AI theater
- Daily pipeline automation concept -- if it worked reliably, having an AI screen -> analyze -> signal -> execute pipeline would be genuinely valuable

**Currently Gimmicky:**
- Chat tab that falls back to hardcoded responses
- Sentiment tab with identical options flow for every symbol
- Fundamental tab with random number P/E ratios
- Technical Score gauge that shows random numbers as if they were analysis

---

## Honest Bottom Line

### What AlphaDesk Gets Right
1. **Design language** -- professional, dense, dark theme. Looks like it belongs on a trading desk
2. **Strategy thesis quality** -- the academic rigor in strategy documentation is outstanding
3. **Trade Builder** -- auto-detecting Bull Call Spreads from leg configuration is a sophisticated feature
4. **Architecture** -- the backend agent framework, pipeline, and Alpaca integration show real engineering thought
5. **Information density** -- the dashboard packs portfolio, strategies, positions, calendar, market context, activity feed, and news into one screen without feeling cluttered
6. **Keyboard shortcuts** -- power users will appreciate Ctrl+K, number keys for timeframes, question mark for help

### What AlphaDesk Gets Wrong
1. **Data integrity** -- contradictory numbers across pages destroy trust instantly
2. **Fake data passed off as real** -- the analysis panel, sentiment, fundamentals, and options puts all show generated data without any indication to the user
3. **Empty strategies** -- 6 of 8 strategies have zero activity, making the strategy grid look like a demo
4. **Options puts side broken** -- 0.01 across the board is immediately visible as fake
5. **Chat tab sometimes empty** -- a completely blank panel with no error message or placeholder
6. **No real fundamental data** -- this should be trivial to fix with a free API

### Final Scores

| Dimension | Score | Notes |
|---|---|---|
| Dashboard Value | 6/10 | Good layout, data trust issues |
| Trading Workflow | 7/10 | Core flow is tight, missing power features |
| Data Quality | 3/10 | Real equity prices, fake everything else |
| Portfolio View | 4/10 | Basics present, no risk analytics |
| Strategy Management | 6/10 | Excellent documentation, empty performance |
| Pipeline | 5/10 | Good design, untested, opaque |
| Options Chain | 4/10 | Framework solid, puts data broken |
| News & Sentiment | 2/10 | Real dashboard news, fake analysis panels |
| AI Integration | 4/10 | Real architecture, placeholder execution |
| **Overall** | **4.5/10** | Polished prototype, not production-ready |

### vs Competitors
- vs TradingView Free: **4/10**
- vs Thinkorswim: **2/10**
- vs Robinhood Legend: **5/10** (Robinhood also lacks advanced options analytics)
- vs Bloomberg Terminal: **1/10** (not a fair comparison)

### What Would Make Me Use This

If in the next 2-4 sprints, AlphaDesk:
1. Fixed all data consistency bugs between dashboard and strategy detail pages
2. Integrated real fundamental data (FMP API is free for basic data)
3. Fixed the options puts side to show real or at least properly modeled prices
4. Made the AI analysis actually return Claude output and labeled fallbacks clearly as "Demo Data"
5. Had 3+ months of strategy pipeline history showing real, auditable trade decisions with reasoning
6. Added portfolio-level Greeks and basic risk analytics

...then I would seriously consider using it for paper trading alongside my primary tools. The strategy-as-portfolio concept is genuinely novel and the trade builder UX is better than many established platforms. The product needs to earn trust through data accuracy before it can ask for capital.

---

*Review conducted through source code analysis of all 41 frontend components, 28 previously identified QA findings, full DOM text dumps of every page, and evaluation of the complete backend agent architecture including strategy content, API endpoints, and AI integration code.*
