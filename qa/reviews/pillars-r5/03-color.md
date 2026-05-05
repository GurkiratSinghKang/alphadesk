# Pillar 3 — Color (R5 fresh adversarial)

**Score: 3 / 4 — GOOD (regressed from 4/4)**  (R1: 1/4, R2: 3/4, R3: 3/4, R4: 4/4 → **R5: 3/4**)
**Run:** `qa/runs/2026-05-04T20-31-40Z`
**Audited:** 2026-05-04
**Baseline:** `frontend/src/styles/design-tokens.css` + `frontend/src/app/globals.css`
**Stance:** FORCE — fresh hunt; assume the R4 4/4 was a peak, not a permanent state. Verify against rendered DOMs in the canonical sweep, not against R4's promises.

---

## Methodology

1. Re-ran R4's verification grep harness against the current source tree to confirm R4 closures are still closed.
   - Hex count `grep -rEn '#[0-9a-fA-F]{3,6}'`: **211** (unchanged from R4 baseline; R4 promised "improving" — held).
   - `var(--amber-500)` direct refs in `*.tsx`/`*.ts` (excl. `design-tokens.css`): **0** (down from R4's 1; R4 has the `var(--amber-500)` only in `globals.css`).
   - Off-system Tailwind palette `bg-(emerald|red|blue|amber|...)-`: **7** (down from R4's 8 — but the R5 grep is `bg-` only; the broader hunt below catches text/border).
   - Override count (`![bg|text|border|...]-[#…]`): **0** (held).
2. Hunted PR #32 (`sector_rotation`) and PR #33 (strategy A.1 follow-up): **both backend-only**. No new frontend surfaces shipped between R4 audit (`commit 1ee60538`) and the R5 sweep. So no PR-#32/#33 color regressions to find — but R5 still found things R4 missed in code that *was* in scope at R4 time.
3. Counted rendered Tailwind palette tokens in the canonical run's DOMs (the harness that R4 didn't run): `grep -ohE 'text-(amber|emerald|...)-[0-9]+'` across all 50+ DOM files. Found **27 instances of `text-amber-100`** rendered live across 15 separate DOM snapshots.
4. Inspected `ChartPane.tsx` for *raw color literals* outside the documented `getTokenVar()` token-fallback contract — i.e. hex/rgba pairs that don't pick up theme switches.
5. Audited the ESLint guard R4 added (`eslint.config.mjs:67-74`) for completeness — does it actually catch the failure modes the new hits demonstrate?
6. Visual triangulation: opened PNGs for `/strategies`, `/strategy/momentum-quality`, `/dashboard`, `/trade`, `/reports` and a marketing page (`/login`) to cross-check rendered colors against source.
7. Cross-referenced the R4-named "out of scope" findings (O3-residual, O4, O5, O6, F8) against the actual rendered DOMs to determine which are *still rendering* today and therefore stayed live, vs. which were quietly killed by route-mount changes.

---

## Headline

R4's 4/4 was awarded under a narrow contract: "the API-degraded banner and SectorTreemap migrate, plus a guardrail." Both shipped. **But R4 never grep'd the rendered DOMs**, never asked which of the R3 carry-overs are *still rendered* (vs. dead code), and never extended the guard to the `text-amber-N`/`bg-amber-N` *Tailwind utility class form*. R5 found:

- A **NEW BLOCKER** (R5-1): `text-amber-100` (Tailwind's stock pale-yellow `#fef3c7`) renders **27 times** across the catalogue and strategy detail pages on every dashboard load — and the design system's *own* equivalent token (`--state-warning-fg = #f8d590`) is right there, unused. The intentional WCAG fix in `StrategyDisclosure.tsx:87` reached for Tailwind's default palette instead of the project token. Two surfaces (`/strategies/*` cards + `StrategyDisclosure` banners) and one tax-table stamp (`/reports`) ship a near-white amber that doesn't live in `design-tokens.css` and won't follow theme switches.
- A **MAJOR** (R5-2): the ESLint guard R4 shipped only blocks `var(--amber-500)` *literal CSS variable refs*; it does not block `text-amber-500`, `bg-amber-500/10`, or stock Tailwind shades like `text-amber-100/200/400`. The guard is half-finished, so the next round will keep growing the same problem.
- A **MINOR** (R5-3): `ChartPane.tsx` has 6 raw `rgba(…)` constants (`STRUCTURE_COLORS` and `BOOK_COLORS`, lines 311-322) used for support/resistance, demand/supply, and bid/ask rendering. These are forest-greens (`rgba(46,169,143,…)`) and wine-reds (`rgba(200,92,92,…)`) — *different colors* than the chartreuse/coral P&L semantic. They render on the live trade page (`PriceChartPanel.tsx` consumes `ChartPane`). Architecturally questionable but visually plausible (book bid/ask doesn't have to be P&L-coloured); flagging for awareness.

R4's CLOSED items are still closed (decomposition held, banner held, ESLint guard for `--amber-500` held, SectorTreemap held). R4 just never looked for the *Tailwind utility class form* of the same problem.

---

## NEW findings

### NEW BLOCKER (R5-1) — `text-amber-100` ships Tailwind's default `#fef3c7` to 27 rendered sites; the project's own `--state-warning-fg` (= `#f8d590`) is unused

**File:** `frontend/src/components/strategies/StrategyDisclosure.tsx:87, 119, 133`; `frontend/src/app/(dashboard)/strategies/page.tsx:223, 268`; `frontend/src/app/(dashboard)/reports/page.tsx:1237, 1286`

**What R4 missed:** R4 grep'd `var(--amber-500)` literal refs and counted them at 1 (closed). It never grep'd `text-amber-100` / `text-amber-200` / `text-amber-400` (the Tailwind-utility form), and never opened the rendered DOMs to count what was *actually* shipping. R5's DOM-level harness:

```
grep -ohE 'text-(amber|emerald|...)-[0-9]+' qa/runs/2026-05-04T20-31-40Z/*/*/{*.dom.html}
→ 27 × text-amber-100  (zero of any other off-system shade)
```

All 27 sites resolve to the same comment-driven "WCAG contrast fix" introduced in `StrategyDisclosure.tsx`:

```ts
// StrategyDisclosure.tsx:83-88
// A3#5 — WCAG contrast. Previously the pill used ``text-amber`` (#d9a441)
// on a ``bg-amber/[0.04]`` surface. ... Lifting to ``text-amber-100``
// (Tailwind default near-white pale yellow #fef3c7) puts us comfortably
// over 12:1 on the same surface.
```

The fix is correct *as a contrast move*, but it reaches into Tailwind's stock palette (`#fef3c7`) instead of the project's existing pale-warning token. The design-tokens.css decomposition that R4-2 shipped *already defines a near-equivalent*:

```css
/* design-tokens.css:62 */
--state-warning-fg:     #f8d590; /* warning foreground (text on warning bg) */
```

`#f8d590` (`--state-warning-fg`) and `#fef3c7` (`text-amber-100`) are visually adjacent (both pale warning yellows; the difference is roughly 6% lightness). The contrast fix would land identically against `bg-amber/[0.04]` — both pass 12:1 by an enormous margin. **Today the contract is broken**: 27 rendered surfaces use Tailwind's hex, not the design system's. Rendered sites:

| DOM file | Pill rendered | Source |
|----------|---------------|--------|
| `strategies-list/desktop-1440/initial.dom.html` | "Paper-only" pill on Manual / Discretionary card | `strategies/page.tsx:268` |
| `strategies-list/desktop-1440/initial.dom.html` | "Paper-only" pill on KAMA Breakout card | `strategies/page.tsx:268` |
| `strategy-momentum-quality/desktop-1440/initial.dom.html` | "Disclosure" eyebrow + pill | `StrategyDisclosure.tsx:119, 133` |
| `strategy-momentum-quality/desktop-1440/{bottom,chart-1m,scrolled-mid,metric-hover,pause-click}.dom.html` × 5 | Same disclosure (re-render across viewports/states) | `StrategyDisclosure.tsx` |
| `strategy-momentum-quality/mobile-390/{initial,bottom,chart-1m,scrolled-mid,metric-hover,pause-click}.dom.html` × 6 | Same disclosure on mobile | `StrategyDisclosure.tsx` |
| `strategies-list/mobile-390/initial.dom.html` | Mobile catalogue pills | `strategies/page.tsx` |
| `settings/desktop-1440/section-1.dom.html` | At least one pill | (likely a strategy-quick-link section in settings) |

Plus 2 source-only sites in `reports/page.tsx:1237 (text-amber-200)` and `:1286 (text-amber-100)` — these will render the next time a user opens `/reports` with a wash-sale flag set. R5 didn't catch these in the rendered DOMs (the sweep's `/reports` snapshot doesn't have wash-sale data), but they will leak the same Tailwind hex once the route fires.

**Light-mode amplification:** This is *especially* concerning because the design tokens have a light-mode mirror block (`design-tokens.css:336-346`) that inverts `--state-warning-fg` to `#5b3f0c` (a dark amber for the cream marketing surface). `text-amber-100` does **not** have this inversion — Tailwind's default amber-100 is a single hardcoded value (`#fef3c7`) that won't switch. So if anyone accidentally exposes the StrategyDisclosure component in a light-mode surface (or if the marketing palette ever toggles dark mode), 27 surfaces will render near-white text on cream backgrounds and become unreadable. The token system *would have caught this for free* via the `:root[data-theme="light"]` block.

**Why this is a BLOCKER:** the *exact* failure mode R4-2 set out to fix (off-token color references on the most-visible surfaces) is *also present in the Tailwind-utility-class form*. R4 closed the CSS-variable form and stopped. R5's grep finds 27 rendered sites of the same architectural sin. The R4 contract — "one and only one source of truth" — is violated by the *highest-traffic widget on the strategies page* (a pill that renders on every catalogue card and every detail-page banner).

**Fix:** swap `text-amber-100` for `text-state-warning-fg` (or define a dedicated `text-warn-fg-pale` if a slightly lighter shade is wanted) at all 7 source sites. The hex difference between `#fef3c7` and `#f8d590` is 6% lightness — visually indistinguishable on a `bg-amber/[0.04]` surface. WCAG contrast is preserved.

### NEW MAJOR (R5-2) — ESLint guard catches only the CSS-var form, not the Tailwind-utility form; growth path open

**File:** `frontend/eslint.config.mjs:67-74`

R4-2 added two `no-restricted-syntax` rules:

```js
{ selector: "Literal[value=/--amber-500/]", message: "Use --state-warning..." },
{ selector: "TemplateElement[value.raw=/--amber-500/]", message: "..." }
```

These match string literals containing `--amber-500` — i.e. they catch `var(--amber-500)`, `'--amber-500'`, and template-string interpolations. They **do not** match:

- `text-amber-500` (Tailwind utility class, no `--` prefix in the source string — same family of intent, just a different syntactic form)
- `bg-amber-500/40` (opacity variant)
- `border-amber-500/30`
- `text-amber-100` / `text-amber-200` / `text-amber-400` (Tailwind stock palette shades that don't even map to a project token)
- Arbitrary-value classes like `text-[#fef3c7]` (the literal hex form)

**Verification:** `text-amber-500` appears 5 times in `StrategyBuilder.tsx` (lines 273, 291, 292, 296, 297) and 1 time in `WatchlistPanel.tsx:750`. None trip the existing rule. R5 confirmed via `grep -ln 'text-amber-' frontend/src --include='*.tsx'` against the eslint config: 9 source sites use the Tailwind-utility-class form of amber and the lint passes.

**Impact:** the next developer who adds a warning surface and reaches for `text-amber-500` (the natural Tailwind-utility instinct) will not be nudged to use `text-state-warning-fg` / `text-state-warning`. The same drift R3 had (124 `var(--amber-500)` consumers) will recur in the Tailwind-utility-class form — slowly, one PR at a time. R4 closed the *CSS variable* drift permanently; the *Tailwind utility* drift is wide open.

**Fix:** extend the guard to also match the Tailwind-utility-class form. The R4 audit's "Recommended R5 follow-up #5" already named this: "Extend the ESLint guard to also ban arbitrary `(text|bg|border|ring|fill|stroke|outline|shadow)-[#[0-9a-fA-F]/` outside the documented frozen zones." R4 deferred the broader rule. R5 is now seeing the leak the broader rule would have prevented.

A targeted addition that catches the rendered-BLOCKER specifically:

```js
{
  selector: "Literal[value=/\\b(text|bg|border|ring|outline|fill|stroke|shadow)-amber-[0-9]+\\b/]",
  message: "Use semantic token: text-state-warning(-fg|-fg-muted) / bg-state-warning(-bg) / border-state-warning(-border). Direct text-amber-N / bg-amber-N reaches into Tailwind's stock palette and bypasses the design system.",
},
```

…plus the same selector against `TemplateElement[value.raw=/…/]`. The frozen marketing zone (`auth/`, `request-access/`, `login/`, `(public)/`, `global-error.tsx`) needs the rule's `files:` glob narrowed to `src/{app/(dashboard)/**,components/**}` so the green-on-white marketing forms aren't tripped.

### NEW MINOR (R5-3) — `ChartPane.tsx` STRUCTURE_COLORS + BOOK_COLORS use 6 raw `rgba()` literals; bid/ask palette diverges from P&L semantic

**File:** `frontend/src/components/charts/ChartPane.tsx:311-322`

```ts
const STRUCTURE_COLORS = {
  support: "rgba(46, 169, 143, 0.72)",   // forest-green
  resistance: "rgba(200, 92, 92, 0.72)", // brick-red
  demand: "rgba(45, 126, 115, 0.78)",    // teal-green
  supply: "rgba(142, 70, 93, 0.78)",     // wine-purple
  poc: "#c9a66b",                         // brand-gold (token)
};

const BOOK_COLORS = {
  bid: "rgba(46, 169, 143, 0.86)",  // forest-green (same as support)
  ask: "rgba(210, 110, 82, 0.86)",  // burnt-coral
};
```

**What R4 missed:** R4's O6 INFO listed *"4 hex literals in ChartPane (lines 221, 223, 316, 1314)"* — but it counted only `#hex` literals via the `#[0-9a-fA-F]` regex, not `rgba(…)` literals. R5 expanded the regex to `rgba\(` and found 11 in the same file. Six of them are in the `STRUCTURE_COLORS` and `BOOK_COLORS` constants used by support/resistance, demand/supply, bid/ask, and POC structure overlays — and these *render on /trade* (verified: `grep STRUCTURE_COLORS ChartPane.tsx` shows 12 usages at lines 768-865; `PriceChartPanel.tsx:331` mounts `<ChartPane>` on the trade page).

**Architectural concern:** the AlphaDesk design system has *one* P&L color pair: chartreuse `--up-500` (`#a8d04d`) for buy/profit/bullish, coral `--down-500` (`#e07856`) for sell/loss/bearish. The ChartPane bid/ask + structure overlay introduces a *second* greens-and-reds pair — forest-green and wine-red — for the order-book and structure layer. A trader glancing at the chart sees a forest-green bid (`rgba(46,169,143,…)`) right next to a chartreuse 1-day P&L gain — those are *different greens* communicating different ideas, but they're both "good" to the eye.

The choice is defensible: bid/ask isn't P&L; support/resistance isn't P&L. The book layer wanting a *cooler* green ("don't confuse with portfolio P&L") is a reasonable design decision. **What's not defensible** is that none of these 6 rgba constants live in `design-tokens.css`. There's no `--book-bid` / `--book-ask` / `--structure-support` / `--structure-resistance` token. The values are hardcoded into the component, won't switch with theme, and aren't auditable from the token source.

**Visual confirmation:** `qa/runs/2026-05-04T20-31-40Z/trade/desktop-1440/initial-prefill.png` — the TOP BOOK chip in the upper-right quadrant of the chart shows the forest-green-vs-burnt-coral bid/ask palette in action. Adjacent to the main chart (which uses chartreuse/coral candles), this introduces 4 distinct greens-vs-reds on a single render: candle-up (chartreuse), candle-down (coral), book-bid (forest), book-ask (burnt-coral). Visually it works because the book chip is small and visually separated, but the architectural multiplication is non-trivial.

**Fix:** add `--book-bid`, `--book-ask`, `--structure-support`, `--structure-resistance`, `--structure-demand`, `--structure-supply` tokens to `design-tokens.css` (with light-mode mirrors), then `getTokenVar` them in `ChartPane.tsx:311-322`. ~30 LOC migration. Demoted to MINOR because (a) the visual is correct, (b) only 1 file is affected, (c) ChartPane was named in R4's "intentional `*chart*` exemption zone" caveat — R4 explicitly said charts are the source-of-truth palette layer, and bid/ask is a chart-internal semantic. But "chart fallback hex" was R4's framing; "chart introduces a *second* greens-and-reds pair" is a different and unflagged concern.

---

## STILL OUTSTANDING (R4 carry-overs, re-verified against the R5 sweep)

| ID | Severity (R4 → R5) | Title | R5 status |
|----|---------------------|-------|-----------|
| O3-residual | INFO → INFO | 8 generic Tailwind `bg-emerald-`/`bg-red-`/`text-blue-` hits | **Held**; verified via grep — `StrategyTemplates.tsx:109-111`, `StrategyGrid.tsx:73-74,175-176`, `MarketContext.tsx:146`, `AllocationDonut.tsx:120`, `SectorTreemap.tsx:420`. R5 also found two NEW `bg-amber-500/N` hits in `StrategyBuilder.tsx:199,289` (dead-code; not rendered) and one in `WatchlistPanel.tsx:750` (also dead-code; not currently mounted on any route). The *rendered* O3-residual count is unchanged. |
| O4 | INFO → INFO | `bg-[color:var(--…, #fallback)]` token-with-fallback pattern | Held. Same 6 sites at `pipeline/page.tsx:1592,1621`, `BulletGraph.tsx:51`, `EarningsDetailPanel.tsx:248,250,646,648`. Functionally correct. |
| O5 | INFO → INFO | Inline `rgba()` shadows on dashboard hero | Held. 8 sites in `(dashboard)/page.tsx`. Visual depth ladder still reads correctly in PNG. |
| O6 | INFO → upgraded to MINOR R5-3 | Chart-fallback literals in `ChartPane.tsx` and `TradingChart.tsx` | **Partially upgraded.** R4 framed this as "intentional chart-source-of-truth." R5-3 above carves out the `STRUCTURE_COLORS` / `BOOK_COLORS` *non-fallback* literals as a separate concern. R4's hex-only count missed the 6 `rgba()` constants. |
| F8 | INFO → INFO (dead-code) | TradePanel + placeholder small hex residuals | **Confirmed dead-code.** `grep TradePanel\\b src` shows zero consumers outside the file itself + tests. The 3 hex sites at `TradePanel.tsx:1501,1508` and `placeholder.tsx:49` exist on disk but never render. Not blocking; arguably the file should be deleted or migrated. |

### Newly-discovered dead-code amber surface (informational)

R5 found 3 components that *contain* off-system Tailwind palette but **do not render** in the canonical sweep — they're orphan files left from prior architecture rounds:

| File | Off-system sites | Status |
|------|------------------|--------|
| `components/panels/StrategyBuilder.tsx` | 7 (`text-amber-400/500`, `bg-amber-500/5`, `border-amber-500/30`) | Not imported anywhere. Pipeline page comment confirms (line 1078): *"StrategyBuilder + BacktestPanel were mounted on /pipeline (an operations page) — they are CREATION tools…they now live in a small CTA card at the bottom"* — i.e. unmounted on Round-8. |
| `components/panels/WatchlistPanel.tsx` | 1 (`bg-amber-500/15 text-amber-400`) | No imports. Tested in `__tests__/components/WatchlistPanel.test.tsx` only. |
| `components/dashboard/StressTest.tsx` | 2 (`text-amber-400`) | No imports outside its own file + tests. |

These do *not* block R5's score (they don't render, so a user never sees the wrong color). They're tracked here as a cleanup nudge: each is a file the codebase still pays maintenance cost on, and each will re-leak amber-N if someone re-mounts them without first running them through the token migration.

**The one rendered text-amber-400 site:** `NotificationCenter.tsx:42` (`if (iconHint === "shield") return <Shield className={cn(cls, "text-amber-400")} />`). NotificationCenter renders in `layout/TopBar.tsx:144` which mounts on every dashboard page. The shield icon is the "system" notification category. The notification store (`useNotifications.ts:370`) emits `iconHint: "shield"` for non-error system events, and `auth/AuthProductFrame.tsx:41` emits `icon: "shield"` for the authentication-OK welcome notification. So **this single site DOES render** on the auth'd app whenever a non-error system notification is open in the notification center popover. Not in the canonical sweep (the sweep doesn't open the popover), but it's not dead-code. Treating as MINOR-leak (single icon, low visibility), but it should be migrated to `text-state-warning-fg` or `text-rust-500` per intent (security-related → rust-500 reads "vigilance"; or `--brand` since it's a benign system-OK signal).

---

## Sites verified clean

- **Dashboard hero (`(dashboard)/page.tsx`)**: 0 hex literals (5,000-line file; R4-2 SectorTreemap migration plus the broader R4 work cleared this surface). Confirmed by visual: `qa/runs/2026-05-04T20-31-40Z/dashboard/desktop-1440/initial.png` shows uniform chartreuse/coral P&L semantic, single gold brand layer, no rogue greens/blues.
- **API-degraded banner (`(dashboard)/layout.tsx:87-114`)**: 0 hex literals in source; tokens drive the warning palette. (R4-CLOSED, held.)
- **Focus rings**: `grep 'focus-visible:ring-\[' frontend/src` → 1 hit at `CalendarWeekHeatmap.tsx:122`, and that one uses `ring-[color:var(--brand)]` — token-driven. Zero arbitrary-hex focus rings.
- **Hover states**: `grep 'hover:bg-\[#\|hover:text-\[#\|hover:border-\[#' frontend/src` (excl. frozen zones) → 0 hits. All hover/active states tokenized.
- **Marketing surface**: `qa/runs/2026-05-04T20-31-40Z/login/desktop-1440/initial.png` confirms the cream-and-forest-green light-mode marketing palette is intact; no drift toward dark. (Frozen per R2 BUG-08.)
- **P&L semantic uniformity**: every rendered surface — dashboard `+9.27% / -0.46%` watchlist, status strip P&L, capital canvas headline, strategy detail OOS Sharpe, options payoff curve — uses chartreuse-up / coral-down. Verified via PNGs.
- **Override count**: `grep '!\[(text|bg|border|...)-' frontend/src` = 0. No `!important` color overrides.
- **Sector_rotation has no UI**: `grep -rln sector_rotation frontend/src` returns 1 source file (`strategies/[id]/page.tsx:70` slug alias) and 4 reference files (test, content, meta, selector). No dedicated route, no card art, no chart palette. Backend-only PR; no color regression.
- **Pipeline page (`pipeline/page.tsx`)**: rendered DOM has zero off-system Tailwind palette classes; the only hex-color hits are the 2 `(--state-warning, #d97706)` token-with-fallback patterns at lines 1592, 1621 — same as R4.
- **Marketing pages** (`/about`, `/privacy`, `/terms`, `/contact`, `/risk`): hex-literal count holds in the frozen-zone budget; verified `grep '#[0-9a-fA-F]' app/about app/privacy ... = 43 hits`, all in the frozen `(public)`/`auth/`/`marketing` surface.

---

## Verification matrix

| Metric | R1 | R2 | R3 | R4 | R5 | Direction R4 → R5 |
|--------|-----|-----|-----|-----|-----|-------------------|
| Hardcoded color literals (`grep -rEn '#[0-9a-fA-F]{3,6}' frontend/src/app frontend/src/components`) | 306 | 219 | 217 | 211 | **211** | held |
| `var(--amber-500)` direct refs in `*.tsx`/`*.ts` (excl. `design-tokens.css`) | n/a | n/a | 124 | 1 | **0** | improved (-1) |
| `state-warning-*` ecosystem references (semantic token consumers) | 0 | 0 | 0 | 43 | **44** | held |
| `!text-\[#…]` / `!bg-\[#…]` overrides | 13 | 0 | 0 | 0 | **0** | held |
| Hex literals in `(dashboard)/layout.tsx` | n/a | 6 | 6 | 0 | **0** | held |
| Off-system Tailwind palette `bg-(emerald|red|...)` (R4 grep) | ~22 | 17 | 17 | 8 | **7** | held / -1 (1 site of dead code; the live count matches R4) |
| **`text-amber-N` (Tailwind stock palette) — RENDERED in DOMs** | n/a | n/a | n/a | **never measured** | **27 sites** | **NEW finding** |
| `text-amber-N` source-only count in `*.tsx` | n/a | n/a | n/a | **never measured** | **9 source sites** | **NEW** |
| `rgba()` literals in `ChartPane.tsx` (non-fallback) | n/a | n/a | n/a | **never measured** | **6 in STRUCTURE_COLORS + BOOK_COLORS** | **NEW** |
| ESLint guard catches Tailwind-utility-class form (`text-amber-500`) | no | no | no | **no** (CSS-var only) | **no** (unchanged) | **gap** |

---

## Score justification

A **4/4** required all three of:

1. Zero hardcoded literals outside frozen marketing surface and chart-fallback layer
2. One and only one semantic meaning per state token
3. No banner/page in the authenticated app rendered with raw arbitrary-value color classes

R4 awarded the 4/4 on a CSS-variable-only audit. R5's DOM-level audit shows that **criterion 1 is violated**: 27 rendered surfaces ship `text-amber-100` (Tailwind's stock `#fef3c7`) when the design system's own `--state-warning-fg` (`#f8d590`) exists and should be used. The `/strategies` catalogue *and* every `/strategy/{id}` detail page with a disclosure banner are off-token on the same architectural axis R4 said it had closed.

A **3/4** is the right score because:

- **The R4-named carry-overs all held** — banner is still tokenized, decomposition stuck, SectorTreemap is still on `bg-up-*`/`bg-down-*`, P&L semantic is uniform across the dashboard. No regression on the *named* R4 fixes.
- **The leak is on a vector R4 didn't audit** — `text-amber-N` Tailwind utility classes, not `var(--amber-500)` CSS variable refs. R4's grep harness was scoped to the variable form only. R5 widened to the DOM-level grep and found 27 rendered violations.
- **The leak is reversible in ~7 line edits.** The fix is a near-mechanical class swap (`text-amber-100` → `text-state-warning-fg`) plus an ESLint rule extension. Same pattern as R4-2 — a focused micro-sprint can land it.
- **The blocker is real, not theoretical.** A user opening `/strategies` *right now* sees pills with off-system color. The design-tokens.css decomposition is bypassed by the very widget it was intended to drive.

A drop to 2/4 would require either (a) the R4-CLOSED items reverting (they didn't) or (b) a *new* semantic-collision class (not present — chartreuse/coral semantic uniformity holds). A 3/4 captures the regression accurately: the painted surface is still better than R3 was, but R4's "all sources of truth" claim doesn't survive the rendered-DOM audit.

---

## Recommended R6 follow-up (priority-ordered)

1. **Migrate the 7 `text-amber-100`/`text-amber-200` source sites to `text-state-warning-fg` / `text-state-warning-fg-muted`.** (R5-1 fix.) Targets:
   - `frontend/src/components/strategies/StrategyDisclosure.tsx:119, 133` — the eyebrow + pill.
   - `frontend/src/app/(dashboard)/strategies/page.tsx:268` — catalogue card pill.
   - `frontend/src/app/(dashboard)/reports/page.tsx:1237` (`text-amber-200` → `text-state-warning-fg-muted`) and `:1286` (`text-amber-100` → `text-state-warning-fg`).
   Estimated diff: 7 lines + comment update on `:87` to drop the "Tailwind default near-white" reference. Visual delta: <1 unit lightness, indistinguishable on the existing `bg-amber/[0.04]` surface. Verify against the same WCAG ratio (still ~12:1).

2. **Extend the ESLint guard to the Tailwind-utility-class form.** (R5-2 fix.) Add:
   ```js
   {
     selector: "Literal[value=/\\b(text|bg|border|ring|outline|fill|stroke|shadow)-amber-[0-9]+(\\/[0-9]+)?\\b/]",
     message: "Use semantic state-warning tokens (text-state-warning(-fg|-fg-muted), bg-state-warning(-bg), border-state-warning(-border)) instead of stock Tailwind amber shades. Direct text-amber-N reaches Tailwind's default palette and bypasses the design system.",
   },
   { selector: "TemplateElement[value.raw=/\\b(text|bg|...)-amber-[0-9]+(\\/[0-9]+)?\\b/]", message: "..." },
   ```
   Plus the same selectors against `emerald-N`, `red-N`, `blue-N` outside the frozen marketing zone. Net effect: closes both the BLOCKER vector (text-amber-100) *and* the O3-residual vector (StrategyTemplates emerald/amber/red pills) at the lint boundary so the next migration is final.

3. **Tokenize ChartPane's STRUCTURE_COLORS + BOOK_COLORS.** (R5-3 fix.) Add `--book-bid`, `--book-ask`, `--structure-support`, `--structure-resistance`, `--structure-demand`, `--structure-supply` to `design-tokens.css` with light-mode mirrors. Replace the rgba constants in `ChartPane.tsx:311-322` with `getTokenVar('--book-bid', 'rgba(46,169,143,0.86)')` etc. Net 6 token additions + 1 file migrated.

4. **Migrate `NotificationCenter.tsx:42`** (`text-amber-400` → `text-state-warning-fg` or `text-rust-500` per "vigilance" intent). 1 line.

5. **Delete or fully migrate the dead-code amber surfaces** (`StrategyBuilder.tsx`, `WatchlistPanel.tsx`, `StressTest.tsx`). Either remove the files or migrate them to tokens before they're re-mounted by some future PR. ~10 amber-N sites collectively.

6. **Carry forward** the R4-named O3-residual (`StrategyTemplates.tsx`, `StrategyGrid.tsx`, `MarketContext.tsx`, `AllocationDonut.tsx`) — these are still valid but lower-priority than the BLOCKER above.

R6 has a clear path to a permanent 4/4: items 1-2 close the BLOCKER and the guard gap, items 3-5 close the MINOR sprawl. A focused micro-sprint (similar in scope to R4-2) can land all six.

---

## Files audited (R5)

- `frontend/src/styles/design-tokens.css` (lines 50-64 token decomposition still in place; lines 336-346 light-mode mirror still present)
- `frontend/src/app/globals.css` (lines 60-73 Tailwind v4 theme bridge — `--color-amber` alias still wired to `--amber-500`)
- `frontend/src/components/strategies/StrategyDisclosure.tsx` (lines 87, 119, 133 — `text-amber-100` × 2 + the comment driving the pattern)
- `frontend/src/app/(dashboard)/strategies/page.tsx` (lines 223, 268 — catalogue card pill)
- `frontend/src/app/(dashboard)/reports/page.tsx` (lines 1237, 1286 — wash-sale stamp + tax disclaimer)
- `frontend/src/components/layout/NotificationCenter.tsx` (line 42 — shield icon `text-amber-400`)
- `frontend/src/components/charts/ChartPane.tsx` (lines 221-223, 311-322, 1344 — rgba constants + cycling palette)
- `frontend/src/components/charts/TradingChart.tsx` (lines 1037, 1103-1106 — same MACD/compare-palette literals R4 noted as O6)
- `frontend/src/components/panels/StrategyBuilder.tsx` (lines 199, 273, 289-297 — dead-code amber surface)
- `frontend/src/components/panels/WatchlistPanel.tsx` (line 750 — dead-code amber)
- `frontend/src/components/dashboard/StressTest.tsx` (lines 104, 116 — dead-code amber)
- `frontend/src/components/dashboard/StrategyGrid.tsx` (lines 73-74, 175-176 — O3-residual, still rendered, still amber-500/30 + emerald-500/30)
- `frontend/eslint.config.mjs` (lines 67-74 — R4 guard, scope gap noted)
- `frontend/src/lib/strategies.ts` (line 141 — sector-rotation `stage: "planned"` even though backend PR #32 lifted to ACTIVE; not a Pillar 3 finding but adjacent)
- `backend/strategies/registry.py` (line 157 — sector-rotation in IMPLEMENTED_STRATEGY_ROUTE_IDS)
- `qa/reviews/pillars-r4/03-color.md` (full re-read; R4 closure claims cross-checked)

**Screenshots referenced (all under `qa/runs/2026-05-04T20-31-40Z/`):**

- `dashboard/desktop-1440/initial.png` — clean P&L semantic; no off-system palette visible
- `strategies-list/desktop-1440/initial.png` and `card-hover.png` — Paper-only / Active / Coming-soon pills (catalogue rendering with `text-amber-100`)
- `strategy-momentum-quality/desktop-1440/initial.png` — disclosure banner with the off-token pill
- `pipeline/desktop-1440/initial.png` — pipeline ops page; clean
- `trade/desktop-1440/initial-prefill.png` and `multi-leg-prefill.png` — TOP BOOK chip showing the forest-green vs burnt-coral bid/ask palette (R5-3)
- `strategies-earnings-options-play/desktop-1440/initial.png` — held; no regression
- `alerts/desktop-1440/initial.png` — empty state, clean
- `login/desktop-1440/initial.png` — frozen marketing surface, cream-and-forest-green held

**DOMs referenced:**

- `strategies-list/{desktop-1440,mobile-390}/initial.dom.html` (Paper-only pills)
- `strategy-momentum-quality/{desktop-1440,mobile-390}/{initial,bottom,chart-1m,scrolled-mid,metric-hover,pause-click}.dom.html` (disclosure × 12)
- `settings/desktop-1440/section-1.dom.html` (1 amber-100 hit)
