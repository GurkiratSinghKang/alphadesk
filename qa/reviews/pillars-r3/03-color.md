# Pillar 3 — Color (Re-Audit R3)

**Audited:** 2026-05-04
**Run:** `qa/runs/2026-05-04T15-47-19Z`
**Baseline:** `frontend/src/styles/design-tokens.css` + `frontend/src/app/globals.css`
**Screenshots reviewed:** `dashboard` (desktop+mobile), `login`, `strategies-list`, `strategies-earnings-options-play` (initial+scrolled-mid), `pipeline`, `trade` (initial-prefill, single-leg, multi-leg), `alerts`, `analytics`, `reports`, `strategy-momentum-quality` (desktop-1440)
**Stance:** FORCE — assume failure until proven otherwise.
**Prior scores:** R1 = 1 / 4 — POOR (3 BLOCKER, 6 WARNING) → R2 = 3 / 4 — GOOD (5 outstanding, 2 informational)

---

## Score: 3 / 4 — GOOD (held)

R3 closed exactly the one item the R2 sprint targeted: the EarningsCalendarSidebar marketing-palette leak (R2-O2). That fix is fully verified — `grep '#5d7268' EarningsCalendarSidebar.tsx` returns 0 hits, `grep 'bg-white/60' EarningsCalendarSidebar.tsx` returns 0, and the `strategies-earnings-options-play/desktop-1440/initial.png` snapshot now reads as a unified dark dashboard route (no cream-on-white tiles). Hex literal count drifted from 219 → 217 (-2, essentially flat — the R2-O2 sites were already counted as `[#5d7268]` arbitrary classes, not raw `#hex`). The `!text-[#…]` override count remains 0.

What pulls this back from a 4 (and prevents an upgrade): two of the three R2 priority fixes did not ship.

1. **Amber overload (R2-O1) is unchanged.** `--rust-500`, `--warn`, `--state-stale` and `--chart-5` all still alias `var(--amber-500)` (= `#d9a441`) in `design-tokens.css:50,51,93,110,120`. The promised `--state-warning` / `--state-stale` / `--state-info-time` decomposition does not exist. Amber-token consumers grew from 113 → 124 (+10%) — the operator-glance ambiguity got slightly worse, not better.
2. **API-degraded banner (R2-O4) still uses 6 raw amber hexes** at `(dashboard)/layout.tsx:87,92,94,95,99,107` (`#6f541f`, `#21190d`, `#f8d590`, `#d9b165`, `#e7c477`, `#8c6a28`, `#3a2a12`). The banner is visible at the top of every screenshot today (server is in "DATA UNAVAILABLE" mode in the sweep) — it's the most-seen surface in the entire trading app and remains the textbook example of the F2-class pattern that re-occurs because no ESLint rule blocks it.

The three "always-onscreen" surfaces (top nav + dashboard fold + trade ticket) read as a coherent warm-near-black + gold + chartreuse/coral system. P/L semantics are correct everywhere the sweep touches: positive numerals render `--up-500` chartreuse (`+$895.16`, `+22.55%`, `+1.68%` on dashboard, `+$469.12` on pipeline), negative numerals render `--down-500` coral (`-$418.05`, `-$8.21%`, `-$421.44`, `-$66.30`), and gold is unambiguously the primary CTA chroma (`Sign in`, `Request access`, `Open trade`, `Trade`, `Submit path`, `1M` time-segment active state). No rogue lime/forest greens leak into the dashboard chrome — the only chartreuse fills are the legitimate semantic dot on the OrderBar segmented control and the PositionsList P&L sparkline (2 sites, unchanged from R2 verification).

---

## Closed findings (R3)

### R2-O2 — closed ✅
EarningsCalendarSidebar marketing-palette leak. `grep -nE '#5d7268|bg-white/60' frontend/src/app/(dashboard)/strategies/earnings-options-play/_earnings/EarningsCalendarSidebar.tsx` = **0**. The companion `EarningsDetailPanel.tsx` retains 4 hex literals at lines 248, 250, 646, 648 but they are now in `[color:var(--warn,#d97706)]` token-with-fallback form, which is the R2-O6 INFO-tier pattern, not the marketing-leak BLOCKER pattern (the CSS variable wins; the literal is the explicit default if the var is unset). Visual confirmation: `strategies-earnings-options-play/desktop-1440/initial.png` and `scrolled-mid.png` show the calendar sidebar (`PLTR/MRVL/AMAT/ANET/SHOP/CRWD/EXR/...`) and the detail body rendering on `--bg-elev-2` charcoal with cream type and gold accents — no light-cream cards, no marketing grey borders.

### F1 / F2 / F3 / F5 — held closed (R2 status preserved)
- Hardcoded literal count: 306 (R1) → 219 (R2) → **217 (R3)**. Drift of -2 is within sweep noise.
- `!text-[#…]` overrides: 13 → 0 → **0**.
- Login CTA reconciliation (gold, not lime): verified again on `login/desktop-1440/initial.png` — "Request access" and "Sign in" buttons both gold; the marketing rail shows the cream-mode aesthetic per the BUG-08 frozen contract.
- Marketing surface frozen-as-light: `auth/AuthProductFrame` 40, `auth/AuthLuxuryPreview` 37, `request-access/RequestAccessForm` 23, `login/LoginForm` 18 → 118 hits in the documented frozen zone (54% of the 217 total — this is the expected concentration).

### F8 (inline shadows on dashboard hero) — held at 7
`grep 'shadow-\[0_' (dashboard)/page.tsx` = **7** (unchanged from R2). The four distinct alpha values (`0.34`, `0.36`, `0.42`, `0.52`) at lines 912, 1213, 1390, 1429, 1631, 1685, 1746 are still inline. This was demoted to "outstanding-low" in R2 and remains so in R3 — no regression, no improvement.

---

## Outstanding findings (R3)

### O1 — WARNING (held from R2-O1): `--amber-500` still aliased to four meanings
`design-tokens.css:50` defines `--amber-500: #d9a441` and immediately aliases:
- `--rust-500: #d9a441` (line 51, marked deprecated, but still 0 of 0 consumers migrated)
- `--chart-5: var(--amber-500)` (line 93)
- `--warn: var(--amber-500)` (line 110)
- `--state-stale: var(--amber-500)` (line 120)

Amber-class consumer count: `grep -rE 'text-amber|bg-amber|border-amber|fill-amber|outline-amber|ring-amber|from-amber|to-amber'` = **124** (was 113 in R2). The sprint did not begin the decomposition — `grep state-warning frontend/src/styles/design-tokens.css` returns 0, `grep state-info-time` returns 0. Operator still cannot distinguish "act on this" (warning) from "data may be stale" (ws-stale) from "chart series 5" from "after-hours informational" — they all render mustard `#d9a441`. This remains the single largest semantic ambiguity in the dashboard color system.

### O2 — WARNING (held from R2-O4): API-degraded banner uses 6 raw amber hexes
`(dashboard)/layout.tsx:87` → `border-[#6f541f] bg-[#21190d] text-[#f8d590]`
`(dashboard)/layout.tsx:92,94,99` → `text-[#d9b165]` (3 sites)
`(dashboard)/layout.tsx:95` → `text-[#e7c477]`
`(dashboard)/layout.tsx:107` → `border-[#8c6a28] text-[#f8d590] hover:bg-[#3a2a12] focus-visible:outline-[#f8d590]`

Six unique amber-family hexes for a single banner, none referencing `--warn` / `--amber-500`. **Visible on every screenshot in this sweep** (server is paper/dev with degraded data feed): top of `dashboard`, `trade/initial-prefill`, `trade/multi-leg-prefill`, `strategies-list`, `pipeline`, `alerts`, `analytics`, `reports`, `strategies-earnings-options-play`, `strategy-momentum-quality`. The banner is functionally fine and contrast-passing, but it is the most-seen surface in the authenticated app and it perpetuates exactly the multi-shade amber problem O1 names. R2 marked this as the #3 priority fix; R3 did not address it.

### O3 — WARNING (held from R2-O3): Off-system Tailwind palette persists
`grep -rE 'bg-emerald-|bg-red-|text-emerald-|text-red-|text-blue-|bg-blue-'` = **17** (unchanged from R2):
- `dashboard/SectorTreemap.tsx` 11 hits — the entire heatmap still on raw `bg-emerald-{400,500,600,700}` / `bg-red-{400,500,600}` plus `text-emerald-{200,400}` and `text-red-{200,400}` for dashboard heatmap rendering and tooltip
- `dashboard/StrategyGrid.tsx` 2 hits (`border-emerald-500/30 text-emerald-400`)
- `panels/StrategyTemplates.tsx` 2 hits (low/high risk pills using emerald/red)
- `dashboard/MarketContext.tsx` 1 hit (`text-blue-400` news hover)
- `dashboard/AllocationDonut.tsx` 1 hit (`text-blue-400/70` reminder copy)

The treemap green is a different green from the chartreuse `--up-500` on the same fold — the dashboard hero P&L chip and the SectorTreemap "+1%" tile read as two different "up" colors when adjacent. R2 made this a WARNING; R3 made no progress.

### O4 — INFO (held from R2-O6): `bg-[color:var(--…, #fallback)]` pattern persists
`grep -rE 'bg-\[color:var\(--'` = **85** (R2 said 6 — the R2 grep was narrower; this number is the full count of `bg-[color:var(...)]` arbitrary-class fallback usage). Of these, the `(--warn,#d97706)` pattern in `EarningsDetailPanel.tsx:248,250,646,648` and `pipeline/page.tsx:1588,1617` is the typical case. Functionally correct (the var wins), but the literal pollutes grep results and the next refactor has to sort 85 sites. Recommend a `bg-warn/65` named utility or letting Tailwind's CSS-variable resolution handle the fallback in one place.

### O5 — WARNING-LOW (held from R2-O5): inline `rgba` shadows on dashboard hero
7 sites in `(dashboard)/page.tsx` at lines 912, 1213, 1390, 1429, 1631, 1685, 1746 with four distinct alpha values (0.34, 0.36, 0.42, 0.52). Depth-jitter persists across panels. `--shadow-1`/`--shadow-2` tokens defined but unused; no `--shadow-hero` token added. Unchanged.

### O6 — INFO (carried from R2-N2): chart-fallback literals form a stable tertiary palette
`ChartPane.tsx:316` (`poc: "#c9a66b"`), `ChartPane.tsx:1314` (`["#5b8def", "#a07550", "#e07856", "#a8d04d"]`), `ChartPane.tsx:221,223` (`"#c9a66b"`, `"#e0c070"`) hardcode the chart palette as inline literals (no `getTokenVar()` wrapper). This is *not* a token-with-fallback pattern; it's the source of truth. Migrate to `[var(--ice-500), var(--brown-500), var(--down-500), var(--up-500)]` and add a missing `--brown-500` / `--expected-move` token.

---

## NEW findings (R3-only)

### N1 — INFO: chart-fallback palette migrated from `TradingChart.tsx` into `ChartPane.tsx`
The R2 audit cited 29 hex literals in `TradingChart.tsx` and `ChartPane.tsx` was not on the list. R3 grep shows `TradingChart.tsx` still at 29 (the older file), but `ChartPane.tsx` now has 4 hex literals at 221, 223, 316, 1314 — it inherited the same in-line `["#5b8def", "#a07550", "#e07856", "#a8d04d"]` cycling palette referenced in R2-N2. Net: no new sins, but the chart-palette-as-literals issue now lives in two files instead of being concentrated in one. Both should adopt the `getTokenVar(...)` helper used elsewhere.

### N2 — INFO: still no ESLint rule banning arbitrary `text-[#…]` / `bg-[#…]` outside the frozen zone
R2-N1 recommended an ESLint `no-restricted-syntax` rule matching `/(text|bg|border|ring|fill|stroke|outline|shadow)-\[#[0-9a-fA-F]/` outside `auth/`, `marketing/`, `(public)/`, `app/global-error.tsx`, and `*chart*` files. Not shipped. Without this guardrail, the API-degraded banner (O2) and the SectorTreemap raw-emerald (O3) patterns will continue to be copied. The +11 net amber-class consumers between R2 and R3 (113 → 124) is consistent with copy-paste growth.

---

## Score-defending evidence

| Metric | R1 | R2 | R3 | Direction R2→R3 |
|--------|-----|-----|-----|-----------------|
| Hardcoded color literals (`grep -rEn '\\#[0-9a-fA-F]{3,6}' frontend/src/app frontend/src/components`) | 306 | 219 | 217 | -1% (flat) |
| `!text-[#…]` overrides | 13 | 0 | 0 | held |
| `!bg-[#…]` / `!border-[#…]` / `!fill-[#…]` overrides | n/a | 0 | 0 | held |
| Hex literals in frozen auth/marketing surface | n/a | 113 | 118 | +4% (within frozen contract) |
| Hex literals in dashboard surface (non-frozen, non-chart, non-global-error) | ~30 (est) | 16 | ~14 | -13% |
| Chartreuse `bg-up-500` / `bg-[#a8d04d]` as CTA chrome | ~6 | 2 | 2 | held (semantic dots only) |
| Off-system Tailwind palette (`emerald/red/blue-…`) | ~22 | 17 | 17 | held |
| Inline `rgba()` shadows on dashboard hero | 9 | 7 | 7 | held |
| `--amber-500` token aliased to 4 meanings | yes | yes | yes | unchanged |
| Amber Tailwind class consumers | n/a | 113 | 124 | +10% (worse) |
| EarningsCalendarSidebar marketing leak | n/a | present | gone | **closed** |
| API-degraded banner raw amber hexes | n/a | 6 unique | 6 unique | held |

Visual confirmation per snapshot:
- `dashboard/desktop-1440/initial.png` — gold dominates the top control cluster; `+$895.16 unrealized` and `+22.55%` GROSS render `--up-500` chartreuse; `-$418.05 realized` and `-0.23% gross` render `--down-500` coral; warm-near-black surface dominates ~60% as designed.
- `dashboard/mobile-390/initial.png` — same palette holds at mobile; `-$421.44` Day P&L coral, `+22.55%` gross exposure chartreuse, `Open trade` button gold, `Ready` / `0 gates` chips read on the warm-amber state pills.
- `login/desktop-1440/initial.png` — frozen marketing palette intact; "Sign in" and "Request access" gold; cream surface; no lime collision.
- `strategies-list/desktop-1440/initial.png` — cream H2s legible on `--bg-elev-1`; status badges (`ACTIVE`, `PAUSED`, `RESEARCH`) cleanly differentiated; no green-text-on-green ghosts.
- `pipeline/desktop-1440/initial.png` — `+$469.12` chartreuse, `-$11.73 / -$846.61 / -$388.84 / -$1.32` all coral; section icons (Heart, Calendar, History) crisp; `Risk Monitor: ON` chip and `Run Now` gold CTA distinct.
- `trade/desktop-1440/initial-prefill.png` — BUY/SELL segmented control with gold active state and 6px semantic dot (not chartreuse fill); `217.95` ASK chartreuse, `217.96` BID chartreuse with `0.01` SPREAD muted; gold "Load" CTA top-right.
- `trade/desktop-1440/multi-leg-prefill.png` — strangle staged combos render `Sell 1` / `Sell 2` chips, options payoff chart uses chartreuse for profit zone and coral for loss zone correctly. **API-degraded banner visible at top — six amber hexes plainly rendered (O2).**
- `strategies-earnings-options-play/desktop-1440/initial.png` and `scrolled-mid.png` — **R2-O2 fix landed**, calendar sidebar and detail body now render on `--bg-elev-2` with cream type, gold action chips, no `bg-white/60` cards, no `border-[#5d7268]` outlines.
- `analytics/desktop-1440/initial.png` — `+0.00%` chartreuse, `0.00%` Max Drawdown coral, `4 trades` token-driven; histogram bar chartreuse.
- `alerts/desktop-1440/initial.png` — gold "Create Alert" CTA; in-app/email/webhook checkboxes render in token chrome.
- `strategy-momentum-quality/desktop-1440/initial.png` — `+36.20%` chartreuse, `-8.0%` coral, `2.21` Sharpe gold-tinted; status `ACTIVE` chip warm-amber; long-form body cream on `--bg-elev-1`.

---

## Top 3 priority fixes (R3) — same as R2, in same order

R3 made meaningful but narrow progress (one issue closed). The top 3 priorities are unchanged from R2 because the sprint did not address them.

1. **Decompose `--amber-500` overload (O1).** Define `--state-warning` (mustard, act-on-this), `--state-stale` (desaturated amber, refresh-me), `--state-info-time` (ice-tinted, after-hours informational), and rename `--chart-5` to `--chart-amber-warm` so semantic vs chart use is distinguishable. Update `--warn` to point at `--state-warning`, drop the `--state-stale: var(--amber-500)` aliasing, and migrate the 124 `*-amber` consumers per their semantic intent. The operator-glance ambiguity is the largest remaining color sin in the dashboard.

2. **Token-ize the API-degraded banner chrome (O2 / R2-O4).** Replace the 6 inline amber hexes in `(dashboard)/layout.tsx:87-107` with `bg-warn/15 text-warn border-warn/40` (or, if depending on O1 first, `bg-state-warning-banner-bg text-state-warning-banner-fg border-state-warning-banner-border`). This banner is **on-screen every render** — fixing it is the highest-visibility per-line-of-diff color win available.

3. **Add the ESLint guardrail (R2-N1, R3-N2).** A `no-restricted-syntax` rule matching `/(text|bg|border|ring|fill|stroke|outline|shadow)-\[#[0-9a-fA-F]/` outside `auth/`, `marketing/`, `(public)/`, `app/global-error.tsx`, and `*chart*` files would prevent the next F2-class regression. Until shipped, expect amber-class consumer counts to keep drifting up (113 → 124 between R2 and R3 is the leading indicator).

---

## Why "held at 3/4" and not 4/4

A 4/4 requires all three of: (a) zero hardcoded literals outside the frozen marketing surface and chart fallback layer, (b) one and only one semantic meaning per state token, (c) no banner/page in the authenticated app rendered with raw arbitrary-value color classes. R3 satisfies (a) substantially (the dashboard surface is down to ~14 non-banner, non-chart hex hits) but fails (b) — the amber-overload remains unfixed and got measurably worse — and fails (c) — the API-degraded banner is visible on every page in this sweep with six raw amber hexes. One more sprint that ships #1 and #2 above lands a 4.

A drop to 2/4 would require an active regression. None present: the two fixes promised by the R2 sprint (R2-O2 / R2-4) shipped cleanly, override count held at 0, no new lime/forest/blue palette leaks, and P/L semantics are correctly applied throughout the snapshot set. The amber consumer-count drift (+11) is concerning but not yet a blocker because the existing amber tokens still resolve correctly — the issue is semantic ambiguity, not visual regression.

---

## Files audited (R3)

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
- `frontend/src/components/panels/BacktestPanel.tsx`
- `frontend/src/components/panels/TradePanel.tsx`
- `frontend/src/components/dashboard/SectorTreemap.tsx`
- `frontend/src/components/dashboard/StrategyGrid.tsx`
- `frontend/src/components/dashboard/MarketContext.tsx`
- `frontend/src/components/dashboard/AllocationDonut.tsx`
- `frontend/src/components/panels/StrategyTemplates.tsx`
- `frontend/src/components/primitives/SymbolGroupDot.tsx`
- `frontend/src/components/primitives/BulletGraph.tsx`
- `frontend/src/components/strategies/StrategyDisclosure.tsx`
- `frontend/src/components/layout/TickerTape.tsx`

**Screenshots referenced (all under `qa/runs/2026-05-04T15-47-19Z/`):**
- `dashboard/desktop-1440/initial.png`
- `dashboard/mobile-390/initial.png`
- `login/desktop-1440/initial.png`
- `strategies-list/desktop-1440/initial.png`
- `pipeline/desktop-1440/initial.png`
- `trade/desktop-1440/initial-prefill.png`
- `trade/desktop-1440/single-leg-prefill.png`
- `trade/desktop-1440/multi-leg-prefill.png`
- `strategies-earnings-options-play/desktop-1440/initial.png`
- `strategies-earnings-options-play/desktop-1440/scrolled-mid.png`
- `alerts/desktop-1440/initial.png`
- `analytics/desktop-1440/initial.png`
- `reports/desktop-1440/initial.png`
- `strategy-momentum-quality/desktop-1440/initial.png`
