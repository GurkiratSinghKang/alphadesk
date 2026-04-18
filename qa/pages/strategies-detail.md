# /strategies/[id] — expected behavior (example: `/strategies/momentum-quality`)

## Route
- URL: `/strategies/{id}` — canonical slug from `STRATEGY_META` (`lib/strategies.ts`). Known aliases: `earnings-vol` → `earnings-vol-premium` (via `SLUG_TO_ID`).
- Access: requires-auth (nested under `(dashboard)/`).
- Redirects: none; unknown slug falls through to fallback meta (`{ name: slug, shortName: slug, group: "other" }`), which still renders — it does **not** 404. Known: inconsistent with routing intuition.
- Metadata: inherits root layout. Not per-strategy (could be added later).

## Layout
Not using `DashboardPageLayout`; page provides its own container:
```
<div class="mx-auto flex w-full max-w-[1280px] flex-col gap-10 px-6 py-8">
```
Non-desk (dashboard) chrome wraps this (TopBar + TickerTape? + StatusStrip + overlays + footer).

### Structure (top-to-bottom)
1. **Breadcrumb** (`aria-label="Breadcrumb"`): sans 12px `text-fg-muted` "Dashboard / {name}".
2. **StrategyHero** — `_strategy/StrategyHero.tsx`:
   - Left column (max-w 640px): `Eyebrow` "STRATEGY · {CATEGORY_LABEL}" (category from `STRATEGY_META.group`: "Fundamental / event-driven", "Technical / signal-driven", "Discretionary"), `Display size="lg"` italic-serif strategy name, optional italic-serif 16px description from `perf.description`.
   - Right column (4-cell metric plate, grid 2×2 on sm, 1×4 on lg):
     - OOS SHARPE (mono display, neutral tone, em-dash if null/zero).
     - MAX DD (negative percent, loss tone).
     - CAGR (signed percent, profit or loss tone based on sign).
     - HIT RATE (computed from trades: wins / closed, 0 dp percent).
   - Dividers between cells: `border-l border-border-hair pl-4`.
3. **Status + actions row** (flex-between, wraps):
   - `RegimePill` reflecting status — active: regime bull/low ("ACTIVE"), paused: neutral/elevated ("PAUSED"), halted: crisis/high ("HALTED"), idle: neutral/elevated.
   - "Last trade" cell: `Eyebrow` + mono 12.5px formatted date ("Apr 15, 2026") or em-dash.
   - Right: Pause / Resume button (secondary style, with Pause/Play icon) and primary gold "View trades →" button (`ArrowRight` icon, routes to `/?strategy={id}`).
4. **§ 01 Signal** (only if `content = STRATEGY_CONTENT[id]` exists):
   - `SectionRule tag="§ 01 · Signal"`.
   - `SignalSection` (see `_strategy/SignalSection.tsx`): likely 3 subsections — Thesis / Edge / How it works — each with tracked-caps heading + italic-serif body.
5. **§ 02 Performance** (only if `perf` loaded):
   - `SectionRule tag="§ 02 · Performance"`.
   - `EquityPanel`:
     - Top row: `Eyebrow` "EQUITY CURVE" + radio-group range buttons (`1M / 3M / YTD / 1Y / ALL`).
     - SVG equity curve 320px tall, 1000 viewport width. Stroke is `var(--profit)` if final > start, `var(--loss)` otherwise; gradient fill 0.24 → 0.02 underneath.
     - Optional dashed `text-fg-muted` benchmark line (SPY bars normalized to % return). Dash pattern "3 3".
     - Summary row underneath: 4 cells (TOTAL RETURN / CURRENT VALUE / INVESTED / ACTIVE POSITIONS) rendered in `Mono` with tone.
     - Empty state: 280px tall `rounded-lg border border-border bg-bg-elev-1` with italic-serif "Not enough data for equity curve."
6. **§ 03 Positions**:
   - `SectionRule tag="§ 03 · Positions"`.
   - `PositionsSection` (see `_strategy/PositionsSection.tsx`) — lists strategy-specific open positions pulled from `getStrategyPositions(id)`. Expected: tracked-caps table with symbol / qty / entry / current / P&L columns, or an empty state.
7. **§ 04 References** (only if `ACADEMIC_SOURCES[id]` exists):
   - `SectionRule tag="§ 04 · References"`.
   - `<ul>` of italic-serif 13.5px references. Examples for `momentum-quality`: Jegadeesh & Titman (1993), Piotroski (2000), Daniel & Moskowitz (2016), Asness/Frazzini/Pedersen (2019). For PEAD: Bernard & Thomas, Livnat & Mendenhall, Chu et al. For VRP: Bakshi & Madan, Carr & Wu, Dubinsky & Johannes.
   - Strategies without explicit sources skip this section silently.
8. **§ 05 Known limitations** (only if `content.risks` has entries):
   - `SectionRule tag="§ 05 · Known limitations"`.
   - `LimitationsSection` rendering the list of items from `STRATEGY_CONTENT[id].risks`.
9. **Epilogue "When to deploy"** (only if `content.whenToUse`):
   - `border-t border-border-hair pt-6`.
   - `Display size="md"` italic-serif "When to deploy".
   - Italic-serif 15.5px max-w 640 paragraph.

### Typography roles
- H1: Newsreader italic display-lg.
- Eyebrow labels: tracked-caps.
- Metric plate values: Mono display size, tone color.
- Body paragraphs inside sections: italic-serif for editorial emphasis, sans for dense factual content.
- References: italic-serif 13.5px.

### Palette check
- `bg-bg` via dashboard layout.
- Profit cells / equity curve (up): `text-profit` = `--up-500` chartreuse.
- Loss cells / MAX DD / negative CAGR: `text-loss` = `--down-500` coral.
- Gold accent only on "View trades →" primary button and α wordmark in TopBar.
- No raw hex, no electric green/red.

## Mobile (<1024px)
- Hero: left column + metric grid stack vertically. Metric plate becomes 2-col `grid-cols-2` on sm.
- Status / actions row wraps via `flex-wrap`.
- Equity panel: SVG is `preserveAspectRatio="none"` in a `h-[320px] w-full` container — stretches horizontally.

## Interactive elements

### Breadcrumb "Dashboard" link
- Routes to `/`.

### Pause / Resume button
- Label: "Pause" when `perf.status === "active"`, "Resume" otherwise.
- Icon: `Pause` or `Play` (lucide-react).
- Click: `toggleStrategy(id)` POST to backend; on success updates `perf.status`. Button disabled while `toggling` or `!perf`.
- Style: secondary — `border border-border bg-bg-elev-1 hover:bg-bg-elev-2`. Sans 12px semibold.

### "View trades →" primary button
- Gold fill; `ArrowRight` icon.
- Routes to `/?strategy={id}` — goes back to desk with the strategy selected.

### EquityPanel range radio-group
- 5 buttons: `1M / 3M / YTD / 1Y / ALL`. Active: `bg-bg-elev-2 text-fg`; inactive: `text-fg-muted hover:text-fg`. Mono 11px.
- Click sets local `range` state; `filterCurve(perf.equity_curve, range)` filters the displayed data.

### Pause/Resume error handling
- On failure, the catch block is empty (swallowed). Verify no stale UI (button should re-enable via `finally`).

## Expected states

| State | Render |
|---|---|
| **Loading** | Skeleton block: 3 stacked `animate-pulse bg-bg-elev-1` blocks (w-48 h-6 / w-80 h-14 / h-[320px] rounded-lg). |
| **Loaded, OOS data present** | Full hero + equity panel + positions + references. |
| **Loaded, no OOS Sharpe** | Metric cell shows em-dash instead of number. No phantom "0.00". |
| **Empty trades (hit rate null)** | Hit rate cell em-dash. |
| **No STRATEGY_CONTENT for id** | § 01 Signal and § 05 Limitations sections omitted entirely. |
| **No academic sources** | § 04 References omitted. |
| **Active strategy** | RegimePill green/LED bull-low, label "ACTIVE". |
| **Paused strategy** | RegimePill neutral/elevated, label "PAUSED". |
| **Halted strategy** | RegimePill crisis/high, label "HALTED". |
| **Benchmark SPY fetched** | Dashed fg-muted line overlays equity curve. |
| **Benchmark fetch failed** | Equity curve renders alone without benchmark. |

## Edge cases
- **Unknown slug:** `STRATEGY_META[id]` falls back to `{ name: slug, shortName: slug, group: "other" }`; page renders with the slug as the name. No 404.
- **`earnings-vol` alias:** resolves to `earnings-vol-premium` via `SLUG_TO_ID`.
- **Performance returns empty `equity_curve`:** EquityPanel shows empty state ("Not enough data for equity curve.").
- **Zero-value metrics:** `formatOrDash` treats `0` or null as em-dash. Rationale: zero often hides "no data"; rules out false-positive zeros.

## What must NOT happen
- No fabricated Sharpe / CAGR. If backend returns `null`, UI shows em-dash; never synthesize a number.
- No red/green classic palette — all P&L stays chartreuse/coral.
- No emoji.
- No inline raw hex.
- Academic references must be real citations; no Lorem Ipsum.

## SEO / meta
- Inherits root. Not per-page SEO (acceptable for authenticated pages).

## Accessibility (WCAG 2.1 AA)
- Hero metric plate is a `<dl>` with `<dt>` / `<dd>` semantics.
- EquityPanel range-group uses `role="radiogroup"` + `role="radio"` + `aria-checked`.
- Equity SVG has `role="img" aria-label="Strategy equity curve"`.
- Pause button has icon + text; accessible name is the text.
- Focus rings visible on all buttons and the range radios.
- Color contrast: metric cells in `text-profit` / `text-loss` on bg ≈ 5:1 (AA).
