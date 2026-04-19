# Persona 47 — 5K Ultrawide Monitor Audit (5120x2880)

Scope: layout containers across `DeskLayout`, `DashboardPageLayout`, all
`(dashboard)` routes, and chrome primitives (`TopBar`, `StatusStrip`,
`TickerTape`). Target viewport 5120px wide (Apple Studio Display, LG UltraFine 5K,
iMac 5K). For context: the Wave 24 lift (viewport audit r5 #2) took
`DashboardPageLayout` from 1280 -> 1480 with a `2xl:max-w-[1680px]` step — that
was calibrated for 2560px 4K, not 5K.

At 5120px, a 1680px container centers with ~1720px of dead margin on each
side — 67% of pixels are background. The desk route itself fluid-grids fine,
but every other route lands on wasted whitespace, and several chrome
primitives over-stretch edge to edge.

Tailwind 2xl breakpoint is 1536px — nothing in the codebase targets a `3xl`
or `[min-width:2560px]` tier, so there is no escape hatch above 1680.

## Top 10 findings (summary, ~250 words)

### 1. `DashboardPageLayout` 1680px cap wastes 67% of a 5K viewport [P0]
`DashboardPageLayout.tsx:52` — `max-w-[1480px] 2xl:max-w-[1680px]`. At 5120px
the content column is a 1680px ribbon with 1720px of margin per side. The
Wave 24 fix solved 1920/2560, not 5K. Add a `[min-width:2560px]:max-w-[2400px]`
or `[min-width:3200px]:max-w-[2800px]` tier. Affects `/analytics`, `/pipeline`,
`/reports`, `/alerts`, `/settings`, `/strategies/[id]` — six routes.

### 2. Desk route (`/`) fluid grid works, but right column is under-sized [P1]
`DeskLayout.tsx:70` — `lg:grid-cols-[260px_1fr_340px]`. On 5K the 1fr center
column balloons to ~4520px while positions stay locked at 340px. A PnL number
looks lost in a 4km chart cell. Add a `2xl:grid-cols-[300px_1fr_420px]` or
`[min-width:2560px]:grid-cols-[320px_1fr_480px]` tier so rail + positions
scale with viewport.

### 3. `/trade` page has zero max-width — stretches 5120px edge to edge [P0]
`trade/page.tsx:159` — `flex flex-col gap-4 p-4 md:p-6` (no container wrap).
`PriceChartPanel` and `OrderBar` sit in `w-full` sections. At 5K the chart
stretches ~5088px, and the 6-field OrderBar gets ~850px per field. Awkward.
Wrap in `mx-auto max-w-[1680px] 2xl:max-w-[2400px]` like DashboardPageLayout.

### 4. `(dashboard)/loading.tsx` caps at 1800 — narrower than the page it replaces [P2]
`loading.tsx:10` — `max-w-[1800px]`. The skeleton is 120px wider than the
shipped page (1680), so the content visibly re-centers + shrinks on hydration.
Drop to 1680 to match, or lift both together.

### 5. `/strategies/[id]` stuck at 1280px — not yet migrated to DashboardPageLayout [P0]
`strategies/[id]/page.tsx:448,485,573` — three literal
`mx-auto flex w-full max-w-[1280px] flex-col gap-6 px-6 py-8`. The Wave 24 lift
never reached this page. On 5K, strategy detail shows a 1280 ribbon —
3840px dead margin. Migrate to `<DashboardPageLayout>` or hand-lift each instance.

### 6. Analytics 4-col grid already `2xl:grid-cols-4` — but cell width explodes [P1]
`analytics/page.tsx:704,714`. At 5K within a 1680 container, 4 cells split
~410px each (fine). But if #1 lifts to 2400, no rule bumps to `3xl:grid-cols-6`
or `3xl:grid-cols-8`. Charts become low-density rectangles. Pair any container
widening with a higher grid tier.

### 7. Pipeline 6-col card row tops out at `xl:grid-cols-6` [P1]
`pipeline/page.tsx:1122` — `grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6`.
No 2xl/3xl step. At 1680 wide, six cards = ~260px each (good). At 2400 post-lift,
six cards = ~385px each (sparse). Add `2xl:grid-cols-8`.

### 8. `TopBar` header stretches 5120px edge to edge [P2]
`TopBar.tsx` — outer `<header>` has no `max-w`. Search input caps at `max-w-[480px]`
(line 104), but logo/nav left cluster and notification/profile right cluster
fly apart by ~4500px on 5K. Feels broken — user's eyes cannot track logo ->
profile. Wrap inner row in `mx-auto max-w-[1680px]` or match DeskLayout's cap.

### 9. `StatusStrip` footer strip same issue as TopBar [P2]
`StatusStrip.tsx:34` — `flex h-7 shrink-0 items-center ... px-4`. No container.
P&L pill sits far left, WS status far right with ~4800px of dead bar. Same fix:
inner `mx-auto max-w-[1680px]` wrap.

### 10. `TickerTape` scroll speed calibrated for 1920 — appears static at 5K [P3]
`TickerTape` (layout) uses CSS keyframes `translateX(-100%)` at a fixed duration.
On 5K the tape travels 2.6x farther for the same ms budget, so visually it
crawls. Either duration-scale by viewport width or lock to a fixed px/s via JS.
Low severity — cosmetic.

## Summary (~250 words)

The desk (`/`) scales acceptably to 5K because `DeskLayout` uses a fluid
`260px / 1fr / 340px` grid with no outer max-width — the center chart fills
the viewport natively. Two caveats: the right column stays frozen at 340px
while the center balloons to ~4500px (lopsided), and `TopBar` + `StatusStrip`
also lack caps so their left/right clusters fly apart across a near-empty 5K
strip. None of these break the desk, but they make it feel unanchored.

Every **non-desk** route fares worse. `DashboardPageLayout`'s 1480/1680 cap
(Wave 24) was calibrated against 2560px ultrawides, not 5K — on a 5120px
display it wastes 67% of horizontal pixels to margin. Six routes inherit this
(`/analytics`, `/pipeline`, `/reports`, `/alerts`, `/settings`, plus indirectly
`/strategies/[id]` which is still on an **un-migrated** 1280px cap from
before Wave 24). `/trade` has the opposite pathology — no container at all,
so the chart and order bar stretch edge to edge and order fields get 850px
each.

Tailwind's `2xl` breakpoint (1536) is the tallest tier in use; nothing targets
2560+/3200+. Recommend: add a `3xl` custom screen at 2560, bump
`DashboardPageLayout` to `3xl:max-w-[2400px]`, pair with `3xl:grid-cols-{6,8}`
for the pipeline/analytics grids, wrap `/trade`, `TopBar`, `StatusStrip` in
matching caps, and migrate `/strategies/[id]` to `DashboardPageLayout`.
Without these, the desk does not use 5K space — it centers an iPad-sized
column in a sea of void.
