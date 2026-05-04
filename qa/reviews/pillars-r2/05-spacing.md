# Pillar 5 — Spacing (Re-audit)

**Re-audited:** 2026-05-04
**Baseline (R1):** 2/4 — 148 distinct spacing classes, top-10 ≈ 50%, 21+ arbitrary `[Npx]` sites
**Source:** `/Users/GK/Downloads/alphadesk/frontend/src/`
**Tokens:** `frontend/src/styles/design-tokens.css` + `frontend/src/app/globals.css`
**Screenshots:** `/Users/GK/Downloads/alphadesk/qa/runs/2026-05-04T13-45-11Z/<spec>/<viewport>/<label>.preview.png`
**Stance:** FORCE — assume spacing fails until proven otherwise.

---

## Score: 2 / 4 (Needs work) — held, foundation now in place

The headline metric barely moved. **149 distinct spacing classes** (was 148) across **3,642 instances** (was 3,603). Top-10 share is **49.8%** (1,815 / 3,642) — gsd benchmark is ≥70%, so still ~20pp short. Half-step proliferation (`gap-1.5` 131, `py-1.5` 86, `mt-0.5` 69, `py-0.5` 59, `px-1.5` 59, `px-2.5` 52, `gap-0.5` 31, `py-2.5` 31, plus tail) totals **649 uses** — BUG-19/20 was meant to grind these down but was deferred.

What changed:

1. **PR-6a wired `--spacing-*` tokens into Tailwind v4's `@theme inline` block** (`globals.css:157–169`): `--spacing-1..24` → `--space-1..24` plus new `--spacing-0_5: 2px` and `--spacing-1_5: 6px`. The design-token file is now load-bearing instead of decorative; the half-step values that were "off scale" in R1 are now first-class tokens. **R1 WARNING 8 closed.**
2. **BUG-04 (PR-2) replaced the earnings empty-pane void with `CalendarWeekHeatmap`** (`EarningsDetailPanel.tsx:201`; new component `_earnings/CalendarWeekHeatmap.tsx` with `data-slot="calendar-week-heatmap"`; test at `__tests__/earnings/EarningsDetailPanel.test.tsx:46`). **R1 BLOCKER 1 closed.**
3. **PR-5 collapsed chrome to a 48px TopBar** (`TopBar.tsx:64` — `h-12 … sm:px-4`) and removed StatusStrip from rendering (file lingers as dead code; `StatusStrip.test.tsx:6` notes "removed in PR-5"). Net +28px content; `/alerts`, `/strategies-list`, `/strategies-earnings-options-play` previews show a single tight chrome row.
4. **A genuine `<EmptyState>` primitive exists** (`components/primitives/EmptyState.tsx`, `data-slot="empty-state"`, **35 callsite references**, 63-line test).

What didn't change:

- Distinct count 148→149 is noise (likely a new `gap-3.5`).
- Top-10 share unchanged at 49.8%.
- Arbitrary `[Npx]` spacing-only sites: **18** (was 21+; reduction = StatusBar mono-pills PR-5 deleted). `PositionsList.tsx` alone still carries 10 raw-px sites.
- `space-y-*`: 121 total uses; 98 live at `space-y-{1,2,3,4}`. Marketing pages still under-cadenced.

Score holds at 2 because the fragmentation surface is unchanged and the codemod is the load-bearing fix; partial credit is implicit in 2 of 3 R1 BLOCKERs closing. Honest call: **2/4, trending up**.

---

## Findings

### CLOSED (was BLOCKER 1) — Earnings empty-pane void replaced with calendar-week heatmap
`EarningsDetailPanel.tsx:193–201` imports `CalendarWeekHeatmap` and renders it pre-selection (file comment at :193: `// PR-2 / BUG-04: show the calendar-week heatmap instead of the blank prompt.`). The new component (`_earnings/CalendarWeekHeatmap.tsx`) carries `data-slot="calendar-week-heatmap"` and a unit test at `__tests__/earnings/EarningsDetailPanel.test.tsx:46` asserts the slot mounts on the empty path. **R1 BLOCKER 1 closed.**

### CLOSED (was WARNING 8) — `--space-*` tokens wired into Tailwind via `@theme`
`globals.css:157–169` declares `@theme inline { --spacing-1: var(--space-1); ... }` plus the new `--spacing-0_5: 2px` and `--spacing-1_5: 6px`. R1's "token file decorative, not enforced" is no longer true — `p-4`/`gap-2`/`px-3` now resolve through the design token. The lint rule R1 asked for (`no-arbitrary-spacing`) is still missing, so the gate is convention-only; foundation is correct. **R1 WARNING 8 closed.**

### BLOCKER 1 (was BLOCKER 2) — Spacing scale fragmentation: 149 distinct values across 3,642 uses
Codemod deferred → essentially unchanged:

- Distinct: **149** (was 148; +1 noise)
- Total uses: **3,642** (was 3,603; +39, BUG-04 + new cards)
- Top-10 share: **1,815 / 3,642 = 49.8%** (was ~50%)
- **65 values used ≤3 times**; **30 used exactly once** (`gap-12`, `gap-3.5`, `m-2.5`, `mb-6`, `ml-0.5`, `ml-3`, `ml-5`, `ml-8`, `mt-12`, `mt-2.5`, `mt-7`, `mt-8`, `p-3.5`, `pl-1`, `pl-1.5`, `pl-2`, `pl-6`, `pl-8`, `pr-10`, `pr-12`, `pt-20`, …). Textbook codemod targets.
- Half-step uses total: **649**. PR-6a made these in-scale, but they still reflect author-by-author micro-tuning, not a deliberate 6px/2px rhythm.

PR-6a legitimizes 2/6px (off-scale uses dropped from 459 → 0) but scale discipline is unchanged: 50% of authoring still picks outside the top 10. Fix is the deferred codemod: (a) rewrite the 30 singletons to nearest top-10 token, (b) collapse `gap-1`/`gap-1.5`/`gap-2` flex rows to a single `gap-tight` (6px) preset, (c) collapse `mt-0.5`/`mt-1` to one offset class.

### BLOCKER 2 (was BLOCKER 3) — Arbitrary `[Npx]` sites still present in production composites
`grep -E '(p|m|gap|space)[xtylbr]?-\[[0-9]+px\]'` returns **18** spacing-only arbitrary sites (was 21+; reduction = PR-5 StatusBar deletes). Surviving:

- `composites/PositionsList.tsx` lines 123, 246, 254, 261, 294, 300, 332, 340, 347, 362 — **`px-[18px]` × 4 + `mt-[1px]` × 4 + `gap-[2px]` × 2**. One component, 10 raw-px sites. `18px` is between `--space-4 (16px)` and `--space-5 (20px)`; PR-6a didn't add an 18px stop.
- `composites/ContextBar.tsx:47` — `gap-[2px] … md:px-[22px]`
- `composites/AIMemoPanel.tsx:53,80` — `sm:px-[18px] sm:py-[18px]`, `px-[7px] py-[3px]`
- `composites/StrategyCard.tsx:110` — `mt-[3px]`
- `composites/StatusBar.tsx:152` — `py-[1px]` (residual; main pill block deleted)
- `layout/TickerTape.tsx:51` — `py-[3px]`
- `(dashboard)/pipeline/page.tsx:1563` — `gap-[3px]`
- `layouts/editorial.tsx:17` — `before:top-[1px]` (low-priority decorative pseudo)

Fix: snap to scale or extend `@theme` with `--spacing-4_5: 18px` (and `--spacing-0_25: 1px` if `mt-[1px]` is genuinely needed for tabular alignment). PositionsList alone is half the offenders — highest-ROI sweep.

### WARNING 1 (was W4) — Marketing rhythm still under-cadenced; dashboard density now correct
- `space-y-*`: **121 total uses** (was 123). Heavy presets essentially absent: `space-y-10 = 1`, `space-y-6 = 2`. Top-used `space-y-3` (33), `space-y-1` (31) — tight defaults.
- `dashboard/desktop-1440/initial.preview.png` (Control Room): excellent rhythm — `gap-3` between cards, `p-5`/`p-6` inside, hero numerals breathe.
- `strategies-list/desktop-1440/initial.preview.png`: believable trading-terminal grid post-chrome collapse.
- `strategy-momentum-quality/desktop-1440/initial.preview.png`: marketing-style rhythm still flat — § 01..§ 05 stack with `space-y-3`-ish gaps, chapter-breaks missing.

Fix unchanged from R1: introduce `.t-section-stack { @apply space-y-12; }` and require it on legal/marketing pages.

### WARNING 2 (was W5) — Hit-target floor: half-step paddings still produce sub-40px buttons
R1 examples unchanged (`EarningsDetailPanel.tsx:469` chip `py-1` + `text-[11px]` ≈ 22px). `min-h-[44px]` enforced in 4 places by hand (`dashboard/layout.tsx:265,302`, `EarningsDetailPanel.tsx:589`, `TradeButtonRow.tsx:392`); recommended `--btn-h-md` token + primitive does not exist.

### WARNING 3 (was W6) — `gap-1` / `gap-1.5` defaults still discourage density discipline
`gap-1` (108) + `gap-1.5` (131) + `gap-2` (323) = 562 uses. Authors still half-stepping between 4 and 8px. PR-6a made `gap-1.5` first-class, so the system endorses 6px — pick 6 or 8 and migrate. `gap-tight` preset still missing.

### WARNING 4 (was W7) — Sparse outliers — partially addressed
- Earnings detail void: **fixed** (BUG-04, see CLOSED).
- `/pipeline` empty-state: `pipeline/desktop-1440/initial.preview.png` shows the "Pipeline has not run yet today" callout still in a 4-cell ASCII bar; the bottom now has a real performance-summary row but the empty bar itself is a thin orphan strip.
- `/alerts` empty-state: `alerts/desktop-1440/initial.preview.png` now uses `<EmptyState>` (`alerts/page.tsx:968`). **Improved.**
- About/contact/help-earnings marketing pages: not reshipped — same flat `py-16` rhythm.

Net: 2 of 4 outliers improved (earnings, alerts); 2 unchanged (pipeline, marketing).

### NEW WARNING 5 — `<EmptyState>` primitive adopted but inconsistently
35 callsites + 63-line test. But the primitive bakes arbitrary `text-[17px]` / `text-[13px]` and `px-6 py-12` (`primitives/EmptyState.tsx:46–48`), and `analytics/page.tsx:260,332,408,531,654` declares a **local shadow** `EmptyState({ label })` at line 654 instead of importing the primitive. Pick one.

---

## Top 3 Priority Fixes (R2)

1. **Ship the deferred BUG-19/20 spacing codemod.** Top-10 share at 49.8% is the unmoved metric. (a) sweep the 30 singletons to nearest top-10 token, (b) collapse `gap-1` ↔ `gap-1.5` ↔ `gap-2` to a two-stop rhythm via `.gap-tight (6px)` and `.gap-row (8px)`, (c) drop `space-y-2.5`/`space-y-1.5`. Target: top-10 share ≥65% post-sweep. PR-6a foundation in place — this is now mechanical.
2. **One-file sweep of `PositionsList.tsx`** to eliminate `px-[18px]` × 4 + `mt-[1px]` × 4 + `gap-[2px]` × 2. Snap to `px-5` (20px) and `gap-0.5` (now real 2px token), or extend `@theme` with `--spacing-4_5: 18px` and `--spacing-0_25: 1px`. Half the surviving 18 arbitrary sites live here; fixing alone closes BLOCKER 2.
3. **Promote `min-h-[44px]` into a `<TouchTarget>` primitive** or `--touch-target-floor` token. Hand-applied in 4 places; missing in chip components where `py-1 + text-[11px]` → 22px buttons. Pair with a unit test that fails any tappable affordance below 40px.

---

## Token / class counts (cite-sheet)

```
total spacing-utility uses  3,642   (R1: 3,603; +39)
distinct spacing classes      149   (R1:   148; +1)
top-10 share              49.8%     (R1: ~50%;  unchanged)
half-step uses (0.5/1.5/2.5/3.5)   649   (now in-scale via PR-6a)
arbitrary-px spacing sites     18   (R1: 21+; PR-5 deleted ~3)
space-y-* total uses          121   (R1: 123; unchanged)
EmptyState primitive refs      35   (NEW; primitive shipped)
data-slot="calendar-week-heatmap"  exists (R1 void closed)
@theme inline --spacing-1..24  exists (R1 WARNING 8 closed)
```

---

## Files re-audited

- `/Users/GK/Downloads/alphadesk/frontend/src/styles/design-tokens.css`
- `/Users/GK/Downloads/alphadesk/frontend/src/app/globals.css` (`@theme inline` block, 22, 140–200)
- `/Users/GK/Downloads/alphadesk/frontend/src/components/primitives/EmptyState.tsx`
- `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/strategies/earnings-options-play/_earnings/EarningsDetailPanel.tsx`
- `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/strategies/earnings-options-play/_earnings/CalendarWeekHeatmap.tsx` (new)
- `/Users/GK/Downloads/alphadesk/frontend/src/components/composites/PositionsList.tsx`
- `/Users/GK/Downloads/alphadesk/frontend/src/components/composites/ContextBar.tsx`, `AIMemoPanel.tsx`, `StatusBar.tsx`, `StrategyCard.tsx`
- `/Users/GK/Downloads/alphadesk/frontend/src/components/layout/TopBar.tsx` (h-12 confirmed), `StatusStrip.tsx` (dead — no longer rendered), `TickerTape.tsx`
- `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/layout.tsx`, `page.tsx`, `pipeline/page.tsx`, `alerts/page.tsx` (uses `<EmptyState>`), `analytics/page.tsx` (local shadow `EmptyState`)
- Screenshots reviewed (`*.preview.png`): dashboard desktop-1440 initial; strategy-momentum-quality desktop-1440 initial + scrolled-mid; strategies-earnings-options-play desktop-1440 initial; pipeline desktop-1440 initial; alerts desktop-1440 initial; strategies-list desktop-1440 initial.
