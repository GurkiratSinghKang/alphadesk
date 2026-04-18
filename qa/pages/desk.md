# / (trading desk) — expected behavior

## Route
- URL: `/`
- Access: requires-auth (if unauthenticated, backend 401 → implicit redirect to `/login` is handled by an auth guard outside this page; unknown; verify).
- Redirects: `/trade` redirects here.
- Metadata: inherits root layout title "AlphaDesk — AI-Powered Trading Terminal".

## Layout
Flagship desk is the only dashboard route that renders `DeskLayout` (4-row grid) and owns the viewport entirely. `(dashboard)/layout.tsx` detects `pathname === "/"` and renders *only overlays* (CommandPalette, AICopilot, ShortcutOverlay, OnboardingTour) on top of this page.

```
DeskLayout gridTemplateRows: 48px · 38px · 1fr · 22px
DeskLayout gridTemplateColumns (main): 260px · 1fr · 340px
gap 1px with bg var(--border) → hairline separators
```

### Structure
1. **TopBar (48px)** — `components/composites/TopBar.tsx`:
   - α AlphaDesk italic serif 20px wordmark (α in `text-brand`).
   - Nav tabs: Desk (active, `/`), Strategies (`/strategies/momentum-quality`), Analytics (`/analytics`), Pipeline (`/pipeline`), Alerts (`/alerts`). Sans 12px; active tab gets `text-ink-1000 bg-bg-elev-1 rounded-xs`; inactive `text-fg-muted hover:text-fg`.
   - Right-aligned: `RegimePill` (italic-serif regime label with colored LED), mono clock ("14:32:08 ET · Tue Nov 4"), 26px avatar circle with "α" glyph (gold gradient bg).
   - Clicks on nav anchors are intercepted by `onClickCapture` and routed via `router.push`.
2. **ContextBar (38px)** — `components/composites/ContextBar.tsx`:
   - 7 right-aligned metric cells with hairline dividers. First cell is `emphasis` (gold-300 14px mono value).
   - Cells (from `toContextCells` in `_desk/selectors.ts`): Book equity, Day P&L, Cash, Exposure · Long / Short, Sharpe · 30d, Beta, Positions · Orders.
3. **Main row** — 3 columns:
   - **Left (260px) StrategyRail** — `components/composites/StrategyRail.tsx`:
     - Header "Strategies" (italic serif 15px) + "{active} / {total}" mono count, 2-digit padded.
     - Rows (one per strategy): sans name + mono index "01".."20" from `indexLabel`, italic-serif subtitle (e.g. "Swing · 5–20 day hold"), bottom row with `StatusDot` + label ("Active" / "Paused") + `PnLNumber` percent (em-dash when paused or `returnPct === null`).
     - Selected row gets `bg-bg-elev-1 border-l-brand` (2px gold left accent).
   - **Center (1fr) PriceChartPanel + OrderBar**:
     - `PriceChartPanel`:
       - Header: italic-serif 40px symbol name ("Nvidia"), tracked-caps 13px "NVDA · Nasdaq · Semis", mono 36px price ("134.82"), mono 13px delta ("+1.74 · +1.31%") in chartreuse/coral.
       - 5 right-aligned meta cells: Vol / Avg Vol / Range / IV / Regime fit. Regime fit gets chartreuse when ≥0.5, coral otherwise.
       - Range-button row: mono 10.5px buttons `1D 5D 1M 3M 6M YTD 1Y ALL`; active button `text-ink-1000 bg-bg-elev-1 rounded-xs`.
       - Legend chips: gold "Price", dashed chartreuse "20-SMA", ice-blue block "Regime bands".
       - Chart canvas: `lightweight-charts` Line series in gold, min-h 220px. SMA overlay (if present) as dashed chartreuse. Regime bands as price-line overlays (horizontal, translucent).
     - `OrderBar` (under chart, border-top):
       - 6 labeled fields (tracked-caps 9.5px labels): Strategy (select), Side (Buy/Sell toggle), Qty (input), Type (select: market/limit/stop/stop_limit), Price (input), Stop (input — coral tint).
       - Buy button: chartreuse tint; Sell: coral tint. Toggled via `data-active` / `aria-pressed`.
       - Middle slot: italic-serif 12px review copy "Review before submit · regime check · risk policy".
       - Right: primary gold "Stage order →" button. Submits to page's `handleStageOrder` which `router.push("/trade")` (staging flow lands elsewhere).
   - **Right (340px) PositionsList + AIMemoPanel**:
     - `PositionsList`:
       - Header "Book" italic-serif + tablist (Positions / Orders / Journal, tracked-caps 10px) + mono count.
       - Rows: sans 12.5px symbol + mono 9.5px "qty @ entry", italic-serif 11.5px strategy name, 3px progress bar (chartreuse profit / coral loss), right column `PnLNumber` currency (13px) and `PnLNumber` percent (10px).
       - Clicking symbol button calls `onRowClick(id)` → `handleSelectSymbol(symbol)` → sets market store's selected symbol → chart updates.
     - `AIMemoPanel`:
       - Header: pulsing gold `StatusDot` + tracked-caps brand "CLAUDE · PRE-TRADE MEMO" + mono timestamp.
       - Body: italic-serif 15px memo text `text-ink-900`.
       - Chip row: tiny tracked-caps chips in profit/loss/ice/muted tones ("Regime fit 0.82", "Risk ok", "Earn 14d"). No chips renders empty row.
       - Footer: mono 10px "Confidence {0.xx}" left; "{Model} · {latencyMs} ms" right.
       - Initial render uses `emptyMemo` (awaiting-state) — verify what this actually shows on live (probably placeholder italic-serif text explaining no open selection).
4. **StatusBar (22px)** — `components/composites/StatusBar.tsx`:
   - Left: 4 status pills with `StatusDot`s. Per `toStatusPills`:
     - "Alpaca paper · connected" (or "Alpaca live · connected"), tone profit.
     - "Market · open" / "Market · closed", tone profit if open.
     - "Claude · healthy · p50 {ms}ms", tone muted.
     - "Last tick {ms}s", tone muted.
   - Right: "Build {NEXT_PUBLIC_BUILD_VERSION}" gray mono, `kbd` `⌘K`, "Commands" text.

## Typography roles
- TopBar α wordmark: Newsreader italic 20px, α in `text-brand`.
- Nav labels: Inter Tight 12px, letter-spacing 0.02em.
- RegimePill label: italic serif with tracked-caps; colored LED dot based on regime.
- Clock: JetBrains Mono hint color.
- ContextBar cell labels: tracked-caps 8.5px `text-fg-hint`.
- ContextBar values: mono 13px ink-1000; emphasis cell 14px gold-300.
- StrategyRail rows: sans 12.5px name, mono 10px index, italic-serif 11.5px subtitle.
- PriceChartPanel symbol name: Newsreader italic 40px ink-1000.
- OrderBar review copy: italic-serif 12px `text-fg-muted`.
- StatusBar: mono 10px throughout.

## Palette check
- All surfaces on `bg-bg` / `bg-ink-050` / `bg-ink-100`.
- Gold accent: α wordmark, "Stage order →" button, selected rail border-left, AI memo pulsing dot, first ContextBar cell emphasis value, chart gold line.
- P&L: chartreuse `text-up-500`, coral `text-down-500`.
- Ice blue: regime-band chip, regime fit when neutral.
- No raw hex, no electric green/red/blue.

## Mobile (<768px)
- **Known:** desk layout is desktop-first. 3-col grid remains and will horizontal-scroll on narrow devices. No explicit mobile fallback.

## Interactive elements — full inventory

### TopBar
- α logo: non-interactive (no link handler).
- 5 nav tabs — click → `router.push`. Hover state on inactive tabs.
- RegimePill: visual only.
- Avatar circle: has `aria-label="Account"` but no click handler (presentational). (No profile dropdown bound here — ProfileMenu lives only in the non-desk TopBar.)

### ContextBar
- Purely informational; no clicks.

### StrategyRail
- Each row is a `<button>` — click sets `selectedStrategyId` (state on this page) and the OrderBar default strategy. No navigation.
- Hover: `bg-bg-elev-1`.
- Selected: `bg-bg-elev-1 border-l-2 border-l-brand`.

### PriceChartPanel
- 8 range buttons — click sets local `range` state (`1D/5D/1M/3M/6M/YTD/1Y/ALL`). Fetches `getBars(symbol, "D", rangeToLimit(range))` and updates `series`. `rangeToLimit` map: 1D→2, 5D→5, 1M→22, 3M→66, 6M→132, YTD→260, 1Y→260, ALL→1000.
- Chart canvas itself (lightweight-charts) has crosshair + tooltip on hover; drag to pan; wheel to zoom (default LWC behavior).

### OrderBar
- Strategy select — syncs with `selectedStrategyId`.
- Side buttons — toggle `side` state.
- Qty / Price / Stop inputs — controlled strings; numeric parse on submit.
- Type select — `market / limit / stop / stop_limit`.
- "Stage order →" — submits via `handleStageOrder`, which currently just `router.push("/trade")`. (Staging flow is deferred.)

### PositionsList
- 3 tab buttons (Positions / Orders / Journal) — toggle `bookTab` state; no navigation.
- Each position row's symbol button — calls `onRowClick`; desk page sets the selected market symbol → chart panel refreshes.

### AIMemoPanel
- Presentational. No direct interactions.

### StatusBar
- Pills are labels; no interaction.
- ⌘K kbd: visual hint — the shortcut itself is global (works anywhere).

### Overlays (from `(dashboard)/layout.tsx`)
- **CommandPalette** — `⌘K` / `Ctrl+K` toggles. See test-plan.md §4.
- **AICopilot** — `Ctrl+j` toggles (see shortcuts).
- **ShortcutOverlay** — `?` toggles.
- **OnboardingTour** — first-run only; subsequent sessions it remains dormant.

## Expected states

| State | Render |
|---|---|
| **Mount** | Pre-hydration skeleton from `(dashboard)/layout.tsx`: 4 stacked bars in row heights matching the grid, bg-ink-050 / bg-ink-100. Prevents Zustand hydration mismatch. |
| **Initial load** | All composites render immediately; StrategyRail seeded with `strategiesResp` from React Query; ContextBar cells read from `portfolioSummary` + `positions` + `orderCount`. If any is 0 or null, em-dash renders. |
| **No strategies yet (empty rail)** | `rail = []`, OrderBar strategy select empty, AIMemoPanel shows empty memo. |
| **No positions** | PositionsList renders just the header; count = "0". |
| **Market closed** | StatusBar pill "Market · closed", isMarketOpen heuristic: Mon–Fri, 13:30–20:00 UTC. |
| **Backend unreachable** | ContextBar cells render em-dashes, chart panel series stays empty (empty state). No blocking error modal. |
| **Staging an order** | Clicking "Stage order →" triggers `router.push("/trade")` — which in turn redirects back to `/`. Currently a no-op in UX terms; the staging page has not been re-implemented. |

## Edge cases
- **Live WS disconnect:** `StatusStrip` (non-desk) is not rendered here; WS state does not surface in the desk's StatusBar. Inspect console for reconnect activity.
- **`is_demo: true` flash:** `portfolio` store defaults to `is_demo: true` → `statusPills[0]` starts "Alpaca …" until portfolioSummary fetches (~200ms). Known per iter-1-frontend.md P1.
- **Shared state for chart range + symbol:** the selected symbol (from rail / list / command palette) is in `useMarketStore`; `selectedStrategyId` is page-local state. Reloading restores selectedSymbol (persisted) but not selectedStrategyId.

## What must NOT happen
- No demo data in production. If `is_demo === true`, the top of the status bar should reflect that; otherwise all numbers must be real.
- No red/green for P&L (must use `text-up-500 / text-down-500`).
- No emoji.
- No raw hex color on the gold line (verified: chart reads `--gold-300` from CSS variables at init).
- Desk page should never show `Alpaca live · connected` unless `portfolioSummary.is_demo === false`.

## SEO / meta
- Inherits root layout: "AlphaDesk — AI-Powered Trading Terminal". Indexable at the root URL by default; an auth wall should prevent scraping of authenticated content.

## Accessibility (WCAG 2.1 AA)
- TopBar nav: `<nav aria-label="Primary">`. Active tab has `data-active` attribute; WAI-ARIA would expect `aria-current="page"` (not wired currently — verify).
- RegimePill: should have accessible label exposing the regime name.
- Avatar: `aria-label="Account"`.
- PositionsList tabs: `role="tablist"` + `role="tab"` + `aria-selected`.
- Mono clock should have a `<time>` element or an aria-label if the formatted string is announced oddly.
- StatusBar: `role="status"` — announces politely.
- Focus rings: must be visible on nav tabs, rail rows, range buttons, inputs, selects, and the "Stage order →" button.
- Keyboard nav: tab through TopBar → ContextBar (skipped; non-interactive) → StrategyRail rows → range buttons → order fields → Stage button → PositionsList tabs → position rows.
