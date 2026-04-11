# Dashboard Redesign — Design Spec

Sub-project 1 of the AlphaDesk UI/UX overhaul. Adds 6 visual improvements to the dashboard and decomposes the 1329-line monolith page into focused components.

## Implementation Order

1. Component Extraction (refactor, no behavior change)
2. Portfolio Equity Curve
3. Allocation Donut Chart
4. Strategy Sparklines Enhancement
5. P&L Calendar Hover Tooltips
6. Sector Treemap

---

## 1. Component Extraction

Break `src/app/(dashboard)/page.tsx` (1329 lines) into focused component files. No behavior changes — pure extraction.

### New Files

| File | Content | Approx Lines |
|------|---------|-------------|
| `src/components/dashboard/PortfolioHero.tsx` | Command bar hero section (portfolio value, day P&L, time period pills) | ~60 |
| `src/components/dashboard/ActivityFeed.tsx` | Feed panel + FeedItemRow + buildFeedItems helper + constants (FEED_ICONS, SEVERITY_COLORS, etc.) | ~200 |
| `src/components/dashboard/StrategyGrid.tsx` | Strategy grid panel + StrategyCard + Sparkline component + generateSparkData | ~150 |
| `src/components/dashboard/MarketContext.tsx` | Bottom section: indices with sparklines, sector heatmap slot, headlines/account overview | ~180 |
| `src/components/dashboard/PositionsSummary.tsx` | Open positions card (already a separate function, just extract to file) | ~60 |
| `src/components/dashboard/PnlCalendarMini.tsx` | Monthly P&L calendar heatmap (already a separate function, just extract to file) | ~80 |

### What Stays in page.tsx

The `CommandCenter` component retains:
- All `useState` declarations and data fetching (`useEffect` with `fetchAll`)
- The layout grid that composes the extracted components
- Props passed down to each component

Shrinks to ~200-250 lines.

### Interface Contracts

Each extracted component receives data via props — no internal data fetching. The parent `CommandCenter` fetches all data and passes it down.

Key prop interfaces:

```ts
// PortfolioHero
{ portfolioValue: number; dayPnl: number; dayPnlPct: number; equityHistory: { date: string; value: number }[] }

// ActivityFeed
{ feedItems: FeedItem[]; onNavigate: (path: string) => void }

// StrategyGrid
{ strategies: StrategyData[]; regimeLabel: string; onStrategyClick: (id: string) => void }

// MarketContext
{ indices: MarketIndex[]; sectors: SectorData[]; news: NewsItem[]; summary: PortfolioSummary }

// PositionsSummary
{ positions: Position[] }

// PnlCalendarMini
{ days: CalendarDay[]; monthTotal: number }
```

---

## 2. Portfolio Equity Curve

The `PortfolioHero` component becomes a chart-backed hero section. The portfolio value and day P&L float on top of a subtle equity curve.

### Data Source

Derive from the P&L calendar data (already fetched by `CommandCenter`):
- Start value: `equity - sum(all daily P&L this month)`
- Accumulate daily P&L to build equity points
- This gives a month-to-date equity curve

The component also accepts an `equityHistory` prop so the parent can pass richer data if available from `/api/v1/portfolio/performance`.

### Visual Design

- Same command bar area, gradient background (existing `bg-gradient-to-r`)
- Background: SVG area chart, low opacity gradient fill (~0.12 opacity)
- Line color: `var(--profit)` if net positive, `var(--loss)` if net negative
- Portfolio value overlaid top-left: `.text-display` (36px bold)
- Day P&L below: title size with glow effect
- Time period pills top-right: `1W`, `1M`, `3M`, `YTD` — small buttons that filter the equity data
- Default period: `1M` (current month)
- Chart height: fills the hero container (~100px), no explicit axis labels
- Pure SVG — `<polyline>` for the line, `<polygon>` for the gradient fill area

### Component

`src/components/dashboard/PortfolioHero.tsx`

Props: `portfolioValue`, `dayPnl`, `dayPnlPct`, `equityHistory`

---

## 3. Allocation Donut Chart

A small donut chart showing Cash vs. Invested, replacing the "Account Overview" text list in the Market Context bottom section.

### Visual Design

- SVG donut, ~120px diameter
- Two segments: Cash (`var(--primary)` blue) and Invested (`var(--profit)` green)
- Center text: total equity formatted as currency (small, 12px)
- Legend below donut: two rows with colored dots + labels + amounts
- Below legend: compact 3-row summary (Buying Power, Unrealized P&L, Realized Today) — preserves the info from the removed Account Overview

### Data

From `usePortfolioStore`: `summary.cash` and `summary.totalMarketValue`. No new API calls.

### SVG Approach

Two `<circle>` elements with `stroke-dasharray` and `stroke-dashoffset` to create the donut segments. The invested segment uses `dasharray = circumference` with `dashoffset = circumference * (1 - investedPct)`. Rotated -90deg so it starts from the top.

### Component

`src/components/dashboard/AllocationDonut.tsx`

Props: `cash`, `invested`, `equity`, `buyingPower`, `unrealizedPnl`, `realizedPnlToday`

---

## 4. Strategy Sparklines Enhancement

Increase sparkline size from 48x18px to 80x28px and make them span the full card width at the bottom.

### Card Layout Change

```
Before:                     After:
+-------------------+      +-------------------+
| Icon  Name  Badge |      | Icon  Name  Badge |
| +6.60%  1 pos     |      | +6.60%  1 pos     |
| regime   [spark]  |      | regime note       |
+-------------------+      | [===sparkline===] |
                            +-------------------+
```

### Changes

- Sparkline moves from inline next to ChevronRight to a dedicated bottom row
- Size: `width={80} height={28}` → passed as full-card-width with `className="w-full"`
- Actually, the Sparkline component uses a fixed SVG viewBox. Update to render at card width using `width="100%"` with a viewBox, or pass `width={140} height={28}` for the wider card.
- Generate 30 data points (up from 20) for smoother curves
- Remove the ChevronRight icon (the sparkline provides the visual cue for the card)

### Component

Changes in `src/components/dashboard/StrategyGrid.tsx` (the extracted file).

---

## 5. P&L Calendar Hover Tooltips

Add a themed floating tooltip card on hover over calendar day cells.

### Visual Design

- Positioned above the hovered cell, horizontally centered
- Card: `bg-[var(--surface)] border border-border rounded-lg shadow-lg p-2.5`
- Width: ~160px, height: ~90px
- Content:
  - Line 1: Date formatted as "Apr 6, 2026" (13px, foreground)
  - Line 2: P&L value "+$297.02" or "-$170.05" (15px, semibold, green/red with glow)
  - Line 3: "5 trades" (11px, muted)
  - Line 4: "Win rate: 60%" (11px, muted) — or "N/A" if 0 trades
- Small triangle pointer at the bottom pointing to the cell

### Implementation

- `useState<HoveredDay | null>` where `HoveredDay = { date, pnl, trades, winRate, rect: DOMRect }`
- `onMouseEnter` on each cell: set hovered state with cell's `getBoundingClientRect()`
- `onMouseLeave`: clear state
- Tooltip renders as absolutely positioned div relative to the calendar container
- Position calculation: `top = cellRect.top - containerRect.top - tooltipHeight - 8`, `left = cellRect.left - containerRect.left + cellWidth/2 - tooltipWidth/2`
- Clamp horizontal position to stay within container bounds

### Component

Changes in `src/components/dashboard/PnlCalendarMini.tsx` (the extracted file).

---

## 6. Sector Treemap

Replace equal-sized sector boxes with a squarified treemap layout.

### Algorithm

Squarified treemap (Bruls, Huizing, van Wijk 2000):
1. Sort items by value descending
2. For each item, try adding it to the current row
3. If adding it worsens the worst aspect ratio in the row, lay out the current row and start a new one
4. Repeat until all items are placed

Since we don't have sector market cap weights from the API, all sectors get **equal area**. The squarified algorithm still produces a visually interesting layout (varying rectangle shapes). Color intensity conveys performance magnitude.

### Visual Design

- Container: same position in Market Context middle column, ~120px height, full column width
- Each rectangle:
  - Background: green-to-red scale based on `change_pct`
    - `> 1%`: deep green `rgba(34,197,94,0.7)`
    - `> 0.3%`: medium green `rgba(34,197,94,0.4)`
    - `> 0%`: light green `rgba(34,197,94,0.2)`
    - `< 0%`: mirror in red
  - Text: sector name (10px, centered, white) + change pct (11px, bold)
  - Border: 2px `var(--background)` gap between rectangles
- Minimum size: if rectangle is too small for text (<40px wide or <30px tall), show only the colored rectangle with no text

### Component

`src/components/dashboard/SectorTreemap.tsx`

Props: `sectors: { sector: string; change_pct: number }[]`, `width: number`, `height: number`

The treemap algorithm is a pure function `squarify(items, width, height) => LayoutRect[]` that returns positioned rectangles. The component renders them as absolutely positioned divs inside a relative container.

---

## File Summary

### New Files (8)

| File | Purpose |
|------|---------|
| `src/components/dashboard/PortfolioHero.tsx` | Equity curve hero with overlaid value |
| `src/components/dashboard/ActivityFeed.tsx` | Feed panel with items |
| `src/components/dashboard/StrategyGrid.tsx` | Strategy cards with enhanced sparklines |
| `src/components/dashboard/MarketContext.tsx` | Indices, treemap slot, allocation |
| `src/components/dashboard/PositionsSummary.tsx` | Open positions card |
| `src/components/dashboard/PnlCalendarMini.tsx` | Calendar with hover tooltips |
| `src/components/dashboard/AllocationDonut.tsx` | Cash vs Invested donut |
| `src/components/dashboard/SectorTreemap.tsx` | Squarified treemap |

### Modified Files (1)

| File | Changes |
|------|---------|
| `src/app/(dashboard)/page.tsx` | Slim down to ~200 lines, import and compose extracted components |
