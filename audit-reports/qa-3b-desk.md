# QA review: trading desk (/)
Run: 2026-04-18T15-43-20Z

## Summary
Scaffolding renders — 4-row grid, 3 columns, every `data-slot` mounts. But the page is inoperable on first visit: an OnboardingTour `aria-modal` dialog (`initial.dom.html` byte 31640) intercepts every pointer event, explaining the 3 failed harness steps and why ⌘K did not open. Data integrity is poor: 8 rail strategies vs 10 Phase 1 OOS JSONs; every return shows `0.00%` despite real CAGR; chart header shows `0.00` not `—`; Day P&L is neutral (no coral); StatusBar has 3 pills not 4. Backend 422s `orders?status=open`; zero WebSockets.

## Evidence-backed findings

### [P0] Onboarding modal blocks every click on first visit
**Where:** `initial.dom.html` offset 31640: `<div class="fixed inset-0 z-[100]" aria-modal="true" role="dialog">… Welcome to AlphaDesk! … 1 of 5 / Skip / Next`. Manifest click-fail: `<div class="absolute inset-0 bg-black/60 …"> subtree intercepts pointer events`.
**Fix:** Make tour non-modal, OR persist `onboardingSeen` in localStorage and skip render when set.

### [P0] Rail lists 8 strategies; 10 Phase 1 OOS JSONs exist
**Where:** `initial.dom.html:L9022`, header `Strategies 07 / 08`.
**Evidence:** Visible: Momentum+Quality, PEAD, VRP Harvesting, Earnings Vol, Regime Adaptive, Claude Alpha, Dividend Capture, Sector Rotation. Missing: ORB, Pairs Trading, RSI2 Reversal, TS Momentum, VWAP. Fabricated (no OOS JSON): Claude Alpha, Dividend Capture, Sector Rotation.
**Fix:** Drive rail from `/api/v1/strategies/` merged with Phase 1 catalog.

### [P0] All active rail returns render as `0.00%` despite real CAGR
**Where:** rail rows 0–7. Momentum+Quality: `Active / 0.00%`. `phase1-momentum_quality-oos.json.metrics.cagr = 0.362`, `sharpe = 2.209`. Same `0.00%` across 7 active rows. Only `Earnings Vol` (paused) correctly shows `—`.
**Fix:** Backend populates `returnPct`; `toRailItems` renders `—` when null/zero, not `0.00%`.

### [P0] Day P&L rendered neutral white, not coral
**Where:** context-bar cell 2: `<b class="font-mono tabular-nums font-medium text-ink-1000 text-[13px]">−$1,506.92</b>`. Negative value in `text-ink-1000`, no `text-down-500`. Violates plan §78.
**Fix:** `toContextCells` sets tone; ContextBar applies `text-down-500` on loss.

### [P0] StatusBar has 3 pills, plan specifies 4 (missing "Last tick")
**Where:** `initial.dom.html:L31674`: `Alpaca paper · connected | Market · closed | Claude · healthy`. No `Last tick`, no `p50` on Claude.
**Fix:** `toStatusPills` emits 4 pills incl. tick + p50 latency.

### [P0] Backend 422s `/api/v1/trades/orders?status=open` on every poll
**Where:** `network.jsonl:L64,L139,L147`; `console.jsonl:L1–L3`. `status=pending` returns 200.
**Fix:** Add `open` to backend enum, or swap to `filled`.

### [P0] ⌘K command palette did not open
**Where:** Diff `command-palette.dom.html` vs `initial.dom.html` = 1127 bytes, entirely the clock ticking from 11:44:28→11:45:09. No `role="listbox"`, no command input. Artifact name is misleading.
**Fix:** Dismiss modal first; attach ⌘K to `window` with `capture: true`; ensure CommandPalette mounts unconditionally in `(dashboard)/layout.tsx`.

### [P0] Chart header prints `0.00` instead of `—` for missing data
**Where:** desk-center: `SPY · NYSE Arca · ETF / 0.00 / +0.00 · +0.00% / Regime fit 0.00`. Vol/AvgVol/Range/IV correctly show `—`.
**Fix:** Compute price from `series[-1].close`; render `—` when series empty.

### [P1] `"0 · 50"` Positions · Orders cell is a stale pending count
**Where:** context-bar cell 7. Book header is 0. `status=open` 422'd; 50 leaked from pending fallback.
**Fix:** `—` for orders count when open query fails.

### [P1] Top nav missing `aria-current="page"`
**Where:** `initial.dom.html`: `aria-current count: 0`. Plan §157. **Fix:** add it to nav anchors.

### [P1] Rail buttons lack `aria-pressed` / testid
**Where:** rail rows: `aria-pressed: 0`. Harness `[data-testid^=strategy-card]` can't match. **Fix:** `aria-pressed={selected} data-testid="strategy-card"`.

### [P1] RegimePill missing accessible label
**Where:** `Regime aria-label: none`. Plan §158. **Fix:** `aria-label="Regime bull"`.

### [P1] Build version is `dev` in production
**Where:** Status bar: `Build dev`. `NEXT_PUBLIC_BUILD_VERSION` not set on tradingalpha.net. **Fix:** set in deploy env.

### [P1] Clock says `ET` not `EDT` while in DST
**Where:** `11:44:28 ET · Sat, Apr 18` — 2026-04-18 is EDT. **Fix:** use `timeZone: "America/New_York", timeZoneName: "short"`.

### [P2] No WebSocket connections established
**Where:** `network.jsonl` has zero `wss://` entries in 148 events. `useDataPipeline` should subscribe to quotes/portfolio/alerts/agents/bars. **Fix:** Verify pipeline init.

### [P2] AICopilot panel always in initial DOM
**Where:** `"Ask anything..."` present pre-toggle; plan §125 implies Ctrl+J opens it. **Fix:** default-closed.

### [P2] Only vendor TradingView hex leaks (allowed): `#131722 #D1D4DC #fff` inside `a#tv-attr-logo`. No app hex.

### [P2] No mobile breakpoints: `"sm:" 0, "md:" 0` in main layout. Matches plan §83.

### [P2] Onboarding modal only has Skip / Next — 5 steps to escape
**Fix:** Add persistent close (X).

## What the desk is doing right
- All `data-slot` landmarks mount; DeskLayout 4-row/3-col grid is correct.
- Book equity ($101,036.22) and Cash ($42,473.68) are real; gold-300 used once.
- Sharpe, Beta, chart meta cells correctly use `—` for missing data.
- OrderBar uses real `<input>` / `<select>` with `aria-label`s — not divs.
- PositionsList has `role="tablist" / role="tab" / aria-selected`.
- `is_demo` guard works — pill stays on "Alpaca paper · connected".
- Typography matches plan: Newsreader italic, mono tabular-nums, tracked-caps labels.

## Suggested fixes for the 3 failed manifest steps
- **click** on rail: blocked by onboarding backdrop; fallback matched the top-nav "Strategies" link. Fix modal (P0 #1), then add `role="button" data-testid="strategy-card"` to rail rows.
- **type** on `order-bar-symbol`: no symbol input exists. OrderBar has only Qty/Price/Stop. Either add a symbol input or drop this harness step.
- **type** on `order-bar-qty`: Quantity input exists but has no name/testid. Add `name="quantity" data-testid="order-bar-qty"` in `OrderBar.tsx`.

## Manual visual check needed for
- `initial.png` — confirm rail gold border-left and chart empty-state have no visual artifacts.
- `command-palette.png` — confirm no partial palette opened.
- `after-strategy-click.png` vs `click-fail.png` — should be byte-identical.
