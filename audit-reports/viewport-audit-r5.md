# Viewport Audit — Round 5 (Intermediate viewports)

Wave focus: tablet 768-1024, mid-laptop 1280-1380, ultrawide 1920+. Earlier
waves covered 390px (mobile) and 1440px (desktop) extensively — these are the
gaps in between.

Method: static walkthrough of `DeskLayout`, `DashboardPageLayout`, all
dashboard routes (`/`, `/analytics`, `/pipeline`, `/alerts`, `/reports`,
`/settings`, `/strategies/[id]`, `/trade`), the Layer-2 composites, and
every responsive utility (`sm:` / `md:` / `lg:` / `xl:` / `2xl:`). Tailwind
breakpoints in use: sm 640, md 768, lg 1024, xl 1280, 2xl 1536.

File paths are absolute.

---

### [P0] Desk right-rail disappears entirely between 768 and 1024
**Viewport:** 768-1024 (tablet, iPad portrait, Surface)
**File:** /Users/GK/Downloads/alphadesk/frontend/src/components/layouts/DeskLayout.tsx:62
**Current:** `grid grid-cols-1 md:grid-cols-[260px_1fr] lg:grid-cols-[260px_1fr_340px] gap-px` with `<aside data-slot="desk-right" className="flex min-h-0 flex-col overflow-x-hidden lg:overflow-hidden bg-bg">`
**Symptom:** On an iPad portrait (768) through Surface (912) and iPad Pro portrait (1024-), the desk renders as 260px rail + 1fr center, but the right column still renders at `grid-cols-[260px_1fr]`. Because the template has only 2 columns in that range, the right aside (positions + memo) becomes an *orphan* — it flows into the grid's implicit row and appears as a full-width band at the bottom of the main area, stacking below the chart. With `md:overflow-hidden` on `desk-main`, this content is clipped invisibly on `md:h-screen`. Trader cannot see positions on a 768-1024 tablet.
**Fix:** introduce an intermediate template so positions are visible at tablet widths. Three options, in order of effort:
- Cheapest: change `lg:grid-cols-[260px_1fr_340px]` → `md:grid-cols-[220px_1fr_300px]` (skip the 2-col step entirely).
- Middle: add `md:grid-cols-[260px_1fr] lg:grid-cols-[260px_1fr_320px]` but conditionally render positions *under* the chart at md via a flex column rather than a grid cell.
- Safest: `md:grid-cols-[220px_1fr] lg:grid-cols-[220px_1fr_300px] xl:grid-cols-[260px_1fr_340px]` and keep the right aside a `hidden md:block lg:block` sibling that slots into the last column when it exists, else a stacked panel below.

Related: `<aside data-slot="desk-right">` has no `hidden md:` — it renders regardless, which causes the orphan flow. Without a column for it, the grid silently wraps it.

---

### [P0] `DashboardPageLayout` hard-caps at 1280px — ultrawide wastes entire half of a 2560px display
**Viewport:** 1920+ (ultrawide, 4K, 27"+ external monitors)
**File:** /Users/GK/Downloads/alphadesk/frontend/src/components/layouts/DashboardPageLayout.tsx:49
**Current:** `mx-auto flex w-full max-w-[1280px] flex-col gap-6 px-6 py-8`
**Symptom:** Analytics, Pipeline, Reports, Alerts, Settings and Strategy-detail all inherit this shell. At 1920px, the content is a 1280px column centered in a 640px-wide empty margin — wastes 33% of pixels. At 2560px (common 27" monitor), it's 50% waste. On 4K/32", it looks actively broken — a narrow ribbon of UI in a sea of background.
**Fix:** widen to 1480-1600px and scale typography inside:
`mx-auto flex w-full max-w-[1480px] 2xl:max-w-[1680px] flex-col gap-6 px-6 py-8`.
Alternative: keep 1280 for text-heavy routes, add a `wide` variant prop for Analytics/Pipeline/Reports where grids benefit from more columns. Analytics' `lg:grid-cols-2` is the obvious winner: at 1680px, four columns would show all charts simultaneously.

---

### [P1] Pipeline performance grid collapses to 2 cols between 768-1279, hard jumps to 6 at 1280
**Viewport:** 768-1380 (tablet through mid-laptop)
**File:** /Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/pipeline/page.tsx:740
**Current:** `grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3`
**Symptom:** At 1279px the user sees 3 columns (2 rows). At 1280px (exactly xl breakpoint) it jumps to 6 columns (1 row). The cards re-layout violently as the user zooms or resizes. Also, 3-col at 1024-1279px feels wrong — there's room for 4.
**Fix:** add an intermediate step. `grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3`.

---

### [P1] Analytics 4-chart grid: only 2 columns from 1024 onward — 1440/1920 could host 4
**Viewport:** 1440-2560 (laptop+ and ultrawide)
**File:** /Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/analytics/page.tsx:634,644
**Current:** `grid grid-cols-1 gap-4 lg:grid-cols-2` on two rows of SectionCards
**Symptom:** At 1440-2560, the page stays 2-col, so a user who opens analytics on a 4K monitor sees the same density as on a 1024 iPad Pro. 4 charts side-by-side is the natural layout for quant-research review (all eye-visible at once). Also works with a 1480 `max-w` lift per P0 #2.
**Fix:** `grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-4`. Combine Row 1 (drawdown + Sharpe) and Row 2 (distribution + stats) into a single `2xl:grid-cols-4` row when space permits — or leave both rows and the 4-col kicks in on each.

---

### [P1] Pipeline `min-w-[900px]` table clips on 768-900px tablets with no visual scrollbar cue
**Viewport:** 768-900 (iPad portrait, small tablets)
**File:** /Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/pipeline/page.tsx:441-522
**Current:** `<div className="overflow-x-auto">` wrapping `<Table className="min-w-[900px]">`
**Symptom:** At 768px the `overflow-x-auto` gives horizontal scroll, but on macOS/iOS where scrollbars only appear during scroll, the user has no visual affordance that the table extends right. They see Symbol, Shares, Entry, Current, P&L — and may miss Stop Loss / Take Profit / Signal entirely. Combined with `DashboardPageLayout`'s `px-6` + page padding, the effective content width at 768 is ~720px, leaving ~180px hidden.
**Fix:** either a one-line scroll hint above the table (`<p className="text-[10px] text-fg-muted md:hidden">Scroll horizontally to see all columns →</p>`) or a fading right edge to signal overflow: add `after:absolute after:top-0 after:right-0 after:h-full after:w-10 after:bg-gradient-to-l after:from-panel after:pointer-events-none after:content-[''] relative` to the wrapper. Cheapest: add `scrollbar-thin` to the wrapper so the scrollbar is always visible on macOS — globals.css:214 already defines `.scrollbar-thin`.

---

### [P1] ContextBar 7 cells overflow silently below 1100px
**Viewport:** 768-1100 (tablet through small laptop)
**File:** /Users/GK/Downloads/alphadesk/frontend/src/components/composites/ContextBar.tsx:21-29
**Current:** `flex items-stretch h-[38px] overflow-x-auto md:overflow-visible snap-x snap-mandatory md:snap-none scrollbar-none border-b border-border bg-ink-100`
**Symptom:** The `md:overflow-visible` turns off horizontal scroll at 768+. At 768-1100 the 7 cells (each ~100-140px wide at `md:px-[22px]`) don't fit in the center column (which is `1fr` of the md 2-col grid after subtracting 260px rail) — cells are clipped or the flex row overflows behind the rail. The `scrollbar-none` is applied even on overflow-x-auto (under md), so even the fallback mobile scroll has no visible affordance.
**Fix:** keep `overflow-x-auto` longer: `overflow-x-auto lg:overflow-visible snap-x snap-mandatory lg:snap-none`. Or reduce padding: `px-3 md:px-[16px] lg:px-[22px]`. Combined with the DeskLayout fix (P0 #1), this should stay scrollable until there's truly room.

---

### [P2] OrderBar: 7 fields flex-row above md — no wrap, sits at edge of overflow at 1280
**Viewport:** 1280-1380 (mid-laptop)
**File:** /Users/GK/Downloads/alphadesk/frontend/src/components/composites/OrderBar.tsx:100-108
**Current:** `md:flex md:flex-row md:gap-5 md:px-7` with 7 `min-w-[90px]` fields + "review" span + submit button
**Symptom:** At 1280-1380, once the desk has the 340px right column back and the 260px rail, the OrderBar's center-column width is roughly 680-780px. 7 × 90 = 630 + gaps + review copy + Stage button = overflow territory. `flex-nowrap` is the default on `md:flex md:flex-row` — children shrink via `min-w-[90px]` floor, so the review copy + Stage button likely get shoved off-screen or clip the right edge in the parent `overflow-x-hidden md:overflow-hidden` DeskLayout.
**Fix:** `md:flex-wrap` on the md branch, or bump to `lg:flex lg:flex-row xl:flex-nowrap` — below xl it wraps naturally into 2 rows. Alternatively reduce `md:gap-5` → `md:gap-3 xl:gap-5`.

---

### [P2] Strategy rail 260px is ~25% of tablet width — cramped center column
**Viewport:** 768-1024 (tablet, assuming P0 #1 is fixed to show 2-col at md)
**File:** /Users/GK/Downloads/alphadesk/frontend/src/components/layouts/DeskLayout.tsx:62
**Current:** `md:grid-cols-[260px_1fr]`
**Symptom:** At 768, 260px rail is 34% of the viewport, leaving 500px for the chart + order ticket + everything the right column needs to host. The hero (40px display name + 36px mono price + 5 meta cells in flex) alone requires ~680px before meta cells clip.
**Fix:** narrow the rail at md: `md:grid-cols-[220px_1fr] lg:grid-cols-[260px_1fr_320px] xl:grid-cols-[260px_1fr_340px]`. The StrategyRail already has md-specific tighter typography (`md:text-[12.5px]`) so this fits without further work.

---

### [P2] PriceChartPanel header: 5 meta cells + hero + price in single non-wrapping flex row
**Viewport:** 768-1100 (tablet through mid-laptop)
**File:** /Users/GK/Downloads/alphadesk/frontend/src/components/composites/PriceChartPanel.tsx:239-280
**Current:** `<header className="flex items-end gap-6 px-7 pt-5 pb-3.5 border-b border-border-hair">` with `<div className="flex gap-[18px] ml-auto font-mono text-[11px] text-fg-muted">` for 5 meta cells
**Symptom:** Header is single-row flex, no wrap. At a 500-700px center column (tablet with rail+right), the hero name + price eats most of the width and the 5 meta cells either overflow right (hidden by DeskLayout's `md:overflow-hidden`) or squeeze the hero until the 40px display name collapses in weird ways.
**Fix:** allow wrap on the meta cluster: `flex-wrap gap-y-2` on the header, and `md:hidden lg:flex` on the meta cluster so tablet users see hero + price only. Or add a `flex-col md:flex-row` at mobile and collapse meta under the hero below lg. Recommended: `<header className="flex flex-wrap items-end gap-4 md:gap-6 px-5 md:px-7 pt-5 pb-3.5 border-b border-border-hair">` + `<div className="flex gap-3 md:gap-[18px] ml-auto lg:ml-auto font-mono text-[11px] text-fg-muted flex-wrap">`.

---

### [P2] `trade` page uses `calc(100vh - 48px - 32px)` — iOS Safari dynamic viewport bug
**Viewport:** 390-1024 (mobile through tablet, iOS/iPadOS)
**File:** /Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/trade/page.tsx:155
**Current:** `flex flex-col gap-4 p-4 md:p-6 min-h-[calc(100vh-48px-32px)]`
**Symptom:** On iOS Safari the address bar collapses on scroll, redefining 100vh; the page jumps/squashes whenever the user scrolls. Also `32px` is hard-coded but the actual StatusStrip height is 22px (or 32 on marketing-style routes) — mismatch means a scroll gutter appears at the bottom on some devices.
**Fix:** swap to dynamic viewport units: `min-h-[calc(100dvh-48px-22px)]`. `dvh` is supported in all modern Safari (15.4+). Fallback via `@supports` or accept the bug for the ~1% pre-15.4 tail.

---

### [P2] Strategies hero metric grid stays 4x1 from sm (640+) — at 900-1100px, 4 cells are cramped
**Viewport:** 768-1100 (tablet through small laptop)
**File:** /Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/strategies/[id]/_strategy/StrategyHero.tsx:91
**Current:** `grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4 lg:gap-x-10`
**Symptom:** 4 columns from 640px onward in a `max-w-[520px]` sibling feels tight on 768-900 (especially with Display serifs that have italic kerning). Each cell is ~100px of content.
**Fix:** add an intermediate step: `grid grid-cols-2 gap-x-8 gap-y-4 md:grid-cols-4 md:gap-x-6 lg:gap-x-10`. Or keep 2×2 longer: `sm:grid-cols-2 lg:grid-cols-4`.

---

### [P2] Analytics loading skeleton grid uses `lg:grid-cols-2` but body uses same — no consistency diff
**Viewport:** all widths
**File:** /Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/analytics/page.tsx:576
**Current:** `grid grid-cols-1 gap-4 lg:grid-cols-2` (skeleton) — matches body
**Symptom:** None, noting for completeness. If P1 #4 is applied (`2xl:grid-cols-4`), mirror the change on the skeleton grid too.
**Fix:** update to match whatever the final body uses.

---

### [P2] `(dashboard)/loading.tsx` uses `lg:grid-cols-5` and `xl:grid-cols-2` — awkward mid-range
**Viewport:** 1024-1280 (laptop, internal Macbook displays)
**File:** /Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/loading.tsx:16,21
**Current:** `grid grid-cols-1 lg:grid-cols-5 gap-4` ... `grid grid-cols-1 xl:grid-cols-2 gap-4`
**Symptom:** First skeleton grid uses 5 cols at 1024+, second uses 2 cols only at 1280+. Mismatched breakpoints cause the skeleton to feel misaligned with how the real content lays out. Also `max-w-[1800px]` on the outer wrapper is wider than `DashboardPageLayout`'s 1280 — the skeleton is too wide compared to the actual content it replaces.
**Fix:** align loading skeleton width with `DashboardPageLayout`: change `max-w-[1800px]` → `max-w-[1280px]` (or match whatever the final cap becomes). Use consistent breakpoints: `lg:grid-cols-4 xl:grid-cols-5` and `lg:grid-cols-2`.

---

### [P2] WatchlistPanel uses `sm:` (640) for compact mode — but rail only shows at `md:` (768)
**Viewport:** 640-768 (landscape phones, small tablets)
**File:** /Users/GK/Downloads/alphadesk/frontend/src/components/panels/WatchlistPanel.tsx:94-99,262,288,353
**Current:** heavy use of `sm:h-5 sm:py-1.5 sm:text-xs sm:min-h-0 sm:h-7` (compact above 640)
**Symptom:** Inconsistency: WatchlistPanel transitions to compact layout at 640px, but DeskLayout's rail only becomes visible at 768px (`md:block`). Between 640 and 768, the watchlist isn't shown on the desk anyway. But the panel IS used elsewhere (trade page? designs?), where at 640-767 it would render compact — fine. The bigger issue is at 768 when it first appears on the desk, it's already in compact mode without ever having been shown in the comfortable mode. The tight touch targets (h-5, h-7) are fine for desktop but iPad users at 768 get phone-compact without phone-sized content.
**Fix:** use `md:` instead of `sm:` for the Watchlist compact transitions — `md:h-5 md:w-5 md:py-1.5 md:text-[11px]`. Touch targets stay 36-44px until viewport is 768+, and the transition lines up with when the desk rail starts showing.

---

### [P2] SignalSection `md:grid-cols-2` vs `md:grid-cols-1` based on `twoCol` flag — no lg step
**Viewport:** 768-1280 (tablet through mid-laptop)
**File:** /Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/strategies/[id]/_strategy/SignalSection.tsx:35
**Current:** `twoCol ? "md:grid-cols-2" : "md:grid-cols-1"`
**Symptom:** Once twoCol kicks in at md, the content stays 2-col from 768 to infinity. At 1920+ the strategy detail page has 640-780px of unused right-hand margin (inherited from `DashboardPageLayout` `max-w-[1280px]`); lifting that cap (P0 #2) and adding a 3-col variant would use the space.
**Fix:** add a wider breakpoint: `twoCol ? "md:grid-cols-2 2xl:grid-cols-3" : "md:grid-cols-1"`. Only meaningful if P0 #2 max-width lift lands.

---

### [P2] `StrategyGrid` has triple-breakpoint flip (1→2→1→2) across sm/lg/xl
**Viewport:** 640-1536 (phone through wide laptop)
**File:** /Users/GK/Downloads/alphadesk/frontend/src/components/dashboard/StrategyGrid.tsx:263
**Current:** `grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2`
**Symptom:** Counter-intuitive: 1 col at base → 2 at sm → **back to 1 at lg** → 2 again at xl. User resizing from 800 to 1100 to 1300 sees 2 → 1 → 2 cols. The `lg:grid-cols-1` revert is probably because the parent shrinks at lg (context-dependent). Confusing flip.
**Fix:** document the intent with a comment, or flatten to `grid-cols-1 sm:grid-cols-2 xl:grid-cols-2` (drop the lg revert). Verify downstream consumer didn't need it.

---

### [P2] MarketContext similar 1-2-1-2 pattern
**Viewport:** 640-1536
**File:** /Users/GK/Downloads/alphadesk/frontend/src/components/dashboard/MarketContext.tsx:125
**Current:** `grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2`
**Symptom:** Same pattern as StrategyGrid. If the context is always a 3-column outer shell at lg (see line 62: `lg:grid-cols-3`), then each inner cell is narrow → 1 col makes sense. But from the outside it looks like a lint issue.
**Fix:** leave as-is but add a comment citing the parent's `lg:grid-cols-3` so future maintainers don't "fix" it.

---

## Summary — Top 10 by user-frequency × severity

Ordered by how often real traders would hit a *bad* render × how broken it is.

1. **[P0] #1 Desk right-rail orphan between 768-1023** — iPad portrait is common; positions going entirely missing is a trading-desk-breaking bug. DeskLayout.tsx:62.
2. **[P0] #2 DashboardPageLayout 1280px hard cap on ultrawide** — every analytics/pipeline/reports user on a 27"+ monitor. DashboardPageLayout.tsx:49.
3. **[P1] #3 Pipeline perf grid jumps 3→6 at exactly 1280px** — mid-laptop users resizing or multitasking see violent reflow. pipeline/page.tsx:740.
4. **[P1] #5 Pipeline positions table clips silently at 768-900** — users on iPad won't realize they're missing Stop Loss / Take Profit / Signal. pipeline/page.tsx:441.
5. **[P1] #6 ContextBar 7 cells overflow at 768-1100** — trader sees partial regime + PnL info; silent clip is worse than a scrollbar. ContextBar.tsx:21.
6. **[P1] #4 Analytics 4 charts stay 2-col on 1920+** — quant users lose half their screen to padding. analytics/page.tsx:634,644.
7. **[P2] #7 OrderBar 7 fields flex-nowrap at 1280-1380** — common laptop width; submit button likely clips. OrderBar.tsx:105.
8. **[P2] #9 PriceChartPanel header no-wrap meta cells** — visible every time the desk loads on iPad. PriceChartPanel.tsx:239.
9. **[P2] #10 trade page `100vh` iOS Safari bug** — mobile/tablet Safari users see jumpy layout on scroll. trade/page.tsx:155.
10. **[P2] #8 Desk rail 260px is 34% of 768px viewport** — cramped tablet center column; cosmetic but constant. DeskLayout.tsx:62.

Honorable mentions (not top 10 but worth batch-fixing): #11 Analytics skeleton/body symmetry (low-effort copy-paste); #12 `(dashboard)/loading.tsx` odd `max-w-[1800px]` and mismatched breakpoints; #13 StrategyHero 4-col-from-sm cramped at 768-900 (#11 in report body).

### Fix complexity tiers
- **1-line (≤5 min each):** #3, #4, #7, #10, #11, #14. Most just add an `xl:` or `2xl:` class.
- **Small (15-30 min each):** #5 (scroll hint/gradient), #6 (breakpoint swap), #8, #9 (flex-wrap + meta rearrange).
- **Medium (1-2h):** #1 (grid template redesign), #2 (max-w lift + verify downstream), #13 (sm→md swap across WatchlistPanel).

All fixes are class-level; no TypeScript or store changes required.
