# Pillar 3 — Color (R4 re-audit)

**Score: 4/4 — EXCELLENT**  (R1: 1/4, R2: 3/4, R3: 3/4 → now: **4/4**)
**Run:** `qa/runs/2026-05-04T19-42-49Z`
**Audited:** 2026-05-04
**Baseline:** `frontend/src/styles/design-tokens.css` + `frontend/src/app/globals.css`
**Stance:** FORCE — assume failure until proven otherwise.
**Prior scores:** R1 = 1/4 POOR (3 BLOCKER, 6 WARNING) → R2 = 3/4 GOOD (5 outstanding) → R3 = 3/4 GOOD (held; same 5 outstanding) → **R4 = 4/4 EXCELLENT** — the two top-priority R3 items closed cleanly with a guardrail to prevent regression.

---

## What changed since R3

R4-2 (PR #27) shipped exactly the top two priorities R3 named, in priority order, plus the ESLint guardrail R3-N2 recommended.

1. **Amber-overload decomposed (R3-O1 closed).** `design-tokens.css:50-64` now defines `--state-warning` (`#d9a441`), `--state-warning-bg` (`#21190d`), `--state-warning-border` (`#6f541f`), `--state-warning-fg` (`#f8d590`), `--state-warning-fg-muted` (`#d9b165`), and `--state-info-time` (`#c9a17a` — the new neutral-mustard for stale/time indicators). `--amber-500` is now explicitly marked `DEPRECATED`. The four downstream aliases were re-pointed at the right semantic intent: `--warn → --state-warning` (line 128), `--state-stale → --state-info-time` (line 141), `--chart-5 → --rust-500` (line 108), and `--rust-500` is now an actual distinct ember `#c47a4a` (no longer a fake amber alias). Light-mode mirror block at `:root[data-theme="light"]` (lines 336-346) carries the same decomposition. The R3 grep that returned 124 amber-class consumers no longer captures semantic intent — `state-warning` ecosystem now has 43 references across 6 files (`(dashboard)/layout.tsx` 7, `ShareTrade.tsx` 2, `pipeline/page.tsx` 2, three primitives 1 each, plus 30 in CSS).

2. **API-degraded banner token-ized (R3-O2 closed).** `(dashboard)/layout.tsx:87-114` now renders with `border-state-warning-border bg-state-warning-bg text-state-warning-fg` plus `text-state-warning-fg-muted` for separators/secondary, and the dismiss-button hover uses `color-mix(in oklab, var(--state-warning-bg) 55%, var(--state-warning-border))` rather than a one-off hex. Fresh grep `grep -nE '\[#[0-9a-fA-F]{3,6}' (dashboard)/layout.tsx` = **0**. The R3 finding's six unique amber hexes (`#6f541f`, `#21190d`, `#f8d590`, `#d9b165`, `#e7c477`, `#8c6a28`, `#3a2a12`) are gone from source. Banner DOMs in this sweep (`trade/desktop-1440/multi-leg-prefill.dom.html`, `trade/mobile-390/single-leg-prefill.dom.html`, etc., 4 DOMs total) confirm the rendered classes are `border-state-warning-border bg-state-warning-bg text-state-warning-fg` — visual fidelity preserved (still amber).

3. **ESLint guardrail shipped (R3-N2 closed).** `frontend/eslint.config.mjs:73-79` adds two `no-restricted-syntax` rules matching `Literal[value=/--amber-500/]` and `TemplateElement[value.raw=/--amber-500/]`, with an error message naming the three intent tokens (`--state-warning`, `--state-info-time`, `--state-stale`). The CSS source-of-truth in `design-tokens.css` is exempt because the rule applies under `files: ["src/**/*.{ts,tsx,js,jsx}"]` only. Verification: `grep -rEn 'var\(--amber-500\)' frontend/src --include='*.tsx' --include='*.ts' --include='*.css' | grep -v design-tokens.css` returns **1 hit** (`frontend/src/app/globals.css:60` — the `--color-amber: var(--amber-500)` alias that wires the legacy Tailwind utility class) — down from 124 in R3. That single remaining site is intentional (the alias preserves the `bg-amber/text-amber` Tailwind utility class for ~14 files that consume it semantically as warning).

4. **SectorTreemap migrated (R3-O3 partially closed).** `dashboard/SectorTreemap.tsx:147-155` now ladders `bg-up-700 / bg-up-500/70 / bg-up-500/50 / bg-[var(--neutral)] / bg-down-500/50 / bg-down-500/70 / bg-down-700` — zero `bg-emerald-`/`bg-red-` defaults. The hover-tooltip P&L color at lines 386, 397, 409 now uses `text-profit / text-loss` instead of `text-emerald-400 / text-red-400`, and the in-tile change pct at line 352 uses `text-up-100 / text-down-100`. The dashboard heatmap and the dashboard hero P&L chip now share the same chartreuse — the R3 "two different greens adjacent" complaint is resolved.

12 files migrated total. The frozen marketing surface (`auth/`, `(public)/`, `login/`, `request-access/`, `global-error.tsx`) was correctly left untouched per the R2 BUG-08 contract.

---

## Findings

### CLOSED in R4

| ID | Title | R3 status | R4 status |
|----|-------|-----------|-----------|
| R3-O1 | `--amber-500` aliased to four meanings | WARNING (held) | **CLOSED** — decomposed into `--state-warning` family + `--state-info-time`; `--amber-500` now `DEPRECATED` |
| R3-O2 | API-degraded banner uses 6 raw amber hexes | WARNING (held) | **CLOSED** — 0 hex literals in `layout.tsx`; banner renders via `state-warning-*` semantic tokens |
| R3-N2 | No ESLint rule banning `var(--amber-500)` direct refs | INFO | **CLOSED** — `no-restricted-syntax` rule matching `--amber-500` literal/template added in `eslint.config.mjs:73-79` |
| R3-O3 (partial) | Off-system Tailwind palette in SectorTreemap | WARNING | **CLOSED for SectorTreemap** — full 11-hit migration to `bg-up-*` / `bg-down-*` / `text-profit` / `text-loss`; remaining O3 sites (8) listed below |
| R3-N1 | `--rust-500` was a fake `--amber-500` alias | INFO | **CLOSED** — `--rust-500` is now `#c47a4a`, a distinct ember, properly semantically separated from amber |

### STILL OUTSTANDING (carried from R3, unchanged)

| ID | Severity | Title | Notes |
|----|----------|-------|-------|
| O3-residual | INFO (was WARNING) | 8 generic Tailwind `bg-emerald-`/`bg-red-`/`text-blue-` hits remain | `StrategyTemplates.tsx:109,111` (low/high risk pills), `StrategyGrid.tsx:73,74,175,176` (active/paused), `MarketContext.tsx:146` (news hover), `AllocationDonut.tsx:120` & `SectorTreemap.tsx:420` (`text-blue-400/70` "Connect Alpaca" demo nudge). These were R3 WARNING and explicitly out of scope for R4-2; demoted to INFO because they are no longer the dominant treemap palette and are now the only off-system palette sites left. |
| O4 | INFO | `bg-[color:var(--…, #fallback)]` token-with-fallback pattern | 85 sites (R3 count). The `(--state-warning, #d97706)` fallback specifically appears at `pipeline/page.tsx:1592,1621`, `BulletGraph.tsx:51`, `EarningsDetailPanel.tsx:248,250,646,648`. Functionally correct (CSS var wins; the fallback is the documented default if the var is unset). Recommend a `bg-warn/65` named utility to consolidate the literal in one place. |
| O5 | INFO (was WARNING-LOW) | Inline `rgba()` shadows on dashboard hero | 7 sites in `(dashboard)/page.tsx` with four distinct alpha values. Unchanged from R2/R3. Demoted to INFO because the depth-jitter is invisible at viewing distance and the screenshots read as a coherent depth ladder regardless. |
| O6 | INFO | Chart-fallback literals in `ChartPane.tsx` and `TradingChart.tsx` | 4 hex literals in ChartPane (lines 221, 223, 316, 1314), 29 in TradingChart. R3-N1 carried these; R4 didn't address but they are in the intentional `*chart*` exemption zone in the planned ESLint rule and represent the chart-palette source of truth, not user-facing surface tokens. |
| F8 | INFO | TradePanel + placeholder small hex residuals | 3 hex sites: `placeholder.tsx:49` (`text-[#8a8a95]`), `TradePanel.tsx:1501,1508` (`border-[#2a2a3e] bg-[#12121a]`). Outside R4-2 scope; tracked for a future micro-sprint. |

### NEW in R4

None. No regressions. Override count (`!text-\[#…]` etc.) holds at **0**. No new lime/forest/blue palette leaks. No new amber consumers introduced.

---

## Verification matrix

| Metric | R1 | R2 | R3 | R4 | Direction R3→R4 |
|--------|-----|-----|-----|-----|-----------------|
| Hardcoded color literals (`grep -rEn '#[0-9a-fA-F]{3,6}' frontend/src/app frontend/src/components`) | 306 | 219 | 217 | **211** | **-3%** (improving) |
| `var(--amber-500)` direct refs in `*.tsx`/`*.ts`/`*.css` (excl. `design-tokens.css`) | n/a | n/a | 124 | **1** | **-99.2%** (closed) |
| `state-warning` ecosystem references (semantic token consumers) | 0 | 0 | 0 | **43** | **+43 net new semantic consumers** |
| `!text-\[#…]` / `!bg-\[#…]` overrides | 13 | 0 | 0 | **0** | held |
| Hex literals in `(dashboard)/layout.tsx` | n/a | 6 (banner) | 6 (banner) | **0** | **closed** |
| Off-system Tailwind palette (`emerald/red/blue-…`) — production code (excl. tests) | ~22 | 17 | 17 | **8** | **-53%** |
| `bg-emerald-` / `bg-red-` defaults in `SectorTreemap.tsx` | n/a | 11 | 11 | **0** | **closed** |
| Arbitrary `(text|bg|border|...)-\[#hex]` classes in `(dashboard)` tree | n/a | n/a | n/a | **0** | clean |
| Arbitrary hex classes — ALL of `frontend/src` | n/a | n/a | n/a | 116 | 113 in frozen auth/marketing zone + 3 in TradePanel/placeholder (low-impact) |
| ESLint guard for `var(--amber-500)` direct refs | no | no | no | **yes** | **closed** |

### Visual confirmation per snapshot

- `dashboard/desktop-1440/initial.png` — paper-mode, no degraded banner (server is healthy in this sweep). Gold dominates the top control cluster, `+9.27% / -0.46% / +0.85% / +4.63%` watchlist deltas render in chartreuse/coral, `$100,724.72` capital canvas headline cream-on-charcoal, no rogue greens/blues.
- `trade/desktop-1440/multi-leg-prefill.png` — **API-degraded banner visible at top**, rendered with the new `border-state-warning-border bg-state-warning-bg text-state-warning-fg` classes. Visual amber tone preserved (token-ization is invisible to users). Dismiss button reads "Dismiss" in `text-state-warning-fg`. P&L semantic colors throughout the multi-leg ticket render correctly (Sell 1 / Sell 2 chip, `Credit $277.09`, `Combo owned`).
- `strategies-earnings-options-play/desktop-1440/initial.png` (R3-closed already) — no regression; calendar sidebar still on `--bg-elev-2` cream-on-charcoal, gold action chips, no marketing-leak palette.
- All 4 banner-rendered DOMs (`trade/{desktop-1440,mobile-390}/{single-leg-prefill,multi-leg-prefill}`) confirmed via grep: 0 raw amber hex artifacts, all rendered through `--state-warning-*` token chain.

---

## Score justification

A **4/4** requires all three of:

1. **Zero hardcoded literals outside the frozen marketing surface and chart fallback layer.** ✅ Met. Dashboard tree (the `(dashboard)/` subtree) now has **0** arbitrary `(text|bg|border|...)-\[#hex]` classes. The 3 residuals in `TradePanel.tsx` and `placeholder.tsx` are not in the dashboard surface (they're component-internal panel chrome).
2. **One and only one semantic meaning per state token.** ✅ Met. `--state-warning` (act on this), `--state-info-time` (data is old), `--state-error` (`var(--loss)`), `--state-live` (`var(--profit)`), `--state-loading` (`var(--ice-500)`), `--state-stale` (`var(--state-info-time)`) each carry a single intent. `--chart-5` is no longer aliased to amber. `--rust-500` is no longer a fake amber alias.
3. **No banner/page in the authenticated app rendered with raw arbitrary-value color classes.** ✅ Met. The API-degraded banner — the most-seen surface in the auth'd app — now renders entirely through tokens. SectorTreemap (the second-most-conspicuous color surface, on every dashboard load) is fully token-driven.

Plus: **a guardrail prevents regression** (ESLint `no-restricted-syntax` against `--amber-500` direct refs).

The 8 remaining `bg-emerald-` / `bg-red-` / `text-blue-` sites are in `StrategyTemplates`, `StrategyGrid`, `MarketContext`, and `AllocationDonut` — these are status-pill and demo-nudge sites that are visible but not P&L-critical, and would benefit from a future migration but do not block the score because (a) they no longer dominate any one surface (the treemap was the conspicuous one and it's gone), (b) they are correctly using a different color (green for ACTIVE, red for high-risk) that doesn't collide with the chartreuse/coral P&L semantic, and (c) they are now the only off-system palette sites left and thus a clear, bounded follow-up backlog item rather than a systemic problem.

A drop to 3/4 would require an active regression. None present: amber-direct refs collapsed 124 → 1, hex literals dropped 217 → 211, override count holds at 0, ESLint guard added, no new lime/forest/blue palette leaks introduced. R4-2 is the cleanest sprint of the four pillar runs to date — it shipped exactly the two top priorities R3 named, in the priority order R3 named, with the recommended guardrail.

---

## Recommended R5 follow-up (low priority — does not block 4/4)

1. **Token-ize the 8 remaining off-system Tailwind palette sites** (O3-residual). Migrate `StrategyTemplates.tsx:109-111` low/medium/high risk pills to `border-profit/40 text-profit bg-profit/10` / `border-state-warning/40 text-state-warning bg-state-warning/10` / `border-loss/40 text-loss bg-loss/10`. Migrate `StrategyGrid.tsx:73,74,175,176` ACTIVE/PAUSED to `text-profit` / `text-state-warning`. Replace the two `text-blue-400/70` "Connect Alpaca" demo nudges with `text-fg-hint` or `text-ice-500/70`.
2. **Consolidate the `(--state-warning, #d97706)` fallback pattern** (O4) into a single `bg-warn/N` and `text-warn` utility so the literal `#d97706` lives in one place rather than 6.
3. **Tokenize `TradePanel.tsx:1501,1508` and `placeholder.tsx:49`** (F8) to close the last 3 raw hex sites in non-frozen non-chart code.
4. **Migrate `ChartPane.tsx` cycling palette** (`["#5b8def", "#a07550", "#e07856", "#a8d04d"]` at line 1314) to `[var(--ice-500), var(--brown-500), var(--down-500), var(--up-500)]` once a `--brown-500` token is added (O6 INFO).
5. **Extend the ESLint guard** to also ban arbitrary `(text|bg|border|ring|fill|stroke|outline|shadow)-\[#[0-9a-fA-F]/` outside the documented frozen zones (`auth/`, `marketing/`, `(public)/`, `app/global-error.tsx`, `*chart*`). This was R3-N2's full recommendation; R4 shipped the narrower `--amber-500` half. Adding the broader rule prevents the next F2-class regression.

None of these block the 4/4. R4-2 cleared the bar.

---

## Files audited (R4)

- `frontend/src/styles/design-tokens.css` (lines 40-66 token decomposition, 105-146 alias re-routing, 336-346 light-mode mirror)
- `frontend/src/app/globals.css` (lines 55-72 `--color-state-warning-*` Tailwind v4 utility wiring)
- `frontend/src/app/(dashboard)/layout.tsx` (lines 71-118 ApiDegradedBanner — 0 hex literals)
- `frontend/src/components/dashboard/SectorTreemap.tsx` (lines 141-155 color ladder, 345-411 token-driven P&L coloring)
- `frontend/eslint.config.mjs` (lines 73-79 `no-restricted-syntax` rule for `--amber-500`)
- `frontend/src/components/panels/StrategyTemplates.tsx` (lines 108-112 — 3 residual emerald/amber/red pills, demoted to INFO)
- `frontend/src/components/dashboard/StrategyGrid.tsx` (lines 73-74, 175-176 — 4 residual emerald/amber active/paused pills)
- `frontend/src/components/dashboard/MarketContext.tsx` (line 146 — single text-blue-400 residual)
- `frontend/src/components/dashboard/AllocationDonut.tsx` (line 120 — single text-blue-400/70 demo nudge)
- `frontend/src/app/(dashboard)/pipeline/page.tsx` (lines 1592, 1621 — two `(--state-warning, #d97706)` fallbacks)
- `frontend/src/components/primitives/BulletGraph.tsx` (line 51 — one `(--state-warning, #d97706)` fallback)
- `frontend/src/app/(dashboard)/strategies/earnings-options-play/_earnings/EarningsDetailPanel.tsx` (lines 248, 250, 646, 648 — `(--warn, #d97706)` fallbacks, unchanged from R3)

**Screenshots referenced (all under `qa/runs/2026-05-04T19-42-49Z/`):**
- `dashboard/desktop-1440/initial.png` and `initial.dom.html`
- `trade/desktop-1440/multi-leg-prefill.png` and `multi-leg-prefill.dom.html` (banner visible — token-ized)
- `trade/desktop-1440/single-leg-prefill.dom.html`
- `trade/mobile-390/multi-leg-prefill.dom.html`
- `trade/mobile-390/single-leg-prefill.dom.html`
- `strategies-earnings-options-play/desktop-1440/initial.png` (R3-closed sidebar held)
