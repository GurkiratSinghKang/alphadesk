# AlphaDesk Empty-State / Loading / Error Audit — R2

Audit date: 2026-04-18
Scope: `/Users/GK/Downloads/alphadesk/frontend/src/**`
Context: Production at tradingalpha.net runs on a near-empty DB. Most users will land in a world where every list has 0 rows, every chart has no points, and a lot of API calls return empty arrays. Any missing empty state or indefinite loading state renders as a broken page.

---

## P0 — Most visible / most likely hit in production

### [P0] Desk flagship (`/`) — OrderBar strategy select renders empty `<select>` when backend returns no strategies
**File:** `frontend/src/components/composites/OrderBar.tsx:88-105`
**Scenario:** loading + empty
**Current behavior:** `strategies` prop maps directly into `<option>` children. On first render (before React Query resolves) `strategies` is `[]`. The select is empty, `strategyId` becomes `""`, and even when data arrives the existing `useState(strategies[0]?.id ?? "")` initializer is frozen (never recomputes). User sees an inert empty dropdown and has no way to choose a strategy. There is no `disabled` fallback, no placeholder option, and no "No strategies available" copy.
**Fix:** Seed `strategyId` via a `useEffect` that tracks `strategies[0]?.id`, and render a single `<option value="" disabled>No strategies configured</option>` when `strategies.length === 0`. Also disable the "Stage order" button when the select is empty, with reviewCopy = "Configure at least one active strategy to stage orders."

### [P0] Desk flagship — PositionsList has no empty state
**File:** `frontend/src/components/composites/PositionsList.tsx:80-137`
**Scenario:** empty
**Current behavior:** When `positions.length === 0` the `<ul>` renders no rows. The header shows "Book" + tab row + count "0" with a collapsed empty area below. To a user it looks unstyled and broken. This is the dominant state on production (no positions yet).
**Fix:** Explicit empty-state block in the same visual language as the `PositionsSection` on the strategy page — italic serif "No positions open." + hint "Stage an order below to open one." Use the tab-aware copy for "orders" and "journal" tabs as well ("No working orders", "No journal entries yet"). Also: the count span currently reads "0" — hide it in empty state or render it muted.

### [P0] Desk flagship — PriceChartPanel shows a blank div when `series` is empty
**File:** `frontend/src/components/composites/PriceChartPanel.tsx:63-64, 297-299`
**Scenario:** loading + empty
**Current behavior:** `ChartCanvas` early-returns from its effect when `series.length === 0`, rendering an empty 220px-tall `<div>` with no message. No spinner. No "Not enough data" copy. When `getBars` fails silently (line 106-111 of `page.tsx`), the chart sits blank indefinitely. The surrounding `meta` cells also render "—" with no loading signal.
**Fix:** Inside `ChartCanvas`, render an italic-serif "Awaiting price data." when `series.length === 0` and a `Loader2` spinner for the first ~500ms of mount. If `getBars` throws, surface the error to the panel with retry.

### [P0] Strategy detail (`/strategies/[id]`) — EquityPanel treats 0/1 bars as "Not enough data" but the surrounding `§ 02 · Performance` section only renders when `perf` exists — so after a fetch failure the entire section disappears with no feedback
**File:** `frontend/src/app/(dashboard)/strategies/[id]/page.tsx:388-399, 205-216`
**Scenario:** error
**Current behavior:** `toggleStrategy` and all three `getStrategy*` calls use `.catch(() => {})` via `Promise.allSettled`. If `getStrategyPerformance` rejects, `perf` stays `null`, and the entire `§ 02 · Performance` block is omitted. The user sees hero/positions/limitations but no idea that performance data failed to load. No retry, no error toast.
**Fix:** Track a `perfError` state and render a skeleton card + retry button inside the `§ 02` section when `perf == null && !loading`. Same pattern for `positions` (silent swallowing on line 214-215).

### [P0] Strategy detail — StrategyHero's four metric cells all show em-dash on an untraded strategy, giving no context for why
**File:** `frontend/src/app/(dashboard)/strategies/[id]/page.tsx:232-259, _strategy/StrategyHero.tsx:73-97`
**Scenario:** empty
**Current behavior:** On a strategy that has never traded, OOS SHARPE / MAX DD / CAGR / HIT RATE all render four em-dashes. Visually: a hero with `4 × —`. No explanatory copy telling the user the strategy is paused or has no trades yet. The `formatOrDash` helper at line 101-104 *also treats 0 as em-dash*, so a strategy with a real 0.00% return looks identical to one that has never run.
**Fix:** When *every* metric is null, hide the grid and render a single italic-serif line: "This strategy has not traded yet. Activate it to begin collecting performance data." Separately, fix `formatOrDash` to only dash on `null`/`NaN` — a real zero should render as "0.00".

### [P0] Pipeline page — "Latest Pipeline Run" stage bar silently renders "0 / 0 / 0 / 0" when no run exists
**File:** `frontend/src/app/(dashboard)/pipeline/page.tsx:533-536, 114-118`
**Scenario:** empty + loading
**Current behavior:** The `<PipelineFlow>` is rendered unconditionally with `run={todayRun}`. When `todayRun` is null (the common prod state), each stage card shows a muted "0" with label. The explanatory fallback ("No runs available — click Run Now to trigger manually") is *outside* the PipelineFlow and only appears when `!todayRun` — but the four-card zero-grid above still renders and looks like real data. This is confusing.
**Fix:** When `run == null`, short-circuit `<PipelineFlow>` and render only the "No runs available" copy with a primary "Run Now" CTA. Keep the grid visible only when at least one stage has a non-zero count or the run exists.

### [P0] Reports page — shows nothing (white space) for empty strategies / trades inside sections instead of explicit empty messages
**File:** `frontend/src/app/(dashboard)/reports/page.tsx:190-222, 225-259, 617-653`
**Scenario:** empty
**Current behavior:** `PortfolioStatement` wraps positions and closed-trades tables in `{positions.length > 0 && (...)}` and `{closedTrades.length > 0 && (...)}` guards — if both are empty the component shows just the top-level summary cards, no copy explaining why the tables are missing. Similarly `TaxReport` shows "No realized trades found for {year}" only when classified is empty but has no message when trades exist in other years; the fallback text is static. User sees $0 cards with no context.
**Fix:** Inside each section render an explicit italic empty state ("No positions yet — reports populate after the first trade settles") when the gated content is empty but the section is expanded.

### [P0] Analytics page — all four charts render "No drawdown data" / "No return data" but the page still has a confusing layout with fake grid lines
**File:** `frontend/src/app/(dashboard)/analytics/page.tsx:193-194, 238-239, 277-278, 334-335`
**Scenario:** empty
**Current behavior:** The `<EmptyState label="..."/>` is only a short h-32 pill. The surrounding `SectionCard` still shows its title/icon header and a minimum 200px chart area. On first load every card says something like "No drawdown data" in tiny muted text while the tab still reads "§ ANALYTICS · Portfolio analytics" like you're looking at real data. No explanation that trades need to be closed before these populate.
**Fix:** When `equityCurve.length === 0` AND `trades.length === 0` (global empty state), render a single editorial hero card explaining "Analytics unlock once you have closed trades" with a CTA to Pipeline, instead of four side-by-side "no data" cards.

### [P0] Alerts page — first-time users see "Create Alert" form then a section header "Active Alerts (0)" then a centered "No active alerts" message. The header+empty-state combo looks like an error because the user just came from a clean page
**File:** `frontend/src/app/(dashboard)/alerts/page.tsx:422-468`
**Scenario:** empty
**Current behavior:** The "Active Alerts (0)" chip above the empty state is redundant with the centered "No active alerts" copy. Also, the "Triggered History" section is hidden when empty (line 471 gate) — inconsistent with Active.
**Fix:** Hide the "Active Alerts (0)" header chip when alerts.length === 0; the centered empty state is enough. Consider hiding the whole Active Alerts card on first load and leading with the Create form + a tip like "Create your first alert above — it'll appear here."

---

## P1 — Fixable mid-priority bugs

### [P1] Desk flagship — StrategyRail shows rail items even when strategies fetch hasn't returned
**File:** `frontend/src/app/(dashboard)/_desk/selectors.ts:105-137`, `frontend/src/components/composites/StrategyRail.tsx`
**Scenario:** loading
**Current behavior:** `toRailItems(undefined)` synthesizes all 12 canonical strategies with `status: "paused"` and `returnPct: null`. This is visually honest (em-dash everywhere) but the selector cannot distinguish "backend hasn't responded" from "backend responded with zero strategies". A 500 error silently becomes "all 12 strategies are paused", no retry.
**Fix:** Surface a loading flag from `useStrategies()` into the selector and render a muted skeleton for the rail (12 gray rectangles) until the first fetch completes. On error, render a single "Strategies offline" row with a retry link.

### [P1] Desk flagship — ContextBar hardcoded "Sharpe · 30d" and "Beta" cells always render em-dash because the summary endpoint doesn't expose them
**File:** `frontend/src/app/(dashboard)/_desk/selectors.ts:192-193`
**Scenario:** permanent empty
**Current behavior:** Two cells are commented as "not in summary endpoint" and always render "—". They take up valuable top-bar real estate with permanently empty data.
**Fix:** Either wire them to the right backend (`getPortfolioPerformance`) or remove them from the default cell set until wired.

### [P1] Desk flagship — AIMemoPanel always renders "No pre-trade memo available" with confidence 0 / model "—" / latency 0 ms
**File:** `frontend/src/app/(dashboard)/_desk/selectors.ts:338-347, components/composites/AIMemoPanel.tsx:81-86`
**Scenario:** empty (permanent until user stages an order)
**Current behavior:** The panel's footer always reads "Confidence 0.00" and "— · 0 ms". Numeric 0 + "— · 0 ms" looks like a broken widget rather than an awaiting-state.
**Fix:** In empty state, hide the confidence/model/latency footer entirely. Only show it when memo.text is substantive.

### [P1] Desk flagship — StatusBar's "Last tick —" + "Alpaca paper · offline" looks like everything is broken on first render
**File:** `frontend/src/app/(dashboard)/page.tsx:174-181`, `_desk/selectors.ts:289-331`
**Scenario:** first render before any WS message
**Current behavior:** `brokerConnected: !portfolioSummary.is_demo` is false until the summary endpoint responds, so status bar shows "Alpaca paper · offline" on initial paint. Jarring visual.
**Fix:** Default `brokerConnected` to `undefined` during the loading phase and render a neutral "Alpaca · connecting..." tone rather than a loss-coded "offline".

### [P1] Analytics — `TradeStatsTable` renders 11 rows of "$0.00 / 0.0% / 0" when no closed trades exist instead of a single empty state
**File:** `frontend/src/app/(dashboard)/analytics/page.tsx:435-460, 140-147`
**Scenario:** empty
**Current behavior:** `computeTradeStats` returns `{ totalTrades: 0, wins: 0, losses: 0, winRate: 0, profitFactor: 0, ... }` when closed.length === 0. The table renders every row with "0" / "$0.00" making it look like the user did 0/0 trades. Better UX: short-circuit.
**Fix:** In `TradeStatsTable`, if `stats.totalTrades === 0` render one line "No closed trades yet — stats populate after your first exit."

### [P1] Pipeline — Performance Summary card bundle renders 6 cards with "—" / "N/A" / "0" / "0 positions" — very busy empty state
**File:** `frontend/src/app/(dashboard)/pipeline/page.tsx:707-824`
**Scenario:** empty
**Current behavior:** The early-return guard at line 707 only fires when `!perfData && !hasPnlData && displayPositions.length === 0` — but `perfData` may be a shell object with zeros from the backend, causing the 6-card grid to render anyway. Cards read "—" / "N/A" / "0" / "0" / "—" / "—". Visually noisy.
**Fix:** Change the empty-state condition to `!perfData || (perfData.totalTrades === 0 && displayPositions.length === 0)`. Or render a single editorial empty card: "Performance stats appear after the pipeline completes trades."

### [P1] Strategy detail — `fetchData` has no error surface. When backend is down, loading spinner stays forever? No — `setLoading(false)` runs in finally, so page renders with `perf=null, trades=[], positions=[]`. But each section then silently hides.
**File:** `frontend/src/app/(dashboard)/strategies/[id]/page.tsx:168-183`
**Scenario:** error (500 / network fail)
**Current behavior:** After loading resolves, if all three requests failed the page shows:
  - Hero with all em-dashes (no copy)
  - Pause/Resume button is disabled (no feedback about why)
  - No § 02 / § 03 / § 04 / § 05 at all (because each is `perf ? ... : null`)
User sees a hero with an em-dash grid and nothing else. Looks like a broken / half-built page.
**Fix:** Detect "all three requests failed" and render an error card with retry. If only performance failed but trades loaded, show a partial state with the trades table + "Performance temporarily unavailable."

### [P1] Strategy detail — benchmark effect silently swallows errors with `.catch(() => {})` on line 200
**File:** `frontend/src/app/(dashboard)/strategies/[id]/page.tsx:200`
**Scenario:** error
**Current behavior:** If SPY bars fetch fails, no error is surfaced; the EquityPanel silently omits the benchmark line with no indication to the user.
**Fix:** Set a `benchmarkError` state and render a muted "Benchmark unavailable" pill in the EquityPanel header when the bars fetch fails.

### [P1] Settings — Performance Metrics card renders even before its queries have resolved — potential flash of empty metrics
**File:** `frontend/src/components/dashboard/PerformanceMetrics.tsx` (not directly read in audit, but referenced at line 537 of settings page)
**Scenario:** loading
**Action item:** Audit `PerformanceMetrics.tsx` for skeleton/loading states matching the rest of the settings page.

### [P1] MorningBrief — crashes on `data.catalysts` / `data.top_movers` if backend returns partial data
**File:** `frontend/src/components/dashboard/MorningBrief.tsx:204, 207, 307-320`
**Scenario:** error (malformed response)
**Current behavior:** If `data.top_movers` is undefined (e.g. serialization bug), `data.top_movers.length === 0` throws. The error boundary at `(dashboard)/error.tsx` catches it but the whole dashboard shows the generic "Something went wrong" — hiding the rest of the panels.
**Fix:** Add optional chaining: `data?.top_movers?.length === 0`, and default `catalysts ?? []`. Render `MorningBriefContent` only when `data` has the expected shape.

### [P1] TickerTape renders nothing when watchlist is empty (returns null) — but then user has no idea a ticker tape exists
**File:** `frontend/src/components/layout/TickerTape.tsx:23`
**Scenario:** empty
**Current behavior:** `if (items.length === 0) return null`. The component disappears entirely. On a fresh user account with default watchlist this is fine, but the Settings UI still toggles "Ticker Tape" — even with the setting ON, the strip won't appear. Confusing.
**Fix:** Render a muted placeholder strip "Add symbols to your watchlist to see live ticker" when tickerTapeOn is true but there are no quotes yet.

### [P1] PortfolioHero — "Equity curve loading..." copy even after fetch has settled if backend returned empty history
**File:** `frontend/src/components/dashboard/PortfolioHero.tsx:207-213`
**Scenario:** empty
**Current behavior:** "Equity curve loading..." is used both as a loading-state AND as an empty-state copy. On an empty account the history is permanently empty, so it reads "loading..." forever.
**Fix:** Render "No equity history yet — curve populates after first trade" when fetch has completed but returned 0 points. Requires an `isLoading` prop plumbed from the parent.

### [P1] Strategy detail — Pause/Resume button stays disabled forever if perf failed to load, with no explanation
**File:** `frontend/src/app/(dashboard)/strategies/[id]/page.tsx:342-362`
**Scenario:** error
**Current behavior:** `disabled={toggling || !perf}`. If perf load fails, the button is perma-disabled. No tooltip, no explanation.
**Fix:** When `!perf && !loading`, render the button with a "Reload to enable" tooltip, or a separate Retry button.

### [P1] Pipeline history row — expanded detail uses `run.screened.length` without guarding — crashes if the backend returns a run with counts but no arrays
**File:** `frontend/src/app/(dashboard)/pipeline/page.tsx:636-647`
**Scenario:** error (partial backend response)
**Current behavior:** `run.counts?.screened ?? run.screened.length` — if `run.screened` is undefined (older run payload), `.length` throws. Only masked by optional chaining in the first clause; the OR chain doesn't protect.
**Fix:** `run.counts?.screened ?? run.screened?.length ?? 0` (same for analyzed, signals, ordersPlaced).

### [P1] WatchlistPanel — ScreenerTab renders rows even if `r.compositeScore` is undefined, showing blank score pill
**File:** `frontend/src/components/panels/WatchlistPanel.tsx:740-748`
**Scenario:** empty/broken data
**Current behavior:** Rows show a score pill colored by `r.compositeScore >= 70` / `>= 40` / else. A missing/undefined score falls through to "< 40" (loss-colored). Misleading — looks like all stocks are "red-bad".
**Fix:** Default to muted gray when score is null/undefined with label "?".

---

## P2 — Lower-visibility polish

### [P2] TickerStrip (marketing page marquee) returns null on empty array — reasonable, but the marketing page may leave a visible gap
**File:** `frontend/src/components/composites/TickerStrip.tsx:34`
**Scenario:** empty
**Fix:** Render a static "Live ticker loading..." placeholder with the same height so layout doesn't jump.

### [P2] LiveSignalFeed — "Signals appear after pipeline runs or when watchlist stocks cross thresholds" is accurate but dense
**File:** `frontend/src/components/dashboard/LiveSignalFeed.tsx:456-463`
**Scenario:** empty (expected)
**Fix:** Simplify copy to "No signals yet. They appear automatically."

### [P2] StatusStrip — renders "$--.--" when summary hasn't loaded, unclear if this is loading or error
**File:** `frontend/src/components/layout/StatusStrip.tsx:44`
**Scenario:** loading
**Fix:** Render a small animated `…` instead of static `$--.--` during initial load. Add `aria-busy="true"` during load.

### [P2] RiskDashboard — "--" rendered everywhere (Beta, VaR, MaxPos, TopSector) when positions.length === 0 feels like a dead widget
**File:** `frontend/src/components/dashboard/RiskDashboard.tsx:263-317`
**Scenario:** empty
**Fix:** Collapse the four metric cards into a single hero empty-state card: "Risk metrics appear once positions are open."

### [P2] ActivityFeed — on first mount uses `justMounted` gate for 800ms to avoid flashing an empty state, but if the feed stays empty after 800ms the transition feels abrupt
**File:** `frontend/src/components/dashboard/ActivityFeed.tsx:305-324`
**Fix:** Fade the skeleton out into the empty state, or keep the skeleton until 2s of confirmed empty.

### [P2] SignalsTab (Watchlist) — "No live signals." copy is honest but the Configure alerts link goes to /alerts which itself starts empty
**File:** `frontend/src/components/panels/WatchlistPanel.tsx:767-785`
**Fix:** Link to /pipeline instead, or to a doc page explaining how signals are generated.

### [P2] StrategyGrid cards — inside each card if `returnPct === 0 && positions === 0` shows "No positions" — but the card's sparkline may still render a flat line
**File:** `frontend/src/components/dashboard/StrategyGrid.tsx:112-126`
**Scenario:** empty
**Fix:** When `sparkline.length === 0`, show "No data"; currently handled. But when sparkline is `[0,0,0,...]`, render it as muted gray.

### [P2] AllocationDonut — with equity=0, cash=0, invested=0, the donut renders a gray ring with "Total $0.00" in the center — looks like a placeholder
**File:** `frontend/src/components/dashboard/AllocationDonut.tsx:17-76`
**Fix:** When `total === 0`, render a single editorial "No allocation data" state or a clear "Fund your account to see allocation" CTA.

### [P2] MarketMovers — "Market data loading..." copy is right but stays forever if quotes WS never sends data
**File:** `frontend/src/components/dashboard/MarketMovers.tsx:139-145`
**Fix:** After 10s of no quotes, switch copy to "Market data unavailable — check connection."

### [P2] SectorTreemap — returns "No sector data" as `<p>`, breaking visual hierarchy
**File:** `frontend/src/components/dashboard/SectorTreemap.tsx:262-264`
**Fix:** Render the empty state inside a bordered card that matches the other dashboard panels.

### [P2] PnlAttribution — correctly detects empty items but the surrounding card still has the "All-time P&L" "+$0.00" / "Total:" header — redundant
**File:** `frontend/src/components/dashboard/PnlAttribution.tsx:52-64`
**Fix:** Omit the header when items.length === 0.

### [P2] Desk flagship — the `setSeries([])` on bar-fetch catch means the chart goes blank with no error indication
**File:** `frontend/src/app/(dashboard)/page.tsx:108-111`
**Fix:** Track `seriesError` state and render it in the chart overlay.

### [P2] Desk flagship — `isMarketOpen()` uses `new Date()` heuristic at line 292 and is called on every render. The UTC hour+minute math is correct but the status pill may flip on market open with no WS update.
**File:** `frontend/src/app/(dashboard)/page.tsx:292-302`
**Note:** Not a hydration bug per se since the function is called inside the component body on client only, but the result is inconsistent with the server — in SSR `isMarketOpen()` runs before hydration (no — page is "use client"). Still, the bottom status pill updates only on parent re-render. Fix: tick via the `setTickHeartbeat` interval already in place.

### [P2] Hydration — `DashboardLayout` uses `new Date().getFullYear()` in the footer on line 107; runs on every render
**File:** `frontend/src/app/(dashboard)/layout.tsx:107`
**Scenario:** hydration
**Current behavior:** `new Date()` only runs client-side (component is "use client" and guarded by `mounted`). Safe. But similar calls on server components would cause drift. Already low risk.

### [P2] Login page — `new Date().toISOString().slice(0, 10)` at module scope
**File:** `frontend/src/app/login/page.tsx:26`
**Scenario:** hydration
**Current behavior:** It's a server component so this runs on the server at request time and is injected into HTML — safe.

### [P2] `MorningBrief.getGreeting()` / `getMarketStatus()` use `new Date()` inside client functions — OK, but `getDismissKey()` uses `new Date()` and compares to localStorage string. If the user's browser changes timezone mid-day, two different keys exist.
**File:** `frontend/src/components/dashboard/MorningBrief.tsx:33-36`
**Fix:** Acceptable risk; flag only.

### [P2] Reports page — "Unable to load portfolio data" is short and does not offer retry
**File:** `frontend/src/app/(dashboard)/reports/page.tsx:625`
**Fix:** Add a retry button that re-triggers the `load()` closure.

### [P2] Pipeline — RiskMonitorToggle fetches inline with `fetch()` rather than the `apiFetch` helper, so failures don't dispatch the api-error event
**File:** `frontend/src/app/(dashboard)/pipeline/page.tsx:141-158`
**Fix:** Route through `apiFetch` for consistent 401 handling + toast wiring.

### [P2] Alerts page — form validates only symbol shape + price > 0 but silently discards non-alphanumeric symbols without toast clarity
**File:** `frontend/src/app/(dashboard)/alerts/page.tsx:50-70`
**Fix:** Toast "Symbol must be 1–5 uppercase letters" when the regex would fail — currently `placeOrder-style` handling.

### [P2] WatchlistPanel — `MiniSparkline` synthesizes deterministic fake shapes from symbol hash (line 127-173). Real price history would be honest.
**File:** `frontend/src/components/panels/WatchlistPanel.tsx:127-173`
**Scenario:** visible fake data
**Severity:** P2 because it's intentionally disclosed as "mock" in comment, but production users on an empty system will see the same fake sparkline for every ticker.
**Fix:** Replace with real bars or remove the sparkline column entirely.

### [P2] `getChangeTextClass` missing for `hasRealChange=false` rows in WatchlistRow
**File:** `frontend/src/components/panels/WatchlistPanel.tsx:305-316`
**Fix:** Already handled — returns muted-foreground color. OK as-is.

### [P2] PositionsSummary empty state is lightly-styled `<p className="text-hint">` — mismatched with the "Open Positions" header
**File:** `frontend/src/components/dashboard/PositionsSummary.tsx:56-68`
**Fix:** Use the bordered empty-state card pattern from PositionsSection.

### [P2] `formatOrDash` on strategy detail treats `0` as empty but a real zero return is meaningful data
**File:** `frontend/src/app/(dashboard)/strategies/[id]/page.tsx:101-104`
**Fix:** Remove the `value === 0` clause. A strategy with exactly 0.00% return after a round-trip trade should display "0.00%".

### [P2] Strategy detail — `resolveStrategyId` silently accepts unknown slugs (just returns as-is). If user navigates to `/strategies/foo`, the page renders with `STRATEGY_META[strategyId] || {...}` fallback — hero shows "foo" as name but everything else em-dashes.
**File:** `frontend/src/app/(dashboard)/strategies/[id]/page.tsx:39-44, 160-164`
**Fix:** If `STRATEGY_META[strategyId]` is undefined AND the API returns 404, render a proper "Strategy not found" with a link back.

### [P2] `/trade` redirect — if router.replace fails or is slow, user sees `null` (blank page) briefly
**File:** `frontend/src/app/(dashboard)/trade/page.tsx:15-21`
**Fix:** Render a "Redirecting to desk..." message with a fallback `<Link>` for accessibility.

---

## Hydration / SSR flags (P1)

### [P1] `StrategyGrid` uses `useState<ViewMode>("expanded")` then `useEffect` to read localStorage
**File:** `frontend/src/components/dashboard/StrategyGrid.tsx:193-198`
**Current behavior:** Correctly defers to avoid hydration mismatch — no issue here.

### [P1] `MorningBrief` similarly defers — no issue.

### [P1] `DashboardLayout` mounted guard — correct pattern, no issue.

### [P1] `useDeskClock` starts with empty string — no issue.

### [P1] Dashboard `ContextBar` / `StatusBar` initial tick time uses `new Date()` in multiple places — all wrapped in `useEffect` or similar. No hydration drift observed.

---

## Error boundaries status

All of these have route-level `error.tsx` boundaries — good:
- `(dashboard)/error.tsx`
- `(dashboard)/trade/error.tsx`
- `(dashboard)/pipeline/error.tsx`
- `(dashboard)/analytics/error.tsx`
- `(dashboard)/alerts/error.tsx`
- `(dashboard)/reports/error.tsx`
- `(dashboard)/strategies/[id]/error.tsx`

Missing: `(dashboard)/settings/error.tsx`. P2 — Settings page is unlikely to crash but worth adding for consistency.

Also missing: top-level `app/error.tsx` (outside `(dashboard)`) — would catch login/marketing errors. P2.

---

## Summary

The recurring pattern is: **data arrives as `[]` or `null`, components silently render zero-rows / em-dashes, and there's no italic-serif copy to tell the user whether data is loading, empty, or errored.** The system has good primitives (italic serif for awaiting state, em-dash for missing numbers) but inconsistent application.

The highest-impact fixes, ranked by production visibility:

1. Desk `/` **OrderBar** — empty strategy select breaks the main workflow.
2. Desk `/` **PositionsList** — right rail shows an empty header with no message.
3. Desk `/` **PriceChartPanel** — chart sits blank with no loading/error message.
4. Strategy detail — `perf=null` silently collapses 4 of 5 sections.
5. Pipeline — "0/0/0/0" stage bar looks like real data.
6. Reports — sections disappear with no explanation when empty.
7. Analytics — four side-by-side "No data" cards on first load.
8. Alerts — redundant "Active Alerts (0)" header above empty state.
9. Strategy hero — all-em-dash grid with no explanatory copy.
10. Strategy detail — pause button permanently disabled on fetch fail.

Fix all ten of these and the app will look intentional to a first-time user instead of broken.
