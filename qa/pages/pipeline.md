# /pipeline — expected behavior

## Route
- URL: `/pipeline`
- Access: requires-auth
- Redirects: none
- Metadata: inherits root.

## Layout
Wraps in `DashboardPageLayout eyebrow="§ PIPELINE" title="Daily pipeline"` inside the non-desk dashboard chrome. Page is tall — `DashboardPageLayout` handles its own stacking with a `flex flex-col gap-6` inner wrapper.

### Header actions (right slot)
- **Status dot + label:** 2px dot colored `bg-[var(--profit)]` (running), `bg-[var(--loss)]` (last run errored), or `bg-muted-foreground` (idle). Label: "Running" / "Error" / "Idle".
- **Last run timestamp** (if available): `Clock` icon + mono locale string.
- **Templates button:** outline, sm, `Sparkles` icon + "Templates" — opens `StrategyTemplates` modal.
- **RiskMonitorToggle:** pill that reads `GET /api/v1/strategies/admin/risk-monitor`, shows "Risk Monitor: ON" in profit-tint / green dot or "Risk Monitor: OFF" in loss-tint / red dot. Toggle POSTs to same URL with `?enabled={!enabled}`.
- **Run Now button:** primary sm, `Play` icon. While running shows `Loader2 animate-spin` + label "Running...". Disabled while `running`. Triggers `triggerPipeline()` → captures `res.result` into `todayRun`, refreshes status + positions.

### Structure
1. **Section 1 — Current Positions**:
   - Header: `Target` icon + "CURRENT POSITIONS" (tracked caps, tiny) + count badge.
   - Empty state (no positions): card with `Target` icon (30% opacity) + text "No active positions — pipeline will open trades during market hours".
   - Populated: shadcn `Table` with columns Symbol · Shares · Entry · Current · P&L ($) · P&L (%) · Stop Loss · Take Profit · Entry Date · Signal. P&L columns colored with `text-[var(--profit)]` / `text-[var(--loss)]`. Stop Loss "None" rendered in amber with tooltip title "No stop loss set — position is unprotected". Signal column uses `SignalBadge` (buy=profit tint, sell=loss tint, hold=amber).
   - Data source: `getPipelinePositions()`; falls back to broker positions `getPositions()` mapped into pipeline shape when pipeline is empty.
2. **Section 2 — Latest Pipeline Run**:
   - Header: `Zap` icon + "LATEST PIPELINE RUN".
   - `PipelineFlow` component — 4 cards side by side with → separators: Screened · Analyzed · Signals · Orders. Each card shows count + label. Cards with >0 count get `border-primary/40 bg-primary/5 text-primary`; zero cards get `border-border bg-[var(--surface)]` with `text-[#8a8a95]`.
   - When all counts zero + no data: "Pipeline has not run today — awaiting next scheduled run".
   - When run is from a different date: "Showing latest run ({date})".
   - When only counts available (no detail rows): italic-serif "Details not available — counts only.".
   - If no run data yet: "No runs available — click Run Now to trigger manually" below the cards.
3. `Separator`.
4. **Strategy Builder section** (header: `Brain` icon + "STRATEGY BUILDER" + "AI" primary-tinted tag). Inner: `StrategyBuilder` panel (`components/panels/StrategyBuilder.tsx`).
5. `Separator`.
6. **Backtesting section** (header: `BarChart3` icon + "BACKTESTING"). Inner: `BacktestPanel` (`components/panels/BacktestPanel.tsx`).
7. `Separator`.
8. **Section 3 — History (Last 7 Days)**:
   - Empty state: `Clock` icon 50% opacity + "No pipeline history available yet".
   - Populated: Table with expand chevron + Date + Summary columns. Rows are clickable; clicking toggles expansion of details (fetches `getPipelineRun(date)` lazily into `historyRuns[date]`). Expanded row shows 4 counts (Screened / Analyzed / Signals / Orders) and optional portfolio snapshot (Equity / Cash / Positions) and error count.
   - Collapsed summary derives from the row's `summary` field or composes from `h.screened / h.orders_placed / h.errors`.
9. `Separator`.
10. **Section 4 — Performance Summary**:
    - Empty state (no perfData, no hasPnl, no positions): `TrendingUp` icon 50% opacity + "No closed trades yet — performance stats will appear after the pipeline completes trades".
    - Populated: 6-card grid (responsive 2 / 3 / 6 cols):
      - Total P&L — combined closed + open, tinted profit/loss/muted.
      - Win Rate.
      - Total Trades.
      - Active Positions.
      - Best Trade — `text-[var(--profit)]` when positive; symbol sub-line.
      - Worst Trade — `text-[var(--loss)]` when negative; symbol sub-line.

### Modals
- **StrategyTemplates** — opens when `templatesOpen` is true. Click Templates button to open; close handler `setTemplatesOpen(false)`.

### Typography roles
- Page title: Display md italic serif "Daily pipeline".
- Section H2s: tracked-caps 11px semibold `text-foreground`.
- Numbers (counts, prices, stats): mono tabular-nums.
- SignalBadge: mono uppercase 10px bold.

### Palette check
- `var(--panel)` / `var(--surface)` — **known undefined** tokens (iter-1-frontend.md P0). Panels may render transparent until aliased.
- Profit / loss colors via CSS vars `--profit` / `--loss` — verify these map to `--up-500` / `--down-500`.
- Running pill + Risk Monitor ON use `--profit` token.

## Mobile (<768px)
- Performance summary grid collapses to 2 columns, then 3 on md, 6 on xl.
- Tables scroll horizontally (Tables are inside cards without `overflow-x-auto` — this may clip on small screens — verify).

## Interactive elements

### Templates button
- Opens modal.

### Risk Monitor toggle
- Toggles backend flag; reverts on error (optimistic update with rollback).

### Run Now button
- Triggers pipeline; disables + shows spinner; repopulates tables and counts on return.

### History rows
- Click toggles expand/collapse; lazy-fetches run detail.

### Chevron icons
- Indicate expand state; not separately clickable (parent row is the click target).

### Current Positions table
- Rows static — no click handler. Stop Loss "None" has hover tooltip.

## Expected states

| State | Render |
|---|---|
| **Initial mount (pre-hydration)** | "Loading pipeline." italic-serif. |
| **Loading** | Centered `Loader2 animate-spin` for 64px height. |
| **Populated, active run** | All sections with data. |
| **Populated, no run** | Empty-state card for each section. |
| **Pipeline mid-run** | Status dot green, label "Running", Run Now button `Loader2` spinner. |
| **Pipeline error** | Status dot loss-colored, label "Error". Expanded history row shows red error count line. |

## Edge cases
- **Backend returns `counts` only (no row arrays):** known per iter-1-frontend.md P0 — `mapPipelineRun` synthesizes fake `stock-N` / `{strat}-{i}` placeholder rows. PipelineFlow now guards with `countsOnly` state and displays "Details not available — counts only." — verify no synthetic rows are rendered in the positions / history panels.
- **Running flag stuck:** if the backend crashes mid-run, `running` remains true; user cannot re-trigger. Known limitation.
- **Broker positions fallback:** when `positions` empty, `brokerPositions` are mapped in with `entryDate = ""`, `signal = "hold"`, `rationale = ""` — the Signal column will always show "HOLD" in that case. Intentional fallback.

## What must NOT happen
- **No fabricated stock symbols in Screened / Analyzed lists.** Must display count or "Details not available — counts only." — never fake tickers.
- No red/green legacy palette on the perf-summary card accents (currently uses `from-[var(--profit)] to-[var(--loss)]` gradient which should resolve to chartreuse/coral).
- No emoji.
- No real trading actions exposed to anonymous users.

## SEO / meta
- Inherits root. Authenticated page.

## Accessibility (WCAG 2.1 AA)
- Table headers properly `<TableHead>`; rows have semantic `<TableRow>`.
- Risk Monitor toggle is a `<button>` with a title attribute; `aria-pressed` is NOT wired — verify. (The toggle is a visual button with title text only.)
- Run Now disabled state announced via `disabled` attribute.
- History rows are clickable but not keyboard-focusable — the `onClick={handler}` lives on a `<TableRow>` without `role="button" tabIndex={0}`. **Known a11y gap** — keyboard users cannot expand rows.
- Focus rings on all Buttons and pills.
