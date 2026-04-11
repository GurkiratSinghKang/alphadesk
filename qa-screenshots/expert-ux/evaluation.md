# AlphaDesk UX Expert Evaluation

**Evaluator:** Senior UI/UX Designer (15 years trading platform experience)
**Date:** 2026-04-10
**Platform:** AlphaDesk AI Trading Terminal (https://tradingalpha.net)
**Resolution tested:** 1920x1080 (primary), 1366x768 (laptop)
**Screenshots reviewed:** 40+ across Login, Dashboard, Trade, Pipeline, Strategy Detail, Command Palette pages

---

## Executive Summary

AlphaDesk is a competent first-pass at a Bloomberg-inspired dark terminal. The bones are good -- the information architecture is sound, the dark palette is appropriate for the domain, and the developer has clearly studied professional trading UIs. However, it falls short of hedge fund production quality in several critical areas: the dashboard suffers from information sparsity disguised as information density, the options chain on the trade page has serious data integrity issues (bid/ask showing 0.01 across the board), and the strategy detail pages feel half-built with too many empty/placeholder states. A portfolio manager would recognize this as a promising prototype, not a production tool.

**Overall Score: 6.2 / 10**

---

## 1. Visual Hierarchy -- 6.5 / 10

### What works:
- **Portfolio value ($100,032.10)** is correctly the dominant element on the dashboard -- large 36px display font with a subtle gradient treatment. This is the right call; it is the single most important number.
- **Day P&L (-$83.76)** is correctly positioned next to portfolio value with red coloring and a glow effect. Eye tracks there naturally second.
- **Status strip** (P&L, Regime, VIX, connection status) creates a useful secondary information bar that mirrors Bloomberg's approach.
- **Strategy cards** use sparkline charts as visual anchors that pull the eye -- the green/red lines are instantly scannable.

### What fails:
- **The activity feed and strategy grid compete for attention equally.** On the dashboard, the left column (Activity Feed + Open Positions + PnL Calendar) and right column (Strategies) are given roughly equal visual weight, but in a real workflow, the strategy performance grid is more important. It should be more prominent.
- **Section headers like "ACTIVE STRATEGIES", "MARKET INDICES", "SECTOR PERFORMANCE"** are styled as tiny uppercase labels (`text-label` class: 10px, #555 color). They are so dim they practically disappear. A hedge fund PM scanning quickly needs to orient themselves -- these wayfinding labels need to be at least 11-12px and slightly brighter (e.g., #888).
- **The hero equity curve** spanning the top of the dashboard is subtle to the point of being invisible at normal viewing distance. The gradient fill is too faint against the dark background. Bloomberg and TradingView both make their primary chart much more visually substantial.
- **On the trade page,** the chart correctly dominates, but the analysis panel on the right (Technical Score, Key Levels, Indicators) has all elements at roughly the same visual weight. The Technical Score gauge (72/100) is good, but the key levels (Resistance 2, Resistance 1, Current, Support 1, Support 2) should use stronger color-coding to differentiate. Currently the color-coded labels (red for resistance, yellow for current, green for support) are applied correctly but the dollar values next to them are all the same white -- the values themselves should carry subtle color.

### Critical issue:
- **The bottom bar of the dashboard (Market Indices, Sector Performance, Headlines)** is nearly invisible. It sits below the fold at 1920x1080 and uses extremely muted styling. SPY showing $679.35 with a tiny sparkline -- this is important real-time market context that is buried.

---

## 2. Information Density -- 5.5 / 10

### What works:
- **Trade page** achieves proper information density. The 4-panel layout (Watchlist | Chart | Analysis | Trade Entry) plus the options chain below is genuinely Bloomberg-like. Every panel earns its space.
- **Options chain** uses the classic calls-left / strike-center / puts-right layout with proper column headers (Ask, Vol, OI, IV, Delta). This is correctly dense.
- **Watchlist panel** efficiently shows symbol, mini-sparkline, price, and change% in a compact row -- good use of space.

### What fails:
- **Dashboard is too sparse.** The strategy cards (Momentum + Quality, PEAD, VRP Harvesting, etc.) are each roughly 200x120px but only display: name, status badge, return%, position count, and a sparkline. For a hedge fund dashboard, each card should also show: allocated capital, Sharpe ratio or some risk metric, and last trade date. The cards are wasting ~30% of their area on empty dark space.
- **Open Positions section** shows only one position (MRK, 43 shares, $113.84 entry, $121.40 current, +$325.08). With only one position, this section takes up a disproportionate amount of screen real estate. There is no handling for "you have one position, let's use this space more efficiently."
- **PnL Calendar** is a nice feature (green/red cells for daily P&L) but the individual day cells are so small the dollar values inside them are nearly unreadable. At 1920x1080, the calendar occupies about 400x250px -- each day cell is roughly 35x30px, which is too small for "$+325.08" to be legible.
- **Strategy detail pages** are the worst offenders. The Momentum + Quality page shows: "Not enough data for equity curve" with a massive empty chart area, then stat blocks showing "+0.00% ($0.00)", "0.00", "0.0%", "0%", "$0", "N/A". This is a sea of zeros taking up a full viewport. The page should either show meaningful content or collapse gracefully.

### Critical issue:
- **The bottom bar (Market Indices, Sector Performance, Headlines)** is crammed into a thin strip. Sector performance blocks (Technology, Comm Svcs, Real Est, Utilities, etc.) are so small the labels are truncated ("Cons...", "Indust..."). This is the opposite problem from the dashboard cards -- too dense, not enough space allocated.

---

## 3. Consistency -- 7.0 / 10

### What works:
- **Color token system is well-designed.** The CSS custom properties (`--profit: #22c55e`, `--loss: #ef4444`, `--border: #2a2a3e`, etc.) ensure green/red are consistent throughout. The code consistently uses `var(--profit)` and `var(--loss)` rather than hardcoded hex values.
- **Card component usage is consistent.** All strategy cards, position cards, and stat blocks use the same `Card`/`CardContent` shadcn components with consistent border radius and background.
- **Top bar navigation** is consistent across all pages -- AlphaDesk logo, Dashboard/Trade/Pipeline nav items, search bar, bell icon, profile avatar. The active state (blue highlight with bg-primary/15) is correctly applied.
- **Badge component** is used consistently for status indicators (Active, Paused, HOLD, BUY, SELL).

### What fails:
- **Font size inconsistency in data display.** The dashboard portfolio value uses 36px display font, but the strategy detail page stat blocks use ~18px (`text-lg`). The trade page price display (SPY $677.10) uses a different size again (~18px bold). There is no clear typographic scale being followed for "the primary number on each page."
- **Section header inconsistency.** The dashboard uses "Activity Feed" with a small icon and toggle (Today filter), but the pipeline page uses "CURRENT POSITIONS", "TODAY'S PIPELINE RUN", "HISTORY (LAST 7 DAYS)" in full uppercase with different icon styling. The strategy detail uses mixed -- "Trade History" in title case. Pick one convention and stick with it.
- **Button styling varies.** "Run Now" on the pipeline page is a filled blue button. "Pause" on the strategy detail is an outlined button. The search bar in the top bar mimics a button but is actually a div. The command palette trigger uses a kbd element for the shortcut hint. These are minor but accumulate.
- **The status strip and top bar have different background treatments.** TopBar uses `bg-[var(--surface)]` (#12121a) while StatusStrip uses `bg-[var(--background)]` (#0a0a0f). The visual difference is minimal but creates a subtle inconsistency in the perceived layering.

---

## 4. Color Usage -- 7.5 / 10

### What works:
- **Green (#22c55e) and Red (#ef4444) are correctly mapped.** Profit is always green, loss is always red. This is non-negotiable for a trading platform and they got it right.
- **The glow effects** (`.glow-profit` with text-shadow of green, `.glow-loss` with text-shadow of red) are a nice touch that adds energy without being distracting.
- **The "Paused" badge** uses a red/coral tone that correctly signals "stopped/warning" without using the exact loss-red. Good differentiation.
- **The "Bull - Low Volatility" regime badge** uses a green-on-dark-green treatment that is readable and semantically correct.
- **Primary blue (#3b82f6)** is used for interactive elements (nav highlight, Run Now button, search focus ring) and is well-differentiated from the green profit color.

### What fails:
- **Muted foreground (#71717a) is too dim.** On a #0a0a0f background, this fails WCAG AA contrast for normal text (contrast ratio approximately 3.8:1, needs 4.5:1). Secondary labels, timestamps, and descriptions are hard to read. The `text-[#555]` used for section labels is even worse -- roughly 2.5:1 contrast ratio.
- **The sector performance heatmap** in the bottom bar uses dark green and dark red fills with white text, but the cells are so small that even with sufficient contrast the text is unreadable at normal viewing distance.
- **The equity curve on the dashboard** uses a green line with a very faint fill. On the deep dark background, it looks like it is barely there. TradingView and Bloomberg both use more saturated fills or grid backgrounds to make charts pop.
- **The options chain** uses a dark blue header row for column labels (Ask, Vol, OI, IV, Delta, Strike, Last, Bid, Ask, Vol, OI, IV, Delta) but the text color is too similar to the background, making the headers hard to scan.

### Critical issue:
- **No color blindness consideration.** The app relies exclusively on red/green for profit/loss. Approximately 8% of males are red-green colorblind. Bloomberg uses shape indicators (up/down arrows) alongside color. This app does not.

---

## 5. Typography -- 7.0 / 10

### What works:
- **Tabular-nums is used extensively.** The codebase has `tabular-nums` applied to virtually every numeric display element -- prices, percentages, portfolio values, option chain numbers, position quantities. This is a professional detail that many trading UIs miss. Numbers align in columns as they should.
- **The type scale is defined in globals.css** with `.text-display` (36px/700), `.text-title` (15px/500), `.text-body` (13px/400), `.text-label` (10px/600/uppercase), `.text-hint` (11px/#555). This is a thoughtful hierarchy.
- **Geist Sans/Mono font pairing** is a good choice for a terminal-style app. The mono font is used for the Ctrl+K keyboard shortcut hint.
- **Letter-spacing** is correctly tightened for display text (-0.03em) and widened for labels (0.08em). This is a detail that separates professional from amateur typography.

### What fails:
- **The type scale has too many ad-hoc sizes.** Despite defining a clear scale in globals.css, the components frequently use Tailwind arbitrary sizes: `text-[11px]`, `text-[10px]`, `text-[9px]`, `text-xs` (12px), `text-sm` (14px), `text-base` (16px), `text-lg` (18px). This creates at least 8 different body text sizes when there should be 4-5 max.
- **The strategy card names** (e.g., "Cross-Sectional Momentum + Quality") are truncated or too long for their container. The shortName mapping (e.g., "Momentum + Quality") helps but the font size on these cards is so small (approximately 13-14px) that they are hard to read.
- **The PnL calendar day values** are rendered at approximately 10px, which is below the legibility threshold for most users. If the numbers must be this small, they should use a high-contrast color and bolder weight.
- **No italic usage anywhere** for differentiation. In financial UIs, italics are commonly used for estimated values, calculated fields, or notes to distinguish them from firm numbers. Everything here is the same roman style.

---

## 6. Whitespace -- 6.5 / 10

### What works:
- **The trade page** has excellent whitespace management. The 4-column layout (240px watchlist + flex chart + 300px analysis + 380px trade) uses space efficiently with minimal gaps.
- **Card padding is consistent** at roughly 16px internally (p-4 in Tailwind terms).
- **The top bar** at h-11 (44px) is appropriately compact -- Bloomberg terminal's top bar is similar height. It does not waste vertical space.
- **The status strip** at h-7 (28px) is correctly sized for its information density.

### What fails:
- **The dashboard has inconsistent section gaps.** The space between the hero section and the Activity Feed / Strategies section is larger than the space between Strategies and the bottom bar. The grid uses different gap values at different levels.
- **Strategy cards have too much internal whitespace.** Each card has padding that makes it feel empty. The sparkline sits in a sea of dark space. Cards should be more compact or display more data.
- **Strategy detail pages have massive empty areas.** When data is absent (e.g., "Not enough data for equity curve"), the empty chart area is a huge dark rectangle approximately 800x300px. There is no attempt to fill or collapse this space.
- **The bottom bar** (Market Indices + Sector Performance + Headlines) feels crammed compared to everything above it. It is given perhaps 80-100px of height for three distinct data sections. The transition from "spacious dashboard" to "crammed bottom bar" is jarring.
- **The pipeline page** has enormous horizontal whitespace in the positions table. With only one position (MRK), the table stretches across 1920px with columns that are way too wide. The table should auto-size or have max-widths.

---

## 7. Empty States -- 4.0 / 10

### What works:
- **The pipeline page** handles "No pipeline data" with a centered icon and "No pipeline yet" text -- this is acceptable.
- **The activity feed** shows real data (pipeline completed, risk manager rejected, market regime, news headlines), so it is rarely empty.

### What fails:
- **Strategy detail pages with no data are poor.** The Momentum + Quality page shows: large empty chart with "Not enough data for equity curve" in small gray text, then stat blocks with "+0.00% ($0.00)", "0.00", "0.0%", "0%", "$0", "N/A". This communicates nothing useful. It should say: "This strategy was activated on [date]. It will begin trading when market conditions match its criteria. Expected first trade: within [N] days."
- **Claude Alpha strategy page** -- same issue. Empty chart, all-zero stats, "No trades recorded for this strategy yet." No explanation of what Claude Alpha does, when it will trade, or what the user should expect.
- **Trade History section** shows "No trades recorded for this strategy yet" -- bare, unstyled text. No icon, no suggestion of what to do next.
- **The "Chat" tab in the analysis panel** is completely blank. No placeholder, no prompt, no "Coming soon" indicator. Just empty dark space. This is the worst kind of empty state -- it makes the user wonder if the feature is broken.
- **The options chain bid/ask columns** show "0.01" across the board for many strikes. This is either a data issue or a display bug, but to the user it looks like the UI is broken. There is no "Market closed" or "Data loading" indicator.
- **Several stat blocks show "N/A" or "$0"** without any explanation. In a financial context, "$0" and "N/A" mean very different things. "$0" implies the value was calculated and is zero. "N/A" implies the value cannot be computed. The distinction matters and is not handled.

### Critical issue:
- **When a strategy shows +0.00% but has a sparkline that suggests historical data, it is confusing.** Some strategies display green sparklines with visible price movement but show "+0.00%" as the return. This contradiction erodes trust in the data.

---

## 8. Responsiveness -- 5.5 / 10

### What works:
- **The dashboard at 1366x768** does render without horizontal scrolling. The layout compresses and strategy cards stack into fewer columns. It is functional.
- **The trade page at 1366x768** maintains its multi-panel layout. The chart compresses but remains usable.

### What fails:
- **At 1366x768, the dashboard bottom bar is completely below the fold.** Market Indices, Sector Performance, and Headlines are invisible without scrolling. This is critical market context that should be visible at all times -- consider moving it to the status strip or making it float.
- **The trade page at 1366x768** compresses the analysis panel (300px) and trade panel (380px) to the point where the Technical Score gauge and the order entry form feel cramped. Text starts to overflow.
- **The options chain at 1366x768** loses columns or requires horizontal scrolling. The column headers truncate.
- **No tablet or mobile view exists.** If a PM opens this on an iPad, it will be unusable. This is a desktop-first app, which is acceptable for a trading terminal, but there should at least be a "mobile not supported" message rather than a broken layout.
- **The search bar** is a fixed 480px wide. At 1366px viewport, it takes up 35% of the top bar width, which feels disproportionate.

### Critical issue:
- **The trade page uses hardcoded pixel widths** (WATCHLIST_W = 240, ANALYSIS_W = 300, TRADE_PANEL_W = 380). At 1366px, only 446px remain for the chart. A candlestick chart at 446px wide is barely usable -- you can see maybe 60 candles. Bloomberg Terminal at this resolution still shows 100+ candles.

---

## 9. Micro-interactions -- 6.0 / 10

### What works:
- **Price flash animations** (`.flash-profit` and `.flash-loss`) are defined with proper keyframe animations -- green/red background flashes on price updates. This is a professional trading UI pattern.
- **Card hover glow** (`.card-glow:hover`) with a subtle blue border and box-shadow is a nice touch. It provides feedback without being distracting.
- **The "LIVE" indicator** uses a pulsing animation (`animate-ping`) on the green dot. This is a clean way to show real-time connection status.
- **Navigation transitions** (150ms cubic-bezier) are appropriately fast for a trading terminal. Traders hate slow animations.
- **Command palette** opens smoothly with a backdrop blur effect. The search input auto-focuses. Popular symbols (SPY, QQQ, AAPL, etc.) are pre-populated.

### What fails:
- **No loading states on page transitions.** Navigating from Dashboard to Trade to Pipeline shows no indication of loading. The screen just goes blank for 1-3 seconds then content appears. A skeleton loader or spinner is essential.
- **The initial dashboard load** shows "Loading command center..." in plain text. This should be a branded loading screen with the AlphaDesk lightning bolt icon and a progress indicator.
- **No hover effects on the options chain rows.** In TradingView and Thinkorswim, hovering over an option strike highlights the row and shows additional info (P&L graph, probability of expiry). Here, the rows are static.
- **The PnL calendar cells have no hover tooltip.** When hovering over a day cell, there is no popover showing the day's details (trades, P&L breakdown). The calendar is display-only.
- **No transition animation when expanding pipeline rows.** The chevron rotates but the expanded content just appears -- no slide-down or fade-in.
- **Scrollbar styling** is implemented (`.scrollbar-thin`) but only for WebKit browsers. Firefox users get the default wide scrollbar that clashes with the dark theme.

---

## 10. Overall Polish -- 5.5 / 10

### Would I show this to a hedge fund PM?

**Not yet.** Here is what they would criticize, in order:

1. **"Why are half my strategies showing zero?"** -- The Momentum + Quality, VRP Harvesting, Claude Alpha, Mean Reversion, and VCP Breakout strategies all show +0.00% with empty charts. A PM would immediately ask if the system is working. The UI provides no explanation. This is the single biggest trust-eroding issue.

2. **"The options chain shows 0.01 for every bid and ask -- is this thing connected to real data?"** -- The options chain displaying 0.01 across all bid/ask values for multiple strikes suggests either the market is closed (in which case say so) or the data feed is broken. Either way, the UI should handle this gracefully.

3. **"Where's my risk dashboard?"** -- There is no dedicated risk view. No VaR, no sector exposure chart, no correlation matrix, no drawdown chart at the portfolio level. The pipeline page has a "PERFORMANCE SUMMARY" section but it is rudimentary (total P&L, win rate, avg return, best trade, worst trade). A real hedge fund needs: Sharpe, Sortino, max drawdown, beta, sector concentration risk, position sizing alerts.

4. **"Can I see my positions on a chart?"** -- There is no way to overlay entry/exit points on the candlestick chart for a given symbol. The trade page shows the chart and the positions separately but does not connect them visually.

5. **"The chat tab is empty."** -- If you're marketing AI-powered trading, the Claude Chat integration needs to work. An empty panel is worse than no panel at all.

### What a PM would praise:

1. **"The command palette is nice."** -- Ctrl+K to search symbols and commands is a professional touch. The palette includes "Analyze current symbol", "Screen momentum stocks", "Show portfolio", "Switch to live trading" -- these are useful power-user features.

2. **"I like the regime indicator."** -- "Bull - Low Volatility" in the status strip is useful contextual information that Bloomberg does not surface as cleanly.

3. **"The activity feed is useful."** -- Pipeline completions, risk manager rejections, market regime changes, and news headlines in a chronological feed is genuinely useful for understanding what the system has been doing.

4. **"Options chain layout is correct."** -- The calls/puts split with strike center, expiration date tabs, and IV/OI/Vol columns is the standard institutional layout. When the data works, this would be functional.

---

## Scoring Summary

| Category | Score | Weight | Weighted |
|----------|-------|--------|----------|
| 1. Visual Hierarchy | 6.5 | 10% | 0.65 |
| 2. Information Density | 5.5 | 15% | 0.83 |
| 3. Consistency | 7.0 | 10% | 0.70 |
| 4. Color Usage | 7.5 | 10% | 0.75 |
| 5. Typography | 7.0 | 10% | 0.70 |
| 6. Whitespace | 6.5 | 10% | 0.65 |
| 7. Empty States | 4.0 | 10% | 0.40 |
| 8. Responsiveness | 5.5 | 5% | 0.28 |
| 9. Micro-interactions | 6.0 | 10% | 0.60 |
| 10. Overall Polish | 5.5 | 10% | 0.55 |
| **TOTAL** | | **100%** | **6.11** |

**Final Score: 6.1 / 10**

---

## Top 5 Priority Fixes

1. **Fix empty strategy states** -- Replace zero-filled stat blocks with contextual messaging explaining why data is absent and when to expect it. This is the most visible problem.

2. **Fix options chain data** -- Either show real bid/ask data or display a clear "Market Closed" state with last known values. 0.01 across the board destroys credibility.

3. **Improve contrast on muted text** -- Increase `--muted-foreground` from #71717a to at least #8c8c96 (approximately 5:1 contrast ratio). Increase `text-[#555]` label color to #777 minimum.

4. **Add loading/skeleton states** -- Every page transition should show a skeleton loader matching the page layout. The initial load should have a branded splash.

5. **Add risk metrics** -- Even a simple row of cards showing Sharpe, Max Drawdown, Beta, and Win Rate at the portfolio level would significantly increase credibility with institutional users.

---

## Benchmark Comparison

| Feature | Bloomberg | TradingView | Thinkorswim | AlphaDesk |
|---------|-----------|-------------|-------------|-----------|
| Information Density | 10 | 8 | 9 | 5.5 |
| Color Consistency | 9 | 9 | 8 | 7.5 |
| Empty State Handling | 7 | 9 | 7 | 4 |
| Chart Quality | 10 | 10 | 9 | 7 |
| Keyboard Shortcuts | 10 | 9 | 7 | 7 |
| Customizability | 10 | 9 | 8 | 2 |
| Overall Polish | 10 | 9 | 8 | 6 |

AlphaDesk is ahead of a weekend hackathon project but behind a Series A fintech product. The foundation is solid -- the information architecture is correct, the color system is well-engineered, and the technical implementation (tabular-nums, proper CSS custom properties, flash animations) shows attention to detail. But the content layer (data quality, empty states, contextual help) needs significant work before any institutional user would take it seriously.

---

*Evaluation conducted by reviewing 40+ screenshots across all pages at 1920x1080 and 1366x768 resolutions, plus source code analysis of CSS custom properties, component implementations, and typography system.*
