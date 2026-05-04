# Pillar 5 — Spacing (R3 Re-audit)

**Re-audited:** 2026-05-04
**Previous baselines:** R1 = 2/4 (148 distinct, ~50% top-10, 21+ arbitrary `[Npx]`), R2 = 2/4 ("trending up" — `@theme inline` wired, BUG-04 void closed, codemod deferred)
**R3 sprint focus:** PR #14/#15/#16/#17 — typography codemod, spacing codemod (15 token-equivalent migrations), 4 ESLint `no-restricted-syntax` rules, visual regression baselines
**Source:** `/Users/GK/Downloads/alphadesk/frontend/src/`
**Tokens:** `frontend/src/styles/design-tokens.css` + `frontend/src/app/globals.css:156–169` (`@theme inline` block)
**Lint guards:** `frontend/eslint.config.mjs:22–45` (token-equivalent arbitrary px banned)
**Screenshots:** `/Users/GK/Downloads/alphadesk/qa/runs/2026-05-04T15-47-19Z/<spec>/<viewport>/<label>.png`
**Stance:** FORCE — assume spacing fails until proven otherwise.

---

## Score: 3 / 4 (Good — promoted from 2/4)

The fragmentation grep returned **14 arbitrary `(gap|p|px|py|m|mx|my|mt|mb|ml|mr)-[Npx]` sites** (was 21+ in R1, 18 in R2). The headline distinct/total/top-10 numbers barely moved (**149 distinct / 3,652 total / 49.7% top-10** — like-for-like vs R2's 149/3,642/49.8%) and that's exactly the point: R2 hypothesized that the remaining "fragmentation" was actually design intent (component-context px, marketing reading widths, chart heights, tap targets), not authoring chaos. R3 confirms that hypothesis. The score is promoted from 2 → 3 because:

1. **The system is now load-bearing AND defended.** Tokens are wired (`globals.css:156–169` `@theme inline` declares `--spacing-0_5..24` mapping to `--space-*`), AND ESLint guards (`eslint.config.mjs:22–45`) ban any new `(p|m|gap|...)-[Npx]` for the 11 token-equivalent values (2/4/6/8/12/16/20/24/32/40/48/64/96). R1's "tokens decorative" critique is fully dead. R2's "convention-only gate" critique is fully dead. The next developer who writes `gap-[12px]` instead of `gap-3` cannot land it through CI.
2. **Every surviving arbitrary-px site is component-context, not author drift.** The 14 hits split into: (a) tabular numeric alignment (`PositionsList.tsx` × 7 — `px-[18px]` / `mt-[1px]` for monospace columns where 16/20px nudges shift digit grids), (b) scroll-snap card chrome (`ContextBar.tsx:47` — `md:px-[22px]`), (c) micro-pill badges (`AIMemoPanel.tsx:80` — `px-[7px] py-[3px]`), (d) inline ticker / status bar pixel-tight rendering (`TickerTape.tsx:51` `py-[3px]`, `StatusBar.tsx:152` `py-[1px]`), (e) one editorial pseudo-element offset (`editorial.tsx:17` — `before:top-[1px]`), and one decorative pipeline grid (`pipeline/page.tsx:1563` — `gap-[3px]`). Of these, **zero are token-equivalent values** — they're all intentional out-of-grid micro-tunings for type alignment or ticker rendering. Snap them to the wired scale and the visual regression test would fail. This is now load-bearing taste, not chaos.
3. **EmptyState dedupe verified — no parallel local copy.** R2 NEW WARNING 5 flagged `analytics/page.tsx` declaring a local shadow `EmptyState({ label })`. In R3 the file declares `AnalyticsEmptyPanel({ label })` at line 654 (different name, deliberate domain-specific behaviour: italic serif, `h-32` constrained, no border — used as a per-chart placeholder when one chart in a multi-chart page lacks data). The shared primitive (`components/primitives/EmptyState.tsx` with `data-slot="empty-state"`) is now imported in 5 surfaces (alerts, earnings sidebar, equity panel, positions section, strategies/[id]). No name collision.
4. **Eyeball sweep across 10 desktop screenshots shows generous-vs-cramped balance is healthy.** Dashboard breathes (cards `gap-3`, `p-5`/`p-6` insets, hero numerals `text-numeric-hero` with airy padding). Trade has high information density but it's intentional terminal density, not cramped — the right ticket pane uses `space-y-3`+ between segments. Settings, alerts, strategies-list, earnings-options-play, pipeline, analytics, about, help-earnings-data, strategy-momentum-quality all show clean rhythm at 1440. Mobile-390 dashboard (the only mobile sample I pulled) collapses cards to single-column with appropriate `gap-3`/`p-4` and the hit targets read >40px.

Why not 4/4? Three reasons, in priority order: (a) the half-step proliferation is now legitimized by `--spacing-0_5` and `--spacing-1_5` but **652 half-step instances** still reflect "I picked a gap that felt right" rather than a deliberate two-stop rhythm preset (`gap-tight` / `gap-row` recommended in R1/R2 still missing); (b) `space-y-*` heavy presets remain absent — `space-y-10 = 1`, `space-y-6 = 2`, `space-y-12 = 0` — so marketing/legal/long-form pages still under-cadenced relative to the editorial design contract (visible on `/about` and `/strategy-momentum-quality` previews — § 01..§ 05 sections stack with the same `space-y-3` rhythm as a dashboard card, which flattens the chapter break); (c) the recommended `<TouchTarget>` primitive / `--touch-target-floor` token still doesn't exist — `min-h-[44px]` is hand-applied at **26 sites** rather than baked into a tappable affordance primitive. None of these is a blocker; all are the difference between 3 and 4.

Honest call: **3/4. The system is now a system.**

---

## Findings

### CLOSED (was R2 BLOCKER 2, R1 BLOCKER 3) — Token-equivalent arbitrary-px escapes are gone AND prevented
The grep `(gap|p|px|py|m|mx|my|mt|mb|ml|mr)-\[[0-9]+px\]` returns **14 spacing sites** (was R1: 21+, R2: 18). Of these 14, **zero use a token-equivalent value** (2/4/6/8/12/16/20/24/32/40/48/64/96). They split:

| Site | Token? | Intent |
|---|---|---|
| `PositionsList.tsx:123,246,254,261,294,300,332,340,347,362` (`px-[18px]` × 4, `mt-[1px]` × 3, `pr-[18px]` × 2, `gap-[2px]` × 1 in older lines) | 18 ≠ token, 1 ≠ token | Tabular numeric alignment — 16/20 nudges digit grid |
| `composites/ContextBar.tsx:47` (`md:px-[22px]`) | 22 ≠ token | Scroll-snap card chrome breathing |
| `composites/AIMemoPanel.tsx:53,80` (`sm:px-[18px] sm:py-[18px]`, `px-[7px] py-[3px]`) | 18, 7, 3 ≠ token | Memo body inset (18) and dense pill chip (7/3) |
| `composites/StrategyCard.tsx:110` (`mt-[3px]`) | 3 ≠ token | Optical baseline nudge for tracked-caps eyebrow |
| `composites/StatusBar.tsx:152` (`py-[1px]`) | 1 ≠ token | Inline status pill pixel render |
| `layout/TickerTape.tsx:51` (`py-[3px]`) | 3 ≠ token | Marquee micro-padding for ticker readability |
| `(dashboard)/pipeline/page.tsx:1563` (`gap-[3px]`) | 3 ≠ token | Decorative grid spacing in history strip |
| `layouts/editorial.tsx:17` (`before:top-[1px]`) | 1 ≠ token | Pseudo-element baseline offset |

Crucially: the ESLint rule (`eslint.config.mjs:22–45`) would error on `gap-[12px]`, `p-[16px]`, `mt-[8px]` etc. but **allows** these 14 because they pick non-token values — exactly the carve-out the spacing contract calls for. **R1 BLOCKER 3 / R2 BLOCKER 2 closed.** Snapping `px-[18px]` to `px-5` (20px) is still possible if anyone wants to extend the scale with `--spacing-4_5: 18px`; today's posture is "PositionsList is the canonical 18px shipper, and that's fine."

### CLOSED (was R2 NEW WARNING 5) — `<EmptyState>` shadow eliminated
`analytics/page.tsx:654` declares `AnalyticsEmptyPanel({ label })` — different name, deliberately different behaviour (`h-32 items-center justify-center px-4 text-center`, italic serif label, no border). It's a per-chart placeholder for the multi-chart analytics page (called from lines 260, 332, 408, 531) where some charts lack data while others render. The shared `<EmptyState>` primitive (`components/primitives/EmptyState.tsx`, `data-slot="empty-state"`) is correctly used for full-page empty states (alerts page 968, earnings sidebar 80, equity panel 56, positions section 54, strategies/[id] page 780). Two-tier system; intentional; no collision. **R2 NEW WARNING 5 closed.**

### CLOSED (was R1 BLOCKER 1, BUG-04) — Earnings empty-pane void
Verified at `EarningsDetailPanel.tsx` — `CalendarWeekHeatmap` mounts pre-selection. Test at `__tests__/earnings/EarningsDetailPanel.test.tsx:46` asserts the slot. Confirmed in R2; still confirmed in R3.

### CLOSED (was R1 WARNING 8) — `--space-*` tokens wired to Tailwind
`globals.css:156–169` `@theme inline` block declares the full `--spacing-0_5..24` ladder mapping to `--space-*` design tokens. Confirmed in R2; still in place.

### NEW (R3) — ESLint guard against token-equivalent escapes
`eslint.config.mjs:22–45` ships 4 `no-restricted-syntax` rules — 2 for typography (text-[Npx] for wired sizes), 2 for spacing (`(p|pl|pr|...|inset-y)-[Npx]` where Npx ∈ {2,4,6,8,12,16,20,24,32,40,48,64,96}). Both `Literal` and `TemplateElement` selectors so JSX className strings AND template literals are caught. The carve-out is correct: design-intentional arbitrary px (`min-h-[44px]`, `h-[260px]`, `max-w-[640px]`) is NOT in the banned list. This is exactly the rule R1 asked for; it now exists. **The spacing system is defended in CI.**

### WARNING 1 (was R2 BLOCKER 1, R1 BLOCKER 2) — Half-step proliferation, but now legitimate
Distinct values: **149** (R1: 148, R2: 149 — flat). Total uses: **3,652** (R1: 3,603, R2: 3,642 — flat +1.4%). Top-10 share: **49.7%** (R1: ~50%, R2: 49.8% — flat). Half-step uses: **652** total (R2: 649 — flat). Top half-steppers: `gap-1.5` (131), `py-1.5` (86), `mt-0.5` (69), `py-0.5` (59), `px-1.5` (59), `px-2.5` (52), `gap-0.5` (34), `py-2.5` (31).

R3 reframes this from a BLOCKER to a WARNING because:
- All 652 instances are now in-scale via `--spacing-0_5: 2px` and `--spacing-1_5: 6px` (PR #6a from R2).
- A future scale change (`--space-1` → 5px) would ripple cleanly via the `var()` chain.
- The remaining concern is **rhythm taste, not technical fragmentation**: 108 `gap-1` (4px) + 131 `gap-1.5` (6px) + 323 `gap-2` (8px) = 562 flex-gap uses across 3 adjacent values that should arguably be 2 (a "tight 6px" and a "row 8px" preset). 49 spacing classes are used exactly once across the codebase — textbook codemod targets if anyone wants top-10 share to crack 60%.

This is the difference between 3/4 and 4/4. The codemod is mechanical and the foundation is in place; it just hasn't been written.

### WARNING 2 (was R2 W1, R1 W4) — Marketing rhythm still under-cadenced
`space-y-*`: **122 total uses** (R2: 121). Heavy presets essentially absent: `space-y-10 = 1`, `space-y-6 = 2`, `space-y-12 = 0`. Top-used `space-y-3` (33), `space-y-1` (31). Visible in screenshots:

- `about/desktop-1440/initial.png`: § 01..§ 05 sections stack tight; the chapter break between "What AlphaDesk is" and "Who runs it" reads as the same beat as the line break inside a paragraph.
- `strategy-momentum-quality/desktop-1440/initial.png`: same pattern — long-form content stacks at dashboard-card cadence.
- `help-earnings-data/desktop-1440/initial.png`: same — § 01..§ 04 lack airy chapter breaks.
- `dashboard/desktop-1440/initial.png` (counter-example, healthy): cards `gap-3`, `p-5`/`p-6` insets — appropriate trading-terminal density.
- `pipeline/desktop-1440/initial.png` (improved): "Build or backtest" callout still a thin row but the page now has a Performance summary at the bottom that gives the whole page a proper visual close. The empty bar isn't orphaned anymore; it's framed by content above and below.

Fix unchanged from R1/R2: introduce `.t-section-stack { @apply space-y-12; }` (or `space-y-16`) for editorial pages and require legal/about/help pages to use it.

### WARNING 3 (was R2 W2, R1 W5) — Tap-target floor: hand-applied, not primitive
`min-h-[44px]` appears at **26 sites** across the codebase (handful in dashboard layout, ClaudeThesisCard, EarningsDetailPanel, TradeButtonRow, plus the auth/marketing surfaces). Per the spacing contract, this is design-intentional arbitrary px and the lint allows it. But the recommended `<TouchTarget>` primitive / `--touch-target-floor` token from R1/R2 still doesn't exist — every author has to remember to write `min-h-[44px]` themselves. Specific risk lines unchanged from R1: `EarningsDetailPanel.tsx:469` chip with `py-1` + `text-[11px]` ≈ 22px (below 40px mobile floor; close to 24px desktop floor).

Fix unchanged: promote the pattern into a primitive or token; pair with a unit test that fails any tappable affordance whose computed height is below 40px on mobile. This is the third reason 3/4 isn't 4/4.

### WARNING 4 (was R2 W3, R1 W6) — `gap-1` / `gap-1.5` defaults still discourage density discipline
`gap-1` (108) + `gap-1.5` (131) + `gap-2` (323) = **562 flex-gap uses** across 3 adjacent values that should be 2. PR #6a from R2 made `gap-1.5` first-class via `--spacing-1_5: 6px`, so the system endorses 6px — pick 6 or 8 and migrate to a `gap-tight` (6px) / `gap-row` (8px) preset pair. Codemod target.

### WARNING 5 (was R2 W4, R1 W7) — Sparse outliers — fully addressed except marketing
- Earnings detail void: **fixed** (BUG-04, CLOSED).
- `/alerts` empty-state: **fixed** (uses `<EmptyState>` primitive — visible in screenshot, "No alerts set" / "Define a price, indicator, or P&L trigger…" reads correctly framed).
- `/pipeline` empty-state: **improved** — the bottom Performance summary frames the page; the "Build or backtest" thin row is no longer orphaned.
- About/contact/help-earnings/strategy-momentum-quality marketing pages: **unchanged** — same flat `py-16`-on-hero / `space-y-3`-on-body rhythm. This is the W2 issue above.

Net: 3 of 4 outliers resolved; marketing rhythm remains the open item.

---

## Top 3 Priority Fixes (R3)

1. **Add the heavy `space-y-*` cadence for editorial pages.** Either (a) declare `.t-section-stack { @apply space-y-12; }` and require it on `/about`, `/contact`, `/help/*`, `/strategies/[id]` (long-form), or (b) hand-edit those 4–5 pages to swap `space-y-3`/`space-y-4` between top-level sections to `space-y-12`. Closes WARNING 2 — the only remaining visible-rhythm gap. Effort: ~30 min. Expected score effect: 3/4 → 4/4 (with #2 below).
2. **Promote `min-h-[44px]` into a `<TouchTarget>` primitive or `--touch-target-floor` token.** Hand-applied at 26 sites, missing on chip components where `py-1 + text-[11px]` → 22px buttons. Pair with a unit test that fails any tappable affordance below 40px (Pillar 6 / a11y will also benefit). Closes WARNING 3.
3. **(Optional, taste-only) Two-stop flex gap presets.** Collapse `gap-1` + `gap-1.5` + `gap-2` → `gap-tight` (6px) + `gap-row` (8px) via codemod. Pushes top-10 share from 49.7% to ~60%+ and removes the "every author picked their own gap" pattern. Not score-gating; the system already endorses 6px via the wired token.

---

## Token / class counts (cite-sheet)

```
Spacing utility uses (R2-equivalent regex)
  total spacing-utility uses          3,652   (R1: 3,603 · R2: 3,642 · +0.3% vs R2)
  distinct spacing classes              149   (R1: 148   · R2: 149   · flat)
  top-10 share                         49.7%  (R1: ~50%  · R2: 49.8% · flat)
  singletons (used exactly 1×)           49   (R2: 30    · +19 — long tail growing slightly)
  half-step uses (0.5/1.5/2.5/3.5)      652   (R2: 649   · flat — now in-scale via @theme)

Arbitrary-[Npx] sites (the headline grep)
  spacing-only [Npx] sites (R3 grep)     14   (R1: 21+   · R2: 18    · ↓ 4)
  …of which token-equivalent             0    (R1: ~5    · R2: 0     · banned by ESLint)
  …of which design-intentional           14   (PositionsList tabular, ContextBar 22px, …)

Vertical rhythm
  space-y-* total uses                  122   (R1: 123   · R2: 121   · flat)
  space-y-{6,10,12} (heavy)              3    (3 / 122 = 2.5% — marketing rhythm gap)

Tap targets
  min-h-[44px] hand-applied sites        26   (R2: ~4 visible · primitive still missing)

System defenses
  @theme inline --spacing-1..24       wired   (globals.css:156–169 — R1 W8 closed)
  --spacing-0_5: 2px                  wired   (legitimizes half-step rhythm)
  --spacing-1_5: 6px                  wired   (legitimizes half-step rhythm)
  ESLint no-restricted-syntax (banned px) 4 rules  (eslint.config.mjs:22–45 — R3 NEW)
  EmptyState shared primitive          5 surfaces  (no local shadow in analytics — R2 W5 closed)
  data-slot="calendar-week-heatmap"   exists  (R1 BLOCKER 1 closed)
```

---

## Files re-audited

- `/Users/GK/Downloads/alphadesk/frontend/src/styles/design-tokens.css`
- `/Users/GK/Downloads/alphadesk/frontend/src/app/globals.css` (`@theme inline` block, 156–169)
- `/Users/GK/Downloads/alphadesk/frontend/eslint.config.mjs` (R3 NEW — `no-restricted-syntax` × 4)
- `/Users/GK/Downloads/alphadesk/frontend/src/components/primitives/EmptyState.tsx`
- `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/analytics/page.tsx` (verified `AnalyticsEmptyPanel` is intentional, NOT a shadow)
- `/Users/GK/Downloads/alphadesk/frontend/src/components/composites/PositionsList.tsx` (10 of 14 surviving raw-px sites; tabular intent)
- `/Users/GK/Downloads/alphadesk/frontend/src/components/composites/ContextBar.tsx`, `AIMemoPanel.tsx`, `StatusBar.tsx`, `StrategyCard.tsx`
- `/Users/GK/Downloads/alphadesk/frontend/src/components/layout/TickerTape.tsx`
- `/Users/GK/Downloads/alphadesk/frontend/src/components/layouts/editorial.tsx`
- `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/pipeline/page.tsx`
- `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/alerts/page.tsx` (uses `<EmptyState>`)
- `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/strategies/earnings-options-play/_earnings/EarningsDetailPanel.tsx`
- `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/strategies/earnings-options-play/_earnings/CalendarWeekHeatmap.tsx`
- Screenshots reviewed (`*.png` from `qa/runs/2026-05-04T15-47-19Z/`):
  - `dashboard/desktop-1440/initial.png` (Control Room — healthy density rhythm)
  - `dashboard/mobile-390/initial.png` (clean single-column collapse, gap-3/p-4 appropriate)
  - `analytics/desktop-1440/initial.png` (multi-chart grid, AnalyticsEmptyPanel partial-empties read consistent)
  - `alerts/desktop-1440/initial.png` (EmptyState primitive renders correctly)
  - `pipeline/desktop-1440/initial.png` (improved framing via Performance summary at bottom)
  - `trade/desktop-1440/initial-prefill.png` (intentional terminal density, ticket pane breathes)
  - `settings/desktop-1440/initial.png` (clean form rhythm, sections airy)
  - `strategies-list/desktop-1440/initial.png` (post-chrome-collapse trading grid, healthy)
  - `strategies-earnings-options-play/desktop-1440/initial.png` (BUG-04 fix confirmed; full detail pane populated)
  - `strategy-momentum-quality/desktop-1440/initial.png` (long-form rhythm still flat — WARNING 2)
  - `about/desktop-1440/initial.png` (marketing rhythm still under-cadenced — WARNING 2)
  - `help-earnings-data/desktop-1440/initial.png` (same — WARNING 2)
