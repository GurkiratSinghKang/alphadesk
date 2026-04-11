# Pipeline & Strategy Polish — Design Spec

Sub-project 3 of the AlphaDesk UI/UX overhaul. 4 items: pipeline flow diagram, history previews, strategy tabs repositioning, benchmark comparison line.

## Implementation Order

1. Pipeline Flow Diagram
2. History Table Previews
3. Strategy Tabs Repositioning
4. Benchmark Comparison Line

---

## 1. Pipeline Flow Diagram

Horizontal staged-arrow visualization in the "Today's Pipeline Run" section.

### Layout

```
[ 12 Screened ] → [ 3 Analyzed ] → [ 2 Signals ] → [ 1 Order ]
```

- Each stage: rounded box with count + label
- Arrows: `→` character or SVG chevron between boxes
- Colors: stage with count > 0 uses `var(--primary)` border/text; zero stages use muted border
- When no pipeline run today: all stages show `0` in muted style with the "No run today" hint below
- When run data exists: counts from `todayRun.screened.length`, `todayRun.analyzed.length`, `todayRun.signals.length`, `todayRun.ordersPlaced.length`

### File

- Modify: `frontend/src/app/(dashboard)/pipeline/page.tsx` — replace the "Today's Pipeline Run" section content

---

## 2. History Table Previews

Show a compact inline summary instead of "Click to expand" in the history table.

### Current

```
| Date       | Summary         |
|------------|-----------------|
| 2026-04-10 | Click to expand |
```

### New

```
| Date       | Summary                        |
|------------|--------------------------------|
| 2026-04-10 | 5 screened · 2 orders · +$297  |
```

### Data

The history entries from `getPipelineHistory()` return objects with fields that may include `screened`, `analyzed`, `orders_placed`, and `portfolio_snapshot`. Derive the summary:
- Screened count: `h.screened ?? 0`
- Orders count: `h.orders_placed ?? h.ordersPlaced ?? 0`
- P&L: not directly available per-run — show just screened + orders counts

### File

- Modify: `frontend/src/app/(dashboard)/pipeline/page.tsx` — update the history table cell rendering

---

## 3. Strategy Tabs Repositioning

Move tabs from the bottom of the strategy detail page to directly below the metrics row.

### Current Layout

```
Equity Curve
Metrics Row
Trade History
[... scrolls down ...]
About | Positions | Sector Exposure | Correlation | Analytics  ← buried at bottom
```

### New Layout

```
Equity Curve
Metrics Row
[ About | Positions | Sector Exposure | Correlation | Analytics ]  ← prominent
Trade History (inside "About" tab or always visible)
```

### Implementation

- The tabs currently wrap content sections at the page bottom
- Move the `Tabs` component to wrap everything below the metrics row
- Make the tab bar visually prominent: larger text, border-bottom indicator, full-width
- "About" tab shows the strategy thesis + parameters (current content below tabs)
- "Positions" tab is currently empty — keep as-is
- Trade History stays visible in all tabs (or becomes its own tab)

### File

- Modify: `frontend/src/app/(dashboard)/strategies/[id]/page.tsx` — restructure layout to put tabs higher

---

## 4. Benchmark Comparison Line

Overlay a semi-transparent SPY return line on the strategy equity curve.

### Visual

- Strategy line: existing green/red solid line (2.5px)
- Benchmark line: `#71717a` (muted gray) at 1px, `opacity: 0.5`
- Both normalized to % return from start (not absolute values)
- Legend: small labels at top-right of the chart: `● Strategy  ● SPY`

### Data

- Strategy equity curve: already available from `getStrategyPerformance()`
- SPY benchmark: fetch from `getBars("SPY", "D", equityCurve.length)` — get daily closes matching the equity curve date range
- Normalize both: `(value / firstValue - 1) * 100` to get % return

### Implementation

- In the `EquityCurve` component, add a `benchmark` prop: `{ date: string; value: number }[]`
- Render a second `<polyline>` with the benchmark data, using muted color and lower opacity
- Add a small legend with two colored dots + labels
- The parent fetches SPY bars when equity data loads and passes as prop

### Files

- Modify: `frontend/src/app/(dashboard)/strategies/[id]/page.tsx` — fetch SPY bars, pass benchmark prop
- The EquityCurve component is defined inline in this file — add benchmark rendering there

---

## File Summary

### Modified Files (2)

| File | Changes |
|------|---------|
| `frontend/src/app/(dashboard)/pipeline/page.tsx` | Flow diagram + history previews |
| `frontend/src/app/(dashboard)/strategies/[id]/page.tsx` | Tabs repositioning + benchmark line |
