# Persona 46 — Contrast, Focus Rings & Color-Token Consistency

Scope: regressions in the token system after Wave 11 (foreground fix) and Waves 5/6 (hex → token migration). Hunted for AA failures, focus-ring gaps, undefined tokens, and default Tailwind palette leakage.

Token baselines (from `frontend/src/styles/design-tokens.css`):
- `--bg = #0b0a09`, `--bg-elev-1 = #111110`, `--bg-elev-2 = #15140f`, `--bg-card = #1c1a14`
- `--fg = #ece6d2`, `--fg-dim = #a8a08d`, `--fg-muted = #a8a08d` (ink-700, r3-lifted), `--fg-hint = #9a9380` (r3-lifted)
- `--profit = #a8d04d` (chartreuse), `--loss = #e07856` (coral), `--brand = #c9a66b` (gold)
- `--loss-foreground = --ink-000 (#050503)`, `--primary-foreground = #1a1206` (both intentionally near-black because coral/gold are light)

## Findings (10 max)

### F1 — [CRITICAL, AA FAIL] `text-white` on `var(--loss)` coral buttons — ~2.8:1
File: `frontend/src/components/panels/TradePanel.tsx:442`, `:511`, `:793`
`bg-[var(--loss)] ... text-white` on the **Submit LIVE Order** button, the duplicate LIVE submit, and the "Set Stop Loss" dialog confirm. Coral `#e07856` vs pure white `#ffffff` ≈ 2.82:1 — fails WCAG 1.4.3 AA (4.5:1). Wave 11 defined `--loss-foreground = --ink-000` precisely to fix this and the `.u-loss` / destructive classes use it, but these top-stakes trading buttons bypass the token. Use `text-loss-foreground` or `text-ink-000`.

### F2 — [CRITICAL, AA FAIL] Skip-to-content link: `focus:text-white` on `focus:bg-primary`
File: `frontend/src/components/layout/DashboardShell.tsx:22`
Gold `#c9a66b` vs white ≈ 2.06:1. An accessibility utility that fails accessibility. `(dashboard)/layout.tsx:137` was already fixed in r3 to `focus:text-primary-foreground` with an inline comment explaining the 2.4:1 failure — DashboardShell (used on non-dashboard routes) kept the broken class. Same bug also in `frontend/src/components/layout/AICopilot.tsx:321` (`bg-primary text-white` send button — gold on white).

### F3 — [CRITICAL, UNDEFINED TOKEN] `var(--neutral)` is never declared
File: `frontend/src/lib/utils.ts:75`, `frontend/src/components/dashboard/SectorTreemap.tsx:147`, `frontend/src/components/panels/AnalysisPanel.tsx:372,589`, `frontend/src/components/panels/TradePanel.tsx:853`, `frontend/src/components/dashboard/RiskDashboard.tsx:102,103,224`
No `--neutral:` rule anywhere in `design-tokens.css`, `globals.css`, or any component CSS. Tailwind arbitrary `bg-[var(--neutral)]`/`text-[var(--neutral)]` resolves to an empty var → **transparent/initial** at runtime: the middle tile of the SectorTreemap gradient, the cancelled-order chip, and the RiskDashboard neutral progress bars render invisible or inherit unintended colors. Wave 5/6 migration shortfall — should be `--ink-600` (or a named `--neutral` added to tokens).

### F4 — [HIGH, AA FAIL] Treemap tooltip & labels with sub-AA white alpha
File: `frontend/src/components/dashboard/SectorTreemap.tsx:337,352,357,374,397`
`text-[10px] text-white/90` / `text-[9px] text-white/50` / `text-[9px] text-white/40` over mid-saturation sector tiles (emerald/red/neutral fills). 40–50% white on `bg-red-400/50` computes ≈ 1.7–2.1:1 — fails AA. Also 9px body text is below the design system's `--fs-hint = 11px` floor. Color-over-color overlays need `--ink-1000` or opaque tokens plus minimum 11px.

### F5 — [HIGH, PALETTE LEAK] Default Tailwind `zinc` / `emerald` / `red` / `amber` / `blue` outside token system
Files (40 occurrences across 12 files):
- `frontend/src/components/dashboard/SectorTreemap.tsx:144-150,345,378,382,392,396,401,412` — 14 hits of `bg-emerald-*`, `bg-red-*`, `text-zinc-500`, `text-zinc-400`, `text-blue-400/70`
- `frontend/src/components/dashboard/StrategyGrid.tsx:71,72,161,162` — `border-emerald-500/30 text-emerald-400` chips
- `frontend/src/components/panels/StrategyTemplates.tsx:109-111` — risk chips use `emerald/amber/red-500`
- `frontend/src/components/panels/StrategyBuilder.tsx:200,274,290,292,293,297,298` — 7 hits of `amber-400/500`
- `frontend/src/components/panels/WatchlistPanel.tsx:745`, `frontend/src/components/dashboard/ActivityFeed.tsx:71,72`, `frontend/src/components/dashboard/MarketContext.tsx:146`, `frontend/src/components/dashboard/StressTest.tsx:104,116`, `frontend/src/components/dashboard/AllocationDonut.tsx:120`, `frontend/src/components/layout/NotificationCenter.tsx:42`
Design-tokens provide the equivalents: `--up-500` (chartreuse, NOT emerald), `--down-500` (coral, NOT red), `--amber-500` (mustard #d9a441, NOT amber-500 #f59e0b), `--ice-500` (pale cyan, NOT blue-400), `--fg-hint`/`--fg-muted` (NOT zinc). The chartreuse-vs-emerald divergence is visible — tiles on the treemap don't match the P/L numbers anywhere else in the app.

### F6 — [HIGH, TOKEN BYPASS] Hex drift: `#8a8a95` (cool blue-gray) in the warm-ink system
Files: `frontend/src/components/layout/ProfileMenu.tsx:116,122`, `frontend/src/components/ui/placeholder.tsx:49`, `frontend/src/app/(dashboard)/pipeline/page.tsx:140`
`#8a8a95` has a blue tint and was the pre-Wave-5 generic gray. Contrast on bg is ~5.1:1 (passes AA), but it clashes next to `--fg-muted` (#a8a08d, warm) used on surrounding rows — visible hue mismatch in the Profile dropdown equity row and the empty-state placeholders. Replace with `text-fg-muted` or `text-fg-hint`.

### F7 — [HIGH, TOKEN BYPASS] Raw `#2a2a3e` / `#12121a` inside TradePanel (old purple-gray theme)
File: `frontend/src/components/panels/TradePanel.tsx:1381,1388`
`border-[#2a2a3e]` (a cool-purple hex) and `bg-[#12121a]` (cool near-black) inside the positions pane. These predate the warm-ink migration — `#2a2a3e` has ~20° hue shift from `--border` (#2a271d). Any neighboring component uses `--border` / `--bg-elev-2`, so side-by-side the seam is visible on wide screens. Wave 5/6 sweep missed this file.

### F8 — [MEDIUM, AA-BORDERLINE] Shadcn `--color-destructive-foreground: var(--fg)` = cream on coral
File: `frontend/src/app/globals.css:98`
`--fg (#ece6d2)` on `--destructive (#e07856)` ≈ 2.72:1 — AA FAIL. Design-tokens.css defines the correct `--loss-foreground = --ink-000`, but the shadcn alias still points to `--fg`. Any shadcn component that renders `bg-destructive text-destructive-foreground` (e.g., alert-dialog variants, toast destructive) inherits the failing pair. Change to `var(--loss-foreground)`.

### F9 — [MEDIUM, FOCUS RING] `Input` component replaces outline with low-contrast shadow
File: `frontend/src/components/ui/input.tsx:26-27`
`outline-none ... focus-visible:shadow-[0_0_0_3px_rgba(201,166,107,0.12)]`. Gold at 12% opacity on bg-elev-1 has an effective contrast of ~1.3:1 against the surrounding surface — fails WCAG 2.4.7 "Focus Visible" (non-text UI needs 3:1). The global `:focus-visible { outline: 2px solid var(--brand) }` in `globals.css:169-172` would pass, but this component explicitly overrides with `outline-none`. Either keep the global outline, or raise the shadow alpha (e.g., rgba(201,166,107,0.55)) and/or add a 1px solid brand ring.

### F10 — [MEDIUM, PALETTE LEAK] `bg-white/[0.02]` and `bg-black/20` on already-dark surfaces
File: `frontend/src/components/dashboard/PerformanceMetrics.tsx:228,388,425`
Three rows/tables use `bg-white/[0.02]` / `bg-black/20`. These are untokenized micro-elevations that compute to non-standard surface values (`#111110` @ +2% white = #141414) — neither matches `--bg-elev-1` (#111110) nor `--bg-elev-2` (#15140f). Result: subtle banding between cards sitting at "standard" elevations and these rows at "rogue" elevations. Replace with `bg-bg-elev-2` / `bg-bg-card`.

## Also noted, not counted (below threshold):
- `frontend/src/components/panels/PayoffDiagram.tsx:186,197,287` uses `stroke="#ffffff08"` / `#ffffff20` for SVG grid — cosmetic, but these are alpha-over-anything that should be `var(--border-hair)`.
- `frontend/src/components/charts/TradingChart.tsx:550` sets a Bollinger middle-band `getTokenVar("--fg-hint", "#64748b")` — the fallback hex (`#64748b`, slate) doesn't match the token (`#9a9380`); if CSS fails to load the chart gets the wrong color.

---

## 250-word summary

Wave 11's foreground fix (raising `--fg-muted` to ink-700 and recalibrating `--fg-hint` to #9a9380) holds on every surface where components actually use the semantic tokens — placeholder text in `Input`, the `.t-label` class, and most dashboard muted copy pass AA on `--bg-elev-1` through `--bg-card`. The regressions are elsewhere: the Wave 5/6 hex-to-token sweep left loose ends that Wave 11 couldn't reach.

Three critical failures: (1) the `Submit LIVE Order` button and two sibling trading CTAs use `text-white` on `var(--loss)` coral — ~2.8:1, below AA, on the highest-stakes action in the app; (2) the skip-to-content link in `DashboardShell` and the AI Copilot send button still render white on gold (~2.1:1), even though the parallel fix in `(dashboard)/layout.tsx` is documented; (3) `var(--neutral)` is referenced in eight places but never declared anywhere, so the SectorTreemap middle tile, cancelled-order chips, and risk-gauge neutral bars render with an empty CSS var — effectively transparent.

Secondary issues center on default Tailwind palette leakage: 40 occurrences of `emerald`, `red`, `amber`, `zinc`, `blue` utilities still bypass tokens, most densely in `SectorTreemap` (which also stacks 9-px `text-white/40` that fails AA by a wide margin). Shadcn's `--color-destructive-foreground` alias still points to `--fg` (cream), undoing Wave 11 on any component using that mapping. The `Input` focus state replaces the global 2px brand outline with a 12%-gold box-shadow, failing WCAG 2.4.7 for focus-indicator contrast. Remediation is concentrated: fix seven files plus one globals.css line and the color system re-converges.
