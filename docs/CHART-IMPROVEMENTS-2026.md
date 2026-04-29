# Chart UX Improvements — Live Audit 2026-04-26

> Captured from live screenshots of https://tradingalpha.net/ (dashboard) and
> /trade pages, cross-referenced with the 2026 design brief
> (`docs/DESIGN-BRIEF-2026.md`) and the TradingView / NinjaTrader / Webull
> reference patterns from research.

## Method

Used Chrome MCP to log into the live site, captured the dashboard chart with
the user's real account state (SPY · 1M · candles), hovered to verify
crosshair / OHLC overlay, scrolled to verify zoom behavior, navigated to
/trade to inspect the larger chart variant, and took zoom-region snapshots
of specific surfaces. Cross-referenced the live state with the chart code
in `frontend/src/components/charts/{TradingChart,ChartPane,PriceChartPanel}.tsx`.

Three screenshots taken (paths logged at the end of this doc).

## What's working well today (don't regress)

1. **OHLC overlay top-left is in place** (Round-12 CH-2). `O 710.75 H 714.47 L 709.01 C 713.94  +3.19 (+0.45%)  VOL 45.3M` reads cleanly in a translucent pill.
2. **Crosshair dashed lines + price-axis label** ("688.78") follow the cursor correctly.
3. **Time-axis label** at hover ("20 Apr '26 20:00") is clear (though see #5 below).
4. **Drawing tools left rail** is present (6 visible icons).
5. **Volume bars** in lower pane are color-coded by candle direction.
6. **Timeframe selector** (1D / 5D / 1M / 3M / 6M / YTD / 1Y / ALL) consensus set ✓.
7. **Chart-type toggle** (CANDLES / LINE / AREA) at top-left of chart canvas.
8. **Zoom doesn't reset** on data refetch (Round-12 CH-1 fix verified — pan/zoom holds).

---

## Tier 1 — Concrete bugs / clearly broken

### CH-1B Status bar duplicate "Feed idle · market closed"
**Severity: P1 — visible bug.** The bottom status rail shows the Feed-idle pill TWICE: `● Alpaca paper · connected · ● Market · closed · ● Claude · healthy · ● Feed idle · market closed · ● Pipeline · idle · ● Feed idle · market closed`.
**Cause:** `selectors.toStatusPills` emits the "Last tick" pill, then the heartbeat-component (LastTickStatusBar) replaces the *last* pill with a second "Feed idle" pill — but the SB-1 commit added a Pipeline pill BEFORE the last-tick pill, so the heartbeat-replace targets the wrong index.
**Fix:** anchor the last-tick pill by id rather than `next.length - 1`. One line in `LastTickStatusBar` in `app/(dashboard)/page.tsx` around line 720-732.

### CH-1C Mode pill missing despite SB-1 commit
**Severity: P1.** The brief calls for `Mode · PAPER` (amber) or `Mode · LIVE` (green pulse) as the chrome's only anchor that real-money trading is on. Bottom rail in screenshot shows it's not rendering — could be a deploy-pending thing OR the `tradingMode` from the UI store is undefined on first render.
**Fix:** verify deploy 39 actually shipped + add a default-to-`paper` fallback so the pill always renders.

### CH-1D Time-axis label format inconsistent on dashboard chart
**Severity: P2.** Dashboard chart shows axis labels: `9:00 14 15 16 17 20 21 22 23 24 21:00` — mixes intraday timestamps (9:00, 21:00) with day-of-month (14, 15, 16…) for what's actually a 1M daily-bars view. Users can't tell what "14" is. The /trade page chart correctly shows `25 Apr 7 10 15 20 23`.
**Cause:** different `timeFormat` config between dashboard ChartPane and trade-page PriceChartPanel.
**Fix:** unify on the trade-page format (date-only when timeframe ≥ daily).

### CH-1E "INDICATORS 1" link is a button-styled label that doesn't open
**Severity: P2.** The right-side "INDICATORS 1" affordance reads like a count, not a button. Looking at it twice didn't convey "click to add". TradingView's pattern is a labeled button with a dropdown chevron.
**Fix:** change to `+ Indicator (1 active)` or icon + count chip with a chevron.

### CH-1F "Regime bands" indicator chip lacks tooltip
**Severity: P3.** The chip shows `Regime bands` next to `Price · 20-SMA` but a new user has no idea what regime bands mean. No tooltip on hover.
**Fix:** `title="Bull / bear / volatile market regime overlay computed from VIX + SMA cross"` on the chip.

---

## Tier 2 — Layout & hierarchy fixes (per the 2026 brief)

### CH-2A Indicator legend lives OUTSIDE the chart (TradingView violation)
**Severity: P1 — biggest visual hygiene win.** The chips `Price · 20-SMA · Regime bands` sit on the toolbar to the right of the timeframe selector. **Per TradingView convention** (and the brief's CH-5 recommendation) the indicator legend belongs INSIDE the chart canvas, top-left, **fused with the OHLC overlay** so they form a single block. Right now it reads as two separate things.
**Fix:** move the chips into `OHLCReadout` in `ChartPane.tsx`. The OHLC overlay already has a chip strip below the OHLC line — just move the toolbar chips there. Delete the toolbar duplicates.

### CH-2B Chart-type toggle is on its own row
**Severity: P2.** The CANDLES / LINE / AREA toggle gets a dedicated row above the chart. TradingView puts the chart-type picker in the top toolbar as a single "Bar style" button with a dropdown.
**Fix:** collapse CANDLES / LINE / AREA into a single icon-button with the active mode displayed; opens a small popover with the three options. Saves ~32px of vertical space.

### CH-2C Chart canvas has substantial unused vertical space below
**Severity: P2.** The dashboard chart canvas occupies rows ~280–540 (260px), then there's a yellow gap from 540–700 (160px of empty space) before the OrderBar. That's enough room for:
- An optional **RSI / MACD** sub-pane (TradingView "lower studies"), OR
- An expanded **volume-by-price (Volume Profile)** strip on the right axis, OR
- A **compare-symbol** legend ("vs SPY +0.4%")
**Fix:** wire one of these as a configurable second pane. Even a simple "Show RSI" toggle would close most of the perceived gap.

### CH-2D Drawing tools rail has icons without labels
**Severity: P2 — discoverability.** The left rail shows ~6 drawing-tool icons (cursor, line, horizontal, rect, ?, ?, T) with no tooltips. New users can't tell what each does.
**Fix:** add `title="Trend line"` etc. on each rail button. Better: a tiny label slid out on hover, like Linear's sidebar pattern.

### CH-2E No "favorites" affordance for drawing tools
**Severity: P3.** TradingView lets users star their most-used tools, which materializes a favorites strip. Power-users use 4-6 tools per session and wading through the full rail is friction.
**Fix:** star icon on each tool; starred tools render in a top "Favorites" group above the categorized list.

---

## Tier 3 — Missing pro features the brief calls out

### CH-3A Click-axis-to-place-limit (CH-6 from the brief)
**Severity: P0 — biggest "feels pro" win.** NinjaTrader / TradingView pattern: click the right price axis BELOW current price → opens an order ticket pre-filled as a buy limit at that price. Click ABOVE → sell limit. Working orders show as draggable horizontal lines on the chart.
**Effort:** medium-high. Requires:
1. Mouse-position listener on the price axis region
2. Coordinate-to-price conversion (the chart has `chart.priceScale().coordinateToPrice` from lightweight-charts)
3. Floating `cursor-target` that follows the cursor with a B/S indicator
4. Click handler that opens OrderBar pre-filled
5. Working-order line rendering via `series.createPriceLine`

### CH-3B Floating "+" alert affordance on the price axis
**Severity: P1 — small effort, big "feels pro" win.** TradingView shows a `+` icon that follows the cursor along the right price axis; one click adds an alert at that exact price.
**Effort:** small. Needs:
1. Hover handler on the price-axis region
2. Render a small `+` chip at cursor Y
3. On click, dispatch `alphadesk:add-alert` with the price → existing alerts page handles it

### CH-3C Compare-symbol overlay
**Severity: P2.** TradingView's "+ Compare" button overlays a second symbol on the chart with auto-percent-scale. Lets a trader see AAPL vs SPY in one viewport.
**Effort:** medium. Lightweight-charts supports addSeries to the same chart; just wire a "Compare" button + a search field + a second-series renderer.

### CH-3D Bar Replay mode
**Severity: P2 — single biggest "wow this is pro" feature.** Click any historical bar → blue vertical scissors line → play / forward-step / pause / speed control. Critical for backtesting visually + educational use.
**Effort:** medium-high. The chart already holds the full bar series; need a UI control + a state machine that masks bars after the play-cursor.

### CH-3E Event annotations on time axis
**Severity: P2.** Earnings dates, dividend ex-dates, FOMC events should render as small chips along the bottom time axis (TradingView pattern). For AlphaDesk specifically, show the next earnings date (we already have FMP earnings calendar) as a `E` chip.
**Effort:** medium. Iterate the bars, mark earnings dates from `input.earnings` DataFrame, render via `series.setMarkers`.

### CH-3F Expected-move shaded band ahead of next earnings
**Severity: P2 — Tastytrade signature.** When an earnings date is within view, shade a brown ±1σ band on the price axis between today and the report date. Computed from front-month ATM IV.
**Effort:** medium. We already have IV from the chain. Need an overlay primitive (lightweight-charts areaSeries with custom color).

### CH-3G Anchored VWAP
**Severity: P2.** Power-trader tool: click any bar → VWAP calculated from that anchor forward. Quantower / TradingView ship it; AlphaDesk doesn't.
**Effort:** medium. Compute typical-price × volume cumulative from anchor.

### CH-3H Volume Profile (right-axis histogram)
**Severity: P3.** Vertical histogram on the right showing volume-at-price + Point of Control + Value Area. Pro-grade flow tool.
**Effort:** large. New visualization layer.

### CH-3I Save layout / templates
**Severity: P3.** TradingView "Save Layout" and "Save Template" let power users persist a named workspace. Templates = indicator+style sets; Layouts = full pane arrangement.
**Effort:** medium. Persist to user-settings via existing settings API; serialize the chart state.

### CH-3J Multi-pane (RSI / MACD / custom)
**Severity: P2.** Stockcharts has a "Position" dropdown (above / below / overlay / behind another) per indicator. AlphaDesk currently has only the one main pane + volume sub-pane.
**Effort:** medium. Lightweight-charts supports multiple panes via `priceScale` ids.

---

## Tier 4 — Visual polish

### CH-4A Right axis "current price" pill (`713.94`) is solid orange
**Severity: P3.** The pill stands out aggressively in solid orange. TradingView's "current price" indicator is more subtle — colored to match price direction (green / red), thinner, often translucent.
**Fix:** match the brand-warm palette; use a thinner translucent pill colored by direction (green if last close > prev, red if <).

### CH-4B Right axis "current volume" pill (`28.43K`) is solid orange too
**Severity: P3.** Same comment. Volume rarely needs aggressive color coding.

### CH-4C Crosshair time-axis label has too much precision
**Severity: P3.** Hovering shows `20 Apr '26 20:00` for what's clearly daily bars (no intraday data on a 1M view). Drop the time portion when timeframe ≥ daily.

### CH-4D Indicator chips are decorative ovals at low contrast
**Severity: P3.** `Price`, `20-SMA`, `Regime bands` chips are body-mono at the toolbar's foreground color — they read as labels not affordances. Consumers don't know they're clickable (they actually aren't right now, but they should be — toggle visibility per chip).
**Fix:** add a hover-state border + `aria-pressed` toggle behavior + icon (eye / eye-slash).

### CH-4E Volume axis has no label
**Severity: P3.** Right axis under price labels reads `28.43K` but no axis title / explainer. A user new to the chart might think it's a price.
**Fix:** add a tiny `VOL` label above the volume axis range.

### CH-4F SMA series uses the same color as the candle wicks
**Severity: P3 — accessibility.** The 20-SMA line is hard to find against the green candles of an uptrending chart. Should use a distinct hue (gold / amber / brand) per the design brief's "EMA 20 amber, EMA 50 ice, SMA 20 gold, SMA 50 fg-dim" recommendation.
**Fix:** lock the indicator colors to the brief's spec.

---

## Tier 5 — `/trade` page chart specifics

### CH-5A OrderBar layout is broken on /trade
**Severity: P1 — visible bug.** The screenshot shows the OrderBar fields overlapping: `STRATEG SIDE SYMBOL QTY TYPE PRICE STOP` — the labels run together (`STRATEGYIDE`, `BUY/SELL` overlapping `SYMBOL`). The right-pane width is too narrow for the field count.
**Fix:** wrap to two rows below `xl` breakpoint, OR reduce field count via the Stripe progressive-disclosure pattern (default ticket: side + qty + type + primary action; advanced behind a "More" reveal).

### CH-5B No four-zone P&L preview on the trade ticket (FZ-1 not yet wired)
**Severity: P1 — Tastytrade signature win.** The PnLZones primitive shipped in slice 2 but isn't wired into OrderBar yet. The `Place order` button just shows "Submits to paper account" with no visual of the trade's P&L zones.
**Fix:** below the order fields, render `<PnLZones underlying={spotPrice} priceMin={lowerBound} priceMax={upperBound} profitZone={…} expectedMove={…} caption="Expected move ±$3.42 by Fri" />` — uses the primitive shipped in `b3304eb`.

### CH-5C Chart on /trade has a different time-axis format than dashboard
The /trade chart shows `25 Apr 7 10 15 20 23` — clean. Dashboard shows `9:00 14 15 16 17 20 21 22 23 24 21:00` — confusing. See CH-1D. Same root cause; unify on /trade format.

### CH-5D `Recent orders` table on /trade has good column structure but no sticky header
The `Apr 24, 2026 · 3:30:17 PM · AVGO · SELL · 15 · Stop · — · CANCELLED` rows render in a dense, scannable table. The TBL-1 sticky-header fix from slice 2 means scrolling will keep the column headers visible. ✓ — already shipped.

---

## Tier 6 — Interactions to add (NinjaTrader / TradingView research)

### CH-6A Drag working-order lines to modify
After CH-3A lands, working orders should render as horizontal lines on the chart. Make them draggable: drag the line up/down → modifies the limit price via the existing `modifyOrder` API. NinjaTrader / Sierra / MotiveWave all do this.

### CH-6B Right-click context menu on chart
Standard chart power-user menu: `Add Alert at Price`, `Trade from Here`, `Annotate`, `Measure`, `Copy Price`. All actions point to existing endpoints.

### CH-6C Keyboard scrub: ←/→ to step bars when crosshair active
TradingView's bar replay uses ←/→ for step. Reuse the binding for the live chart in non-replay mode: hover crosshair on a bar, press → to advance one bar, ← to go back. Useful for bar-by-bar TA explanation.

### CH-6D Touch / mobile pinch-zoom
Mobile users currently can pinch-zoom the chart, but the pinch is ambiguous between page scroll and chart scrub. Force-touch + `touch-action: none` on the canvas.

### CH-6E Print / export chart as PNG
TradingView's `Snapshot` button exports the visible chart as PNG with the watermark. Useful for trade journaling. Tradier, Webull, and TC2000 all ship this. Lightweight-charts has `chart.takeScreenshot()`.

---

## Recommended ship order (impact-to-effort)

### Quick wins (1-2 hours each)

1. **CH-1B** Fix the duplicate "Feed idle" pill — anchor by id, not index
2. **CH-1C** Verify Mode pill renders + add a default fallback
3. **CH-1D** Unify time-axis format dashboard ↔ trade
4. **CH-2D** Add tooltips to drawing-tool rail icons
5. **CH-4F** Lock SMA / EMA colors per the brief
6. **CH-1F** Add tooltip explainer to "Regime bands"

### Medium (3-5 hours each)

7. **CH-2A** Fuse indicator legend into the OHLC overlay (TradingView convention) [biggest visual hygiene win]
8. **CH-3B** Floating "+" alert affordance on the price axis
9. **CH-5A** Fix OrderBar field overlap on /trade
10. **CH-5B** Wire `<PnLZones>` into OrderBar (FZ-1 finish line — primitive already shipped)
11. **CH-2B** Collapse chart-type toggle into a single popover button

### Larger (1-2 days each)

12. **CH-3A Click-axis-to-place-limit** [biggest "feels pro" win]
13. **CH-3D Bar Replay mode** [biggest pro-feature parity win]
14. **CH-3E** Event annotations on time axis
15. **CH-3F** Expected-move shaded band ahead of earnings
16. **CH-3C** Compare-symbol overlay
17. **CH-3J** Multi-pane (RSI / MACD)

### Strategic (≥ 1 week each)

18. **CH-3H** Volume Profile
19. **CH-3G** Anchored VWAP
20. **CH-3I** Save layout / templates
21. **CH-6E** Print / export PNG

---

## Screenshots captured

Saved to disk during this audit:
1. Dashboard chart, 1M timeframe, no hover (full viewport, 1456×827)
2. Dashboard chart with crosshair active at (600, 400) — shows OHLC overlay updating + price axis label
3. Same as #2 (after scroll-up to verify zoom doesn't reset)
4. /trade page full viewport — shows the larger chart variant + OrderBar overlap
5. Zoom of the toolbar region (0,200 to 1080,580) — confirms indicator legend placement
6. Zoom of bottom status rail (0,800 to 1456,827) — confirms duplicate "Feed idle" pill

## Closing thesis

The chart is **80% there**. The OHLC overlay, crosshair, drawing-tools rail, timeframe presets, volume bars, candle/line/area toggle — all the table-stakes work and look right. The remaining 20% is the difference between "competent" and "pro":

- **Click-axis-to-place-limit** + **floating-+ alert** + **bar replay** are the three TradingView-class wins that take a chart from "good chart" to "trader's chart"
- **Indicator legend fusion with OHLC overlay** is the single highest-leverage visual hygiene fix
- **Status bar duplicate pill** + **Mode pill missing** are bugs that should ship in the next deploy

Recommended next batch: CH-1B + CH-1C + CH-2A + CH-3B (quick-win UI hygiene + the floating-+ alert) → ~half a day, shippable as one commit.
