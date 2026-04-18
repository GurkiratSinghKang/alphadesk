# /analytics — expected behavior

## Route
- URL: `/analytics`
- Access: requires-auth
- Redirects: none
- Metadata: inherits root.

## Layout
Wraps in `DashboardPageLayout eyebrow="§ ANALYTICS" title="Portfolio analytics"` inside a `ScrollArea` (height 100%). Non-desk dashboard chrome above (TopBar + TickerTape + StatusStrip + footer).

### Structure
1. `DashboardPageLayout` header — tracked-caps `§ ANALYTICS`, Newsreader italic "Portfolio analytics" Display-md H1. `SectionRule` underneath.
2. **Row 1 (grid 1×2 on lg):**
   - SectionCard "Underwater equity (drawdown)" icon `TrendingDown` → `DrawdownChart` SVG (600×200), coral area + stroke, 3 Y-axis ticks, 3 X-axis date labels (slice(5)), grid dashed at `var(--border)`.
   - SectionCard "30-day rolling Sharpe ratio" icon `Activity` → `RollingSharpeChart` SVG. Gold line (`var(--primary)`), zero-line dashed when range spans 0. Empty state if less than 30 days of data.
3. **Row 2 (grid 1×2 on lg):**
   - SectionCard "Daily return distribution" icon `BarChart3` → `ReturnDistribution` SVG — histogram bars (chartreuse positive / coral negative, 0.4 opacity) with a dashed normal-distribution overlay in `var(--chart-4)`.
   - SectionCard "Trade statistics" icon `Table2` → `TradeStatsTable`: 2-col grid of 11 rows — Total Trades, Win Rate, Profit Factor, Avg Win, Avg Loss, Largest Win, Largest Loss, Avg Hold Time, Max Hold Time, Max Consec. Wins, Max Consec. Losses. Values mono tabular-nums.
4. **Row 3:**
   - SectionCard "Monthly returns heatmap" icon `Calendar` → `MonthlyHeatmap`: table, header row (Year + 12 month abbreviations + YTD), body rows per year. Each cell background is chartreuse or coral tinted (intensity scaled by `|val| / maxAbs`); YTD cell uses `text-profit` / `text-loss`. Months without data render `--`.

### Typography roles
- Page title: Display size="md" italic serif.
- Eyebrow "§ ANALYTICS": tracked-caps.
- Section titles: sans 14px semibold `text-foreground`.
- All numbers: mono / tabular-nums.

### Palette check
- Backgrounds: `bg-[var(--panel)]` inside SectionCards; `rounded-xl border border-border`. **Known bug:** iter-1-frontend.md P0 — `var(--panel)` is undefined in tokens; cards render transparent until the alias is added.
- Chart colors come from CSS vars: `--border`, `--muted-foreground`, `--primary` (gold), `--chart-4`.
- **Known deviation:** the charts hardcode legacy hex (`rgba(239,68,68,0.15)` + `#ef4444` for drawdown, `rgba(34,197,94,...)` for gains) — this is the classic red/green palette, not the chartreuse/coral token set. iter-1-frontend.md P1 "TradingChart.tsx + OptionsPanel.tsx hard-code pre-F0 hex palette" is the same issue at a different file; verify `analytics/page.tsx` is also on the fix list. **Flag this** — P&L should be `--up-500` (#a8d04d) and `--down-500` (#e07856).

## Mobile (<1024px)
- Row grids collapse to `grid-cols-1`.
- Heatmap table: `overflow-x-auto` keeps it scrollable horizontally on narrow screens.

## Interactive elements
- **SectionCard headers:** purely visual, not collapsible.
- **Chart SVGs:** no tooltips or crosshair interactions — read-only visualizations.
- **Heatmap cells:** non-interactive.
- **Global overlays:** command palette, shortcuts overlay, AI copilot, onboarding — mounted by dashboard layout.

## Expected states

| State | Render |
|---|---|
| **Loading** | 4 placeholder blocks (`h-[260px] animate-pulse rounded-lg bg-bg-elev-1`) in row 1+2 grids; 1 at 200px for row 3. |
| **Loaded, ≥30 days data** | All four charts + heatmap + stats populated. |
| **Loaded, <30 days** | Rolling Sharpe chart renders empty state "Not enough data for rolling Sharpe (need 30+ days)". |
| **No trades** | TradeStats shows 0 totals and 0% rates. `totalTrades = 0`. |
| **API unreachable** | Arrays stay empty; each chart renders its own `<EmptyState />`. |
| **Portfolio performance returns nonsense** | `computeDailyReturns` / `computeDrawdown` etc. still try to render; large outliers may blow out the Y-axis. |

## Edge cases
- **`pnl_pct` missing on trades:** `computeTradeStats` normalizes snake_case and camelCase; trades missing pnl are still counted as closed if `status === "closed"`.
- **Equity base `100000`:** hardcoded starting equity for return calculations; if live backtest uses a different base, returns are wrong. Acceptable — same convention as backtests.
- **Histogram buckets = 20:** hardcoded; fixed granularity regardless of data spread.
- **Empty heatmap:** EmptyState "No monthly data".
- **Years without months:** renders row with all cells `--`; YTD aggregates to 0.

## What must NOT happen
- No fake demo data.
- No emoji.
- **Known violation:** charts currently use classic red/green and SaaS blue — must be fixed to chartreuse/coral.
- No crash when arrays are empty — every subcomponent has an empty-state guard.

## SEO / meta
- Inherits root layout. Authenticated page.

## Accessibility (WCAG 2.1 AA)
- Page header has an H1 (Display italic) and a tracked-caps H2-equivalent ("§ ANALYTICS").
- Each SectionCard title is a real `<h2>` element.
- Charts don't have aria descriptions — stat tables are the accessible fallback.
- Heatmap cells: if `--` rendered, the `<td>` still has a visible glyph; screen reader reads "--". Acceptable.
- Focus order: dashboard TopBar → skip-link → main content. SectionCards contain no focusable elements.
- Color contrast: heatmap text on tinted cells may fall below 4.5:1 when intensity is low; verify. Current fallback is `color: var(--fg)` on light cells and `var(--ink-1000)` on strong cells.
