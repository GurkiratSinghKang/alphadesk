# AlphaDesk Product Analysis: Path to World-Class Trading Terminal

**Date:** 2026-04-12  
**Analyst:** Claude Product Advisor  
**App URL:** https://tradingalpha.net  
**Functional Status:** 27/28 checks pass (stable baseline)

---

## EXECUTIVE SUMMARY

AlphaDesk is a surprisingly capable trading terminal for its stage. The dark theme, typography system, and component library are well-executed. The information architecture is sound. However, several areas prevent it from feeling like a Bloomberg/TradingView competitor:

1. **Strategy sparklines are fake/flat** -- the most visible data visualization gap
2. **No real index sparklines** on the dashboard -- market context feels static
3. **Equity curve is too small** and lacks interactive crosshair
4. **Trade page is desktop-only** -- 375px and 768px are non-functional
5. **Landing page undersells the product** -- needs a product screenshot
6. **No loading skeleton transitions** on initial auth pages

The foundation is solid. Most improvements are polish, not architecture.

---

## 1. VISUAL DESIGN & POLISH

### Current State
The dark theme is well-executed with a deliberate 4-layer depth system:
- `--background: #0a0a0f` (deepest)
- `--surface: #12121a` (elevated)
- `--panel: #1e1e32` (cards/panels)
- `--border: #2a2a3e` (subtle dividers)

Typography uses Inter (sans) + JetBrains Mono with a Bloomberg-style scale (`text-display` at 36px, `text-label` at 10px uppercase tracking). Color system uses `--profit: #22c55e` / `--loss: #ef4444` / `--primary: #3b82f6` consistently.

### Issues Found

**A. Portfolio Hero equity curve is too short (h-[56px])**
- The equity strip at the bottom of the PortfolioHero is only 56px tall
- Bloomberg Terminal gives equity curves 200-400px of vertical space
- The gradient fill is nice but the chart is so compressed it barely registers visually
- **Priority: MUST-HAVE | Effort: Small**

**B. Strategy sparklines return flat lines (generateSparkData fills with 100)**
- `generateSparkData()` in Sparkline.tsx returns `Array(count).fill(100)` -- a flat array
- Since `min === max`, the Sparkline component returns `null`
- This means NO sparklines render on strategy cards -- a huge visual gap
- Should use real equity curve data from strategy performance endpoints
- **Priority: MUST-HAVE | Effort: Medium**

**C. Market index sparklines are empty arrays**
- Dashboard page passes empty arrays for sparkData: `result[idx.symbol] = []`
- The Sparkline component returns null for <2 datapoints
- SPY, QQQ, IWM all show no sparklines -- just text
- **Priority: MUST-HAVE | Effort: Medium**

**D. Glow effects (glow-profit, glow-loss) are subtle to the point of invisible**
- text-shadow of `0 0 12px rgba(34, 197, 94, 0.4)` is barely visible on the dark bg
- TradingView and Bloomberg use more aggressive accent lighting on key numbers
- **Priority: Nice-to-have | Effort: Small**

**E. Card hover glow is too subtle**
- `card-glow:hover` adds `box-shadow: 0 0 20px rgba(59, 130, 246, 0.06)` -- 6% opacity
- This is nearly imperceptible. Should be 12-15% for a noticeable effect
- **Priority: Nice-to-have | Effort: Small**

**F. No favicon/logo differentiation**
- Using the default Zap icon as the logo throughout
- A custom trading-terminal logo would add premium feel
- **Priority: Nice-to-have | Effort: Medium**

---

## 2. INFORMATION ARCHITECTURE

### Current State
The dashboard follows a strong hierarchy:
1. **PortfolioHero** (equity + P&L) -- top prominence
2. **ActivityFeed** (left 60%) + **StrategyGrid** (right 40%) -- core decision area
3. **PositionsSummary** + **PnlCalendar** (below feed, 2-col)
4. **EconomicCalendar** (below positions)
5. **MarketContext** (indices + sectors + news + allocation) -- bottom

Navigation is 3-tab: Dashboard / Trade / Pipeline. Simple and clear.

### Issues Found

**G. Strategy Grid shows 13 strategies in a 2-col grid -- too many**
- 13 strategies means 7 rows of cards in a 2-col layout
- The grid pushes MarketContext way down the page
- Consider: Collapsible accordion per strategy category, or a compact list view toggle
- **Priority: SHOULD-HAVE | Effort: Medium**

**H. Economic Calendar is between Positions and MarketContext -- odd placement**
- Economic calendar feels like market context, not portfolio info
- It should either be inside MarketContext or moved to a sidebar widget
- **Priority: Nice-to-have | Effort: Small**

**I. No quick-action buttons on the dashboard**
- From the dashboard, the only action is clicking strategy cards or positions
- Missing: "Quick Trade" button, "Run Pipeline" shortcut, "Add to Watchlist"
- TradingView has action chips everywhere
- **Priority: SHOULD-HAVE | Effort: Small**

**J. Trade page lacks mobile fallback**
- Trade page uses absolute positioning with fixed pixel widths (WATCHLIST_W=240, ANALYSIS_W=300, TRADE_PANEL_W=380)
- Total minimum width: 920px before chart gets any space
- At 768px or 375px, the chart area goes to zero or negative width
- Should show a tabbed mobile layout or a "desktop recommended" notice
- **Priority: MUST-HAVE | Effort: Large**

---

## 3. DATA VISUALIZATION

### Current State
Solid foundation: custom SVG equity curve with gradient fill, squarified treemap algorithm, donut chart for allocation, interactive P&L calendar heatmap. TradingChart uses lightweight-charts with proper ResizeObserver.

### Issues Found

**K. Equity curve lacks interactive crosshair**
- The PortfolioHero equity curve is a static polyline SVG
- No hover state, no crosshair, no date/value tooltip
- TradingView shows crosshair + value on hover for ALL charts
- The strategy detail page has a better implementation -- should be unified
- **Priority: MUST-HAVE | Effort: Medium**

**L. P&L Calendar intensity scale is coarse**
- Intensity is `Math.min(Math.abs(pnl) / 500, 1)` with opacity `0.3 + intensity * 0.7`
- $500 ceiling means any day with >$500 P&L looks the same
- Should be dynamic based on the month's actual range
- **Priority: Nice-to-have | Effort: Small**

**M. Allocation Donut is 120x120 -- too small for the data it conveys**
- The donut + legend + account details are crammed into a tight column
- Center text at 13px font is hard to read
- Consider: Make the donut bigger (160x160) or replace with a horizontal stacked bar
- **Priority: Nice-to-have | Effort: Small**

**N. Sector Treemap has no click interaction**
- Hovering shows a tooltip but clicking does nothing
- Should: click sector to filter positions, or navigate to sector ETF on trade page
- **Priority: SHOULD-HAVE | Effort: Medium**

**O. Options chain "Last" column should highlight ATM strike more aggressively**
- Current ATM highlight is `bg-primary/5` -- barely visible
- Thinkorswim uses a bold divider line and distinct background for ATM
- **Priority: SHOULD-HAVE | Effort: Small**

---

## 4. TRADING WORKFLOW

### Current State
The trade page has a proper 4-panel layout (Watchlist | Chart | Analysis | Options+Trade). Options chain click-to-add-leg works. The trade builder detects strategy names (Bull Call Spread, Iron Condor, etc.) and shows aggregate Greeks.

### Issues Found

**P. Stock order workflow is too many clicks**
- To buy AAPL: must go to Trade page, search AAPL, manually click "Add Leg" in trade builder, set side/qty/price
- No simple "Buy 100 shares at market" shortcut
- The AnalysisPanel has a quick order form -- but it is hidden in a tab
- Need a prominent "Quick Order" button on the chart panel toolbar
- **Priority: MUST-HAVE | Effort: Medium**

**Q. No order preview/confirmation dialog**
- Clicking "Paper Trade" or "Submit LIVE Order" fires immediately
- No confirmation step showing: total cost, margin impact, position after fill
- This is dangerous for a LIVE trading mode
- **Priority: MUST-HAVE | Effort: Medium**

**R. Trade builder legs default to type "call" with no strike/expiry**
- Adding a generic leg creates a placeholder with strike=undefined, expiry=undefined
- Should prompt the user to click the options chain instead
- **Priority: Nice-to-have | Effort: Small**

**S. No keyboard shortcut for placing orders**
- Professional terminals have Ctrl+Enter to submit, Escape to cancel
- The keyboard shortcut system exists but does not cover order entry
- **Priority: SHOULD-HAVE | Effort: Small**

---

## 5. COMPETITIVE GAPS

### vs TradingView
| Feature | TradingView | AlphaDesk | Gap |
|---------|-------------|-----------|-----|
| Drawing tools | 50+ tools | H-line, trendline, fib | Large |
| Multi-chart layout | Yes | No (single chart) | Large |
| Social/Ideas | Yes | No | Large (not needed) |
| Alerts | Price, indicator, drawing | Price only | Medium |
| Replay mode | Yes | No | Medium |
| Screener | Advanced | Basic (via pipeline) | Medium |
| Pine Script | Yes | Strategy Builder (AI) | Different approach |
| Mobile app | Excellent | Non-functional on mobile | Critical |

### vs Thinkorswim
| Feature | ToS | AlphaDesk | Gap |
|---------|-----|-----------|-----|
| Options analytics | Payoff diagram, Greeks surface | Greeks table only | Large |
| Risk analysis | Beta-weighted, stress test | Basic P&L | Large |
| Probability analysis | Probability cone | Expected move only | Medium |
| Watchlist scanner | Real-time | Static list | Medium |
| Order types | All (OCO, OTO, trailing) | Market, limit, stop | Medium |

### vs Bloomberg
| Feature | Bloomberg | AlphaDesk | Gap |
|---------|-----------|-----------|-----|
| News terminal | World-class | 3 headlines | Large |
| Fixed income | Full | None | N/A (equity focus) |
| Chat/messaging | IB chat | None | N/A |
| Data depth | Tick-level everything | OHLCV + quotes | Large |

### AlphaDesk Unique Advantages
- **Claude AI analysis** integrated into every workflow -- no competitor has this
- **13 parallel strategies** with automated pipeline execution
- **Master agent risk management** with rejection explanations
- **Strategy builder with backtesting** using natural language
- **P&L calendar with trade attribution** is better than most

---

## 6. PERFORMANCE & RESPONSIVENESS

### Issues Found

**T. Trade page is completely broken below 920px**
- Fixed pixel widths (240 + 300 + 380 = 920px minimum) mean chart area collapses
- At 768px tablet: chart width = 768 - 240 - 300 = 228px (nearly unusable)
- At 375px mobile: chart width = -145px (broken layout)
- Must implement a tabbed or stacked mobile layout
- **Priority: MUST-HAVE | Effort: Large**

**U. Dashboard loads in 2 phases with visible loading spinner**
- Phase 1: PortfolioHero + StrategyGrid (via React Query)
- Phase 2: ActivityFeed + MarketContext + EquityHistory (fetched in useEffect)
- The "Loading activity..." spinner is visible for 1-3 seconds
- Should use skeleton loading states instead of spinners for smoother perceived load
- **Priority: SHOULD-HAVE | Effort: Small**

**V. WebSocket reconnection has no visual feedback**
- StatusStrip shows LIVE/OFFLINE status, but reconnection attempts are silent
- Should show "Reconnecting..." with attempt count
- **Priority: Nice-to-have | Effort: Small**

---

## 7. CONTENT & DOCUMENTATION

### Current State
Docs page has 10 sections with a sidebar ToC. Content covers all major features. Strategy descriptions in lib/strategy-content.ts are detailed.

### Issues Found

**W. Strategy descriptions on dashboard are too terse**
- Strategy cards show only the shortName + regimeNote (e.g., "Thrives in bull trends")
- No description of what the strategy actually does
- The full descriptions exist on the strategy detail page but are not surfaced
- Consider a tooltip or expandable detail on hover
- **Priority: Nice-to-have | Effort: Small**

**X. Empty states are inconsistent**
- PositionsSummary empty: "No open positions -- the pipeline opens trades during market hours" (good, actionable)
- Orders empty: "No recent orders" + "Orders will appear after you place a trade" (fine)
- Activity Feed empty: "No activity yet today" + "Run Pipeline" link (excellent)
- Backtest empty: varies
- Should unify the pattern: icon + headline + context sentence + optional action
- **Priority: Nice-to-have | Effort: Small**

---

## 8. TRUST & CREDIBILITY

### Current State
Legal pages (Terms, Privacy, Risk Disclosure) are comprehensive. The landing page shows 4 feature cards and a login form.

### Issues Found

**Y. Landing page has no product screenshot or demo**
- Users see feature descriptions but never the actual product before logging in
- A hero screenshot of the dashboard (or short video) would dramatically improve conversion
- TradingView, Bloomberg, and every competitor show the product on their landing page
- **Priority: MUST-HAVE | Effort: Small**

**Z. No onboarding flow after first login**
- User lands directly on the dashboard with no guided tour
- A 3-5 step onboarding tooltip sequence would help new users
- "Welcome to AlphaDesk" dialog with key areas highlighted
- **Priority: SHOULD-HAVE | Effort: Medium**

**AA. "Demo data" opacity treatment is confusing**
- When isDemo=true, values appear at 40% opacity with a tooltip "Demo data -- connect Alpaca API for live values"
- This makes the dashboard look broken to first-time users
- Should show a prominent banner: "You're viewing demo data. Connect your Alpaca account for live trading."
- **Priority: SHOULD-HAVE | Effort: Small**

---

## TOP 30 PRIORITIZED IMPROVEMENTS

| Rank | ID | Improvement | Area | Priority | Effort | Impact |
|------|----|----------------------------------------------------|------|----------|--------|--------|
| 1 | B | **Replace flat sparklines with real strategy equity curves** | Data Viz | Must-have | Medium | Highest -- strategy cards look broken without sparklines |
| 2 | C | **Add real index sparklines** (SPY/QQQ/IWM intraday data) | Data Viz | Must-have | Medium | Dashboard market context feels static without them |
| 3 | T | **Make trade page responsive** (tabbed layout <920px) | Responsive | Must-have | Large | Non-functional on tablets and mobile |
| 4 | Q | **Add order confirmation dialog** before submission | Trading | Must-have | Medium | Safety-critical for live trading mode |
| 5 | Y | **Add product screenshot to landing page** | Trust | Must-have | Small | First impression drives conversion |
| 6 | A | **Increase equity curve height** to 120-180px | Visual | Must-have | Small | Most prominent chart is too compressed |
| 7 | K | **Add crosshair + tooltip to equity curve** | Data Viz | Must-have | Medium | Static chart feels non-interactive |
| 8 | P | **Add quick stock order shortcut** from chart toolbar | Trading | Must-have | Medium | Too many clicks to place a simple stock order |
| 9 | J | **Add mobile fallback** for trade page (even if minimal) | Responsive | Must-have | Large | Currently crashes layout on small screens |
| 10 | AA | **Replace demo opacity with a clear banner** | Trust | Should-have | Small | Demo mode looks like a bug, not a feature |
| 11 | Z | **Add first-login onboarding tour** (3-5 steps) | Trust | Should-have | Medium | New users have no guidance |
| 12 | U | **Use skeleton states instead of spinners** for dashboard Phase 2 | Performance | Should-have | Small | Smoother perceived load time |
| 13 | G | **Add compact/list toggle for Strategy Grid** | Info Arch | Should-have | Medium | 13 cards push MarketContext below the fold |
| 14 | N | **Make sector treemap clickable** (navigate to sector ETF) | Data Viz | Should-have | Medium | Hover-only interaction wastes potential |
| 15 | O | **Stronger ATM strike highlight** in options chain | Data Viz | Should-have | Small | Key reference point is hard to spot |
| 16 | S | **Add Ctrl+Enter keyboard shortcut** for order submission | Trading | Should-have | Small | Power users expect keyboard order entry |
| 17 | I | **Add quick-action buttons** to dashboard (Trade, Pipeline) | Info Arch | Should-have | Small | Dashboard is passive; needs action shortcuts |
| 18 | E2 | **Add options payoff diagram** to trade builder | Competitive | Should-have | Large | Major Thinkorswim parity feature |
| 19 | E3 | **Add multi-chart layout** (2-4 charts side by side) | Competitive | Should-have | Large | TradingView's most popular feature |
| 20 | E4 | **Add more drawing tools** (trend channel, rectangle, text) | Competitive | Should-have | Medium | Currently only h-line, trendline, fib |
| 21 | L | **Dynamic P&L calendar intensity scale** | Data Viz | Nice-to-have | Small | Fixed $500 ceiling limits visual range |
| 22 | D | **Increase glow effect intensity** on P&L numbers | Visual | Nice-to-have | Small | Current glow is nearly invisible |
| 23 | E | **Increase card hover glow opacity** from 6% to 12-15% | Visual | Nice-to-have | Small | Hover feedback is too subtle |
| 24 | M | **Enlarge allocation donut** to 160x160 | Data Viz | Nice-to-have | Small | Current 120x120 is cramped |
| 25 | H | **Move economic calendar into MarketContext** section | Info Arch | Nice-to-have | Small | Better information grouping |
| 26 | W | **Add strategy description tooltips** on dashboard cards | Content | Nice-to-have | Small | Strategy names alone lack context |
| 27 | R | **Improve "Add Leg" UX** -- prompt to use options chain | Trading | Nice-to-have | Small | Default empty leg is confusing |
| 28 | X | **Unify empty state patterns** across all components | Content | Nice-to-have | Small | Inconsistent tone and structure |
| 29 | V | **Show reconnection status** in StatusStrip | Performance | Nice-to-have | Small | Silent reconnection feels uncertain |
| 30 | F | **Design a custom AlphaDesk logo** (replace Zap icon) | Visual | Nice-to-have | Medium | Premium branding touch |

---

## QUICK WINS (can ship in a single sprint)

1. **Increase equity curve height** -- change `h-[56px]` to `h-[120px]` in PortfolioHero.tsx (5 min)
2. **Increase card hover glow** -- change `0.06` to `0.12` in globals.css (2 min)
3. **Increase P&L glow** -- change `0.4` to `0.6` in globals.css (2 min)
4. **Add product screenshot to landing page** -- screenshot + `<img>` tag (30 min)
5. **Replace demo opacity with banner** -- add a dismissable info bar (30 min)
6. **Dynamic P&L calendar scale** -- use `Math.max(...days.map(d => Math.abs(d.pnl)))` (15 min)
7. **Stronger ATM highlight** -- change `bg-primary/5` to `bg-primary/15 border-y border-primary/30` (10 min)
8. **Use skeleton loaders** -- replace spinner divs with pulse skeleton shapes (30 min)

---

## FILES REFERENCED

- `/Users/GK/Downloads/alphadesk/frontend/src/components/dashboard/PortfolioHero.tsx` -- equity curve
- `/Users/GK/Downloads/alphadesk/frontend/src/components/dashboard/Sparkline.tsx` -- sparkline + generateSparkData (flat)
- `/Users/GK/Downloads/alphadesk/frontend/src/components/dashboard/StrategyGrid.tsx` -- strategy cards
- `/Users/GK/Downloads/alphadesk/frontend/src/components/dashboard/MarketContext.tsx` -- indices + sectors + news
- `/Users/GK/Downloads/alphadesk/frontend/src/components/dashboard/SectorTreemap.tsx` -- treemap (hover only)
- `/Users/GK/Downloads/alphadesk/frontend/src/components/dashboard/AllocationDonut.tsx` -- donut chart (120x120)
- `/Users/GK/Downloads/alphadesk/frontend/src/components/dashboard/PnlCalendarMini.tsx` -- P&L calendar
- `/Users/GK/Downloads/alphadesk/frontend/src/components/panels/TradePanel.tsx` -- trade builder
- `/Users/GK/Downloads/alphadesk/frontend/src/components/panels/OptionsPanel.tsx` -- options chain
- `/Users/GK/Downloads/alphadesk/frontend/src/components/panels/ChartPanel.tsx` -- chart + toolbar
- `/Users/GK/Downloads/alphadesk/frontend/src/components/layout/TopBar.tsx` -- navigation
- `/Users/GK/Downloads/alphadesk/frontend/src/components/layout/StatusStrip.tsx` -- status bar
- `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/page.tsx` -- dashboard layout
- `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/trade/page.tsx` -- trade page (fixed widths)
- `/Users/GK/Downloads/alphadesk/frontend/src/app/globals.css` -- theme tokens + utilities
- `/Users/GK/Downloads/alphadesk/frontend/src/app/login/page.tsx` -- landing page
