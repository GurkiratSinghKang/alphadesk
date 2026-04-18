# AlphaDesk Mobile Responsive Audit (≤768px, primary 390px iPhone 14)

Scope: `frontend/src/app/(dashboard)/`, `frontend/src/components/composites/`, `frontend/src/components/layouts/`, `frontend/src/components/layout/`, `frontend/src/components/ui/`, `frontend/src/components/dashboard/`, `frontend/src/components/panels/`.

All file paths are absolute. Severity: P0 unusable, P1 degraded/ugly, P2 polish.

---

## P0 — Blockers (unusable at 390px)

### 1. `DeskLayout` hard-codes a 3-column desktop grid with no mobile fallback
**File:** `/Users/GK/Downloads/alphadesk/frontend/src/components/layouts/DeskLayout.tsx:63`
**Broken:** `gridTemplateColumns: "260px 1fr 340px"` is set via inline `style` — Tailwind responsive variants can't override it. At 390px viewport the rail (260) + center (≥0) + right (340) = 600px minimum, forcing horizontal scroll and rendering the dashboard effectively unusable. Combined with `overflow-hidden` on the root (line 49) the overflowing columns are clipped, hiding ~half the UI.
**Fix:** Replace the inline style grid with Tailwind classes supporting a mobile stack and tablet/desktop split:
```tsx
<div className="grid min-h-0 overflow-hidden grid-cols-1 md:grid-cols-[220px_1fr] lg:grid-cols-[260px_1fr_340px] gap-px bg-[var(--border)]">
```
…and render rail/right as collapsible drawers (Sheet) below `md`. The root `h-screen w-full overflow-hidden` also needs `overflow-x-hidden md:overflow-hidden` or the right drawer will cause horizontal scroll.
**Severity:** P0

### 2. `DeskPage` top `TopBar` has no mobile fallback (navigation is invisible)
**File:** `/Users/GK/Downloads/alphadesk/frontend/src/components/composites/TopBar.tsx:32-92`
**Broken:** `h-12 px-5 gap-6` + 5 nav tabs + RegimePill + clock + avatar. On 390px the logo (≈140px) + nav (≈240px) + gap-6×N alone exceed viewport. The nav has **no hamburger**, no `md:hidden`, and no horizontal scroll — so items either clip off-screen or force overflow. The flagship desk page at `/` uses THIS composite, not the other `components/layout/TopBar.tsx` which does have a hamburger.
**Fix:** Rewrite `TopBar` composite to hide the nav below `md`, add a `Sheet`-based hamburger mirroring `components/layout/TopBar.tsx:46-75`. Shrink clock/avatar gap: `gap-2 md:gap-6`, `px-3 md:px-5`. Hide clock below `sm`.
**Severity:** P0

### 3. `ContextBar` 7 metric cells with 22px horizontal padding overflow to ~800px
**File:** `/Users/GK/Downloads/alphadesk/frontend/src/components/composites/ContextBar.tsx:19-86`
**Broken:** `flex items-stretch h-[38px]` with each cell `px-[22px]` (44px total) + two typography lines. Seven cells × ~100px min = ~700-800px width. No `overflow-x-auto`, no `flex-wrap`. On 390px the cells squeeze into unreadable widths or push off-screen.
**Fix:** `className={cn("flex items-stretch h-[38px] overflow-x-auto scrollbar-none md:overflow-visible ...")}` on the wrapper, and shrink cell padding on mobile: `px-3 md:px-[22px]`. Add `shrink-0` to each cell. Also wrap with `data-mobile-scroll` so the `ContextBar` appears as a horizontal pill strip below `md`.
**Severity:** P0

### 4. `OrderBar` has 7 fields in a single flex row — unusable on mobile
**File:** `/Users/GK/Downloads/alphadesk/frontend/src/components/composites/OrderBar.tsx:80-204`
**Broken:** `flex gap-5 items-end px-7 py-4` with Strategy select + Side buttons + Symbol + Qty + Type + Price + Stop + review copy + Stage button. Each input has `min-w-[90px]`. Total minimum ~770px. On 390px this wraps chaotically with review text and the Stage button either pushed below or clipped. Also on desk layout (line 243 `page.tsx`) it sits inside the center column which is already 0px on mobile.
**Fix:** Below `md`: stack fields two-up, hide italic review copy, put Stage button as a sticky bottom bar. Change outer to `flex flex-col gap-3 md:flex-row md:gap-5 md:items-end px-4 md:px-7`. Wrap fields in a `grid grid-cols-2 md:flex md:flex-row gap-2` container. Make `<span data-slot="order-review">` `hidden md:inline`. Make Stage button full-width on mobile: `className="w-full md:w-auto md:ml-auto"`.
**Severity:** P0

### 5. `PriceChartPanel` header uses fixed large fonts with no downscale
**File:** `/Users/GK/Downloads/alphadesk/frontend/src/components/composites/PriceChartPanel.tsx:231-272`
**Broken:** `text-[40px]` for sym-name, `text-[36px]` for price, a 5-cell meta group (Vol/Avg Vol/Range/IV/Regime fit) aligned with `ml-auto` and `flex gap-[18px]`. Header container has `gap-6 px-7 pt-5 pb-3.5` with no `flex-wrap`. On 390px the 40px italic name + 36px price both cost ~200px each, with the 5-cell meta demanding another ~350px. Horizontal overflow, clipped meta cells, unreadable.
**Fix:** Add `flex-wrap` and downscale: `className="flex flex-wrap items-end gap-3 md:gap-6 px-4 md:px-7 pt-4 pb-3.5 border-b border-border-hair"`. Font scales: `text-[28px] md:text-[40px]`, `text-[24px] md:text-[36px]`. Hide meta group below `md` (`hidden md:flex`) and surface it as a horizontally-scrolled strip via `md:ml-auto`.
**Severity:** P0

### 6. Range button row + Legend chips in `PriceChartPanel` overflow
**File:** `/Users/GK/Downloads/alphadesk/frontend/src/components/composites/PriceChartPanel.tsx:274-295`
**Broken:** Eight range buttons (1D/5D/1M/3M/6M/YTD/1Y/ALL) + three legend chips in a `flex justify-between` row. No wrap, no scroll. ~420px minimum.
**Fix:** Add `overflow-x-auto scrollbar-none` to the range container; hide legend chips below `sm` (`hidden sm:flex`). Better: `flex flex-col gap-2 sm:flex-row sm:justify-between sm:items-center`.
**Severity:** P0

### 7. Inputs use `text-[13px]` — triggers iOS zoom on focus
**File:** `/Users/GK/Downloads/alphadesk/frontend/src/components/ui/input.tsx:22`
**Broken:** Base input class uses `font-mono tabular-nums text-[13px]`. iOS Safari auto-zooms any input whose computed font-size is < 16px on focus. Applies to the entire app's inputs (OrderBar, alerts form, settings, etc). The OrderBar is already unusable; on mobile the zoom makes it worse.
**Fix:** `text-[16px] md:text-[13px]` on the Input component base, or add the pattern `text-base md:text-[13px]`. Same fix needed on all native `<input>` elements in `alerts/page.tsx:89,143`, `pipeline/page.tsx:642`, `AICopilot.tsx:299`, `CommandPalette.tsx:234`, `shortcut-overlay.tsx:145`.
**Severity:** P0

### 8. `CommandPalette` max-width is desktop-only; `max-w-xl` inside `Dialog` + `sm:max-w-md` base breaks it
**File:** `/Users/GK/Downloads/alphadesk/frontend/src/components/layout/CommandPalette.tsx:219`, `/Users/GK/Downloads/alphadesk/frontend/src/components/ui/dialog.tsx:59`
**Broken:** `DialogContent` default is `w-full max-w-[calc(100%-2rem)] ... sm:max-w-md`. CommandPalette overrides to `max-w-xl` (576px). On 390px the `sm` breakpoint (≥640px) is NOT hit, so the dialog uses `max-w-[calc(100%-2rem)]` = 358px which is OK, BUT the `[&>button]:hidden` is applied and the Dialog's close button is hidden — if the user can't dismiss via escape (no ⌘K reopen on mobile without keyboard) they're trapped. Also `Command.Input` at `text-sm` is 14px → iOS zoom.
**Fix:** Add a visible close affordance for mobile: render an explicit close button inside the palette header for `sm:hidden`. Change `Command.Input` to `text-base md:text-sm`. Confirm the dialog actually takes full screen height at mobile: add `max-h-[90vh] flex flex-col` to `DialogContent` when rendering the palette.
**Severity:** P0

### 9. `AICopilot` sidebar is hard-coded 400px wide — exceeds 390px viewport
**File:** `/Users/GK/Downloads/alphadesk/frontend/src/components/layout/AICopilot.tsx:162`
**Broken:** `w-[400px]` fixed width; on 390px iPhone viewport this panel is wider than the screen and gets clipped by 10px on the left, losing the border and close-button context. Slide-in animation `translate-x-full` → `translate-x-0` works but the opened state is still >100vw.
**Fix:** `w-full sm:w-[400px] max-w-[100vw]` and use `right-0 left-0 sm:left-auto` for mobile full-width behaviour. Internal input `text-xs` (line 299) → iOS zoom; raise to `text-base sm:text-xs`.
**Severity:** P0

### 10. `NotificationCenter` popover is `w-96` (384px) — nearly edge-to-edge, risks clipping
**File:** `/Users/GK/Downloads/alphadesk/frontend/src/components/layout/NotificationCenter.tsx:133`
**Broken:** `PopoverContent` is `w-96` = 384px. Fine in isolation but anchored to `align="end"` from an `h-8 w-8` button in the top bar. With `side="bottom"` it renders starting from the right edge; on a 390px screen the popover extends 384px leftward, covering almost the entire viewport — which also leaves no touch target for dismissal by tapping outside. Notifications content below, clipped text "Clear all", tabs row overflow.
**Fix:** `w-[calc(100vw-1rem)] max-w-96` so it fits the viewport, and `side="bottom" align="end" sideOffset={4}`.
**Severity:** P0

### 11. Pipeline Positions table has 10 columns at `text-[11px]` with `whitespace-nowrap`
**File:** `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/pipeline/page.tsx:440-522`
**Broken:** Table renders 10 columns (Symbol, Shares, Entry, Current, P&L $, P&L %, Stop Loss, Take Profit, Entry Date, Signal). `<Table>` wrapper already has `overflow-x-auto` (good), but the P&L % / P&L $ columns use `text-xs tabular-nums` with no min-width hints, and the Stop Loss cell mixes icon + text inline. On 390px the table becomes a 1200px horizontal scroll area with each cell just a few pixels wide at natural flow — readable only after scrolling the table right, which users won't discover.
**Fix:** Wrap card in `overflow-x-auto` at the card level (`Card` is already there via Table), but ALSO render a mobile-only card list below `md:hidden` using stacked position cards. Add `className="min-w-[900px]"` to the inner `<table>` so the scroll container engages correctly.
**Severity:** P0

### 12. Pipeline `PipelineFlow` stage cards overflow on mobile
**File:** `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/pipeline/page.tsx:92-129`
**Broken:** `flex items-center justify-between gap-2` with 4 stage cards separated by arrow spans, each `flex-1`. Inside each card: `text-lg font-bold` (18px) + label. Labels like "Screened"/"Analyzed" wrap unpredictably at narrow widths. The arrows `→` have `shrink-0` but take up width that squeezes the cards.
**Fix:** Below `sm` render vertically: `flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2`. Replace arrow spans with vertical chevron on mobile: conditionally render `<span className="hidden sm:inline">→</span>` and a down-arrow in the mobile stack.
**Severity:** P0

---

## P1 — Degraded / ugly

### 13. `AIMemoPanel` uses `text-[15px]` italic serif body but no padding downscale
**File:** `/Users/GK/Downloads/alphadesk/frontend/src/components/composites/AIMemoPanel.tsx:39-87`
**Broken:** `px-[18px] py-[18px]` with `text-[15px]` leading 1.4 is OK typographically. But on 390px the footer row has `Confidence 0.XX` on left and "model · 123 ms" on right in a `flex justify-between` — the model ID can be long (claude-3-opus-20240229), which will cause overflow.
**Fix:** `flex-wrap` on footer, truncate model name: `<span className="truncate max-w-[60%]">`. Consider stacking below `sm`.
**Severity:** P1

### 14. `PositionsList` uses fixed grid columns `[60px_1fr_auto]` with small touch targets
**File:** `/Users/GK/Downloads/alphadesk/frontend/src/components/composites/PositionsList.tsx:86-134`
**Broken:** Row is `grid grid-cols-[60px_1fr_auto] gap-2.5 items-center px-[18px] py-2.5`. The symbol button (line 88-99) has `text-[12.5px]`, entry info at `text-[9.5px]` — unreadable on mobile. Tab buttons (lines 53-73) are `px-2 py-[3px]` which is ~15×20px — far below 44×44 iOS touch target.
**Fix:** Tab buttons: `px-3 py-2 min-h-[44px] sm:px-2 sm:py-[3px] sm:min-h-0`. Row symbol label: `text-sm md:text-[12.5px]`, entry `text-[11px] md:text-[9.5px]`. Increase row padding on mobile: `py-3 md:py-2.5`.
**Severity:** P1

### 15. `StrategyRail` items have `py-3` rows but the left border is invisibly thin
**File:** `/Users/GK/Downloads/alphadesk/frontend/src/components/composites/StrategyRail.tsx:67-73`
**Broken:** Row button `w-full text-left px-4 py-3 border-l-2`. On mobile the 2px left border becomes hard to see and the 12.5px/11.5px/10.5px nested text scale makes items unreadable at touch distances. No hover state on touch devices.
**Fix:** Increase mobile text: `text-sm md:text-[12.5px]` for name, etc. Add `min-h-[56px]` for tap ergonomics. Add `active:bg-bg-elev-1` for tap feedback.
**Severity:** P1

### 16. `StatusBar` at `h-[22px]` is too short for readable text, and pills overflow
**File:** `/Users/GK/Downloads/alphadesk/frontend/src/components/composites/StatusBar.tsx:42-78`
**Broken:** 22px row with 4 pills + Build version + ⌘K kbd + "Commands" label. ~310px minimum. At 390px with padding `px-5 gap-[18px]` it fits but clips the 4th pill. Also the "⌘K" hint is irrelevant on touch devices.
**Fix:** Hide `⌘K` and "Commands" below `md`: add `hidden md:inline-flex` wrappers. Reduce gap to `gap-2 md:gap-[18px]` and `px-3 md:px-5`. Consider `overflow-x-auto scrollbar-none` with pill `shrink-0`.
**Severity:** P1

### 17. `MarketingShell` footer uses 4-col grid that stacks only at `sm` but logo block is 36px
**File:** `/Users/GK/Downloads/alphadesk/frontend/src/components/layouts/MarketingShell.tsx:134-188`
**Broken:** `grid grid-cols-1 gap-10 border-t border-border pt-20 pb-10 sm:grid-cols-[2fr_1fr_1fr_1fr]`. OK above `sm` (640px). BUT: logo is `text-[36px]` and `px-6 sm:px-8 lg:px-12` means 24px side padding on 390px, leaving 342px — so the 36px logo + tagline at `text-[16px]` fits but looks heavy. Sign-in link + Request-access button in top nav sit on a single line with logo — no hamburger. Below `sm` the nav links are `hidden sm:flex` so links disappear entirely.
**Fix:** Add a hamburger sheet below `sm` for nav links. Downsize hero logo on mobile: `text-[28px] sm:text-[36px]`. Ensure pt-20 shrinks: `pt-12 sm:pt-20`.
**Severity:** P1

### 18. `DashboardPageLayout` uses `px-6 py-8` and `max-w-[1280px]` — edges too close on 390px
**File:** `/Users/GK/Downloads/alphadesk/frontend/src/components/layouts/DashboardPageLayout.tsx:49`
**Broken:** 24px horizontal padding is OK but the header uses `Display size="md"` which via `--fs-display-md: clamp(32px, 4vw, 52px)` resolves to 32px at 390px. That's fine. But the `actions` slot (line 60) is `flex items-center gap-2` — on `/alerts` with 3 actions (count, clear triggered, delete-all), this overflows the flex-wrap parent and breaks the header layout. Also applies to pipeline-page actions (status dot + timestamp + templates + risk-monitor + Run Now → ~500px).
**Fix:** Ensure `flex-wrap` is always set (already there on line 53). But the header layout is `flex flex-wrap items-end justify-between gap-4` — actions end up BELOW the title at mobile, which is fine; however the actions themselves don't wrap nicely. Wrap with `w-full sm:w-auto flex flex-wrap gap-2`.
**Severity:** P1

### 19. `Alerts` create form uses `grid-cols-1 sm:grid-cols-4` — works, but symbol input has `text-sm` only (no iOS-zoom safe)
**File:** `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/alerts/page.tsx:78,83-90,135-144`
**Broken:** Form at 390px stacks 4 rows (symbol, condition, price, submit). Individual inputs are `h-9 ... text-sm` (line 89) — computed font size 14px, iOS zooms. The "Delete All" confirm popover (line 361) has `min-w-[240px]` and is absolutely positioned `right-0 top-full` — on mobile this extends off-screen or clips.
**Fix:** `text-base sm:text-sm` on input classes. Popover: `min-w-[calc(100vw-2rem)] max-w-[280px] right-0`. Alert row (line 181-256) uses fixed `w-16/w-20/w-24` columns + flex-1 date — horizontal overflow. Wrap in `overflow-x-auto` or switch to stacked card rows below `md`.
**Severity:** P1

### 20. `AlertRow` has 7 inline columns all with fixed widths — forces horizontal scroll
**File:** `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/alerts/page.tsx:182-256`
**Broken:** `flex items-center gap-3 px-4 py-3`: status icon (w-auto) + symbol (w-16) + condition (w-20) + target (w-24) + status (w-20) + date (flex-1, truncate) + delete button. Total min ~320px + gap-3×6 = 338px, fits at 390px with date truncated. But column headers (lines 432-442) are separate divs with matching widths — any text growth breaks visual alignment on touch scroll.
**Fix:** Below `md` hide column headers (`hidden md:flex`) and render stacked card rows.
**Severity:** P1

### 21. Reports page renders 10+ tables with `overflow-x-auto` wrappers but fixed-width columns
**File:** `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/reports/page.tsx:193-259,343-387,523-555`
**Broken:** Positions + Closed trades + Strategy performance + Tax trades tables. Each wrapped in `overflow-x-auto` (correct), but column widths let the tables shrink to unreadable widths because `text-xs` (12px) cells + tabular-nums cause tight packing. Rows with `whitespace-normal` on Symbol could overflow vertically. CSV Download buttons at `size="sm" ... gap-1.5` are `h-7` (28px) — touch-target too small.
**Fix:** Ensure inner tables have `min-w-[520px]` to force scroll. Download buttons should be `size="sm" h-9 sm:h-7` and `w-full sm:w-auto`.
**Severity:** P1

### 22. Analytics page SVG charts use fixed viewBox `0 0 600 200` — readable but labels tiny at 390px
**File:** `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/analytics/page.tsx:193-332`
**Broken:** SVGs are `className="w-full" preserveAspectRatio="xMidYMid meet"`, which means at 390px the 600-unit viewBox compresses to 390px, making the 8-9pt axis labels ~5pt in CSS — illegible. The axis text `fontSize="9"` and "8" assumes a 600px rendered width.
**Fix:** Lift font sizes proportionally for small viewports, or render only 2 y-ticks instead of 3 below `sm`. Simplest: increase fontSize to 11-12 for labels (since they're aspect-scaled anyway). Also wrap `<svg>` in `overflow-x-auto` with `min-width: 320px` so wide charts can scroll.
**Severity:** P1

### 23. Analytics `MonthlyHeatmap` is a 13-column table (Year + 12 months + YTD) — forced horizontal scroll OK but cells unreadable
**File:** `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/analytics/page.tsx:358-409`
**Broken:** Wrapped in `overflow-x-auto` (good). Cells at `text-[10px]` with `px-1 py-1` are about 35px wide — but the table renders `w-full` meaning it tries to fit 14 columns in 390px = 28px each. Values like `+12.3%` cannot fit at 10px font in 28px cells.
**Fix:** Apply `min-w-[700px]` to the inner `<table>` so the scroll container becomes the intended UX.
**Severity:** P1

### 24. `OnboardingTour` tooltip `w-80` (320px) positioned absolutely via `getTooltipStyle()` — can overflow viewport on 390px
**File:** `/Users/GK/Downloads/alphadesk/frontend/src/components/layout/OnboardingTour.tsx:252`
**Broken:** `w-80` = 320px. On 390px the tour tooltip can clip if the computed position has less than 35px horizontal slack. The `absolute` positioning via `getTooltipStyle()` doesn't clamp.
**Fix:** `w-[calc(100vw-2rem)] max-w-80`. Also set `left: Math.max(16, Math.min(pos.left, window.innerWidth - 336))` in `getTooltipStyle()`.
**Severity:** P1

### 25. `ShortcutOverlay` grid `grid-cols-2` at 390px squeezes shortcut rows unusably
**File:** `/Users/GK/Downloads/alphadesk/frontend/src/components/ui/shortcut-overlay.tsx:158`
**Broken:** `grid grid-cols-2 gap-6` doesn't have responsive variants. At 390px with `px-6` (24px each side) each column has ~145px for `kbd` + description — key labels like "Cmd+Shift+P" break onto two lines. The whole overlay is `max-w-[640px]` which equals viewport at 390px so it fills — but the two-column grid is the problem.
**Fix:** `grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6`.
**Severity:** P1

### 26. Pipeline `Performance Summary` has 6 cards via `grid-cols-2 md:grid-cols-3 xl:grid-cols-6`
**File:** `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/pipeline/page.tsx:717`
**Broken:** At 390px it's 2 columns of 3 rows, which fits — but each card has `p-4 text-center` with `text-lg` stat (18px) + label. The "Worst Trade" / "Best Trade" cards include a symbol underneath at `text-[10px]` — readable but the card itself is about 170px wide, which is OK. The issue is the card uses `CardContent p-4` which has 16px internal padding, and the accented `h-0.5 bg-gradient-*` (line 719) is rendered above the padding — visually acceptable.
**Fix:** Reduce mobile padding: `<CardContent className="p-3 sm:p-4 text-center">`. Accept the 2-col layout.
**Severity:** P1

### 27. `MorningBrief` uses `grid-cols-1 md:grid-cols-3 gap-4 mb-4` — fine, but header inside has `h-8 w-8` icon + multiline title
**File:** `/Users/GK/Downloads/alphadesk/frontend/src/components/dashboard/MorningBrief.tsx:127-145`
**Broken:** Header row is `flex items-start justify-between mb-4`. The greeting title + date + market status can wrap when narrow; the dismiss X button (line 147-153) uses `p-1` — ~24×24px, below touch target.
**Fix:** Dismiss button: `p-2 min-h-[44px] min-w-[44px] sm:p-1 sm:min-h-0 sm:min-w-0`.
**Severity:** P1

### 28. `StrategyCard` composite has `p-4` with 30px mono return and 200×28 sparkline
**File:** `/Users/GK/Downloads/alphadesk/frontend/src/components/composites/StrategyCard.tsx:98-101`
**Broken:** `<Sparkline ... width={200} height={28}>` is hard-coded 200px wide — the `className="h-7"` makes it vertically responsive but width is fixed. At 390px inside a `p-4` padding = 358px for the card but then the sparkline is stuck at 200px, leaving whitespace on the right. The return value `text-[30px]` doesn't scale down, and the "open →" hover affordance is invisible on touch.
**Fix:** Pass `width` as 100% of container: switch to SVG `preserveAspectRatio="none"` and `className="w-full h-7"`, remove hardcoded 200. Scale return: `text-[24px] sm:text-[30px]`. Replace the hover-revealed "open →" with an always-visible right chevron on mobile.
**Severity:** P1

---

## P2 — Polish

### 29. Button `sm` size is `h-[26px]` — half the iOS touch target
**File:** `/Users/GK/Downloads/alphadesk/frontend/src/components/ui/button.tsx:55`
**Broken:** Button sizes: `sm: h-[26px]`, default `h-[34px]`, `xs: h-6`, `icon-xs: size-6`, `icon-sm: size-[30px]`. None reach the iOS HIG 44px minimum. Many callers use `size="sm"` (header actions) or `size="icon"` — on touch devices each tap is frustrating. Not a layout blocker but degrades usability.
**Fix:** Add a responsive mobile default: `default: h-[44px] md:h-[34px]`, `sm: h-[38px] md:h-[26px]`. Or introduce a new `size="sm-touch"` and audit callers that should use it (alerts-page clear/delete, settings export buttons, notification X).
**Severity:** P2

### 30. `TickerTape` marquee never stops and has no `prefers-reduced-motion` respect
**File:** `/Users/GK/Downloads/alphadesk/frontend/src/components/layout/TickerTape.tsx:34`
**Broken:** `animate-marquee` runs constantly with no pause, no reduce-motion handling, no hover-pause. Competing `TickerStrip` composite (composites/TickerStrip.tsx:72-76) does handle `prefers-reduced-motion`. Consistency: the dashboard ticker tape should match.
**Fix:** Add reduce-motion media query to pause the marquee; add `hover:pause` + `touch-pause` via JS state for mobile. This is more an a11y issue than mobile layout.
**Severity:** P2

### 31. `StatusStrip` has `overflow-x-auto` and hides Regime/VIX at md/lg — good, but P&L section can be very long
**File:** `/Users/GK/Downloads/alphadesk/frontend/src/components/layout/StatusStrip.tsx:34-82`
**Broken:** At 390px the P&L chip `+$1,234,567.89 (+12.34%)` is >180px. With `overflow-x-auto` it scrolls, but the user has no cue to scroll. `scrollbar-none` hides the thumb.
**Fix:** Add a right-edge gradient fade to hint scrollability: `after:content-[''] after:absolute after:right-0 after:top-0 after:bottom-0 after:w-8 after:bg-gradient-to-l after:from-bg after:to-transparent sm:after:hidden`.
**Severity:** P2

### 32. `login/page.tsx` uses `px-12 py-12` — 48px padding on mobile is excessive
**File:** `/Users/GK/Downloads/alphadesk/frontend/src/app/login/page.tsx:28`
**Broken:** 48px horizontal padding on a 390px screen leaves 294px for content. The `Display size="lg"` renders at 44-80px clamp which at 390px is ~44px and still feels cramped.
**Fix:** `px-6 sm:px-8 lg:px-12 py-8 sm:py-12`.
**Severity:** P2

### 33. Settings page — trading mode switch is `h-6 w-11` and toggle knob `h-4 w-4` — small touch target
**File:** `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/settings/page.tsx:350-363`
**Broken:** Critical live-trading toggle is only 24px tall. Accidental taps risk going live. Touch target below the 44pt minimum.
**Fix:** `h-7 w-12 sm:h-6 sm:w-11`, knob `h-5 w-5 sm:h-4 sm:w-4`. Also add a confirmation step when switching to LIVE.
**Severity:** P2 (verging on P1 given the risk)

### 34. `EditorialNameplate` `flex-wrap` works, but 32px logo + multiple separators dominates narrow widths
**File:** `/Users/GK/Downloads/alphadesk/frontend/src/components/composites/EditorialNameplate.tsx:40-90`
**Broken:** `text-[32px]` wordmark + 3 italic `·` separators + uppercase Vol/Issue + title + date. At 390px with `gap-4` and flex-wrap, elements wrap unpredictably. Date with `ml-auto` at the end may be on a different line and misaligned.
**Fix:** Downscale: `text-[22px] sm:text-[32px]` for wordmark; hide Vol/Issue spans below `sm` (`hidden sm:inline`). Force date below rest on mobile: `w-full sm:w-auto sm:ml-auto`.
**Severity:** P2

### 35. `Dialog` base `max-w-[calc(100%-2rem)]` + `sm:max-w-md` — good, but only 1rem (16px) side margin at mobile
**File:** `/Users/GK/Downloads/alphadesk/frontend/src/components/ui/dialog.tsx:59`
**Broken:** 16px side gap means 358px content width at 390px. Decent. BUT the inner `p-5` = 20px padding each side only leaves 318px for actual content — dialogs with form rows or long labels will feel cramped.
**Fix:** Reduce inner padding for mobile: `p-4 sm:p-5` on the DialogContent base class. Consider `gap-3 sm:gap-4` instead of `gap-4`.
**Severity:** P2

### 36. `DialogFooter` close button uses `flex-col-reverse` — stacks primary action BELOW cancel on mobile
**File:** `/Users/GK/Downloads/alphadesk/frontend/src/components/ui/dialog.tsx:109-115`
**Broken:** `-mx-5 -mb-5 flex flex-col-reverse gap-2 ... sm:flex-row sm:justify-end`. On mobile this reverses children, putting the primary action ABOVE the cancel — good UX convention. But with negative margins `-mx-5 -mb-5` the footer extends beyond the dialog edge, which works when dialog also has `p-5`, but with `-mx-5` on a `sm:max-w-md` dialog at 390px the footer touches the viewport edge. Cosmetic.
**Fix:** Verify at 390px; if footer clips, switch to `-mx-4 sm:-mx-5`.
**Severity:** P2

### 37. `(dashboard)/loading.tsx` skeleton uses `max-w-[1800px] mx-auto p-6` but grid stacks `grid-cols-1`
**File:** `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/loading.tsx:1-18`
**Broken:** Minor — padding is 24px which is fine. The 200px/320px skeleton heights look OK at 390px. No actual bug; just note the skeleton shape doesn't match the new `DeskLayout` (it mimics the pre-F3 chrome), so during hydration on desk route the user sees a different layout than what renders — jarring.
**Fix:** Either ensure `(dashboard)/loading.tsx` is never used for the desk route, or give the desk route its own `loading.tsx` that matches the 4-row shell.
**Severity:** P2

### 38. `ShareTrade` share card is `w-[420px]` fixed — doesn't fit 390px viewport
**File:** `/Users/GK/Downloads/alphadesk/frontend/src/components/panels/ShareTrade.tsx:81`
**Broken:** ShareCard component is hard-coded 420px to preserve aspect ratio for the generated image. Inside a `DialogContent className="max-w-[480px]"` (line 460) which on 390px becomes `max-w-[calc(100%-2rem)]` = 358px. The 420px card inside a 358px dialog overflows by 62px horizontally — the preview is clipped.
**Fix:** Either scale the preview with `transform: scale(0.83)` on mobile, or provide a narrower share card variant for mobile. Add overflow: `<div className="overflow-x-auto">` around the card.
**Severity:** P2

### 39. Multi-timeframe panel uses `grid-cols-2 grid-rows-2 gap-1.5` — 4 charts on a 390px screen is unreadable
**File:** `/Users/GK/Downloads/alphadesk/frontend/src/components/panels/MultiTimeframe.tsx:227`
**Broken:** 4-up chart grid at 390px gives ~190px per chart — each chart is a TradingView-style line at tiny dimensions, no axis labels visible.
**Fix:** Stack below `md`: `grid grid-cols-1 md:grid-cols-2 md:grid-rows-2 gap-2`.
**Severity:** P2

### 40. `PortfolioHero` period pills use `px-2 py-0.5 text-[10px]` — tap-friendly below standard
**File:** `/Users/GK/Downloads/alphadesk/frontend/src/components/dashboard/PortfolioHero.tsx:187-200`
**Broken:** Period pills (1W/1M/3M/YTD) are ~40×18px. Far below touch target. Also the hero header uses `flex items-center justify-between` — on 390px the left "Portfolio / Day P&L" stack + the right "Pills + ExportButton" stack can compress or wrap.
**Fix:** Period pills `px-3 py-2 text-xs sm:px-2 sm:py-0.5 sm:text-[10px]`. Header layout: `flex flex-wrap items-center justify-between gap-y-3`.
**Severity:** P2

---

## Summary by file (quick reference)

| File | P0 | P1 | P2 |
|------|----|----|----|
| `components/layouts/DeskLayout.tsx` | 1 | - | - |
| `components/composites/TopBar.tsx` | 1 | - | - |
| `components/composites/ContextBar.tsx` | 1 | - | - |
| `components/composites/OrderBar.tsx` | 1 | - | - |
| `components/composites/PriceChartPanel.tsx` | 2 | - | - |
| `components/composites/StatusBar.tsx` | - | 1 | - |
| `components/composites/PositionsList.tsx` | - | 1 | - |
| `components/composites/StrategyRail.tsx` | - | 1 | - |
| `components/composites/AIMemoPanel.tsx` | - | 1 | - |
| `components/composites/StrategyCard.tsx` | - | 1 | - |
| `components/composites/EditorialNameplate.tsx` | - | - | 1 |
| `components/ui/input.tsx` | 1 | - | - |
| `components/ui/dialog.tsx` | - | - | 2 |
| `components/ui/button.tsx` | - | - | 1 |
| `components/ui/shortcut-overlay.tsx` | - | 1 | - |
| `components/layout/CommandPalette.tsx` | 1 | - | - |
| `components/layout/AICopilot.tsx` | 1 | - | - |
| `components/layout/NotificationCenter.tsx` | 1 | - | - |
| `components/layout/OnboardingTour.tsx` | - | 1 | - |
| `components/layout/StatusStrip.tsx` | - | - | 1 |
| `components/layout/TickerTape.tsx` | - | - | 1 |
| `components/layouts/MarketingShell.tsx` | - | 1 | - |
| `components/layouts/DashboardPageLayout.tsx` | - | 1 | - |
| `app/(dashboard)/pipeline/page.tsx` | 2 | 1 | - |
| `app/(dashboard)/alerts/page.tsx` | - | 2 | - |
| `app/(dashboard)/reports/page.tsx` | - | 1 | - |
| `app/(dashboard)/analytics/page.tsx` | - | 2 | - |
| `app/(dashboard)/settings/page.tsx` | - | - | 1 |
| `app/login/page.tsx` | - | - | 1 |
| `app/(dashboard)/loading.tsx` | - | - | 1 |
| `components/panels/ShareTrade.tsx` | - | - | 1 |
| `components/panels/MultiTimeframe.tsx` | - | - | 1 |
| `components/dashboard/MorningBrief.tsx` | - | 1 | - |
| `components/dashboard/PortfolioHero.tsx` | - | - | 1 |

**Totals: 12 P0 · 16 P1 · 12 P2 = 40 findings.**

## Recommended fix order

1. **DeskLayout grid** (#1) — single change unblocks every other desk-page concern. Introduce a mobile fallback that hides the rail and right column in drawers.
2. **Input zoom** (#7) — global fix; one change in `input.tsx` + a handful of native `<input>` elements.
3. **TopBar** (#2) — replace the composite at `/` with the layout-version that has a hamburger, OR add a hamburger to the composite.
4. **ContextBar / OrderBar / PriceChartPanel** (#3, #4, #5, #6) — desk is useless without these.
5. **Dialogs + palettes** (#8, #9, #10) — modal UX is broken everywhere.
6. **Pipeline table + stages** (#11, #12) — largest `/pipeline` regressions.
7. Everything else can be polish iterations.
