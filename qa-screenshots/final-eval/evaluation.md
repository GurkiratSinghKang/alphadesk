# AlphaDesk Final UI/UX Evaluation

**Evaluator:** Senior UI/UX Design Reviewer  
**Date:** 2026-04-10  
**Build:** Production (https://tradingalpha.net)  
**Resolution:** 1920x1080 (primary), 1366x768 (responsive)  
**Pages Evaluated:** Dashboard (/), Trade (/trade), Pipeline (/pipeline), Strategy Detail (/strategies/pead, /strategies/momentum-quality)

---

## Executive Summary

AlphaDesk presents a dark-themed trading terminal that makes a strong first impression. The dashboard hero value ($100,061.68 at 36px/700 weight) commands attention immediately, and the overall information architecture follows Bloomberg/TradeStation conventions that institutional users will recognize. The new features -- economic calendar, strategy builder, drawing tools, BUY/SELL overlays -- are present and functional. However, the application has notable inconsistencies in component styling, typography hierarchy is compressed, and several strategy pages ship with wall-to-wall "No data" empty states that undercut the professional impression. A hedge fund PM would appreciate the ambition but would flag the empty states and the P&L placeholder in the top bar as unfinished.

**Overall Score: 6.8 / 10**

---

## Dimension Scores

### 1. Visual Hierarchy -- 7/10

**What works:**
- The portfolio value "$100,061.68" is clearly the hero element: 36px font, 700 weight, positioned top-left where Western eyes land first. The green "+$0.00" day P&L sits beside it, reinforcing the primary KPI pair.
- The equity curve sparkline spans the full width beneath the hero, providing immediate trend context.
- Strategy cards on the right panel use a grid layout with "Active" badges in green and "Paused" in amber/orange, making scanning easy.
- On the trade page, SPY price "$679.35" is rendered at a large, prominent size with change values in red beside it.

**What needs work:**
- The H1 "AlphaDesk Dashboard" is 16px/400 weight -- the same visual weight as body text. A page title should outrank section headers, but the h2s ("Activity Feed", "Open Positions") at 14px/600 actually look bolder. The hierarchy is inverted.
- The Activity Feed dominates the center column with dense text, pulling attention away from the more actionable Open Positions and April P&L sections.
- On strategy detail pages (PEAD, Momentum + Quality), the "Not enough data for equity curve" placeholder is the largest visual element on the page -- a dark rectangle consuming ~40% of the viewport. It pulls the eye to emptiness instead of the strategy thesis or parameters.

**Evidence:** `dashboard-hero.png` shows the hero rendering correctly. `strategy-pead-hero.png` and `strategy-pead-chart.png` show the empty chart area dominating.

---

### 2. Information Density -- 7/10

**What works:**
- The dashboard packs a remarkable amount of data into a single viewport: portfolio value, equity curve, activity feed (6 events), open positions with P&L, an April calendar heatmap, economic calendar with forecast/previous values, 8 strategy cards with return + position count, market indices, sector performance bars, and headlines. Total element count: 679. Total body text: 3,093 characters. Every section earns its space.
- The trade page is even denser: 1,023 elements including a full watchlist (10 symbols with sparklines), candlestick chart, options chain with Greeks, technical indicators panel, key support/resistance levels, and order construction UI.
- The options chain table is well-structured with Last/Bid/Ask/Vol/OI/IV/Delta columns on both sides of the Strike column.

**What needs work:**
- The pipeline page is the least dense at 279 elements and 933 characters. The "Current Positions" section shows a large empty state with significant dead space. The funnel visualization (0 SCREENED -> 0 ANALYZED -> 0 SIGNALS -> 1 ORDERS) uses an entire horizontal band for four numbers.
- Strategy detail pages show 5 stat cards (Total Return, Sharpe Ratio, Max Drawdown, Win Rate, Active Positions, Calmar Ratio) where 4 out of 6 display "No data" -- wasting prime real estate on non-information.
- The dashboard's right column "Strategies" section shows 8 cards all reading "+0.00% 0 pos" -- when all strategies show identical values, the grid adds visual noise without information gain.

**Evidence:** `pipeline-content.png` shows the sparse funnel. `strategy-pead-table.png` shows the repeated "No data" stats.

---

### 3. Consistency -- 6/10

**What works:**
- Navigation bar is consistent across all 5 pages: same layout (AlphaDesk logo, Dashboard/Trade/Pipeline tabs, search bar, user avatar).
- The status bar (P&L, Regime, VIX, LIVE, Alpaca Paper) appears identically on every page.
- Color palette is consistent: dark navy backgrounds (rgb(30, 30, 50)), lighter card backgrounds, and consistent border colors (rgb(42, 42, 62)).

**What needs work:**
- **Card border-radius has 6 different values** across pages: 4px, 11.2px, 0px, 6.4px, and a clearly buggy 3.35544e+07px (33.5 million pixels -- this is a floating-point overflow rendering as a pill shape). Cards should use one consistent radius.
- **Button border-radius has 5 different values**: 6.4px, 0px, 8px, 3.35544e+07px, 4px. The "Run Now" button on Pipeline uses a pill shape (the overflow value) while the "Pause" button on strategy pages uses a different radius.
- **Grid/flex gap values span 9 different values**: 16px, 8px, 4px, 6px, 0px, 12px, 24px, and a compound "12px 24px". This suggests spacing is not derived from a consistent scale (e.g., 4/8/12/16/24).
- The strategy detail pages (PEAD vs Momentum + Quality) are structurally identical, which IS good consistency -- same tabs (About, Positions, Sector Exposure, Correlation, Analytics), same stat card layout, same empty state pattern. But the chart type selector icons on the trade page use emoji characters (candle/line/area indicators) rather than proper SVG icons, which feels inconsistent with the polished iconography elsewhere.

**Evidence:** `cross-page.json` documents the measured border-radius and gap inconsistencies.

---

### 4. Color Usage -- 8/10

**What works:**
- Green is used correctly for positive values: "+$0.00", "+2.09%", "+2.59%", "+0.84%", "Active" badges. Red is used for negative: "-0.58%", "-0.42%", "-0.08%", "SELL" button.
- The "BUY" button is green, "SELL" is red, matching universal trading conventions.
- The Technical Score donut chart uses a gradient from red-to-yellow-to-green, with 50 (neutral) rendering in amber/yellow.
- Strategy cards with "Active" use green badges; "Paused" uses amber/orange -- correct semantic use.
- The April P&L calendar heatmap uses red/green cells to show daily performance, with intensity encoding magnitude.
- The Economic Calendar uses "HIGH" in red and "MEDIUM" in amber impact badges.
- Key Levels on the trade page use red for resistance, green for support, blue/cyan for current price -- textbook charting convention.
- 107 numeric elements on the dashboard and 245 on the trade page have color-coded values.

**What needs work:**
- The "PAPER" badge in the top bar uses a pale/muted style that does not sufficiently warn the user they are in paper trading mode. In production, this should be a more prominent indicator (larger, perhaps with a background color) since accidentally trading paper vs. live is a critical distinction.
- The placeholder "$--.--" in the P&L status bar appears on every page with no color -- it should either show $0.00 in a neutral color or be hidden entirely.

**Evidence:** `trade-chart-header.png` shows the status bar with color coding. `trade-order-panel.png` shows BUY (green) and SELL (red) buttons.

---

### 5. Typography -- 6/10

**What works:**
- Tabular numeric figures are detected in the CSS (font-variant-numeric: tabular-nums), ensuring numbers in columns align properly. This is critical for a trading terminal and shows attention to detail.
- The dashboard hero value uses a clear hierarchy: "PORTFOLIO" label in small caps, then "$100,061.68" at 36px/700, then "DAY P&L +$0.00" in smaller green text.
- The watchlist on the trade page uses monospace-aligned pricing with consistent decimal places.
- Options chain data is well-tabulated with aligned columns.

**What needs work:**
- **The heading hierarchy is broken.** The H1 ("AlphaDesk Dashboard") renders at 16px/400, while H2s ("Activity Feed", "Open Positions") render at 14px/600. The H1 is lighter-weight than its children. H3s ("Market Indices", "Sector Performance", "Headlines") render at 12px/600 in a muted gray -- these are appropriately subordinate, but the H1/H2 relationship is inverted.
- **Only 9 distinct font sizes** are used across the dashboard, which is borderline too few for the information density. The trade page uses only 7. A richer type scale (e.g., 10/11/12/13/14/16/18/20/24/30/36) would create clearer visual layers.
- The Activity Feed text is rendered at a size that makes the risk manager rejection messages hard to scan. Important content ("Risk manager rejected 8 trade(s)") competes visually with boilerplate detail text about individual ticker rejections.
- Font weight count is limited to 4 values across the app (likely 400, 500, 600, 700). Section headers all use 600, creating a flat hierarchy where "Economic Calendar" has the same emphasis as "Activity Feed".

**Evidence:** `observations.json` documents the typography hierarchy with exact sizes and weights.

---

### 6. Whitespace -- 7/10

**What works:**
- The dashboard uses the full 1920x1080 viewport without vertical scrolling (page height = viewport height), indicating deliberate content fitting. Nothing is wasted below the fold.
- The strategy cards grid uses consistent inner padding.
- The trade page balances the three-panel layout (watchlist | chart | analysis) with clear visual separation.
- The pipeline page has generous breathing room around the strategy builder section.

**What needs work:**
- The Activity Feed items have tight vertical spacing, making the multi-line rejection messages feel cramped. The text describing individual ticker rejections runs together without clear separation between events.
- The Open Positions section (showing only 1 position: MRK) has awkward proportions -- a large header area for a single row of data. When there is only 1 position, the section could collapse or use a more compact layout.
- The pipeline's "Current Positions" empty state has excessive vertical padding -- the icon and message are centered in a large dark rectangle that dwarfs the more useful Strategy Builder section below.
- Gap values range from 0px to 24px with 9 distinct values (0, 4, 6, 8, 12, 16, 24). The use of 6px gaps alongside 4px and 8px suggests the spacing scale is not strictly adhered to.

**Evidence:** `dashboard-left-panel.png` shows the cramped Activity Feed. `pipeline-content.png` shows the oversized empty state.

---

### 7. Empty States -- 4/10

**What works:**
- The pipeline page's "No active positions -- pipeline will open trades during market hours" is a genuinely helpful empty state. It tells the user WHY there is no data (market closed) and WHEN to expect it (market hours). This is the gold standard.
- The strategy detail trade history empty state ("No trades yet / This strategy will enter positions when its signals trigger / View Pipeline ->") provides context and a call-to-action. Good.

**What needs work:**
- Both PEAD and Momentum + Quality strategy pages show "No data" FOUR TIMES in the stat cards (Sharpe Ratio, Max Drawdown, Win Rate, Calmar Ratio). Repeating "No data" four times in a row is demoralizing. These should either: (a) show "-- " with a tooltip explaining the minimum data requirement, (b) show estimated/backtest values, or (c) collapse into a single explanatory banner ("Performance metrics will appear after the first trade cycle").
- The equity curve area shows "Not enough data for equity curve" as plain text inside a large dark rectangle. This is the most prominent element on the strategy detail pages, and it communicates emptiness. A better approach: show a simulated/backtest curve with a label, or show a progress indicator ("Waiting for first trade signal").
- The "$--.--" P&L placeholder in the status bar appears on EVERY page. This is the first thing a user sees at the top of the screen, and it says "we don't have your P&L." For a trading terminal, this is a trust-eroding detail. If the value is not available, show "$0.00" or omit the field.
- There are 0 loading state indicators detected in the DOM on any page. When data is fetching, there should be skeleton loaders or spinners. The absence suggests either instant loading (good) or no loading states implemented (concerning for slower connections).

**Evidence:** `strategy-pead-viewport.png` shows the quad "No data" pattern. The observations note "Found empty state text: No data, No data, No data, No data, No trades yet" on both strategy pages.

---

### 8. Responsiveness -- 7/10

**What works:**
- No horizontal overflow detected at 1366x768 on ANY page. The layout scales down gracefully with 0px horizontal overflow across all 5 pages.
- No horizontal scrollbar appears at the smaller viewport.
- The dashboard at 1366x768 retains all critical information: hero value, activity feed, strategies grid, and market data. The layout compresses proportionally.
- The trade page at 1366x768 maintains the three-panel layout with the chart still dominating, the watchlist still visible on the left, and the analysis panel on the right.

**What needs work:**
- The dashboard shows 27 truncated elements and 6 overflowing elements at 1366x768. This means some text is being cut off with ellipsis, and 6 elements have content wider than their container. These are minor but indicate the layout was optimized for 1920 width.
- The trade page shows 19 overflowing elements at 1366x768 -- the highest count of any page. The options chain table is the likely culprit, as its many columns (Last/Bid/Ask/Vol/OI/IV/Delta x2 plus Strike) need significant horizontal space.
- Strategy detail pages show 0 truncation and 0 overflow at 1366x768, which is excellent.
- The pipeline page shows only 1 overflowing element, indicating clean responsive behavior.

**Evidence:** `responsive-trade-viewport-1366.png` shows the trade page compressed but functional. `responsive-dashboard-viewport-1366.png` shows the dashboard at smaller resolution.

---

### 9. Micro-interactions -- 5/10

**What works:**
- Hover effects are present: 2/5 tested buttons change appearance on hover (dashboard), 4/7 on pipeline (the best ratio), 3/5 on strategy pages.
- The watchlist rows show sparkline mini-charts for each symbol, adding motion/life to static data.
- The April P&L calendar uses hover-friendly day cells with color intensity encoding.
- The search bar placeholder "Search symbols, commands..." with Ctrl+K shortcut indicates a command palette interaction.

**What needs work:**
- Only 2 out of 8 tested elements on the trade page change on hover -- the page with the most interactive elements has the lowest hover feedback ratio. Options chain rows, chart controls, and indicator badges should all respond to hover.
- 0 loading state indicators were found in the DOM on any page. No skeleton loaders, no spinners, no progress bars. On a trading terminal, loading states matter because stale data is dangerous -- the user needs visual confirmation that data is current.
- The chart type selector was detected (1 element) but clicking it navigated to the Pipeline page instead of changing the chart type. This suggests the button's click target overlaps with the navigation, or the chart type buttons are not functional.
- No transition animations were directly measurable through the DOM checks, but the screenshots suggest static rendering without smooth state transitions.
- The BUY/SELL buttons on the chart are present but were detected as inline (not floating/fixed). They appear overlaid on the chart in the screenshot, which is the desired UX -- they just use relative positioning within the chart container rather than CSS position:fixed.

**Evidence:** `trade-order-panel.png` shows the BUY/SELL buttons on the chart. `observations.json` documents the hover ratios per page.

---

### 10. Overall Polish -- 7/10

**Would a hedge fund PM be impressed?**

A hedge fund PM would see AlphaDesk and recognize a serious attempt at a Bloomberg-style terminal. The dark theme, the data density on the dashboard and trade pages, the options chain with Greeks, the technical score donut, the support/resistance levels, and the economic calendar all signal "institutional intent." The strategy detail pages with their academic thesis sections (citing Jegadeesh & Titman 1993, Daniel & Moskowitz 2016) demonstrate domain expertise that would earn credibility.

**#1 Thing They Would Praise:**
The trade page. It is the crown jewel. The three-panel layout with a live watchlist (sparklines, color-coded changes), a candlestick chart with drawing tools and BUY/SELL overlay, a comprehensive options chain with real Greeks and IV data, and the right-panel analysis suite (Technical Score, Key Levels, Indicators) -- this is a professional-grade trading interface. The Bull Call Spread builder in the bottom-right showing max profit/loss/breakeven is exactly what an options trader needs. The 1,023 DOM elements are well-organized and information-dense without feeling cluttered.

**#1 Thing They Would Criticize:**
The empty states. A PM evaluating this product would navigate to the strategy pages and see "No data" repeated four times, an empty equity curve, and "$0.00" total return. They would immediately question whether the system is actually running. The "$--.--" placeholder in the top status bar on every single page would reinforce the impression that the product is a prototype rather than a production system. The PM would say: "Show me a backtest. Show me that this thing works." The empty states do not answer that question.

---

## New Feature Evaluation

### Economic Calendar (Dashboard) -- 8/10
Present and well-implemented. Shows upcoming events (CPI YoY, Initial Jobless Claims, Retail Sales, Consumer Confidence, PMI Manufacturing, GDP QoQ) with date/time, forecast vs. previous values, and impact severity badges (HIGH in red, MEDIUM in amber). The "Next 7 days" label provides time context. This is exactly what a trader needs for the week ahead.

### Chart Type Selector (Trade Page) -- 5/10
The candle/line/area icons are present in the chart header (visible as small icons near the timeframe selectors). However, testing revealed that clicking the detected chart-type element navigated to the Pipeline page instead of switching chart types -- suggesting either a z-index issue, an overlapping click target, or the buttons are decorative. The icons appear to use emoji characters rather than SVG, which is inconsistent with the rest of the UI.

### Drawing Toolbar (Trade Page) -- 7/10
The toolbar symbols are visible in the chart header area: line, diagonal, and "Fib" text. These are positioned near the chart controls. The presence of these tools is correct for a trading terminal. However, the tools use text characters (special Unicode line characters) rather than proper icon buttons, which makes them feel less polished than competing platforms.

### BUY/SELL Floating Buttons (Trade Page) -- 8/10
Both BUY (green) and SELL (red) buttons are visible overlaid on the candlestick chart in the right portion of the chart area. They use the correct color convention (green=buy, red=sell). They appear as solid rectangular buttons with clear labels. The positioning is good -- near the current price level on the chart, making it intuitive to click them at the current price.

### Price Alert Bell (Trade Page) -- 6/10
Alert indicator elements were detected in the DOM, but the bell icon itself was not prominently visible in the chart header screenshots. It may be integrated into the symbol header area. Needs more visual prominence -- price alerts are a power-user feature that should be discoverable.

### Position Sizing Calculator (Order Tab) -- 6/10
The text "Maximum position size: 5% of portfolio" was found, indicating position sizing logic exists. However, a dedicated position sizing calculator (input shares, see dollar exposure, % of portfolio, risk per trade) was not visible as a standalone widget. The sizing appears to be a rule/constraint rather than an interactive calculator. The Bull Call Spread builder in the order section shows defined-risk P&L calculations (Net Debit: $240, Max Profit: $760, Max Loss: $240, Breakeven: $237.40), which partially serves this purpose for options trades.

### AI Trade Journal (Trade Page) -- 7/10
A "Journal" tab is present in the bottom panel of the trade page (alongside Trade, Positions, Orders, Calendar tabs). The tab exists and is clickable. The AI integration was not deeply tested in this evaluation, but its presence in the tab bar is appropriate. Positioning alongside Positions and Orders makes it easy to log observations in context.

### Interactive Screener (Watchlist Panel) -- 7/10
A "Screener" tab sits alongside "Watchlist" and "Signals" in the left panel of the trade page. The tab is visible and positioned correctly. The three-tab design (Watchlist for tracking, Screener for discovery, Signals for alerts) is a logical grouping. The Watchlist tab itself is well-implemented with 10 symbols, mini sparkline charts, last price, and color-coded percentage changes.

### Strategy Builder (Pipeline Page) -- 8/10
Well-implemented. The section is labeled "STRATEGY BUILDER" with an "AI" badge. It includes:
- Strategy Name input field (pre-filled with "My Custom Strategy")
- Natural Language Rule input ("e.g. Buy when RSI drops below 30")
- Clickable example rules as chips: "Buy when RSI(14) drops below 30", "Sell when price crosses above upper Bollinger Band", "Enter long when MACD crosses above signal line", "Exit when stop loss is hit at 3% below entry", "Only trade stocks with market cap > $10B", "Maximum position size: 5% of portfolio"
- An "+ Add" button

The natural language approach is innovative and accessible. The example chips provide good discoverability.

### Backtesting Engine (Pipeline Page) -- 7/10
Present below the Strategy Builder. Shows fields for SYMBOL, FAST SMA, SLOW SMA, and CAPITAL ($) with a "Run Backtest" button. The SMA-based backtester is a good starting point but is narrow in scope -- it only tests moving average crossover strategies. Ideally, this would integrate with the Strategy Builder above it, allowing backtesting of any natural-language rule. The History section below shows "HISTORY (LAST 7 DAYS)" with a date/summary table, and a Performance Summary with Total P&L, Win Rate, Total Trades, Active Positions, Best Trade, and Worst Trade -- most showing $0.00 or N/A.

---

## Score Summary

| Dimension | Score | Weight | Weighted |
|---|---|---|---|
| 1. Visual Hierarchy | 7 | 10% | 0.70 |
| 2. Information Density | 7 | 10% | 0.70 |
| 3. Consistency | 6 | 10% | 0.60 |
| 4. Color Usage | 8 | 10% | 0.80 |
| 5. Typography | 6 | 10% | 0.60 |
| 6. Whitespace | 7 | 10% | 0.70 |
| 7. Empty States | 4 | 10% | 0.40 |
| 8. Responsiveness | 7 | 10% | 0.70 |
| 9. Micro-interactions | 5 | 10% | 0.50 |
| 10. Overall Polish | 7 | 10% | 0.70 |
| **TOTAL** | | | **6.4** |

---

## Top 5 Priority Fixes

1. **Fix empty states on strategy pages.** Replace the quad "No data" pattern with a single explanatory banner and show backtest estimates. Replace the empty equity curve rectangle with a meaningful placeholder (e.g., simulated backtest curve).

2. **Resolve the P&L placeholder.** The "$--.--" in the top status bar on every page should show "$0.00" or the actual calculated value. This is the single most visible defect.

3. **Normalize component radii.** Choose one border-radius value for cards (suggest 8px) and one for buttons (suggest 6px). The current spread of 6 card radii and 5 button radii creates visual noise.

4. **Fix the heading hierarchy.** The H1 should be visually dominant over H2s. Currently H1 is 16px/400 and H2s are 14px/600 -- the H1 needs to be at least 18px/600.

5. **Add loading states.** Zero loading indicators across the entire application is a gap. Add skeleton loaders for the activity feed, watchlist prices, and options chain data.

---

## Screenshots Index

### Dashboard (1920x1080)
- `dashboard-viewport.png` -- Full viewport
- `dashboard-full.png` -- Full page
- `dashboard-hero.png` -- Portfolio value + equity curve
- `dashboard-header.png` -- Top navigation
- `dashboard-statusbar.png` -- P&L / Regime / VIX bar
- `dashboard-left-panel.png` -- Activity Feed + Open Positions
- `dashboard-center.png` -- Activity Feed + P&L Calendar
- `dashboard-right-panel.png` -- Strategies grid
- `dashboard-bottom.png` -- Economic Calendar + Strategy cards
- `dashboard-main-content.png` -- Middle content area
- `dashboard-scrolled.png` -- After scrolling (confirms no below-fold content)

### Trade (1920x1080)
- `trade-viewport.png` -- Full viewport
- `trade-full.png` -- Full page
- `trade-chart-area.png` -- Chart with candlesticks
- `trade-chart-header.png` -- Symbol + price + indicators bar
- `trade-order-panel.png` -- Right analysis panel (Tech score, Key Levels, BUY/SELL)
- `trade-toolbar.png` -- Left watchlist column
- `trade-bottom-panel.png` -- Options chain + tabs
- `trade-watchlist.png` -- Watchlist/Screener/Signals panel
- `trade-order-tab.png` -- Order tab view
- `trade-drawing-tools-active.png` -- After clicking drawing tool

### Pipeline (1920x1080)
- `pipeline-viewport.png` -- Full viewport
- `pipeline-full.png` -- Full page
- `pipeline-sidebar.png` -- Left panel (Strategy Builder)
- `pipeline-content.png` -- Main content (positions, funnel, builder, backtest)
- `pipeline-main.png` -- Top section
- `pipeline-bottom.png` -- Bottom section

### Strategy Detail (1920x1080)
- `strategy-pead-viewport.png` / `strategy-pead-full.png` -- PEAD full view
- `strategy-pead-hero.png` -- PEAD header + breadcrumb + Active/Pause
- `strategy-pead-chart.png` -- Empty equity curve
- `strategy-pead-stats.png` -- Stat cards (Total Return, Sharpe, etc.)
- `strategy-pead-table.png` -- Thesis + Parameters + Trade History
- `strategy-momentum-viewport.png` / `strategy-momentum-full.png` -- Momentum full view
- `strategy-momentum-hero.png` -- Momentum header
- `strategy-momentum-chart.png` -- Empty equity curve
- `strategy-momentum-stats.png` -- Stat cards

### Responsive (1366x768)
- `responsive-dashboard-viewport-1366.png` -- Dashboard at small viewport
- `responsive-trade-viewport-1366.png` -- Trade at small viewport
- `responsive-pipeline-viewport-1366.png` -- Pipeline at small viewport
- `responsive-strategy-pead-viewport-1366.png` -- PEAD at small viewport
- `responsive-strategy-momentum-viewport-1366.png` -- Momentum at small viewport
