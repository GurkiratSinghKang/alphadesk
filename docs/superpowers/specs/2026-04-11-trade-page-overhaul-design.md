# Trade Page Overhaul — Design Spec

Sub-project 2 of the AlphaDesk UI/UX overhaul. Adds 5 features to the trade page: L1 data bar, watchlist sorting, order entry tab, position indicator lines, and resizable options chain.

## Implementation Order

1. L1 Data Bar (ChartPanel header)
2. Watchlist Click-to-Sort (WatchlistPanel)
3. Order Entry Tab (AnalysisPanel)
4. Position Indicator Lines (ChartPanel + TradingChart)
5. Resizable Options Chain + Full-Screen Toggle (trade/page.tsx)

---

## 1. L1 Data Bar

Compact quote strip below the symbol name in the chart header.

### Layout

```
SPY  $679.35  -0.52 (-0.08%)
679.30 / 679.35  spread: 0.05  |  Vol: 12.4M  |  H: 682.18  L: 678.03
```

### Details

- Second line: 11px, `text-muted-foreground`, `tabular-nums`
- Bid styled in `text-[var(--profit)]`, Ask in `text-[var(--loss)]`
- Spread: absolute difference `ask - bid`, neutral color
- Volume: formatted with compact notation (`formatNumber(vol, true)`)
- High/Low: from quote data (`quote.high`, `quote.low`)
- All data from `useMarketStore` quotes — no new API calls

### File

- Modify: `frontend/src/components/panels/ChartPanel.tsx` — add a second line below the existing symbol/price header

---

## 2. Watchlist Click-to-Sort

Sortable column headers in the watchlist.

### Behavior

- Column headers become clickable buttons
- Click toggles sort: `default → descending → ascending → default`
- Active sort column shows ▲ (ascending) or ▼ (descending) indicator
- Sort keys: `"default"` (insertion order), `"symbol"`, `"last"`, `"changePct"`
- Default: insertion order (current behavior)

### State

```tsx
const [sortKey, setSortKey] = useState<"default" | "symbol" | "last" | "changePct">("default");
const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
```

### Implementation

- `useMemo` computes sorted list from `watchlist + quotes` based on `sortKey` and `sortDir`
- Column header click handler cycles through sort states
- The sort indicator (▲/▼) renders next to the active column name

### File

- Modify: `frontend/src/components/panels/WatchlistPanel.tsx` — add sort state, sorted memo, clickable headers

---

## 3. Order Entry Tab

New "Order" tab in the analysis panel right sidebar.

### Tab Bar

`Tech | Fund | Sent | Chat | Order`

### Form Layout

```
┌─────────────────────────┐
│  [  BUY  ] [  SELL  ]   │  ← side toggle pills
│                         │
│  Quantity    [  10  ±]   │  ← number input with steppers
│                         │
│  Order Type  [Market ▾]  │  ← dropdown
│                         │
│  Price       [ 260.43 ]  │  ← shown for limit/stop only
│                         │
│  TIF    [Day] [GTC]      │  ← toggle pills
│                         │
│  ─────────────────────  │
│  Est. Cost    $2,604.30  │  ← preview
│  Commission   $0.00      │
│                         │
│  [ Buy 10 AAPL @ Market ]│  ← submit button, green/red
└─────────────────────────┘
```

### Details

- Side toggle: `Buy` in green bg, `Sell` in red bg. Active state has ring highlight.
- Quantity: `<input type="number">` with min=1, +/- buttons on sides
- Order type: `select` dropdown with Market, Limit, Stop, Stop Limit
- Price input: disabled/hidden for Market, visible for Limit/Stop/Stop Limit
- TIF: `Day` / `GTC` small pill toggle
- Preview: computed from `quantity * price` (for limit) or `quantity * quote.last` (for market)
- Submit calls `placeOrder()` from `@/lib/api`
- Success fires `toast({ type: "success", message: "Order placed: Buy 10 AAPL @ Market" })`
- Error fires `toast({ type: "error", message: errorDetail })`
- Uses selected symbol from `useMarketStore`

### File

- Modify: `frontend/src/components/panels/AnalysisPanel.tsx` — add `OrderTab` function component (~120 lines) and add to tabs array

---

## 4. Position Indicator Lines

Horizontal dashed lines on the chart showing entry, stop loss, and take profit for held positions.

### Lines

| Line | Color | Style | Label |
|------|-------|-------|-------|
| Entry | `var(--primary)` blue | dashed | "Entry $121.43" |
| Stop Loss | `var(--loss)` red | dashed | "SL $108.15" |
| Take Profit | `var(--profit)` green | dashed | "TP $125.22" |

### Data Source

- Positions from `getPositions()` — provides `symbol`, `avgCost`
- Pipeline positions from `getPipelinePositions()` — provides `stopLoss`, `takeProfit`
- Match by symbol against the currently selected chart symbol
- Only show lines when a position exists for the viewed symbol

### Implementation

- `ChartPanel.tsx`: fetch positions on mount, pass matching position data to `TradingChart`
- `TradingChart.tsx` (uses `lightweight-charts` library): use `series.createPriceLine()` API to add/remove horizontal lines
- Price lines are removed and re-created when the symbol changes
- Labels positioned on the right edge of the chart

### Files

- Modify: `frontend/src/components/panels/ChartPanel.tsx` — add position data fetching and pass to TradingChart
- Modify: `frontend/src/components/charts/TradingChart.tsx` — add `createPriceLine()` calls in useEffect

---

## 5. Resizable Options Chain + Full-Screen Toggle

### Default Height

Increase from ~150px to 250px.

### Drag Handle

- 6px grab bar on the top edge of the options panel
- `cursor: row-resize` on hover
- `onMouseDown` starts drag, `onMouseMove` updates height, `onMouseUp` stops
- Constraints: min chart height 200px, min options height 100px, max options height 70% of viewport
- Styled: thin line with subtle dots/grip indicator, `bg-border hover:bg-primary/30`

### Full-Screen Toggle

- Small expand icon button (Maximize2 from lucide) in the options panel header, next to existing controls
- Click sets `optionsFullScreen` state to `true`, which:
  - Hides the chart and analysis panel
  - Options chain fills the entire content area below the symbol header
  - Button icon switches to Minimize2
- Click again restores the split layout

### State

```tsx
const [optionsPanelHeight, setOptionsPanelHeight] = useState(250);
const [optionsFullScreen, setOptionsFullScreen] = useState(false);
```

### File

- Modify: `frontend/src/app/(dashboard)/trade/page.tsx` — restructure layout with controlled height, drag handler, full-screen toggle state

---

## File Summary

### Modified Files (5)

| File | Changes |
|------|---------|
| `frontend/src/components/panels/ChartPanel.tsx` | L1 data bar + position data pass-through |
| `frontend/src/components/charts/TradingChart.tsx` | Price lines for entry/SL/TP |
| `frontend/src/components/panels/WatchlistPanel.tsx` | Sortable column headers |
| `frontend/src/components/panels/AnalysisPanel.tsx` | OrderTab component + tab entry |
| `frontend/src/app/(dashboard)/trade/page.tsx` | Resizable options + full-screen toggle |
