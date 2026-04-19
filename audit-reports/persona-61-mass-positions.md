# Persona 61 — Mass Positions (500 open positions)

Scope: does the Book/Positions list virtualize? Any O(N^2) frontend code?
Synthetic 500-row mount test + static grep.

## Verdict

**No virtualization anywhere in the app.** zero imports of `react-window`,
`react-virtual`, `@tanstack/react-virtual`, `FixedSizeList`, `VariableSizeList`
or `useVirtualizer` across `frontend/src`. All position/order/trade lists
render every row in a single `.map(...)` call into the DOM.

Synthetic 500-row test of the real `<PositionsList>` (new file at
`frontend/src/__tests__/composites/PositionsList.perf.test.tsx`):

- `li` nodes rendered: **500** (would be ~20–30 if virtualized)
- JSDOM mount time: **407 ms** first paint; browser layout/paint is strictly
  worse because JSDOM skips compositing and font metrics.
- DOM size per row: grid with 3 columns + 2 nested `<PnLNumber>` components,
  so ~15 elements × 500 = ~7,500 nodes just for this one pane.

## Findings (10 max)

1. **PositionsList renders all rows — no windowing.**
   `frontend/src/components/composites/PositionsList.tsx:206` — `positions.map(...)`
   yields one `<li>` per position. No `React.memo` on the row. 500 rows →
   500 live `<button>` click handlers + 500 `<PnLNumber>` subtrees.

2. **500 bar-chart API requests on mount.**
   `frontend/src/components/dashboard/PositionsSummary.tsx:35-52` — issues
   one `getBars(sym, "D", 20)` per position in `Promise.allSettled`. With
   500 positions this fires 500 concurrent HTTP requests and sets
   `sparkData` state 500 times (one setter per-batch thanks to the final
   `.then`, but the fetch storm hits the backend at mount).

3. **O(N) per-click lookup in page.tsx.**
   `frontend/src/app/(dashboard)/page.tsx:553` — `positionRows.find(r => r.id === id)`
   runs linearly on every row click. Benign at 500 (one lookup), but if
   wired to a bulk action it would become O(N²).

4. **TradePanel "close all" / "flatten" fires N concurrent orders.**
   `frontend/src/components/panels/TradePanel.tsx:608,630` — `Promise.all(positions.map(placeOrder))`
   with no batching or throttle. 500 positions = 500 simultaneous order
   POSTs; the backend rate limit (or broker API) will almost certainly
   fan-fail.

5. **Stress test: two sorts + two filters over positions.**
   `frontend/src/components/dashboard/StressTest.tsx:134-180` — `.map` then
   `.sort` then `[...results].sort(...)` then `positions.filter(isTechPosition)`
   then another `.sort`. O(N log N) but with a constant of 4 passes; at 500
   rows fine, but recomputed on every render because `computeStressResult`
   is not memoised at the call site.

6. **Tax report does 4 filter+reduce passes.**
   `frontend/src/app/(dashboard)/reports/page.tsx:487-494` — `shortTermTrades.filter(...).reduce(...)`
   repeated 4× over the same array. Should be a single pass. Scales with
   trade count, not positions, but same pattern.

7. **CSV export materialises the full table in memory.**
   `frontend/src/app/(dashboard)/reports/page.tsx:132,230` — `positions.map(p => [...])`
   to build a 2D array, then the full positions table renders into the DOM
   again at :230 (no windowing in `<table><tbody>` either).

8. **`useQuotes(positionSymbols)` loops all symbols per tick.**
   `frontend/src/stores/market.ts:249-260` — the selector rebuilds the
   returned record by iterating `stableSymbols` on every store change. At
   500 symbols + every WS tick, the shallow-compare walks 500 entries. OK
   for now (Zustand's `useShallow` short-circuits on equal refs), but the
   constant is 500× higher than the designer assumed.

9. **`positionSymbols` memo key is the whole array.**
   `frontend/src/components/panels/TradePanel.tsx:674-677` — `useMemo(..., [positions])`
   so any mutation (including a single P&L update from quote stream) busts
   the memo and rebuilds the 500-entry symbol array, which then invalidates
   `useQuotes`.

10. **PositionsSection strategy table — no row memo, no virtualization.**
    `frontend/src/app/(dashboard)/strategies/[id]/_strategy/PositionsSection.tsx:88` —
    `positions.map(p => <tr>...</tr>)` into an HTML `<table>`. `<table>`
    layout is inherently O(N) in reflow; browsers cannot incrementally
    layout a table, so 500 rows makes every width recalc full-scan.

## Summary (250 words)

A trader with 500 open positions will see real jank. AlphaDesk has **no
virtualization layer** anywhere — a grep of `react-window|react-virtual|
virtualize|FixedSizeList|VariableSizeList|useVirtualizer` across
`frontend/src` returns zero component matches; only `react-query` trips
the regex. The synthetic 500-row test I added at
`frontend/src/__tests__/composites/PositionsList.perf.test.tsx` confirms
`<PositionsList>` materialises every row: 500 `<li>` nodes asserted,
407 ms mount time in JSDOM, roughly 7.5k DOM nodes for just the Book
pane. Every WebSocket quote tick rerenders the same tree because
neither the list nor the row is wrapped in `React.memo`, so props
identity churns on every store update.

No true O(N²) loop on the hot rendering path — each position array is
walked once per render. But three O(N) patterns multiply badly at
N=500. `PositionsSummary` fires **one `getBars` HTTP request per
position** on mount (`components/dashboard/PositionsSummary.tsx:35-52`);
500 parallel requests hit the backend before any sparkline paints.
`TradePanel`'s close-all and flatten actions do
`Promise.all(positions.map(placeOrder))` with no batching or
concurrency cap (`TradePanel.tsx:608,630`) — the broker gateway will
rate-limit. The strategy-scoped `PositionsSection` renders a classic
`<table>` with 500 `<tr>` children; table layout is O(N) per reflow and
cannot be chunked by the browser.

The `useQuotes` shallow selector (`stores/market.ts:249`) walks all
symbols on every store change; at 500 positions that is a 500-entry
loop per tick plus a fresh symbol-array allocation whenever the
positions slice mutates (`TradePanel.tsx:674`).

Minimum fix: wrap `<PositionsList>`'s Positions and Orders branches
with `@tanstack/react-virtual`, memoise the row as
`React.memo(PositionRow)`, and batch the sparkline fetch behind one
bulk `getBars` endpoint or throttled chunks of 10–20.
