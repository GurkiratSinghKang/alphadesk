# AlphaDesk Trading Terminal -- Final UX Rating

**Evaluator:** Senior UI/UX Designer (Automated Playwright Capture + Manual Inspection)  
**Date:** 2026-04-10  
**URL:** https://tradingalpha.net  
**Resolution:** 1920x1080  
**Screenshots:** `/qa-screenshots/final-rating/` (30+ captures across all pages and viewports)

---

## Dimension Ratings

### 1. Visual Hierarchy -- 7/10

The dashboard establishes a clear top-down reading order: the two-row header (TopBar + StatusStrip) anchors the top with brand, navigation, and live market context; the large "$100,061.68" portfolio value in 36px acts as the undeniable focal point; and the left column (Activity Feed, Open Positions, P&L Calendar, Economic Calendar) stacks downward against the right-column Strategy Grid. However, the strategy cards and the P&L calendar heatmap compete for attention at equal visual weight, and the equity curve sparkline in the portfolio hero section is too subtle relative to the dollar figure beneath it. On the Trade page, the chart correctly dominates the viewport, but the right sidebar panels (Technical Score, Key Levels, Trade Builder) lack distinct section anchoring and blur into a single dense stripe.

### 2. Information Density -- 8/10

This is legitimately impressive for a trading terminal. The dashboard packs twelve strategy cards, an activity feed with timestamped entries, open positions table, P&L calendar heatmap, and economic calendar into a single 1920x1080 viewport without scrolling. The Trade page layers a full-width candlestick chart, watchlist sidebar with 8 symbols and live prices, options chain table, technical analysis panel with Key Levels / RSI / MACD readings, and order entry -- all above the fold. The information-to-chrome ratio is high and appropriate for the target user (professional traders). The one concern is the Pipeline page, which feels comparatively sparse -- the Current Positions table has only one row, and the Strategy Builder and Backtesting sections are stacked vertically with generous empty space between them.

### 3. Consistency -- 7/10

The design system is coherent within each page. Cards use a uniform `border-border bg-[var(--panel)]` pattern, text hierarchy follows Inter for UI and JetBrains Mono for numeric data, and the green/red profit/loss encoding is applied everywhere (strategy returns, P&L calendar cells, position values, chart candles). The two-row header is consistent across all three pages. However, there are minor inconsistencies: the strategy cards on the dashboard use a 3-column grid, but the Pipeline page uses full-width stacked sections with different card styling. Button styles vary between the BUY/SELL buttons (full green/red backgrounds) and the chart toolbar buttons (ghost/text style). The "Run Backtest" button on Pipeline uses a different green treatment than the strategy "Active" badges.

### 4. Color Usage -- 8/10

The dark theme palette is well-executed. The background layers (--background -> --surface -> --panel) create appropriate depth separation. The primary blue (#3b82f6) is reserved for interactive elements and active navigation states, avoiding overuse. Green (#22c55e) and red (#ef4444) are used exclusively for profit/loss semantics, which is correct for a trading application. The StatusStrip's LIVE indicator uses an animated ping on a green dot -- effective and unobtrusive. The orange/amber for "Paused" strategy badges and the high-impact economic events is a good third accent. The one weakness is that the chart's black background (#000) is noticeably darker than the surrounding panels, creating a visual "hole" effect rather than a seamless integration.

### 5. Typography -- 7/10

Two font families (Inter for UI, JetBrains Mono for numeric/financial data) is a solid, professional choice. The font size range (9px-36px across 9 distinct sizes) is reasonably well-controlled but could be tighter -- 9px text in the StatusStrip borders on illegibility, and the jump from 14px body to 36px hero headline is steep with no intermediate heading size in between. Tabular-nums is correctly applied to financial figures for alignment. Font weights are used purposefully: semibold for labels, medium for navigation, bold for the brand mark. The 11px navigation text in the TopBar is small but legible given the dark-on-dark context.

### 6. Whitespace -- 6/10

The dashboard uses whitespace efficiently but not generously. Card padding (p-3.5) is tight, and the gap between the left and right columns is narrow. The Strategy Grid cards are packed close together, which aids density but leaves little breathing room -- the sparklines on each card feel cramped. The Trade page is better: the chart has appropriate breathing room, and the sidebar panels use consistent internal padding. The Pipeline page has the opposite problem -- too much dead space between sections (Current Positions, Today's Pipeline Run, Strategy Builder, Backtesting, History). The P&L calendar heatmap cells are very small with minimal inter-cell spacing, making individual day values hard to distinguish. The header's two-row treatment (TopBar 44px + StatusStrip 28px = 72px total) is compact but effective.

### 7. Empty States -- 4/10

This is the weakest dimension. The automated scan found zero dedicated empty-state elements in the DOM. On the Strategy Detail page, the chart area shows "Not enough data to display curve" as plain centered text -- no illustration, no suggestion for next steps. The "Trade History" section shows "No trades yet" with a single line of explanatory text -- adequate but minimal. The Pipeline page's "Today's Pipeline Run" section shows four identical empty "0" circles with no context about what these represent or when data will appear. The Backtesting section shows empty input fields with no example or guidance. There are no onboarding nudges, no empty-state illustrations, and no progressive disclosure for first-time users. A professional trading terminal needs better handling of zero-data states, particularly for the P&L calendar when no trades have occurred on certain days.

### 8. Responsiveness -- 6/10

At 768px tablet width, the dashboard restructures into a single column and remains functional -- the portfolio hero, activity feed, and strategy grid all stack vertically without horizontal overflow. At 375px mobile, the layout degrades more: the Strategy Grid cards become very narrow, the StatusStrip's multiple data points (P&L, Regime, VIX, LIVE, Alpaca Paper) wrap or truncate awkwardly. The Trade page at mobile width is genuinely impressive -- it restructures into a vertical stack with the watchlist on top, chart below, and the technical analysis panel adapting to full width. However, the options chain table at mobile width has obvious horizontal overflow issues, and the chart toolbar's many buttons crowd together. The TopBar navigation collapses items but doesn't implement a hamburger menu -- at 375px the nav items are visually truncated.

### 9. Micro-interactions -- 6/10

The StatusStrip's LIVE indicator has an animated ping effect -- small but polished. Strategy cards have cursor-pointer and hover states (card-glow class + bg opacity transition). The command palette opens with Ctrl+K and has a proper keyboard shortcut modal (captured in 28-keyboard-shortcuts.png) showing Global, Chart, and Navigation shortcuts. Chart type and drawing tool buttons have active-state highlighting (primary/20 background). Toast notifications exist via the useToast hook with the Sonner library. However, several expected micro-interactions are missing or invisible: no loading skeletons (the loading.tsx files exist but show generic spinners), no smooth chart-type transition animations, no entry animations on dashboard cards, and no visible feedback when clicking BUY/SELL buttons beyond the toast. The keyboard shortcuts modal itself is functional but visually plain.

### 10. Overall Polish -- 7/10

The application presents a cohesive, professional dark-themed trading terminal that would not look out of place next to commercial products like TradingView or Thinkorswim. The login page is clean with the lightning bolt icon and centered card layout. The two-row header is an excellent design decision that surfaces critical market context (regime, VIX, connection status) without cluttering the main navigation. The candlestick chart renders correctly with volume bars below. The allocation donut, P&L calendar, and strategy sparklines all contribute to a data-rich but not overwhelming dashboard. The main polish gaps are: the chart's solid black background clashing with the rest of the dark navy theme, the Pipeline page feeling unfinished compared to Dashboard and Trade, and some edges where the UI transitions from "looks good" to "almost there" (like the options chain table formatting, or the backtesting section's bare-bones appearance).

---

## Feature Evaluation

### Dashboard Features

| Feature | Status | Notes |
|---------|--------|-------|
| 12-strategy grid | Present | Grid renders strategy cards with name, return %, sparkline, Active/Paused badge. Cards are clickable and navigate to /strategies/[id]. Strategy metadata includes regime notes and icons. |
| Equity curve | Present | Rendered as a thin green sparkline in the Portfolio Hero section above the $100K figure. Subtle but functional. |
| Allocation donut | Present | SVG-based donut chart showing Cash vs. Invested split with blue/green segments. Includes numeric breakdown of equity, buying power, unrealized/realized P&L. |
| P&L calendar | Present | Heatmap grid showing daily P&L with green (profit) and red (loss) cells. Month total displayed in header. Tooltip on hover shows date, P&L amount, trade count, and win rate. |
| Economic calendar | Present | Lists upcoming macro events (Non-Farm Payrolls, CPI, FOMC, etc.) with time, impact level (high/medium/low), forecast, and previous values. Color-coded impact indicators. |

### Trade Page Features

| Feature | Status | Notes |
|---------|--------|-------|
| Chart types | Present | Dropdown with Candlestick, Line, Area options. Each type has distinct icon. ChartType state toggles rendering correctly. |
| Drawing tools | Present | Horizontal line, trendline, and Fibonacci retracement tools in chart toolbar. Active state highlighted in primary blue. Clear-all button appears when drawings exist. |
| BUY/SELL buttons | Present | Green BUY and red SELL buttons positioned on the chart overlay at current price level. Trigger order placement flow. |
| Price alerts | Present | BellPlus icon in chart toolbar creates price alert at current level. Integrated with alerts store that feeds the TopBar notification bell. |
| Position sizer | Present | AnalysisPanel includes position size calculation based on risk parameters. |
| Order entry | Present | Full trade builder in TradePanel with multi-leg support. Detects strategy type (Bull Call Spread, Iron Condor, etc.) from legs. Shows net Greeks (delta, gamma, theta, vega) and max profit/loss. Integrates with Alpaca API for live order submission. |
| AI journal | Present | Journal tab within TradePanel. Functional but minimal -- no rich-text or AI-generated insights visible in the current state. |

### Pipeline Page Features

| Feature | Status | Notes |
|---------|--------|-------|
| Strategy builder | Present | Natural-language rule input with pattern parsing for indicators (RSI, MACD, EMA, etc.), actions (buy/sell), operators, and values. Example rules provided. Rendered with rule cards showing parsed components. |
| Backtesting engine | Present | SMA crossover backtesting with configurable fast/slow periods and initial capital. Produces total return, trade count, wins/losses, max drawdown, Sharpe ratio, and equity curve. Uses real OHLCV bar data from API. |
| Interactive screener | Partial | Screener functionality exists in WatchlistPanel with filtering capabilities and is accessible via CommandPalette search, but there is no dedicated fullscreen screener view with multi-criteria filters. The current implementation is a symbol search + watchlist rather than a comprehensive stock screener. |

### System-Level Features

| Feature | Status | Notes |
|---------|--------|-------|
| Keyboard shortcuts | Present | Comprehensive shortcut system with Global (show shortcuts with ?, command palette with Ctrl+K), Chart (timeframe switching with 1-9 keys), and Navigation (Ctrl+1/2/3 for Dashboard/Trade/Pipeline). Modal overlay displays all shortcuts. |
| Toast notifications | Present | Implemented via Sonner library with useToast hook. Fires on order placement, alert creation, and error conditions. |
| Two-row header | Present | TopBar (44px) with brand, navigation, search bar, notifications, profile. StatusStrip (28px) with live P&L, market regime, VIX level, connection status, and broker info. Clean separation of primary nav from real-time market context. |

---

## OVERALL SCORE: 6.6 / 10

Weighted breakdown:
- Visual Hierarchy: 7
- Information Density: 8
- Consistency: 7
- Color Usage: 8
- Typography: 7
- Whitespace: 6
- Empty States: 4
- Responsiveness: 6
- Micro-interactions: 6
- Overall Polish: 7
- **Average: 6.6**

This is a solid foundation for a trading terminal with genuinely impressive information density and color execution. The core architecture -- dark theme, two-row header, three-page layout, multi-panel trade view -- is well-designed and functional. The gap between this and a production-grade commercial product lies in the details: empty states, loading transitions, mobile polish, and some visual inconsistencies.

---

## Top 5 Remaining Shortcomings

1. **Empty states are absent or minimal.** The Strategy Detail page, P&L calendar (no-data days), Pipeline Run section, and Backtesting results all show bare-bones text or nothing at all when data is unavailable. Professional apps like Bloomberg Terminal or Thinkorswim provide contextual guidance, sample data, or illustrations in zero-data states. This is the single biggest polish gap.

2. **The Pipeline page feels unfinished relative to Dashboard and Trade.** It has significant dead vertical space, the "Today's Pipeline Run" section shows four cryptic "0" circles without labels explaining what they track, the Strategy Builder text input is a single-line field for complex rules, and the History table is empty. This page needs the same density and visual refinement applied to Dashboard.

3. **Chart background creates a visual discontinuity.** The TradingView-style chart uses a solid black (#000000) canvas that sits noticeably darker than the surrounding --panel (#0e1726-ish) backgrounds. This creates a visual "window" rather than an integrated panel. Either the chart background should match the panel color, or a subtle border/shadow should smooth the transition.

4. **Mobile responsiveness has rough edges.** At 375px, the StatusStrip overflows with too many data points crammed horizontally, the options chain table requires horizontal scrolling without a visible scroll indicator, and the TopBar navigation doesn't collapse into a hamburger menu. The strategy cards at mobile width lose their sparklines and become generic text blocks. A dedicated mobile layout pass is needed.

5. **Loading and transition states lack polish.** Loading states use simple spinner components rather than content-aware skeletons. Page transitions between Dashboard/Trade/Pipeline are abrupt with no cross-fade or shared-element animation. The BUY/SELL buttons provide toast feedback but no visual button state change (loading spinner, disabled state, success checkmark). The keyboard shortcuts modal appears instantly without a fade-in transition. These details collectively create a "functional but not refined" feeling.
