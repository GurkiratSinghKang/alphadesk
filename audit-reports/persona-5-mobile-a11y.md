# Persona 5 — Mobile + A11y Commute User

Walk-through as a mobile-primary (iPhone 14, 390px) AlphaDesk user who occasionally uses iPad (768-1024px) and VoiceOver. Read each file mentally at 390px. All paths absolute. Harness reference: `/Users/GK/Downloads/alphadesk/qa/runs/2026-04-19T02-54-35Z/` (most recent).

Severity: P0 = would abandon the app; P1 = painful but usable; P2 = polish.

---

## 1. Landing at `/` on a 390px iPhone

**File:** `/Users/GK/Downloads/alphadesk/frontend/src/components/layouts/DeskLayout.tsx:62-72`

Works — I have a 1-col at base, 2-col at md, 3-col at lg. Right aside is wired `md:col-span-2 md:row-start-2` so positions/memo stack below the chart at 768-1023. The shell root uses `min-h-screen md:h-screen` plus `overflow-x-hidden` which is correct for mobile (no viewport-locked height trap, no horizontal scroll). `<main id="main-content">` landmark is emitted.

BUT: **the rail is `hidden md:block`** (line 76). At 390px the StrategyRail is completely invisible. There is no Sheet affordance to open it, no button, no route. A user who wants to switch strategies on mobile has zero path from the desk.

**Impact:** P0 for the mobile trader. The desk page loses 1/3 of its functionality on phone.

**Fix:** Add a rail-drawer trigger in the composite TopBar's mobile hamburger menu — or surface the strategies as their own nav item (see #3 below).

---

## 2. Scrolling around the desk

**ContextBar:** `/Users/GK/Downloads/alphadesk/frontend/src/components/composites/ContextBar.tsx:24-30` — now uses `overflow-x-auto lg:overflow-visible snap-x snap-mandatory` with `shrink-0` cells and `px-3 md:px-[22px]` padding. 7 cells scroll horizontally with snap. Correct. Still has `bg-ink-100` but no right-edge gradient cue — traders won't see that it extends past the visible edge.

**PriceChartPanel:** `/Users/GK/Downloads/alphadesk/frontend/src/components/composites/PriceChartPanel.tsx:244` — header has `flex-wrap`, meta cells also `flex-wrap`. Good — they re-flow to a second line on mobile. BUT the hero uses `text-[40px]` symbol + `text-[36px]` price with NO downscale — these two elements alone consume ~280px before meta wraps. Range row at line 287 also not wrapped: 8 range buttons on one row will overflow at 390px once you subtract px-7 (28px × 2) padding.

**OrderBar:** `/Users/GK/Downloads/alphadesk/frontend/src/components/composites/OrderBar.tsx:104-110` — now renders as `grid grid-cols-2 gap-3` on mobile, `md:flex md:flex-row md:flex-wrap xl:flex-nowrap` above. 7 fields stack 2-up, Stage button full-width `col-span-2`. Fields are 44px tall on mobile (`h-11 md:h-9`). Correct.

---

## 3. Trying to click on a strategy

The **desk composite `NAV_ROUTES`** (`/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/page.tsx:57-63`) includes `{ label: "Strategies", href: "/strategies/momentum-quality" }`. The composite TopBar renders these inside its own Sheet (`/Users/GK/Downloads/alphadesk/frontend/src/components/composites/TopBar.tsx:80-100`) which IS visible on mobile.

However on any NON-desk route, the layout falls back to the `components/layout/TopBar.tsx` chrome. That TopBar's `navItems` array (line 33-40) has: Dashboard, Trade, Analytics, Alerts, Pipeline, Reports. **NO Strategies entry.** So once a user clicks into any dashboard route, there is no strategies link anywhere in the nav. The only path back is typing a URL.

Also the strategies listing page `/strategies/` does not exist — there's only `/strategies/[id]/`. If the user taps "Strategies" from the desk TopBar, they land on `/strategies/momentum-quality` (one specific strategy), not a browsable list.

**Impact:** P0 — mobile users have no strategy discovery.

**Fix:** Add a Strategies entry to `/Users/GK/Downloads/alphadesk/frontend/src/components/layout/TopBar.tsx:33-40` pointing to a new `/strategies` listing page, or reuse the rail by rendering it in a mobile drawer.

---

## 4. TickerTape readability

**File:** `/Users/GK/Downloads/alphadesk/frontend/src/components/layout/TickerTape.tsx:32-40`

Fixed: `role="region"` + `aria-live="off"` (not deprecated `role="marquee"`). Readable — 11px text, tabular-nums. BUT: still missing `prefers-reduced-motion` support for the `animate-marquee` CSS. `TickerStrip` (`composites/TickerStrip.tsx:77-81`) properly respects reduced-motion; `TickerTape` (the in-app one) does not. iOS user with Reduce Motion enabled gets a looping animation anyway.

**Impact:** P2 for layout, P1 for motion-sensitive a11y users.

---

## 5. Tapping an input

**File:** `/Users/GK/Downloads/alphadesk/frontend/src/components/ui/input.tsx:22`

Fixed: `text-base md:text-[13px]` → 16px on mobile, 13px on md+. iOS will NOT zoom on focus. Correct.

BUT native `<input>` elements that bypass the Input primitive still ship at `text-sm` (14px). Examples:
- `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/alerts/page.tsx:89,143` — symbol + price inputs: `text-sm` → iOS zooms.
- `/Users/GK/Downloads/alphadesk/frontend/src/components/layout/CommandPalette.tsx:266` — `Command.Input` at `text-sm` → iOS zooms whenever user taps ⌘K.

**Impact:** P1. Alerts and command palette are top-3 mobile flows.

---

## 6. The hamburger sheet

**Desk TopBar composite:** `/Users/GK/Downloads/alphadesk/frontend/src/components/composites/TopBar.tsx:55-126` — Sheet side-left, `w-72` (288px, fits 390px), `min-h-[44px]` rows, color-coded logout at bottom, closes on click. Good. `Sheet` default z/overlay treatment applies.

**Non-desk TopBar:** `/Users/GK/Downloads/alphadesk/frontend/src/components/layout/TopBar.tsx:46-75` — also `w-64` (256px) Sheet. 44×44 touch ergonomics via `py-2.5`. But 6 items, single-column, no "Strategies," no "Settings" (only routed via ProfileMenu), no scroll since content is short. Both Sheets work.

---

## 7. Mobile strategy detail

**File:** `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/strategies/[id]/_strategy/StrategyHero.tsx:91`

`dl className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4"` — at 390px this renders 2×2 (4 cells in 2 rows). The persona's hint said `sm:grid-cols-2` but the code is `sm:grid-cols-4`; the mobile-390 case still works (base is `grid-cols-2` → 2 columns, 2 rows with 4 cells). Correct.

**EquityPanel:** `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/strategies/[id]/_strategy/EquityPanel.tsx:154-157` — `viewBox={`0 0 ${w} ${h}`}` + `preserveAspectRatio="none"` + `className="h-[320px] w-full"`. SVG scales horizontally (will stretch line + area; `polyline strokeWidth={1.8}` becomes thin vertical at 390px since horizontal scale > vertical). The stretched line with "none" aspect causes visual distortion on narrow viewports — prices won't look linear.

**Impact:** P2 — displays but looks visually wrong.

---

## 8. Settings on mobile

**File:** `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/settings/page.tsx:46-65`

Toggle switches are `h-5 w-9` (20px × 36px). iOS minimum tap target is 44×44. The harness (`manifest.json:2162-2194`) recorded **6 clickable elements failed with "element is not visible"** on mobile-390 at `/settings` during `click-every`. These are almost certainly the small toggles — they are visible but below the 44pt threshold Playwright considers "stable for interaction." Users will mis-tap frequently.

Critical path: the **trading-mode toggle (live/paper)** is one of these 20px switches. Accidental taps could flip a paper account to LIVE without confirmation.

**Impact:** P1 for UX, borderline P0 for the live-mode toggle.

---

## 9. Screen reader checks

- **CommandPalette** (`components/layout/CommandPalette.tsx:249-252`): `DialogTitle` + `DialogDescription` both `sr-only`. Correct.
- **Tables** (`components/ui/table.tsx:86-93`): `scope={scope ?? "col"}` default. VoiceOver table rotor works. Correct.
- **TickerStrip** (`composites/TickerStrip.tsx:49-51`) and **TickerTape** (`layout/TickerTape.tsx:37-39`): `role="region"` + `aria-live="off"`. No deprecated `role="marquee"`. Correct.
- **OrderBar selects** (`composites/OrderBar.tsx:126,203`): `focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-ring`. Visible focus ring. Correct.
- **main + skip link** (`app/(dashboard)/layout.tsx:109-114,135-140`): skip link emitted in both branches (desk and non-desk) with `focus:not-sr-only focus:z-[60]`. `<main id="main-content">` in `DeskLayout.tsx:85-93` and `(dashboard)/layout.tsx:147`. Correct.

A11y r3 fixes appear to be landed.

---

## 10. WsStatusBanner

**File:** `/Users/GK/Downloads/alphadesk/frontend/src/components/layout/WsStatusBanner.tsx`

Four states:
- `open` → renders null
- `connecting` → muted `bg-bg-elev-1 text-fg-muted`, `role="status" aria-live="polite"`, text "Connecting to live data…"
- `reconnecting` → `bg-amber/10 text-amber`, `role="status" aria-live="polite"`, text "Reconnecting to live data…"
- `failed` → `bg-loss/10 text-loss`, `role="alert" aria-live="assertive"`, "Live data offline — quotes may be stale. Reload to retry." + Reload button

Mounted for both desk and non-desk branches of `(dashboard)/layout.tsx`. When a commuter switches from Wi-Fi to cellular, the banner cascades connecting→reconnecting→(either open or failed). The user can tap "Reload" to retry.

**The banner height is ~28px** (`py-1.5 text-xs`). The desk grid is `grid-rows-[48px_38px_1fr_22px]` — the banner renders OUTSIDE that grid (above it, as a sibling of DeskLayout via the dashboard layout wrapping component). It will push content down. Correct behaviour.

**Concern:** when wsStatus transitions from `reconnecting` to `open`, the banner disappears instantly with no animation, causing a ~28px jump. On mobile at scroll position > 0, the user's visible chart moves — a small but real annoyance.

---

## 11. Intermediate viewport (iPad 768-1024)

**DeskLayout** at md: `grid-cols-[260px_1fr]` + right aside stacks below (`md:col-span-2 md:row-start-2`). User sees rail + center row 1, positions/memo row 2. `md:overflow-y-auto` on desk-main lets the column scroll; `lg:overflow-hidden` restores viewport-lock at 1024. Correct.

**ContextBar** still `overflow-x-auto lg:overflow-visible` — scrollable at 768-1023 which is right because the center column has limited width after the 260px rail.

**Pipeline table** (`app/(dashboard)/pipeline/page.tsx:447-448`): `<div className="overflow-x-auto scrollbar-thin">` + `<Table className="min-w-[900px]">`. At 768-900px the macOS scrollbar becomes visible because of `scrollbar-thin` defined in globals.css. Good — traders see Stop Loss / Take Profit columns exist.

---

## 12. Ultrawide (1920+)

**File:** `/Users/GK/Downloads/alphadesk/frontend/src/components/layouts/DashboardPageLayout.tsx:49-52`

`max-w-[1480px] 2xl:max-w-[1680px]`. Uses real estate on large monitors. Correct.

The **desk route at `/`** does NOT use DashboardPageLayout — it uses `DeskLayout` which is 260/1fr/340. On a 4K monitor the center column becomes 3260px wide. That's arguably too wide; but DeskLayout doesn't cap. This is intentional for the trading surface.

---

## 13. Safari quirks

`100vh` search (`/Users/GK/Downloads/alphadesk/frontend/src/app/global-error.tsx:45,59`): still uses `100vh` — this is OK because the global-error page is rarely seen and the `minHeight:"100vh"` applies inline-style to a fatal error screen.

Only `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/trade/page.tsx:159` uses the iOS-safe `min-h-[calc(100dvh-48px-22px)]`. The flagship desk uses `min-h-screen md:h-screen` (not 100vh explicitly — `h-screen` resolves to `100vh` in Tailwind). On iOS Safari with address bar visible, the desk bottom clips by ~60px. Not severe (scrolling still works on `min-h-screen`) but the StatusBar could be partially hidden.

---

## 14. Harness snapshots (most recent: 2026-04-19T02-54-35Z)

Manifest: 227 pass / 6 fail / 8 skipped cells. 15 specs × 2 viewports (30 runs).

Mobile-390 steps ran for all 15 routes. Screenshots exist for `dashboard/mobile-390/initial.png`, `strategy-momentum-quality/mobile-390/initial.png`, etc. DOM bytes for dashboard/mobile-390/initial = same as desktop-1440 (both SSR'd identically) — expected.

**Fails:**
- `settings/mobile-390 click-every`: 6 sub-failures, all "element is not visible" — the 5×9 toggle switches are too small for Playwright to consider stable.

**Skips:**
- `alerts/{desktop,mobile}/hover-first-alert`: no `[data-testid=alert-row]` found — the alerts route has no alert rows yet (fresh DB), harness steps gracefully skip.
- `dashboard/{mobile}/click-strategy`: no `[data-testid=strategy-rail]` or `[data-testid^=strategy-card]` — because on mobile the rail is `hidden md:block`. The strategy rail is literally not in the DOM. Validates finding #1.
- `dashboard/{mobile}/command-palette`: not opened by click — command palette opens via ⌘K which has no mobile trigger.
- `strategy-momentum-quality/{mobile}/chart-1m`: `[data-range='1M']` not found at mobile-390 — the range buttons may be offscreen or the test selector changed.

---

## Additional findings beyond the persona checklist

**StatusBar (bottom 22px strip):** `/Users/GK/Downloads/alphadesk/frontend/src/components/composites/StatusBar.tsx:42-78`
Still `h-[22px] px-5 gap-[18px]` without mobile treatment. 4 pills + Build + ⌘K + Commands text in one non-wrapping flex row — at 390px this overflows by ~80px. No `overflow-x-auto`. `⌘K` kbd is meaningless on touch. Previously flagged P1 in mobile-audit-r2 #16 — still unresolved.

**PositionsList tabs:** `/Users/GK/Downloads/alphadesk/frontend/src/components/composites/PositionsList.tsx:82-88`
Still `text-[10px] px-2 py-[3px]` — ~15×20px tap targets, far below 44pt. Previously flagged P1 in mobile-audit-r2 #14 — still unresolved.

**OnboardingTour:** `/Users/GK/Downloads/alphadesk/frontend/src/components/layout/OnboardingTour.tsx:266` still `w-80` fixed — can overflow 390px viewport. Previously flagged P1 #24 — still unresolved.

**fg-hint contrast:** `/Users/GK/Downloads/alphadesk/frontend/src/styles/design-tokens.css:64` — `--fg-hint` still below AA on most surfaces. CAPTION labels on ContextBar, StrategyRail subtitles, input hints all use it. Per a11y r3 P0 #1 — still a WCAG 1.4.3 violation.

**AlertRow 7 columns:** `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/alerts/page.tsx:182-256` — 7-column flex row with `w-16/w-20/w-24` fixed widths at 390px still overflows. Not fixed. Previously flagged P1 #20.

**Pipeline PipelineFlow:** `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/pipeline/page.tsx:92-129` — 4 stage cards + arrows in `flex items-center justify-between` still does not break below sm. Mobile audit #12 — unresolved.

---

## Top 10 items a mobile user would hit in their first session

Listed in the order a fresh mobile user would trip over them, not severity:

1. **Strategy rail invisible on mobile** — the flagship desk hides `StrategyRail` at `<md` with no drawer/menu alternative. Strategies are core to the app. `DeskLayout.tsx:76` + composite TopBar has no "Strategies" nav item that opens the rail.
2. **Non-desk TopBar hamburger omits Strategies** — once the user clicks into Pipeline/Analytics/etc, `components/layout/TopBar.tsx:33-40` `navItems` has no Strategies link. Dead-end navigation.
3. **Settings toggles are 5×9 (20×36px)** — far below iOS 44×44 min; harness recorded 6 "element not visible" failures on `/settings` mobile. The live/paper trading toggle risks accidental activation.
4. **Native inputs in Alerts + CommandPalette zoom on iOS** — `alerts/page.tsx:89,143` and `CommandPalette.tsx:266` use `text-sm` (14px). iOS Safari auto-zooms. Only `components/ui/input.tsx` is fixed.
5. **PositionsList tabs are 10px text in 15×20 boxes** — `PositionsList.tsx:82-88` — users cannot reliably switch Positions/Orders/Journal on a phone.
6. **StatusBar overflow at 390px** — `StatusBar.tsx:42-47` renders 4 pills + Build + ⌘K without `overflow-x-auto`. Bottom strip gets clipped or pushes viewport horizontally.
7. **PriceChartPanel 40px title + 36px price with no mobile downscale** — `PriceChartPanel.tsx:247,258` — fonts consume ~280px before meta cells wrap, forcing two large stacked rows that push the chart below the fold on 390px.
8. **Range buttons row not wrapped** — `PriceChartPanel.tsx:287-302` — 8 range buttons + 3 legend chips in `flex justify-between`, no wrap/scroll. Overflows at 390px.
9. **Equity chart stretches with `preserveAspectRatio="none"` at 320px tall × 390px wide** — `EquityPanel.tsx:154-157`. The line looks visually distorted on mobile (horizontal scale ≫ vertical).
10. **TickerTape ignores `prefers-reduced-motion`** — `layout/TickerTape.tsx:42` has `animate-marquee` with no media query. Motion-sensitive iOS users see a perpetual scroll regardless of the system setting (the marketing `composites/TickerStrip.tsx` respects it, but the in-app one does not).

Honorable mentions: `OnboardingTour` w-80 clips at 390px; WsStatusBanner instant show/hide causes ~28px jump when network flaps; `text-fg-hint` contrast still fails AA on all surfaces.
