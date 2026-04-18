# AlphaDesk — Visual Design Consistency Audit (R2)

Date: 2026-04-18
Scope: `frontend/src/**` on branch `feature/deployment`
Design source of truth: `frontend/src/styles/design-tokens.css` (warm near-black `ink-*`, brand `gold-*`, P/L = chartreuse `up-500` / coral `down-500`, `amber-500`/`ice-500`/`wine-500` for info/critical).
Bridge: `frontend/src/app/globals.css` — `@theme inline` maps CSS vars → Tailwind utility names.
Typography primitives: `frontend/src/components/typography/{Display,Eyebrow,SerifEyebrow,Mono,SectionRule}.tsx` + `.t-*` classes in design-tokens.css.
Button primitive: `frontend/src/components/ui/button.tsx` (six canonical variants + legacy aliases).

The codebase has two overlapping design layers:

1. **Old layer** (`src/components/dashboard/*`, `src/components/panels/*`, error pages) — predates the token system. Uses Tailwind default `emerald-500`, `red-500`, `blue-400`, `amber-400`, raw hex `#1a1a2e` / `#2a2a3e` / `#8a8a95` (a blue-gray completely foreign to the warm-black palette), raw `<button>`s, raw `<h2 className="text-sm font-semibold">`.
2. **New layer** (`src/components/composites/*`, `src/components/primitives/*`, `src/components/typography/*`) — correctly uses `text-up-500`, `text-fg-muted`, `Display` / `Eyebrow` / `Mono`, and spacing vars.

Almost every finding below is a piece of "old layer" that hasn't been migrated to tokens.

---

## Top 15 findings — ordered by (severity × user-visibility)

### [P0] P/L semantics use wrong palette on the hero dashboard
**File:** `frontend/src/components/dashboard/MorningBrief.tsx:162-229, 268-285`
**Current:** `text-emerald-500`, `text-red-500`, `text-emerald-500/70`, `text-red-500/70` for profit/loss indicators, TrendingUp/Down icons, and macro indicator lists. Rendered on the front page every time the user loads the app.
**Should be:** `text-profit` and `text-loss` (bridge tokens in `globals.css:50-51` mapping to `--up-500` / `--down-500`).
**Why it matters:** The brand explicitly chose chartreuse `#a8d04d` and coral `#e07856` to avoid the "traffic-light" look (see design-tokens.css:39). Using Tailwind `emerald-500` (#10b981) / `red-500` (#ef4444) produces a different hue side-by-side with the PortfolioHero / StatusStrip / TradePanel which correctly use `var(--profit)` / `var(--loss)`. The user literally sees two different greens and two different reds on one screen.

### [P0] ShareTrade card renders a completely different visual palette
**File:** `frontend/src/components/panels/ShareTrade.tsx:81, 112, 123, 127, 187, 284-420, 460, 477`
**Current:** Entire canvas share-card is drawn with `#22c55e`, `#ef4444`, `#3b82f6`, `#eab308`, `#2a2a3e`, `#0e0e18`, `#12121f`, `#71717a`, `#e2e2ea`, plus `bg-white/[0.03]` containers. Gradient `from-[#0e0e18] to-[#12121f]` is a blue-black, not the warm near-black `--ink-050` (#0b0a09).
**Should be:** token vars — `--bg`, `--bg-elev-1`, `--border`, `--up-500`, `--down-500`, `--gold-500`, `--fg-muted`. For canvas `fillStyle`, use `getComputedStyle(document.documentElement).getPropertyValue("--up-500")`.
**Why it matters:** This is the sharable artifact the user screenshots and posts publicly. It brands AlphaDesk as a generic blue-gray Tailwind app when in reality the product is warm-black + gold + chartreuse/coral.

### [P0] Error pages are three different designs — and ship dead color tokens
**Files:**
- `frontend/src/app/(dashboard)/error.tsx:17-31` (uses `<Button variant="outline">` — correct)
- `frontend/src/app/(dashboard)/reports/error.tsx:3-10` (raw `<button className="px-4 py-2 rounded bg-primary text-white text-sm">`)
- `frontend/src/app/(dashboard)/alerts/error.tsx:3-10` (same raw button)
- `frontend/src/app/(dashboard)/analytics/error.tsx:3-10` (same raw button)
- `frontend/src/app/(dashboard)/strategies/[id]/error.tsx:3-10` (same raw button)
- `frontend/src/app/(dashboard)/pipeline/error.tsx:17-31` (uses the Button primitive — correct, plus `text-4xl`)
**Current:** 3 variants of the "Try Again" button (shadcn Button + two raw `<button>` styles), inconsistent "⚠" emoji sizing, `text-white` which maps to literal white (not a token), while the canonical button uses `text-primary-foreground` = `#1a1206` (near-black; correct for gold bg).
**Should be:** One shared `<ErrorBoundaryUI>` component consumed by every `error.tsx`. Use `Button` primitive with `variant="outline"` and the design-system glyph.
**Why it matters:** Same app, 5 different "oops" screens. `bg-primary text-white` on a gold background is illegible (gold + white, WCAG fail); the primary variant's actual foreground is near-black.

### [P0] Calendar day cells: hardcoded Tailwind hex palette for P/L
**File:** `frontend/src/components/panels/PnlCalendar.tsx:19-34, 207, 221, 270`
**Current:** `getPnlBg` returns literal `#991b1b / #dc2626 / #f87171 / #3f3f46 / #86efac / #22c55e / #15803d`; `getPnlText` returns `#fecaca / #1c1917 / #d4d4d8 / #052e16 / #f0fdf4`; cells use `bg-[#1a1a2e]/50` (Tailwind slate-black, not warm-black); text uses `text-green-300` / `text-red-300`.
**Should be:** A token-derived scale — e.g. `rgb(from var(--up-500) r g b / 0.2)` for the softest cell, `var(--up-500)` for strongest, and tint with `var(--up-100)` / `var(--down-100)` which are already defined. Empty cell should use `bg-bg-card` not `#1a1a2e`.
**Why it matters:** P&L calendar is on the dashboard. It renders red/green from a completely different palette than PortfolioHero, AttentionGrid, StrategyGrid, etc.

### [P0] Trading chart and Payoff diagram hardcode GPU colors for overlays
**Files:**
- `frontend/src/components/charts/TradingChart.tsx:491, 500, 514, 523, 561, 575, 588, 603` — indicators RSI/MACD/ATR/Stoch/Williams use `#f59e0b`, `#8b5cf6`, `#06b6d4`, `#ec4899`, `#f472b6`, `#38bdf8`, `#fb923c`, `#a78bfa` (literal tech-rainbow palette).
- `frontend/src/components/panels/PayoffDiagram.tsx:186, 194, 203, 216, 223, 240, 241, 247, 282, 302, 313, 316` — strike-level marks use `#22c55e`, `#ef4444`, `#a78bfa`, `#f59e0b`, `#8a8a95`, `#666`, plus `fontFamily="Inter, system-ui, sans-serif"` (hardcoded font, not `var(--font-ui)` / `var(--font-mono)`).
- `frontend/src/components/panels/BacktestPanel.tsx:420, 422, 431, 451, 462, 465, 515` — equity curve A vs B uses literal `rgba(34,197,94,0.12)`, `rgba(239,68,68,0.12)`, `#f59e0b`, `#ef4444`.
**Should be:** Read from computed style — the existing `getTokenVar()` pattern in `TradingChart.tsx:92-93` is correct; extend it to every indicator. Cycle through `--chart-1`..`--chart-5` in `globals.css:121-125` or use `--gold-*` / `--ice-*` / `--up-*` / `--down-*`.
**Why it matters:** The chart is where the user spends most of their time. Indicators in pink/purple/cyan directly contradict the editorial warm-black + gold aesthetic and look like a different product.

### [P0] `text-[#8a8a95]` (cool blue-gray) used as a second "muted" color across 7 files
**Files:**
- `frontend/src/components/layout/StatusStrip.tsx:36, 44, 48, 49, 54`
- `frontend/src/components/layout/ProfileMenu.tsx:44, 50`
- `frontend/src/components/panels/AnalysisPanel.tsx:821, 838, 856, 870, 885, 896, 912, 919, 937, 947`
- `frontend/src/components/ui/placeholder.tsx:49`
- `frontend/src/app/(dashboard)/pipeline/page.tsx:103`
- `frontend/src/components/panels/PayoffDiagram.tsx:282, 302`
**Current:** `text-[#8a8a95]` — a cool (blue-tinged) gray.
**Should be:** `text-fg-muted` (=`--ink-600` = `#7d7665`, warm) for metadata; `text-fg-hint` (=`--ink-500`) for placeholders.
**Why it matters:** On every screen, the "labels" (P&L / Regime / VIX on the status bar, Equity on the profile menu, Quantity/Order Type/Limit Price on the order ticket) shift color from the rest of the UI's warm-gray body text. The eye reads it as two different greys on the same row.

### [P1] Raw `<h2 className="text-sm font-semibold text-foreground">` used everywhere instead of Display/Eyebrow
**Files (representative):** `MorningBrief.tsx:133`, `StrategyCorrelation.tsx:126,144`, `EconomicCalendar.tsx:39`, `MarketContext.tsx:60`, `StrategyGrid.tsx:210`, `AICopilot.tsx:175`, `PnlAttribution.tsx:57,73`, `RiskDashboard.tsx:194`, `MarketBreadth.tsx:82,99`, `PerformanceMetrics.tsx:282`, `LiveSignalFeed.tsx:414`, `StressTest.tsx:246`, `PnlCalendarMini.tsx:38,66`, `MarketMovers.tsx:110`, `PositionsSummary.tsx:61,75`, `ActivityFeed.tsx:331`, `reports/page.tsx:71`, `analytics/page.tsx:426`, `settings/page.tsx:318,383,395,429,461,473,528`.
**Current:** ~25 panel titles all render `<h2 className="text-sm font-semibold text-foreground">Panel Name</h2>` — identical visual but with copied Tailwind classes.
**Should be:** The design system provides `.t-h3` (17px, weight 500, letterSpacing -0.005em) for panel titles — OR use `Eyebrow` / `Display size="md"` wrappers from `components/typography/`. Even simpler: create one `<PanelHeader title=... action=... />` composite the way `composites/PositionsList.tsx` already does.
**Why it matters:** (a) `text-sm font-semibold` is 14px weight-600, but `.t-h3` is 17px weight-500 — the rest of the design is built around the editorial scale so 14/600 looks heavy+small next to composites. (b) Divergent class strings break any future typography tweak (you'd touch 25 files). (c) `settings/page.tsx` drops `text-foreground` from its h2s, so Settings headers are a different color than every other page header.

### [P1] Icon size inconsistency (`size-4` vs `h-4 w-4` vs `h-3.5 w-3.5`)
**Files (sampled):** Icons across `components/dashboard/*`, `components/panels/*`, `components/layout/*` use a mix of `h-3 w-3`, `h-3.5 w-3.5`, `h-4 w-4`, `size-4`, `h-5 w-5`, and arbitrary `size-[18px]` / `h-[22px] w-[22px]`.
- `button.tsx` canonicalizes icons inside buttons to `size-4` (`[&_svg:not([class*='size-'])]:size-4`), but standalone icons everywhere use `h-3.5 w-3.5` or `h-4 w-4`.
- `TopBar.tsx:81` — custom `h-[26px] w-[26px]` profile bubble.
- `StatusDot.tsx:41-42` — `h-[5px] w-[5px]` / `h-[7px] w-[7px]`.
**Should be:** Define icon sizes as tokens — e.g. `--icon-xs: 12px; --icon-sm: 14px; --icon-md: 16px` — and consistently use `size-*` utility (or a sized `<Icon>` wrapper that enforces it).
**Why it matters:** In a row of four panels, the icons don't line up vertically. The "Market Open" dot on MorningBrief is 14px and the "LIVE" dot on StatusStrip is 6px; they read as different types of status when they're the same information.

### [P1] Severity chips use Tailwind `emerald`/`amber`/`red` instead of semantic tokens
**Files:**
- `frontend/src/components/dashboard/LiveSignalFeed.tsx:40-43` — `buy/sell/watch/alert` variant map uses `emerald-500`, `red-500`, `amber-500`, `blue-500`.
- `frontend/src/components/dashboard/LiveSignalFeed.tsx:260-262` — confidence pulses use `bg-emerald-500` / `bg-amber-400` / `bg-red-400`.
- `frontend/src/components/panels/StrategyTemplates.tsx:108-110` — `low/medium/high` difficulty map uses `emerald-500`, `amber-500`, `red-500`.
- `frontend/src/components/dashboard/StrategyGrid.tsx:71-72, 161-162` — online/stale badge.
- `frontend/src/components/dashboard/RiskDashboard.tsx:92-93, 262, 294, 311, 328` — risk warning tone.
- `frontend/src/components/dashboard/StrategyCorrelation.tsx:154, 249, 270, 278, 288, 296, 316` — correlation matrix cells use `red-400` / `blue-400` / `emerald-400`.
- `frontend/src/components/panels/StrategyBuilder.tsx:239, 257, 258, 262, 263, 255, 175` — amber warnings.
**Current:** Mixes Tailwind's emerald+red with the product's up/down palette and with amber.
**Should be:** `bg-profit`/`text-profit`/`border-profit` (`profit-tint` for 10%), `bg-loss`/`text-loss`/`border-loss`, `text-amber`/`bg-amber/15`, `text-ice` for neutral/info. All already wired in `globals.css:50-60`.
**Why it matters:** Signals ("BUY SIGNAL — AAPL") on `LiveSignalFeed` appear in a green that doesn't match the P&L green in the same card's header.

### [P1] Trade action buttons use `text-black`/`text-white` literals on colored backgrounds
**Files:**
- `frontend/src/components/panels/AnalysisPanel.tsx:959-960` — BUY = `bg-[var(--profit)] text-black`, SELL = `bg-[var(--loss)] text-black`.
- `frontend/src/components/panels/TradePanel.tsx:440-441, 509-510, 783` — mixes `text-black` (buy) and `text-white` (sell); one place has `text-white` on loss and other places have `text-black`.
- `frontend/src/components/panels/WatchlistPanel.tsx:291, 297` — quick BUY/SELL chips: `text-black` on both.
- `frontend/src/components/layout/ProfileMenu.tsx:106` — Confirm Live Mode: `bg-[var(--loss)] text-white`.
- `frontend/src/components/layout/AICopilot.tsx:304` — send button: `bg-primary text-white`.
- `frontend/src/components/layout/DashboardShell.tsx:22` and `app/(dashboard)/layout.tsx:95` — skip-to-content link: `focus:bg-primary focus:text-white`.
**Current:** Literal black/white.
**Should be:** For BUY on `--up-500` (#a8d04d, luminous chartreuse), `--ink-000` (`#050503`) via the existing `primary-foreground` convention, NOT raw `text-black`. For SELL on `--down-500` (#e07856, coral), WCAG contrast wants `--ink-1000` (`#f7f1dc`) or `--fg`. Currently TradePanel uses `text-black` in some places and `text-white` in others on the same `--loss` bg — a literal inconsistency within one file.
**Why it matters:** (a) the hot BUY/SELL buttons are visually the most important control on the app; inconsistent text colors mean the same action is styled 3 different ways across the app (TradePanel vs AnalysisPanel vs WatchlistPanel); (b) `text-black` is not a token; if the brand ever tweaks its warm-black, these won't follow.

### [P1] `bg-[#14141e]` / `bg-[#12121a]` — cool-blue panel bg layered over the warm-black app
**Files:**
- `frontend/src/components/panels/OptionsPanel.tsx:248, 273, 319` — header/tabs/sticky-thead.
- `frontend/src/components/panels/AnalysisPanel.tsx:993` — TabsList.
- `frontend/src/components/panels/TradePanel.tsx:1350` — TabsList.
- `frontend/src/components/panels/AnalysisPanel.tsx:986, 993` — `border-[#2a2a3e]`.
- `frontend/src/components/panels/TradePanel.tsx:1343` — `border-[#2a2a3e]`.
- `frontend/src/components/panels/ShareTrade.tsx:460, 477` — dialog.
**Current:** `#14141e` / `#12121a` are both cool blue-blacks with a #00001e cast. The design palette is WARM — `--ink-150` is `#15140f` (yellow-warm). Side-by-side they look like different apps.
**Should be:** `bg-bg-elev-2` / `bg-bg-elev-1` (or `bg-[var(--bg-elev-1)]`). `border-border` not `border-[#2a2a3e]`.
**Why it matters:** Options chain and Trade tab selector visibly "stand out" because their black is 5° cooler than the surrounding UI. The user can't name why it looks off, but they notice.

### [P1] Random off-grid spacing — `px-[7px]`, `px-[10px]`, `py-[1px]`, `gap-[14px]`, `gap-[18px]`, `mt-[1px]`, `gap-[2px]`
**Files:**
- `frontend/src/components/composites/AIMemoPanel.tsx:36, 70` — `px-[18px] py-[18px]`, `px-[7px] py-[3px]`.
- `frontend/src/components/composites/StatusBar.tsx:47, 64, 69` — `gap-[18px]`, `py-[1px]`.
- `frontend/src/components/composites/PositionsList.tsx:41, 87, 96, 101` — `px-[18px]`, `mt-[1px]`, `gap-[2px]`.
- `frontend/src/components/composites/ContextBar.tsx:36` — `gap-[2px] px-[22px]`.
- `frontend/src/components/composites/PriceChartPanel.tsx:261, 290` — `gap-[18px]`, `gap-[14px]`.
- `frontend/src/components/composites/StrategyCard.tsx:76` — `mt-[3px]`.
- `frontend/src/components/layout/TickerTape.tsx:34` — `py-[3px]`.
- `frontend/src/components/layouts/editorial.tsx:17` — `top-[1px]`.
- `frontend/src/components/ui/button.tsx:55` — sm variant: `h-[26px] px-[10px]`.
**Current:** Spacing values like 7, 10, 14, 18, 22 don't land on the 4px/8px grid; they're eyeballed to match editorial print proportions.
**Should be:** `--space-1/2/3/4/5/6/8/10/12/16/24` = 4/8/12/16/20/24/32/40/48/64/96. If the editorial layout genuinely needs a non-grid rhythm, add tokens like `--space-edit-1: 7px; --space-edit-2: 18px;`. Either way, these should not be scattered arbitrary-value Tailwind classes.
**Why it matters:** Card inner spacing has the highest cumulative visual impact — when panels are `px-4` (16) in one place and `px-[18px]` in another, rows don't align across vertically-stacked panels. The composites layer intentionally uses editorial spacing; the dashboard layer uses default; they don't share a rhythm.

### [P2] `font-['JetBrains Mono']` / `fontFamily: "JetBrains Mono, monospace"` bypass the CSS var
**Files:**
- `frontend/src/components/composites/PriceChartPanel.tsx:83` — `fontFamily: "JetBrains Mono, monospace"`.
- `frontend/src/components/charts/TradingChart.tsx:319` — `getTokenVar("--font-ui", "Inter, sans-serif")` (correct pattern, but hardcoded fallback is `Inter`; the design does not use Inter at all — UI font is `Söhne`/`Geist` loaded by next/font).
- `frontend/src/components/panels/PayoffDiagram.tsx:313, 316` — SVG text `fontFamily="Inter, system-ui, sans-serif"`.
**Should be:** `var(--font-mono)`, `var(--font-ui)`. Let next/font own the identity.
**Why it matters:** If next/font switches families (or the cache busts on a deploy), these callers won't follow and render system sans instead of the intended face.

### [P2] Modal / tooltip / toast z-index stack is a patchwork
**Files:**
- Dialog: `z-50` (`ui/dialog.tsx:34, 59`).
- Sheet: `z-50` (`ui/sheet.tsx:31, 58`).
- Dropdown-menu: `z-50` (`ui/dropdown-menu.tsx:36, 45`).
- Popover: `z-50` (`ui/popover.tsx:35, 40`).
- Tooltip: `z-50` (`ui/tooltip.tsx:48, 53`).
- Toast: `z-[55]` (`ui/toast.tsx:120`) — one level above dialog, but a dialog at z-50 opened while a toast is visible will overlap on the same plane.
- Shortcut overlay: `z-[60]` (`ui/shortcut-overlay.tsx:118`).
- Onboarding tour overlay: `z-[100]` (`layout/OnboardingTour.tsx:215`) — uses arbitrary value.
- AICopilot drawer: `z-40` + `z-50` (`layout/AICopilot.tsx:153, 162`).
- Alerts filter dropdown: `z-50` (`app/(dashboard)/alerts/page.tsx:361`) — same plane as Dialog, will render under Dialog if both open.
- SectorTreemap tooltip: `z-30` (`dashboard/SectorTreemap.tsx:368`); PnlCalendarMini tooltip: `z-10` (`dashboard/PnlCalendarMini.tsx:125`) — these tooltip-like elements sit *below* modals but also below each other on no consistent logic.
- `StrategyTemplates.tsx:276, 284-285` — modal at `z-50` + sticky header at `z-10` inside; if a tooltip from `z-30` shows inside, its rank wins/loses unpredictably.
**Should be:** Named scale in design-tokens.css — e.g. `--z-base:0 --z-sticky:10 --z-dropdown:20 --z-overlay-local:30 --z-drawer:40 --z-modal:50 --z-toast:60 --z-tour:70`. Apply via Tailwind arbitrary values that reference those vars.
**Why it matters:** The alert filter dropdown already opens behind newer dialogs in some flows, and OnboardingTour at z-100 hides any tooltip/toast during the welcome flow. Not purely cosmetic — users can click controls they can't see.

### [P2] Inconsistent shadows — `shadow-2xl` / `shadow-xl` / `shadow-lg` used in ad-hoc places
**Files:**
- `frontend/src/components/layout/OnboardingTour.tsx:252` — `shadow-2xl`.
- `frontend/src/components/layout/CommandPalette.tsx:219` — `shadow-2xl`.
- `frontend/src/components/layout/AICopilot.tsx:162` — `shadow-2xl`.
- `frontend/src/components/panels/StrategyTemplates.tsx:284` — `shadow-2xl`.
- `frontend/src/components/panels/ShareTrade.tsx:81` — `shadow-2xl`.
- `frontend/src/components/ui/shortcut-overlay.tsx:124` — `shadow-2xl shadow-black/40`.
- `frontend/src/components/ui/dialog.tsx:61` — `shadow-xl shadow-black/50`.
- `frontend/src/components/ui/dropdown-menu.tsx:47` — `shadow-xl shadow-black/40`.
- `frontend/src/components/ui/popover.tsx:42` — `shadow-xl shadow-black/40`.
- `frontend/src/components/ui/tooltip.tsx:56` — `shadow-lg shadow-black/40`.
- `frontend/src/components/ui/toast.tsx:61` — `shadow-lg shadow-black/30`.
- `frontend/src/components/panels/WatchlistPanel.tsx:101, 287` — `shadow-lg shadow-black/20`.
**Current:** Sizes `2xl` / `xl` / `lg` mixed with opacity tweaks, and some places use just `shadow-lg`.
**Should be:** The design system defines three shadow tokens — `--shadow-hair`, `--shadow-1`, `--shadow-2` (`design-tokens.css:137-140`). Map Tailwind's `shadow-*` to those (e.g. `shadow-2` for modals, `shadow-1` for dropdowns, `shadow-hair` for cards). The design philosophy in the tokens comment literally says "depth comes from border, not shadow" — so `shadow-2xl` everywhere is off-brand.
**Why it matters:** Two floating panels shown at the same time (e.g. a Popover over a Sheet) produce a double-drop-shadow effect that's aesthetically loud in a product otherwise defined by hairline borders.

---

## Appendix — additional items below P2 threshold (summary only)

- `components/dashboard/SectorTreemap.tsx:382, 392, 396` — `text-zinc-500` / `text-zinc-400` (should be `text-fg-hint` / `text-fg-muted`); `:144-150` — all treemap cells `bg-emerald-*` / `bg-red-*` (should derive from `--up-*` / `--down-*`).
- `components/dashboard/ActivityFeed.tsx:71-72` — `text-blue-400` / `text-amber-400` for info/warning; use `text-ice` and `text-amber` tokens.
- `components/dashboard/AllocationDonut.tsx:120` and `components/dashboard/SectorTreemap.tsx:412` and `components/dashboard/PortfolioHero.tsx:216` — "Connect Alpaca API for live data" fragment uses `text-blue-400/70`; use `text-ice` or `text-fg-hint`.
- `components/dashboard/MarketContext.tsx:146` — `group-hover:text-blue-400` on news headline; use `group-hover:text-brand`.
- `components/panels/StrategyBuilder.tsx:175` — `border-[var(--profit)]/30 bg-[var(--profit)]/5` next to `border-amber-500/30 bg-amber-500/5`; pick one naming convention (either all via tokens or all via Tailwind classes).
- `components/ui/input.tsx:25`, `components/ui/textarea.tsx:22`, `components/ui/input-group.tsx:31` — `shadow-[0_0_0_3px_rgba(201,166,107,0.12)]` is the brand-tint glow with a hardcoded rgba. The value is already available as `--brand-tint` — use `shadow-[0_0_0_3px_var(--brand-tint)]`.
- `components/dashboard/PerformanceMetrics.tsx:199, 359, 396` — `bg-white/[0.02]` / `bg-black/20` for table zebra; use `bg-bg-elev-1`.
- `components/dashboard/PnlCalendarMini.tsx:113, 115` — `text-white` on colored cells; use `text-ink-1000`.
- `components/dashboard/StrategyCorrelation.tsx:203, 214, 248` — `border-[var(--surface)]`, `text-white/80`, `text-2xl font-bold`; use tokens and typography primitives.
- `components/dashboard/SectorTreemap.tsx:324` — `ring-1 ring-white/30`; use `ring-ink-1000/30` or `ring-border-strong`.
- `components/layout/AICopilot.tsx:198` — `rounded-2xl` while the design system says cards = `--radius-md` (6px) and modals = `--radius-xl` (16px); `2xl` is off-scale.
- `components/panels/ShareTrade.tsx:460` — `rounded-xl` on a modal dialog — OK, matches `--radius-xl`, but elsewhere modals use `rounded-2xl` (`StrategyTemplates.tsx:284`) — pick one.
- `components/layout/NotificationCenter.tsx:42` — `text-amber-400`; use `text-amber`.
- `components/panels/AnalysisPanel.tsx:460-461` — `text-amber-400`/`text-amber-300` for ETF warning; use `text-amber` from the design system.
- `components/panels/TradePanel.tsx:1317` — `bg-primary text-[9px] font-medium text-primary-foreground` — `text-[9px]` is smaller than the minimum legible token `--fs-micro: 9.5px`; round up or use the micro token.
- `components/panels/StrategyBuilder.tsx:257-263` — tree of `text-amber-500`, `text-amber-400`, `text-amber-500/50`, `text-amber-400/90` — five different amber tones in one warning block; use one `text-amber` plus proper opacity.
- Raw `<button>` count: 25+ call sites use hand-rolled buttons (`app/(dashboard)/alerts/page.tsx:101, 115`; `components/panels/AnalysisPanel.tsx:823, 832, 914-915, 939-940`; `components/panels/TradePanel.tsx:1234, 1317-1318`; `components/panels/WatchlistPanel.tsx:616, 696, 699, 702, 705, 918, 923, 928`; `components/panels/ShareTrade.tsx` overlay buttons). Each has its own `rounded-{sm,md}`, `h-{6,7,8,9}`, `text-[{9,10,11}px]`, `bg-{primary,panel}` combo.
- `components/layout/TopBar.tsx:87` — nav items: raw `<button>` with `rounded-md px-3 py-2 text-[11px]`; the `Button` variant `ghost` exists for this.
- `components/panels/ShareTrade.tsx:112-127` — `bg-white/[0.03] border border-white/[0.06]`; in a dark warm-black app, "white at 3%" is a cold gray — use `bg-bg-elev-2 border-border-hair`.
- `components/layout/OnboardingTour.tsx:227, 240` — overlay uses `bg-black/60` + `rgba(0,0,0,0.6)`; the `Dialog`/`Sheet` primitives use `bg-ink-000/60` — the overlay on the tour is a slightly different black than every other overlay in the app.
- `components/ui/sheet.tsx:31` and `ui/dialog.tsx:34` do use `bg-ink-000/60` ✓ — so the violator is specifically OnboardingTour (`bg-black/60`) and StrategyTemplates (`bg-black/60`) and ShortcutOverlay (`bg-black/60`). Three different flavours of overlay dimming.

## Summary tally

Total raw hex literals in production TSX (excluding the design-tokens.css itself and __tests__): **~180+ occurrences across 15 files**, dominated by `ShareTrade.tsx` (40+), `TradingChart.tsx` (15+), `PnlCalendar.tsx` (11), `PayoffDiagram.tsx` (10+), `AnalysisPanel.tsx` (10+), `StatusStrip.tsx` (5), `TradePanel.tsx` (5).

Total Tailwind default-palette utilities (`text-*-{400,500}`, `bg-*-{400,500}` for `emerald`/`red`/`blue`/`amber`/`green`): **~80+ across 20 files**.

Typography primitives (`Display`, `Eyebrow`, `Mono`, `SectionRule`): used by the composites layer and the `/` design page. Zero uses in `app/(dashboard)/*/page.tsx`.

**Recommended roll-up:**

1. One-PR sweep: replace every `text-emerald-*` / `text-red-*` / `text-green-*` occurring as a P/L color with `text-profit` / `text-loss` (grep-safe).
2. One-PR sweep: replace `text-[#8a8a95]` with `text-fg-muted` everywhere.
3. Consolidate the 7 error.tsx files into one component.
4. Rewrite `ShareTrade` canvas + `PnlCalendar` color scale using `getComputedStyle` + token vars; rewrite `TradingChart` indicator palette to cycle `--chart-1..5`.
5. Introduce a `<PanelHeader title action />` composite and migrate ~25 raw `<h2>`s.
6. Normalize z-index to a named scale in `design-tokens.css`.
