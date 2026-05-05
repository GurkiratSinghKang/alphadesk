# AlphaDesk Frontend Audit — 2026-05-05

**Scope:** `frontend/src/app/`, `frontend/src/components/`, `frontend/src/lib/`, `frontend/src/hooks/`, `frontend/src/stores/`, design-tokens.css
**Reviewer model:** claude-sonnet-4-6
**Branch:** feature/deployment
**Tests at time of audit:** 1009 passing, typecheck clean
**Note:** 41 pre-existing lint problems (mostly `no-explicit-any` in test mocks + `react-hooks/set-state-in-effect`) are not re-flagged unless they produce new findings.

---

## P0 — Critical (trade-correctness / money at risk)

---

### P0-1 · `marketOpen` is memoized with an empty dep array — stale on every render

**File:** `frontend/src/app/(dashboard)/trade/page.tsx:865`

```ts
const marketOpen = useMemo(() => isMarketOpen(), []);
```

`isMarketOpen()` is a pure function of `new Date()` — it has no React state inputs, so `useMemo` caches the result from the **first render** and never recomputes it. A user who opens the `/trade` page before market open (e.g., 09:15 ET) will see `marketOpen = false` for the entire session. `buildExecutionReadiness` uses this value as the gate on the "Market is closed — no live quote" vs. "Feed delayed" distinction.

More critically: at market open (09:30 ET) `executionReadiness.canSubmit` may remain `false` with `"Market closed · awaiting next session open."` blocker copy even though the market is now open and a fresh bid/ask is live. The submit button stays locked until a navigation or re-mount that recalculates the memo.

On submit, `handleSubmit` calls `isMarketOpen()` directly (line 630: `marketOpen: isMarketOpen()`), so the actual gate check on the server-path is fine — but the UI pill tells the trader they cannot submit when they actually can. **A trader with a live account sees "Awaiting market open" and manually finds a workaround (refreshing, or trusting the pill is wrong) rather than trusting the interface.**

**Fix:** Replace the stale memo with a live value:

```ts
const [marketOpen, setMarketOpen] = useState(() => isMarketOpen());
useEffect(() => {
  const id = setInterval(() => setMarketOpen(isMarketOpen()), 30_000);
  return () => clearInterval(id);
}, []);
```

Or simply call `isMarketOpen()` inline inside the `buildExecutionReadiness` memo where it is already called correctly in `handleSubmit`.

**Confidence: 95**

---

### P0-2 · Multi-leg `?legs=` parser does not guard on minimum part count

**File:** `frontend/src/app/(dashboard)/trade/page.tsx:237–248`

```ts
for (const raw of legsParam.split(",")) {
  const parts = raw.split(":");
  if (parts.length < 1) continue;          // ← always false; String.split always returns ≥1 element
  const [occ, rawSide, rawQty, rawLimit] = parts;
  const parsed = parseOccSymbol(occ);
  if (!parsed) continue;
  const orderSide: "buy" | "sell" = rawSide === "sell" ? "sell" : "buy";
  const qty = parseInt(rawQty ?? "1", 10) || 1;
```

The guard `parts.length < 1` is vacuously false — `"".split(":")` returns `[""]`, so the loop proceeds with `occ = ""`, `rawSide = undefined`, `rawQty = undefined`. `parseOccSymbol("")` returns `null`, so `parsed` is null and the loop `continue`s. No order corruption results from a completely empty segment — but a malformed segment like `":sell:1"` (leading colon) resolves `occ = ""`, fails `parseOccSymbol`, and silently drops the leg rather than surfacing an error.

The intended guard is `parts.length < 3` (OCC + side + qty are the three mandatory fields). Without this guard, a deep-link with a truncated leg (e.g., from a copy-paste that clips a colon) silently submits a **fewer-leg combo** than the user staged, changing the risk profile of the trade without any warning.

**Fix:**

```ts
if (parts.length < 3) continue; // require at minimum OCC:side:qty
```

**Confidence: 88**

---

### P0-3 · `handleSubmit` in `trade/page.tsx` is a plain `async function` inside the render body — stale closure on every deps change

**File:** `frontend/src/app/(dashboard)/trade/page.tsx:546`

`handleSubmit` is declared as a regular `async function` (not `useCallback`) inside the component body. It closes over `activeLegs`, `legsUnavailable`, `comboType`, `quoteAtFillTs`, `executionQuote`, `brokerDegraded`, `seriesError`, `seriesLoading`, `portfolioPositions`, `portfolioSummary`, and `recentOrders`.

The chart overlay `buildChartTradeOverlays` builds the `submit` callback at memo time:

```ts
submit: () => { void handleSubmit(chartOrderDraft); },
```

`chartOrderDraft` is memoized, but the `handleSubmit` it closes over is the one from the last render where `buildChartTradeOverlays` ran. If `legsUnavailable` changed between that render and the submit click (e.g., the retry effect just cleared it), the guard `deriveLegReadiness` inside `handleSubmit` reads stale `legsUnavailable` from the stale closure.

**Consequence:** A trader clicks "Submit" from the chart overlay precisely as the retry effect clears `legsUnavailable`. The stale closure re-runs `deriveLegReadiness` with the old "blocked" state, shows the "resolve gate first" error, and the order is not placed. This is a denial-of-service rather than incorrect submission — but it is still a trade-correctness issue.

**Fix:** Wrap `handleSubmit` in `useCallback` with the full dependency array, or read `legsUnavailable` from the Zustand store snapshot inside the function rather than from the closure.

**Confidence: 82**

---

## P1 — Important (functional bugs, incorrect UX, a11y blockers)

---

### P1-1 · `routeVenue` and `trailingStop` fields are collected but never submitted

**File:** `frontend/src/components/composites/OrderBar.tsx:231, 858–860`

```ts
const [routeVenue, setRouteVenue] = React.useState("smart");
const [trailingStop, setTrailingStop] = React.useState("");
```

`currentDraft` (the `StagedOrder` object emitted via `onDraftChange` and passed to `onSubmit`) does not include `routeVenue` or `trailingStop`. The `StagedOrder` type has no `routeVenue` or `trailingStop` fields. Both are captured into local state and rendered with full UI affordance in the Advanced section, but silently dropped on `stage()`. The submit note at line 885 even acknowledges this:

> "Route, risk size, and trailing stop remain planning notes."

If a trader configures a trailing stop and believes it will be submitted (the UI shows no disclaimer near the "Trailing stop" input — only in a small paragraph at the bottom of the expanded Advanced section), they place an unprotected market order.

**Risk:** Trailing stop = real money protection. Silence = wrong order type submitted.

**Fix:** Either remove the trailing stop input entirely (it is not submitted) and add a prominent "(planning only — not submitted)" label on the route/trailing UI, or add `trailingStop` to `StagedOrder`, `placeOrder`, and the backend.

**Confidence: 90**

---

### P1-2 · TradePanel has no execution-readiness gate — submit goes straight to broker without quote freshness / broker-degraded check

**File:** `frontend/src/components/panels/TradePanel.tsx:318–363`

`TradeBuilderTab.handleSubmit` calls `placeOrder(pendingOrder)` after a confirmation dialog, but it never checks `usePortfolioStore(s => s.brokerDegraded)` or any quote-age gate. The entire `buildExecutionReadiness` machinery present on `/trade` is absent here. This panel is accessible from the dashboard sidebar.

**Consequence:** A trader using the legacy TradePanel while the broker is in fallback / demo mode submits a real order against synthetic quote data. The `/trade` page blocks this via `buildExecutionReadiness` checking `brokerDegraded`; the panel does not.

**Fix:** Add a `brokerDegraded` guard before `setPendingOrder` / opening the confirmation dialog, mirroring the check in `trade/page.tsx:1583–1596`.

**Confidence: 87**

---

### P1-3 · Double-client-filter on `recentOrders` — `orderFilter === "working"` is applied twice

**File:** `frontend/src/app/(dashboard)/trade/page.tsx:517–538`

When `orderFilter === "working"`, the fetch already requests `status=open` from the backend (only open/working orders), then the client memo re-filters `recentOrders` for `isWorkingOrderStatus`. More importantly: `recentOrders.slice(0, 50)` is applied on ingest, then `filteredRecentOrders` calls `.slice(0, 10)`. With `orderFilter === "all"`, the first 50 ALL orders are stored, then sliced to 10 for display. Switching from "working" (only open orders stored) to "all" still only shows 10 records drawn from the 50-order batch. A trader reviewing order history sees a silently truncated list.

**Fix:** Remove the duplicate client-filter on the "working" path and make the fetch/store/display counts explicit and consistent.

**Confidence: 83**

---

### P1-4 · `useIsWideViewport` reads `window.innerWidth` without SSR guard, risking hydration mismatch

**File:** `frontend/src/app/(dashboard)/strategies/earnings-options-play/page.tsx:131`

The hook accesses `window.innerWidth`. On the server there is no `window`, so unless the hook correctly returns a stable server snapshot the initial render and the client render can diverge in layout. The earnings page uses `isWideViewport` to decide whether to smooth-scroll the detail panel into view. A mismatch can produce a React hydration warning and a visible layout jump on mobile.

**Confidence: 80**

---

### P1-5 · `MiniSparkline` in `WatchlistPanel.tsx` uses a non-reproducible seed — sparklines change shape on every re-mount

**File:** `frontend/src/components/panels/WatchlistPanel.tsx:128–174`

```ts
function MiniSparkline({ trend, symbol }: { trend: number; symbol: string }) {
  let seed = 0;
  for (let i = 0; i < symbol.length; i++) seed += symbol.charCodeAt(i) * (i + 1);
```

The seed is derived from `symbol` only, not from actual historical price data. The sparkline is fully synthetic — a function of a pseudo-random sequence seeded by the ticker name. The shape shown for NVDA has no relationship to NVDA's actual price history. This is `P1` because it is a silent data-accuracy failure on a trading platform.

**Fix:** Feed real historical data or remove the sparkline entirely and replace with a text-only `+/-% change` indicator.

**Confidence: 85**

---

### P1-6 · `OrderBar` `submittingRef` guard logic is inverted — clears the in-flight lock exactly when the parent flips `submitting=true`

**File:** `frontend/src/components/composites/OrderBar.tsx:437–442`

```ts
React.useEffect(() => {
  if (submitting) submittingRef.current = false;
}, [submitting]);
```

The effect clears `submittingRef.current` (the local double-submit guard) when `submitting` becomes `true`. But `submitting=true` is the in-flight state — the order has not yet returned. If the effect fires and clears the ref while the POST is still in flight, a second rapid tap on "Place order" can bypass the `submittingRef.current` guard and call `onSubmit` again.

Semantically this guard should be cleared when `submitting` transitions from `true` → `false` (i.e., when the POST resolves), not when it becomes `true`.

**Fix:**

```ts
React.useEffect(() => {
  if (!submitting) submittingRef.current = false;
}, [submitting]);
```

**Confidence: 88**

---

## P2 — Moderate (quality / performance / correctness concerns)

### P2-1 · Quote `high`/`low` merge logic in market store produces wrong OHLC values after WS ticks

**File:** `frontend/src/stores/market.ts:140–141`

`high`/`low` merge uses truthiness checks on prices. If `incoming.low = 0` (WS tick with no low field) the falsy branch fires. For a legitimately small non-zero value (e.g., 0.001 for a penny stock), the same falsy branch incorrectly skips the min calculation. Latent precision bug.

**Fix:** Use explicit `> 0` checks rather than truthiness.

### P2-2 · `getSnapshot` fan-out closes over stale `activeLegs`

**File:** `frontend/src/app/(dashboard)/trade/page.tsx:395–476`

Race in concurrent mode where `computeMissingLegs` may close over stale `activeLegs` snapshot. **Fix:** Pass `activeLegs` as a parameter.

### P2-3 · `getOrders` poll has no AbortController — dangling fetch on filter change

**File:** `frontend/src/app/(dashboard)/trade/page.tsx:515–528`

`apiFetch` uses `AbortSignal.timeout(15_000)` not the effect's `cancelled` flag — the request always runs for up to 15 seconds after unmount. **Fix:** Thread an `AbortController` signal through `getOrders`.

### P2-4 · `NotificationCenter.tsx` uses `lucide-react` while rest of design system uses `@phosphor-icons/react`

**File:** `frontend/src/components/layout/NotificationCenter.tsx:1–17` — tracked R6-4 carry-over.

### P2-5 · `MarketContext.tsx` unused `ExternalLink` import (dead import)

**File:** `frontend/src/components/dashboard/MarketContext.tsx:2`

### P2-6 · `WatchlistPanel.tsx` reads `localStorage` at module scope without `safeGetItem`

**File:** `frontend/src/components/panels/WatchlistPanel.tsx:43–52` — SSR-unsafe pattern.

---

## P3 — Low (minor, tracked, or cosmetic-only impact)

- **P3-1** Deprecated `--amber-500` consumers remain (tracked R6-4)
- **P3-2** `EarningsOptionsPlayPage` `window.location.search` direct read; prefer `useSearchParams`
- **P3-3** `riskRewardLabel` can display negative R value for incoherent brackets
- **P3-4** Chart overlay `submit` closure recreated every render

---

## Accessibility Findings

- **A1** `ExecutionReadinessPanel` is `hidden` below `md:` — no mobile keyboard accessible equivalent (`trade/page.tsx:1513`)
- **A2** `ColumnSelector` custom dropdown in `WatchlistPanel.tsx` is not keyboard-operable (`WatchlistPanel.tsx:69–124`)

---

## Summary Table

| ID | Severity | File | Issue |
|----|----------|------|-------|
| P0-1 | P0 | `trade/page.tsx:865` | `marketOpen` stale memo locks submit after market open |
| P0-2 | P0 | `trade/page.tsx:239` | Multi-leg parts guard `< 1` is vacuously false; should be `< 3` |
| P0-3 | P0 | `trade/page.tsx:546` | `handleSubmit` stale closure in chart overlay submit path |
| P1-1 | P1 | `OrderBar.tsx:231,858` | `routeVenue` + `trailingStop` collected but silently dropped |
| P1-2 | P1 | `TradePanel.tsx:318` | Legacy TradePanel has no `brokerDegraded` gate |
| P1-3 | P1 | `trade/page.tsx:517` | `orderFilter="working"` double-filters; history truncated |
| P1-4 | P1 | `earnings-options-play/page.tsx:131` | `useIsWideViewport` SSR mismatch risk |
| P1-5 | P1 | `WatchlistPanel.tsx:128` | Synthetic sparklines misrepresent price history |
| P1-6 | P1 | `OrderBar.tsx:437` | `submittingRef` cleared on `submitting=true`, not `false` — guard inverted |
| P2-1 | P2 | `market.ts:140` | Low/high OHLC merge uses truthiness for zero prices |
| P2-2 | P2 | `trade/page.tsx:410` | `computeMissingLegs` closes over stale `activeLegs` |
| P2-3 | P2 | `trade/page.tsx:520` | `getOrders` poll lacks AbortController — dangling fetch |
| P2-4 | P2 | `NotificationCenter.tsx:1` | Still using `lucide-react` (tracked R6-4) |
| P2-5 | P2 | `MarketContext.tsx:2` | Unused `ExternalLink` import |
| P2-6 | P2 | `WatchlistPanel.tsx:43` | `localStorage` read in `useState` initializer — SSR-unsafe |
| A1 | a11y | `trade/page.tsx:1513` | Readiness panel hidden on mobile |
| A2 | a11y | `WatchlistPanel.tsx:69` | Column selector not keyboard-operable |
