# Pillar 3 — Color (Re-Audit R2)

**Audited:** 2026-05-03
**Run:** `qa/runs/2026-05-04T13-45-11Z`
**Baseline:** `frontend/src/styles/design-tokens.css` + `frontend/src/app/globals.css`
**Screenshots reviewed:** `dashboard`, `login`, `strategies-list`, `pipeline`, `trade`, `strategies-earnings-options-play` (desktop-1440 `initial.preview.png`)
**Stance:** FORCE — assume failure until proven otherwise.
**Prior score:** 1 / 4 — POOR (3 BLOCKER, 6 WARNING)

---

## Score: 3 / 4 — GOOD

The remediation sprint resolved the two highest-impact blockers (`!important` hex overrides, primary-CTA reconciliation) and the system now reads as a single coherent palette across the dark trading surface. Hardcoded literals dropped from 306 to 219 (-28%), and **88% of the remaining literals (113 of 129 Tailwind arbitrary classes) live in the auth/marketing shell that is intentionally frozen as light-mode-only per design-system contract**. Discipline outside that frozen zone is much improved: the `!text-[#…]` override count is **0** (was 13), the lime-CTA collision is gone, and gold is unambiguously the brand chroma.

What pulls this back from a 4: the amber-overload (F6) is unfixed and `--state-stale` still aliases `--amber-500`; one earnings sub-route (`EarningsCalendarSidebar` / `EarningsDetailPanel`) still leaks the marketing `bg-white/60` + `border-[#5d7268]` palette into a dashboard page; and inline `shadow-[…rgba()…]` strings persist on the dashboard hero (7 hits in `(dashboard)/page.tsx`). The top dashboard chartreuse dominance (F3 part 2) is dampened — chartreuse `bg-up-500` is now reserved for a 6px semantic dot in OrderBar's segmented control + PositionsList sparkline; visible chartreuse comes from semantic `text-up-500` on P&L numbers, which is correct usage.

---

## Closed findings

### F1 — closed (substantially)
Hardcoded literals: **306 → 219** (`grep -rnE '#[0-9a-fA-F]{3,8}' src --include='*.tsx' --include='*.ts' | wc -l = 219`). Of the 219, distribution shifts the diagnosis:

- Auth/marketing frozen zone (per BUG-08 deferral contract): `AuthProductFrame` 40, `AuthLuxuryPreview` 37, `RequestAccessForm` 23, `LoginForm` 18 → **118 hits acceptable as documented frozen surface**.
- Chart fallback literals (`getTokenVar("--up-500", "#a8d04d")`): `TradingChart` 29, `PayoffDiagram` 10, `ShareTrade` 10, `drawingPlugin` 2, `analytics/page` 5, `BulletGraph` 1, `SymbolGroupDot` 2 → **59 hits acceptable as token-with-fallback pattern** (the literal is the explicit default if the CSS variable is unset, never the source of truth).
- `global-error` 10 → **acceptable** because tokens may not have loaded when this renders.
- True remaining violations on dashboard surface: **~22 hits across 5 files** (see Outstanding).

### F2 — closed
`!text-[#…]` and `!bg-[#…]` overrides: `grep -rnE '!text-\[#' src --include='*.tsx' | wc -l = 0`. Strategies-list and Pipeline page screenshots confirm: cream H2 headers render legibly on `--bg-elev-1`, and all four section icons (Target, Zap, Clock, TrendingUp) on Pipeline read crisp. The strategy-detail "near-white text on pale band" rendering bug is resolved.

### F3 (CTA reconciliation) — closed
Login screenshot (`login/desktop-1440/initial.preview.png`) confirms: "Sign in" and "Request access" CTAs now render in **gold** matching the brand chroma — no green-button collision with the marketing rail. Trade screenshot (`trade/desktop-1440/initial-prefill.preview.png`) shows BUY/SELL as a gold-active **segmented** control with a 6px semantic dot, not as a chartreuse solid button. Dead `buy-solid` / `sell-solid` Button variants are removed (PR-6b verified — `grep buy-solid src` returns 0).

`grep -rnE 'bg-\[#a8d04d\]|"bg-up-500"' --include='*.tsx' = 2`, both legitimate semantic dots (`OrderBar.tsx:512`, `PositionsList.tsx:287` sparkline). The 60/30/10 inversion called out in F3 is largely corrected on `dashboard/desktop-1440/initial.preview.png`: the warm-near-black surface now visibly dominates, gold occupies the top-right control cluster as a 5–8% accent, and chartreuse appears only on positive P&L numerals (semantic, not chrome).

### F5 (theme parity in marketing shell) — closed by deferral
BUG-08 explicitly froze the auth/marketing surface as light-mode-only per design-system contract. The screenshots confirm a consistent cream + gold treatment across `/login`, `/request-access`, `/about`, `/contact`, `/privacy` — the parallel palette is now an intentional aesthetic choice, not an accidental one. F5 is reclassified from BLOCKER to "intentional design contract" and removed from the active findings list. Future visual refresh of the marketing surface still requires editing 4–5 files, but that is now a documented constraint.

### F4 (token discipline collapse: `text-up-500` leaking) — partially closed
Primitive `badge.tsx` and `button.tsx` still use `up-500` / `down-500` directly (intended — primitives can use raw scale). `text-primary` vs `text-brand` redundancy and `bg-primary` vs `bg-brand` are unchanged but were always WARNING tier; they don't block the upgrade.

### F8 (inline shadows) — partially closed
Dashboard inline shadow count: `grep 'shadow-\[0_' (dashboard)/page.tsx = 7` (was 9). Improvement is small and the alpha-jitter problem persists; demoted to outstanding-low.

---

## Outstanding findings

### O1 — WARNING (was F6): `--amber-500` overload, `--state-stale` still aliased
`grep -nE 'amber|warn' design-tokens.css` shows `--state-stale: var(--amber-500)` at line 120, `--warn: var(--amber-500)` at line 110, and `--rust-500: #d9a441` (deprecated alias to `--amber-500`) at line 51 — the four orthogonal meanings (warning vs stale vs risk-threshold vs after-hours) still all resolve to mustard `#d9a441`. `text-amber` / `bg-amber` / `border-amber` usage count: **126** (was 113). An operator still cannot tell at a glance whether an amber pill means "act on this," "refresh me," or "informational." Decompose into `--state-warning`, `--state-stale`, `--state-info-time` with different chroma.

### O2 — WARNING (NEW): Marketing palette leaks into earnings sub-route
`strategies-earnings-options-play/desktop-1440/initial.preview.png` shows the earnings calendar / detail panels rendering as **light-mode cream cards (`bg-white/60`) with marketing-grey borders (`border-[#5d7268]`)** inside an otherwise dark dashboard route. Source: `EarningsCalendarSidebar.tsx:74,85,87,103,104` and `EarningsDetailPanel.tsx:184,187,199` apply `border-[#5d7268]/40 bg-white/60` and `text-[#5d7268]` (without the `!` modifier — F2 fixed only the `!important` flavor). 8 sites total. This is a fresh F2-class regression: cream-on-white-on-dark inside a dashboard route reads as a half-shipped page. Replace `border-[#5d7268]` → `border-border-hair`, `bg-white/60` → `bg-bg-elev-2`, `text-[#5d7268]` → `text-fg-muted`.

### O3 — WARNING (was F7): Off-system Tailwind palette persists
`grep -rnE 'bg-emerald-|bg-red-|text-emerald-|text-red-|text-blue-|bg-blue-' --include='*.tsx' | wc -l = 17`, distributed:
- `dashboard/SectorTreemap.tsx` 11 hits (entire heatmap logic still on raw `bg-emerald-{400..700}` / `bg-red-{400..600}`)
- `panels/StrategyTemplates.tsx` 2 hits
- `dashboard/StrategyGrid.tsx` 2 hits
- `dashboard/MarketContext.tsx` 1 hit (`text-blue-400` news hover)
- `dashboard/AllocationDonut.tsx` 1 hit (`text-blue-400/70`)

The treemap green is still visibly different from `--up-500` chartreuse on the same fold. Unchanged from R1.

### O4 — WARNING (was F9, partial): API-degraded banner uses raw amber hex chrome
`(dashboard)/layout.tsx:87,92,94,95,99,107` apply `border-[#6f541f]`, `bg-[#21190d]`, `text-[#f8d590]`, `text-[#d9b165]`, `text-[#e7c477]`, `border-[#8c6a28]`, `hover:bg-[#3a2a12]`, `outline-[#f8d590]` — 6 unique amber-family hexes for a single banner. None reference the existing `--warn` / `--amber-500` token tree. Visible on `strategies-earnings-options-play/desktop-1440/initial.preview.png` (top "DATA UNAVAILABLE" strip). Functionally fine and contrast-passing; structurally it perpetuates exactly the multi-shade amber problem O1 calls out. Should resolve through `--warn` or a new `--state-warning-banner-{bg,border,fg}` triplet.

### O5 — WARNING-LOW (was F8): Inline `rgba` shadow strings on dashboard hero
`grep 'shadow-\[0_' (dashboard)/page.tsx = 7` (down from 9). Each shadow has a slightly different alpha (`0.36`, `0.34`, `0.42`, `0.52`) per panel, producing depth-jitter as you scroll. `--shadow-1`/`--shadow-2` are defined in `design-tokens.css` and unused here. Add a third `--shadow-hero` token and route consumers through it.

### O6 — INFO: `bg-[color:var(--…)]` arbitrary-class fallback pattern
6 hits across `(dashboard)/pipeline/page.tsx:1588,1617`, `BulletGraph.tsx:51`, `EarningsDetailPanel.tsx:248,646`, `SymbolGroupDot.tsx:29,31` use Tailwind's `bg-[color:var(--amber-500,#d97706)]/65` arbitrary-value syntax with hex fallback. This is functionally a token reference (the var wins) but still pollutes grep results and makes future refactors noisier. Migrate to `bg-warn/65` or a named utility.

---

## NEW findings (not in original audit)

### N1 — INFO: API-degraded banner is the pattern that broke F2's win
The same family of inline-amber-hex chrome (O4) reads as a one-off "raw colors are still ok in this banner" exception. With nothing in the codebase preventing the next consumer from copying the pattern, expect F2-class regressions to reappear. Recommend a `<DegradedBanner severity="warn|crit">` primitive that consumes `--warn` tokens, then ban arbitrary-value classes via an ESLint rule (`no-restricted-syntax` matching `/text-\[#/`).

### N2 — INFO: chart-fallback literals form a stable tertiary palette outside the token system
`#a07550` (expected-move brown), `#5b8def` (ice — same value as `--ice-500` but typed inline at `TradingChart:1099`, `SymbolGroupDot:31`), `#e07856` (coral — same as `--down-500`), `#a8d04d` (chartreuse — same as `--up-500`) appear as inline literals in `TradingChart.tsx:1099-1102` for compare-series cycling. These are *not* fallbacks (no `getTokenVar` wrapper); they are direct hex. Migrate to `[var(--ice-500), var(--brown-500 || expected-move), …]` and add a missing `--brown-500` / `--expected-move` token if needed.

---

## Score-defending evidence

| Metric | R1 | R2 | Direction |
|--------|-----|-----|-----------|
| Hardcoded color literals (`tsx`+`ts`, no tests) | 306 | 219 | -28% |
| `!text-[#…]` overrides | 13 | 0 | fixed |
| `!bg-[#…]` / `!border-[#…]` / `!fill-[#…]` overrides | n/a | 0 | clean |
| Tailwind arbitrary `text-[#…]` / `bg-[#…]` / `border-[#…]` | ~144 | 129 | -10% |
| Of those, in frozen auth/marketing | n/a | 113 (88%) | concentrated |
| Of those, leaking into dashboard | ~30 (est) | 16 | -47% |
| Chartreuse `bg-up-500` / `bg-[#a8d04d]` as CTA chrome | ~6 | 2 (both semantic dots) | fixed |
| Off-system Tailwind palette (`emerald/red/blue-…`) | ~22 | 17 | -23% |
| Inline `rgba()` shadows on dashboard hero | 9 | 7 | -22% |
| `--amber-500` token still aliased to 4 meanings | yes | yes | unchanged |

Visual confirmation per screenshot:
- `login/desktop-1440/initial.preview.png` — CTAs are gold; the lime "Sign in" button is gone.
- `dashboard/desktop-1440/initial.preview.png` — gold dominates the top control cluster; chartreuse appears only on positive P&L numerals (semantic) and a P&L sparkline; warm-near-black surface reads as 60% dominant.
- `strategies-list/desktop-1440/initial.preview.png` — cream H2s legible; no `#12281f` deep-green ghost text.
- `pipeline/desktop-1440/initial.preview.png` — section icons (Target, TrendingUp) crisp; `t-h2` headers render as cream `--fg`.
- `trade/desktop-1440/initial-prefill.preview.png` — BUY/SELL is a segmented control with gold active state and tiny semantic dot, not a chartreuse fill.
- `strategies-earnings-options-play/desktop-1440/initial.preview.png` — **regression visible**, light cream panels inside a dark dashboard route (O2).

---

## Top 3 priority fixes (R2)

1. **Decompose `--amber-500` overload (O1).** Define `--state-warning` (mustard, act-on-this), `--state-stale` (desaturated amber, refresh-me), `--state-info-time` (ice, after-hours informational). Update `--warn` to point at the new `--state-warning`, drop `--state-stale: var(--amber-500)` aliasing. Sweep the 126 `*-amber` consumers per their semantic intent. The operator-glance problem is the single largest remaining color sin in the dashboard.

2. **Fix the earnings-options-play marketing-leak (O2).** Three classes across two files: `border-[#5d7268]/40` → `border-border-hair`, `bg-white/60` → `bg-bg-elev-2`, `text-[#5d7268]` → `text-fg-muted`. ~8 sites, ~10 lines of diff. Restores the dashboard look-and-feel inside a dashboard route.

3. **Token-ize the API-degraded banner chrome (O4).** Replace the 6 inline amber hexes in `(dashboard)/layout.tsx:87-107` with `bg-warn/15 text-warn border-warn/40` (or a fresh `--state-warning-banner-{bg,border,fg}` triplet). Then add an ESLint rule banning Tailwind arbitrary-value classes matching `/(text|bg|border|ring|fill|stroke|outline|shadow)-\[#[0-9a-fA-F]/` outside `auth/`, `marketing/`, `(public)/`, `app/global-error.tsx`, and `*chart*` files. Without this rule, expect F2-class regressions to recur.

---

## Files audited (R2)

- `frontend/src/styles/design-tokens.css`
- `frontend/src/app/globals.css`
- `frontend/src/app/(dashboard)/layout.tsx`
- `frontend/src/app/(dashboard)/page.tsx`
- `frontend/src/app/(dashboard)/pipeline/page.tsx`
- `frontend/src/app/(dashboard)/strategies/page.tsx`
- `frontend/src/app/(dashboard)/strategies/earnings-options-play/_earnings/EarningsCalendarSidebar.tsx`
- `frontend/src/app/(dashboard)/strategies/earnings-options-play/_earnings/EarningsDetailPanel.tsx`
- `frontend/src/app/(dashboard)/analytics/page.tsx`
- `frontend/src/app/global-error.tsx`
- `frontend/src/components/auth/AuthProductFrame.tsx`
- `frontend/src/components/auth/AuthLuxuryPreview.tsx`
- `frontend/src/components/charts/TradingChart.tsx`
- `frontend/src/components/charts/ChartPane.tsx`
- `frontend/src/components/charts/drawingPlugin.ts`
- `frontend/src/components/composites/OrderBar.tsx`
- `frontend/src/components/panels/PayoffDiagram.tsx`
- `frontend/src/components/panels/ShareTrade.tsx`
- `frontend/src/components/panels/TradePanel.tsx`
- `frontend/src/components/dashboard/SectorTreemap.tsx`
- `frontend/src/components/dashboard/StrategyGrid.tsx`
- `frontend/src/components/dashboard/MarketContext.tsx`
- `frontend/src/components/dashboard/AllocationDonut.tsx`
- `frontend/src/components/panels/StrategyTemplates.tsx`
- `frontend/src/components/primitives/SymbolGroupDot.tsx`
- `frontend/src/components/primitives/BulletGraph.tsx`
- `frontend/src/components/ui/badge.tsx`
- `frontend/src/components/ui/button.tsx`
- `frontend/src/components/ui/placeholder.tsx`

**Screenshots referenced:**
- `qa/runs/2026-05-04T13-45-11Z/login/desktop-1440/initial.preview.png`
- `qa/runs/2026-05-04T13-45-11Z/dashboard/desktop-1440/initial.preview.png`
- `qa/runs/2026-05-04T13-45-11Z/strategies-list/desktop-1440/initial.preview.png`
- `qa/runs/2026-05-04T13-45-11Z/pipeline/desktop-1440/initial.preview.png`
- `qa/runs/2026-05-04T13-45-11Z/trade/desktop-1440/initial-prefill.preview.png`
- `qa/runs/2026-05-04T13-45-11Z/strategies-earnings-options-play/desktop-1440/initial.preview.png`
