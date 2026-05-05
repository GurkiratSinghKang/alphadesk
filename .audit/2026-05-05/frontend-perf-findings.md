# Frontend Performance Adversarial Findings (2026-05-05)

Auditor scope: NEW perf bugs since 2026-04-18 audit (audit-reports/04-performance.md). Verified each suspect against existing fixes (perf-audit-r3 P0/P1 fixes already in place — useShallow, per-symbol selectors, leaf-isolated tick heartbeat, deprecated `setLastMessage` removed, dropped `useDataPipeline` polling).

## Summary
- **14 findings: 4 P0, 6 P1, 4 P2**
- Hot paths: `/trade` page (re-render storm via unmemoized derived quote), `OrderBar` (10 useEffects + draft propagation), Toast context (every render new object), bundle waste (`@phosphor-icons/react` not in `optimizePackageImports`).

## Findings (grouped by theme)

---

### Theme 1: Re-render storms in the hot trade path

#### F1 — `/trade` page recomputes `executionQuote` on every render, invalidating 6 downstream `useMemo`s
**Severity:** P0
**File:** `frontend/src/app/(dashboard)/trade/page.tsx:779`
**Evidence:**
```tsx
const quote = toQuote(selectedQuote ?? undefined);          // line 359 — fresh object every render
// …
const executionQuote = buildExecutionQuote(quote);          // line 779 — UN-MEMOIZED, runs each render
// …
const tradePreview = useMemo(() => buildPreTradePreview({…, quote: executionQuote, …}),
  [previewDefaults, executionQuote, …]);                    // line 826 — invalidated every render
const quoteAgeSeconds = useMemo(…, [executionQuote.timestamp]);    // 855
const executionReadiness = useMemo(…, [tradePreview, executionQuote, …]); // 877
```
`buildExecutionQuote` returns a fresh object literal every call (line 1996-2010). Because it's used as a dep in `tradePreview`, `executionReadiness`, plus `chartTradeOverlays` is built inline (line 905), every quote tick on the selected symbol fans out into recomputing all the readiness checks, the pre-trade preview, the `ConfidenceCheck[]`, the chart overlays, and re-renders the OrderBar with new `defaults`. SIP at market open = several hundred ticks/min = several hundred wasted recomputations on a 2,800-line page.

**Impact:** Frame drops on `/trade` during active markets; main offender for INP on the order ticket fields (every keystroke also triggers parent re-render → recompute fan-out).
**Fix:**
```tsx
const quote = useMemo(() => toQuote(selectedQuote ?? undefined), [selectedQuote]);
const executionQuote = useMemo(() => buildExecutionQuote(quote), [quote]);
```
Both lines are 1-line wraps. Combined with stabilising `quote` (see F11), this drops the trade page's per-tick reconcile from O(N depth) to O(1).

---

#### F2 — `OrderBar` `currentDraft` `useMemo` + `onDraftChange` `useEffect` re-fires the parent on every keystroke and every quote tick
**Severity:** P0
**File:** `frontend/src/components/composites/OrderBar.tsx:396-428`
**Evidence:**
```tsx
const currentDraft = React.useMemo<StagedOrder>(() => ({
  strategyId, symbol: (symbolValue || symbol).trim().toUpperCase(),
  side, quantity: qtyNum, type, price: priceNum, …
}), [bracketEnabled, bracketStopNum, extendedHours, extendedHoursSupported,
     priceNum, qtyNum, side, stopNum, strategyId, symbol, symbolValue,   // ← 13 deps
     takeProfitNum, timeInForce, type]);

React.useEffect(() => {
  onDraftChange?.(currentDraft);                             // 426 — fires on every render
}, [currentDraft, onDraftChange]);
```
The trade page passes `onDraftChange={setTicketDraft}` (line 776). Each call enters the parent's setState → parent re-renders → re-passes a new `defaults` object (line 770: `{ ...ORDER_BAR_DEFAULTS, … }` literal) → 5 `useEffect`s in OrderBar (lines 137, 181, 195, 238, 246, 254, 262, 270) re-evaluate looking for `defaults?.X !== last refs`, sometimes triggering more setStates. Worse, the parent's `symbol` prop changes on every quote tick (per F1 fan-out), so OrderBar's symbol-sync `useEffect` (line 195) runs constantly.

**Impact:** Parent `<TradePage>` re-renders on every OrderBar keystroke; OrderBar re-renders on every parent quote tick. Two-way thrash. Every form interaction creates a render storm.
**Fix:** Don't propagate the draft through `onDraftChange` on every render. Only propagate on user-driven changes (debounce 100ms or use a ref + imperative "getDraft()" handle):
```tsx
// Option A — debounce the propagation
React.useEffect(() => {
  const id = setTimeout(() => onDraftChange?.(currentDraft), 100);
  return () => clearTimeout(id);
}, [currentDraft, onDraftChange]);

// Option B — expose imperative ref instead of pushing on every change
React.useImperativeHandle(forwardedRef, () => ({ getDraft: () => currentDraft }));
```
Even better: hoist `currentDraft` derivation to the parent and have OrderBar be fully controlled.

---

#### F3 — `ToastContext.Provider value` is a fresh object literal every render, breaking `useContext` consumers
**Severity:** P0
**File:** `frontend/src/components/ui/toast.tsx:155`
**Evidence:**
```tsx
return (
  <ToastContext.Provider value={{ addToast, dismissToast }}>   // fresh {} every render
    {children}
    …
  </ToastContext.Provider>
);
```
`ToastProvider` re-renders any time `toasts` array changes (every toast appearance/dismiss, every 5s on auto-dismiss timers, every dropped-count update). Because the `value` is a new object literal, every component that calls `useToast()` sees a new context value → re-renders. With `useToast()` used in 30+ places (NotificationCenter, OrderBar parent, AnalysisPanel, dashboard page handlers, etc.), every toast event triggers a full subtree reconcile of the toast-consuming surface area.

**Impact:** Every toast (and every auto-dismiss timer) re-renders the dashboard tree. With pipeline notifications, alert toasts, system notifications hitting steadily during a session, this is a constant source of waste.
**Fix:**
```tsx
const ctxValue = useMemo(() => ({ addToast, dismissToast }), [addToast, dismissToast]);
return <ToastContext.Provider value={ctxValue}>{…}</ToastContext.Provider>;
```
`addToast` and `dismissToast` are already `useCallback`-wrapped (lines 99, 113), so the memo is stable as long as their identities are.

---

#### F4 — `StrategyGrid` passes inline arrow `onClick={() => onStrategyClick(strategy.id)}` to `React.memo`'d `StrategyCard`
**Severity:** P1
**File:** `frontend/src/components/dashboard/StrategyGrid.tsx:294-300, 325-331`
**Evidence:**
```tsx
{grouped.map((strategy, i) => (
  <StrategyCard
    key={strategy.id}
    strategy={strategy}
    regimeLabel={regimeLabel}
    onClick={() => onStrategyClick(strategy.id)}    // new fn every parent render
    index={i}
  />
))}
// …same pattern in CompactStrategyRow at 325-331
```
Both `StrategyCard` (line 32) and `CompactStrategyRow` (line 148) are `React.memo`-wrapped, but the `onClick` identity changes every parent render so the memo bails. The dashboard parent re-renders on every store update + 30s interval (page.tsx:263) + every `useStrategies` poll at 60s. Per F1 the trade page also has overlapping consumers.

**Impact:** Memo is a no-op; with 13+ strategies enabled, that's 13 redundant card re-renders per parent update. Minor on its own but pattern-of-the-day.
**Fix:**
```tsx
// In <StrategyGrid> parent:
const onClick = useCallback((id: string) => onStrategyClick(id), [onStrategyClick]);
// pass:
<StrategyCard … onClick={onClick} />
// inside StrategyCard:
onClick={() => onClick(strategy.id)}   // fine because StrategyCard re-renders with new strategy.id only
// or even better — pass strategy.id once in the Card; bind there.
```

---

### Theme 2: Bundle size waste

#### F5 — `@phosphor-icons/react` is NOT in `optimizePackageImports` — every page that imports a phosphor icon ships the full barrel
**Severity:** P1
**File:** `frontend/next.config.ts:14-16`
**Evidence:**
```ts
experimental: {
  optimizePackageImports: ["lucide-react"],   // phosphor missing
},
```
10 files import from `@phosphor-icons/react` including the dashboard `(dashboard)/page.tsx:13-29` (15 icons), `/trade/page.tsx:33-53` (16 icons), `/strategies/trading-agents-research/page.tsx`, login form, and several auth previews. Without `optimizePackageImports`, Turbopack resolves `import { ArrowRight } from '@phosphor-icons/react'` by loading the package's barrel which re-exports ~1500 icon components, defeating tree-shaking on the dev bundle and bloating the route chunk on prod.

**Impact:** Phosphor's barrel is ~280 KB raw; with proper tree-shaking each icon is ~1 KB. The /trade and /dashboard route chunks include thousands of unused icon definitions. Estimate: +100-150 KB raw / +30-40 KB gzip per dashboard route chunk.
**Fix:**
```ts
experimental: {
  optimizePackageImports: ["lucide-react", "@phosphor-icons/react"],
},
```
One-line config change. Then rebuild and measure.

---

#### F6 — `OptionsPayoffPanel`, `SectorTreemap`, `AllocationDonut`, `StressTest`, `StrategyTemplates` are statically bundled into routes that may not need them
**Severity:** P1
**Files:**
- `frontend/src/app/(dashboard)/trade/page.tsx:63` — `import OptionsPayoffPanel`
- `frontend/src/app/(dashboard)/strategies/earnings-options-play/_earnings/EarningsDetailPanel.tsx:29` — `import OptionsPayoffPanel`
- `frontend/src/components/dashboard/MarketContext.tsx:6-7` — `AllocationDonut` + `SectorTreemap`
- `frontend/src/app/(dashboard)/pipeline/page.tsx:51` — `StrategyTemplates` (modal — only loaded on click)

**Evidence:** `StrategyTemplates` is a modal gated by `templatesOpen` state (line 1470: `<StrategyTemplates open={templatesOpen} onClose={…} />`) — pure modal pattern, only rendered when `open`. Yet it's a static import, so the entire 365-line component + lucide icons + `getStrategies/toggleStrategy` API surface is part of the pipeline page's initial JS. Same shape for `OptionsPayoffPanel` (266 LOC + SVG path math — used only when an option deep-link is staged) and `SectorTreemap` (425 LOC including squarified treemap algorithm + ResizeObserver — only renders when sectors data exists).

**Impact:** Bundle weight on /pipeline + /trade is materially heavier than necessary. /pipeline ships StrategyTemplates' 365 LOC + 11 lucide icons + `getStrategies/toggleStrategy` paths even though >95% of pipeline visitors never click the templates button.
**Fix:**
```tsx
// pipeline/page.tsx
const StrategyTemplates = dynamic(
  () => import("@/components/panels/StrategyTemplates").then(m => ({ default: m.StrategyTemplates })),
  { ssr: false }
);
// trade/page.tsx
const OptionsPayoffPanel = dynamic(() => import("@/components/options/OptionsPayoffPanel"), { ssr: false });
// MarketContext.tsx — keep static (it's the dashboard hero) BUT split SectorTreemap so its 425-LOC squarify algorithm + tooltip handlers split out:
const SectorTreemap = dynamic(() => import("./SectorTreemap").then(m => m.SectorTreemap), { ssr: false });
```

---

#### F7 — `AllocationDonut`, `PositionsList`, `IVTermSkew`, `CalendarWeekHeatmap` declared `"use client"` but contain zero client-only behavior
**Severity:** P2
**Files:**
- `frontend/src/components/dashboard/AllocationDonut.tsx:1` — `"use client"` but no state/effects/handlers, pure SVG from props
- `frontend/src/app/(dashboard)/strategies/earnings-options-play/_earnings/IVTermSkew.tsx` — no `"use client"` AND no state — already correctly server-shaped (good template)
- `frontend/src/app/(dashboard)/strategies/earnings-options-play/_earnings/CalendarWeekHeatmap.tsx:1` — `"use client"` but only invokes `onSelect` (a prop) on click; no effects, no state. The handler can stay client; the body should be server.

**Evidence:** `AllocationDonut` is a pure function of `cash, invested, equity, buyingPower, unrealizedPnl, realizedPnlToday, isDemo` props that returns SVG. No `useState`, no `useEffect`, no event handlers. Yet `"use client"` forces it (and its lucide icon imports if any) into the client bundle.

**Impact:** Marginal — the components are small. But each "use client" boundary widens the client tree; AllocationDonut imports `formatCurrency` which pulls Intl.NumberFormat (already in the bundle), and the import edge prevents Next from server-rendering the SVG, which means hydration cost on every dashboard mount.
**Fix:** Remove `"use client"` from AllocationDonut entirely. For CalendarWeekHeatmap, split: the visual layout becomes a server component, and the `onSelect` callback is wired by a thin client wrapper.

---

### Theme 3: Polling & timer waste

#### F8 — `useMarketDepth` polls Level-2 endpoint every 5s for the active chart symbol, even when nothing on screen renders depth
**Severity:** P1
**File:** `frontend/src/hooks/useMarketDepth.ts:48`
**Evidence:**
```ts
const query = useQuery({
  queryKey: ["market-depth", symbol.toUpperCase()],
  queryFn: () => getMarketDepth(symbol, 10),
  enabled: Boolean(symbol),
  staleTime: 2_000,
  gcTime: 30_000,
  refetchInterval: 5_000,                      // ← 5s poll, no visibility gate
  retry: 1,
});
```
Used by `PriceChartPanel` (composites/PriceChartPanel.tsx:127) which mounts on every chart-bearing dashboard panel. The hook polls a backend endpoint (`getMarketDepth`) every 5s for the entire chart lifecycle, with no `document.hidden` gate, no "is depth panel open" gate, no `enabled` toggle when the user navigates to a different tab.

**Impact:** Every active dashboard tab fires 12 backend requests/min/symbol for L2 depth that may not even be rendered (the `topOfBookOn` toggle in ChartPane:420 defaults true, but `liquidityProfileOn`/`structureZonesOn` default false). On the chart-bearing /trade page, that's 720 backend requests/hour just for L2. Multiply by N concurrent users.
**Fix:**
```ts
const visible = typeof document === "undefined" ? true : document.visibilityState === "visible";
const query = useQuery({
  …,
  refetchInterval: visible ? 5_000 : false,
  refetchIntervalInBackground: false,         // explicit
  enabled: Boolean(symbol) && depthEnabled,    // gate on whether the consumer renders depth
});
```
Or push depth onto the existing WS `quotes` channel (single fan-out instead of N polled clients).

---

#### F9 — `NotificationCenter` ticker re-renders the entire popover every 30s even when the popover is closed
**Severity:** P1
**File:** `frontend/src/components/layout/NotificationCenter.tsx:113-117`
**Evidence:**
```tsx
const [, setTick] = useState(0);
useEffect(() => {
  const id = setInterval(() => setTick((t) => t + 1), 30_000);
  return () => clearInterval(id);
}, []);
```
The `setTick` only matters when the popover is open and rendering relative-time strings ("just now" / "2m ago"). But the timer fires unconditionally whenever the component is mounted (which is every dashboard route via the TopBar). Forcing a state update every 30s re-runs the `unreadCount` useMemo, the `filtered` useMemo, and re-evaluates every notification's `count` (loops `notifications` 4× — once per tab). With many notifications (cap 50 visible × 4 tab counts) that's >200 array operations every 30s on every dashboard tab.

Also, even when the user has the popover closed, the body of the component creates a `<Popover>` child tree (PopoverContent renders inside a portal) — Base UI's PopoverContent typically returns null when closed but still re-runs the JSX construction.

**Impact:** Background CPU waste on every dashboard tab. With dozens of notifications during the day this becomes the dominant timer-driven re-render.
**Fix:** Gate the interval on the popover open state:
```tsx
const [open, setOpen] = useState(false);
useEffect(() => {
  if (!open) return;                          // only tick while user is viewing
  const id = setInterval(() => setTick((t) => t + 1), 30_000);
  return () => clearInterval(id);
}, [open]);

// Then drive the Popover open prop:
<Popover open={open} onOpenChange={setOpen}>…</Popover>
```

---

#### F10 — `/trade` page polls `getOrders` every 20s independently of the dashboard's existing 30s order poll
**Severity:** P1
**File:** `frontend/src/app/(dashboard)/trade/page.tsx:527`
**Evidence:**
```ts
useEffect(() => {
  let cancelled = false;
  async function fetchRecent() {
    const status = orderFilter === "working" ? "open" : orderFilter === "all" ? undefined : orderFilter;
    const orders = await getOrders(status);
    if (!cancelled) setRecentOrders(orders.slice(0, 50));
  }
  fetchRecent();
  const id = setInterval(fetchRecent, 20_000);     // ← 20s, no visibility gate
  return () => { cancelled = true; clearInterval(id); };
}, [orderFilter]);
```
Meanwhile dashboard `(dashboard)/page.tsx:263` polls `getOrders()` every 30s. Both push results into the same `usePortfolioStore` orders bucket via different paths. Plus the WS `portfolio` channel pushes orders too.

**Impact:** When the user is on `/trade`, the app is firing `GET /trades/orders` ~3 times/min (20s) plus 2 times/min from the dashboard timer (still mounted via the layout) plus WS pushes. Each REST call goes through the single Gunicorn worker.
**Fix:** Drop the trade page's 20s `setInterval`. Read from `usePortfolioStore.orders` directly (already populated by WS push and the dashboard's 30s poll), filter on `orderFilter` via `useMemo`. Keep a single one-shot fetch on mount.
```ts
useEffect(() => {
  void getOrders().then(orders => usePortfolioStore.getState().setOrders(orders));
}, []);
const recentOrders = usePortfolioStore(s => s.orders);
const filteredRecentOrders = useMemo(() => filter(recentOrders, orderFilter), [recentOrders, orderFilter]);
```

---

#### F11 — `MultiTimeframe` polls 4 separate bar endpoints every 60s with no visibility gate and no React Query
**Severity:** P2
**File:** `frontend/src/components/panels/MultiTimeframe.tsx:198-202`
**Evidence:**
```ts
useEffect(() => {
  if (!selectedSymbol) return;
  const interval = setInterval(() => fetchAllTimeframes(selectedSymbol), 60000);
  return () => clearInterval(interval);
}, [selectedSymbol, fetchAllTimeframes]);
```
`fetchAllTimeframes` makes 4 parallel `getBars` calls (one per timeframe). Every 60s, this hammers the backend with 4 sequential bar fetches even if the panel is hidden behind a tab/collapse.

**Impact:** 4 bar fetches/min/symbol per mounted instance. If the panel mounts on multiple charts, multiplies.
**Fix:** Use React Query (`useQueries`) with `refetchInterval: 60_000` and `refetchIntervalInBackground: false` for built-in visibility gating, deduping, and AbortController support.

---

### Theme 4: Effect cleanup & subscription hygiene

#### F12 — `ChartPane` adds `keydown`/`keyup` window listeners that fire on EVERY keystroke and call `setShiftHeld` even when `e.shiftKey` hasn't changed
**Severity:** P2
**File:** `frontend/src/components/charts/ChartPane.tsx:646-656`
**Evidence:**
```tsx
const [shiftHeld, setShiftHeld] = React.useState(false);
React.useEffect(() => {
  function onKey(e: KeyboardEvent) {
    setShiftHeld(e.shiftKey);                  // ← fires on every keystroke
  }
  window.addEventListener("keydown", onKey);
  window.addEventListener("keyup", onKey);
  return () => {
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("keyup", onKey);
  };
}, []);
```
React batches but the comparison `setShiftHeld(false)` when already `false` still hits the reducer + bail-out path; on every keystroke ChartPane evaluates `setShiftHeld`. With ChartPane being 2,093 LOC and 20 useMemos, even a bail-out reconcile is non-trivial.

Worse, when the user is typing in the OrderBar (text input on the trade page), every keystroke fires this. With an active multi-chart layout this fires for every chart instance.

**Impact:** Typing in any input on the trade page invokes ChartPane's reducer; minor but compounds with F1/F2.
**Fix:** Compare before set:
```tsx
function onKey(e: KeyboardEvent) {
  setShiftHeld(prev => prev === e.shiftKey ? prev : e.shiftKey);
}
```
And listen only for `keydown` of `Shift` (not every key) plus `keyup` of `Shift`:
```tsx
function onDown(e: KeyboardEvent) { if (e.key === "Shift") setShiftHeld(true); }
function onUp(e: KeyboardEvent) { if (e.key === "Shift") setShiftHeld(false); }
```

---

#### F13 — Dashboard pipeline-leaf `LastTickStatusBar` re-renders every 2s via `Date.now()` even when no quote has arrived
**Severity:** P2
**File:** `frontend/src/app/(dashboard)/page.tsx:2458-2487`
**Evidence:**
```tsx
const [nowMs, setNowMs] = useState(0);
useEffect(() => {
  // …
  setNowMs(Date.now());
  id = setInterval(() => setNowMs(Date.now()), 2_000);
  // …
}, []);

const lastTickSec = useMemo(() => {
  const ts = getFreshestQuoteTimestamp();
  if (!ts || nowMs <= 0) return undefined;
  …
}, [nowMs]);
```
The 2s heartbeat fires unconditionally when the tab is visible. But `getFreshestQuoteTimestamp()` is read from a Zustand store imperatively, so `lastTickSec` only depends on `nowMs`, not on actual quote arrivals. Result: the Last Tick pill re-renders every 2s with the same value when the market is closed (no quotes flowing).

**Impact:** 30 wasted re-renders/min on every dashboard tab. Each re-render runs the `pills` useMemo (which slices and rewrites the array). Background tab gating is in place (good), but visible-tab gating to "is anything actually moving?" is missing.
**Fix:** Subscribe to the freshest timestamp via Zustand directly so the component only re-renders when a quote actually arrives. Use the 2s tick only for cosmetic rounding:
```tsx
const lastQuoteTs = useMarketStore(s => getFreshestQuoteTimestamp());  // re-renders only when ts changes
// drop nowMs entirely — compute relative duration in render via Date.now()
const lastTickSec = lastQuoteTs ? (Date.now()/1000 - lastQuoteTs) : undefined;
```

---

#### F14 — `NotificationCenter` recomputes `count` 4× per tab on every render — once per filter
**Severity:** P2
**File:** `frontend/src/components/layout/NotificationCenter.tsx:178-202`
**Evidence:**
```tsx
{TABS.map((tab) => {
  const count =
    tab.value === "all"
      ? notifications.filter((n) => !n.read).length              // O(N) scan
      : notifications.filter((n) => n.category === tab.value && !n.read).length;
  …
})}
```
With 4 tabs (`all`, `trades`, `alerts`, `pipeline`, `system` — actually 5), the `notifications` array is scanned 5 times per render. Combined with F9's 30s tick + every NotificationCenter re-render from popover state, that's a lot of array scans for what should be a single grouping.

**Impact:** Marginal but easy fix.
**Fix:** Single-pass reduce via `useMemo`:
```tsx
const counts = useMemo(() => {
  const acc: Record<string, number> = { all: 0, trades: 0, alerts: 0, pipeline: 0, system: 0 };
  for (const n of notifications) {
    if (n.read) continue;
    acc.all++;
    acc[n.category] = (acc[n.category] ?? 0) + 1;
  }
  return acc;
}, [notifications]);
// then in render: count={counts[tab.value]}
```

---

## Methodology notes

- All findings verified against current code on `feature/deployment` (HEAD `bc37a59b`). Each carries a real file:line reference.
- Skipped issues already identified in `audit-reports/04-performance.md` (quote-storm selectors via useShallow, `setLastMessage` removal, `getSnapshot` bulk endpoint, etc.). Spot-checked: those fixes are in place.
- Skipped purely visual / typography findings (those belong to `qa/reviews/UI-REVIEW-R5.md`).
- Did not run a build to measure exact bundle sizes — a run with `@next/bundle-analyzer` would confirm F5/F6 deltas. The findings are based on import patterns and known Next.js + Turbopack behaviour.
- Hydration-risk audit clean: no `Math.random()` / `window` in SSR-rendered render bodies (the few `Date.now()` callsites are inside `useEffect` or in client-only id generators, so they don't cause hydration mismatch).
