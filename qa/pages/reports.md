# /reports — expected behavior

## Route
- URL: `/reports`
- Access: requires-auth
- Redirects: none
- Metadata: inherits root.

## Layout
Wraps in `DashboardPageLayout eyebrow="§ REPORTS" title="Reports"` inside a `ScrollArea`.

### Structure
Three collapsible **SectionCards** (custom component, chevron in header):

1. **Portfolio Statement** (default open; icon `FileText`):
   - 4-card Account Summary (Equity / Cash / Buying Power / Positions).
   - 3-card P&L Summary (Unrealized / Realized / Total), colored profit or loss.
   - "Current Positions" table (only if positions > 0): Symbol / Qty / Avg Cost / Price / Mkt Value / P&L.
   - "Closed Trades" table (only if closedTrades > 0): Symbol / Side / Qty / Entry / Exit / P&L (top 50).
   - Button: primary small `Download` + "Download Portfolio Statement (CSV)" → `portfolio-statement-YYYY-MM-DD.csv`.

2. **Strategy Performance Report** (default open; icon `BarChart3`):
   - Table: Strategy · Status · Return · Sharpe · Max DD · Trades · Win Rate.
   - Status chip tints profit when active.
   - Return colored profit/loss; Sharpe + Max DD computed per strategy from trades.
   - Empty state: "No strategies found".
   - Button: "Download Strategy Report (CSV)" → `strategy-performance-YYYY-MM-DD.csv`.

3. **Tax Report (Simplified)** (default closed; icon `Calculator`):
   - Tax Year dropdown (5 years, default = current).
   - 3-card summary: Short-Term Net / Long-Term Net / Total Realized.
   - 2-col Short-Term / Long-Term breakdown: Gains (profit) + Losses (loss).
   - Trade list preview (top 30): Symbol · Type · P&L · Days Held · Exit Date.
   - Empty state: "No realized trades found for {year}."
   - Button: "Download Tax Report (CSV)" → `tax-report-YYYY.csv`.

### Typography roles
- Page title: Display md italic serif "Reports".
- SectionCard titles: sans 14px semibold with icon.
- Card labels: tracked-caps 10px `text-muted-foreground`.
- Values: mono tabular-nums, profit/loss tinted.

### Palette check
- Cards use `bg-[var(--panel)]` (known undefined — iter-1-frontend.md P0 — may render transparent).
- Profit/loss via `text-[var(--profit)]` / `text-[var(--loss)]`.
- No raw hex in the page file.

## Mobile (<768px)
- Account Summary: `grid-cols-2 md:grid-cols-4`.
- P&L summary stays 3 cols.
- Tables scroll horizontally (`overflow-x-auto`).

## Interactive elements

### SectionCard headers
- Full-width `<button>` toggling `open` state.
- Chevron swaps `ChevronDown` ↔ `ChevronRight`.
- Hover: `hover:bg-accent/30`.

### Download buttons (×3)
- Each serializes CSV client-side via `arrayToCsv` + `escapeCsv` and triggers browser download via `URL.createObjectURL` + hidden `<a download>`.

### Tax Year dropdown
- `<select id="tax-year">`; 5 options (currentYear..currentYear-4).

## Expected states

| State | Render |
|---|---|
| **Loading** | Three 260px `animate-pulse` placeholders. |
| **Loaded, data present** | All 3 sections populated. |
| **No positions** | Portfolio skips "Current Positions" table. |
| **No closed trades** | Portfolio skips "Closed Trades" table. |
| **No strategies** | Strategy table empty-state row (colSpan 7). |
| **No tax-year trades** | Tax Report empty state. |
| **Portfolio fetch failed** | `summary === null` → "Unable to load portfolio data." |

## Edge cases
- `pnl_pct` null → "N/A".
- Infinite profit factor → "Inf".
- Missing `buyingPower` → "$0.00".
- CSV export with no rows contains only headers.

## What must NOT happen
- No synthesized trades / positions.
- No red/green classic palette — `--profit`/`--loss` tokens only.
- No emoji.

## SEO / meta
Inherits root; authenticated.

## Accessibility (WCAG 2.1 AA)
- SectionCard header is a `<button>` but missing `aria-expanded` (a11y gap).
- Tables use proper `<table><thead><tbody>`.
- Tax year has `<label htmlFor>`.
- Focus rings visible on every button and select.
- Color contrast: profit/loss ≈ 5:1 (AA).
