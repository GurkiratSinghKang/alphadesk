# Persona 28 — Mobile-Only Trader (390px iPhone, exclusive viewport)

Walk-through as an AlphaDesk user who opens the app ONLY on a 390px iPhone. Verification of whether R2/R7/R15 mobile-oriented wave fixes actually landed, with a focus on uniquely-mobile flows: swipe, pull-to-refresh, haptics, PWA install, and dense small-screen UX.

All paths absolute. Severity: P0 = blocks or maims the flow; P1 = missing expected mobile affordance; P2 = polish.

---

## Summary (250 words)

R2/R7/R15 landed most of the visual-layout mobile fixes: `DeskLayout` grid now stacks 1-col at base (`/Users/GK/Downloads/alphadesk/frontend/src/components/layouts/DeskLayout.tsx:70`), `PriceChartPanel` header hero fonts scale down with `text-[22px] sm:text-[32px] md:text-[40px]` and the range row wraps (`PriceChartPanel.tsx:248,295`), the Input primitive is now `text-base md:text-[13px]` (no iOS zoom) and the same fix propagated to the Alerts inputs, `CommandPalette`, and `AICopilot`. `StatusBar` gained `overflow-x-auto`, the desk `TopBar` composite now has a hamburger Sheet, and the non-desk `TopBar` adds a `/strategies` link. `NotificationCenter` popover is `w-[calc(100vw-2rem)]`. `Settings` toggles wrap the 20×36 switch in a 44×44 hit target. `TickerTape` added `motion-reduce:animate-none`. A global `prefers-reduced-motion` media query exists in `globals.css:311`. Good coverage of visual fixes.

What's still broken is the uniquely-mobile layer — the things a 390px-only user expects because they live on their phone. There is NO PWA manifest, NO service worker, NO `viewport` meta (Next `export const viewport` is absent in `app/layout.tsx`), NO `apple-touch-icon`, NO `theme-color`, NO `safe-area-inset-*` handling, NO haptics, NO swipe or pull-to-refresh, NO bottom tab bar. The StrategyRail is still `hidden md:block` with no drawer, so the flagship desk at `/` is a stripped-down view on phone. The top hamburger Sheet doesn't even list "Strategies" — users must navigate via one-off routes. These are core mobile UX patterns, not polish.

---

## Findings

### 1. No PWA manifest — "Add to Home Screen" produces a broken tile (P0)

**File:** `/Users/GK/Downloads/alphadesk/frontend/public/` + `/Users/GK/Downloads/alphadesk/frontend/src/app/layout.tsx`

There is no `public/manifest.webmanifest`, no `public/icons/`, no `apple-touch-icon.png`, and `layout.tsx` does not emit a `manifest` or `themeColor` link. When a mobile-only user taps Safari's Share → Add to Home Screen, iOS generates a low-resolution screenshot-tile with the generic Safari "AlphaDesk" string and no splash screen. On Android Chrome the install prompt never fires (`beforeinstallprompt` requires a valid manifest). Given this persona uses the app exclusively on phone, the PWA path is the #1 missing affordance.

**Fix:** Add `public/manifest.webmanifest` with `name`, `short_name`, `display: standalone`, `theme_color: #0a0a0a`, `background_color: #0a0a0a`, 192/512 icons; add `apple-touch-icon.png`; and in `app/layout.tsx` add `export const metadata.manifest = "/manifest.webmanifest"` and `export const viewport = { themeColor: "#0a0a0a", viewportFit: "cover" }`.

---

### 2. No `viewport` meta — no control over pinch-zoom, no `viewport-fit=cover` (P0)

**File:** `/Users/GK/Downloads/alphadesk/frontend/src/app/layout.tsx:34-51`

`RootLayout` exports only `metadata` — no `export const viewport`. Next's generateViewport API is unused, so the rendered HTML relies on the framework default. There is no `viewport-fit=cover`, so on iPhone 14/15 Pro / Pro Max the status-bar and home-indicator safe zones are not reserved. The `TopBar` (48px) and `StatusBar` (22px) both risk sitting under the notch / home-indicator when the browser chrome collapses. There is also no `safe-area-inset-*` padding anywhere in the codebase (`grep env(safe-area` returns 0 matches). On a standalone PWA this means content touches the screen edge.

**Fix:** Add `export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#0a0a0a" }` in `layout.tsx`, and add `pt-[env(safe-area-inset-top)]` / `pb-[env(safe-area-inset-bottom)]` on the dashboard-layout shell and `StatusBar`.

---

### 3. StrategyRail still `hidden md:block` — no drawer, no mobile path (P0)

**File:** `/Users/GK/Downloads/alphadesk/frontend/src/components/layouts/DeskLayout.tsx:74-79`

`<aside data-slot="desk-rail" className="hidden md:block …">{rail}</aside>`. On 390px the rail is completely absent from the DOM. The desk TopBar composite's hamburger Sheet at `/Users/GK/Downloads/alphadesk/frontend/src/components/composites/TopBar.tsx:82-124` lists the 5 `routes` passed in — but the list of individual strategies (which the rail shows) is nowhere. A mobile-only trader cannot pick a strategy to load on the desk; they must drill through `/strategies` as a separate route. Previously flagged in `persona-5-mobile-a11y.md` #1 — still unresolved.

**Fix:** Render the rail as a bottom Sheet triggered by a "Strategies" button in the mobile `TopBar`. Below `md` swap `hidden md:block` for `<Sheet>…<SheetContent side="left" className="md:hidden">{rail}</SheetContent></Sheet>` with a visible trigger near the left edge of the TopBar.

---

### 4. No haptic feedback anywhere — `navigator.vibrate` never called (P1)

**File:** entire codebase (`grep -r "navigator.vibrate" frontend/src` → 0 matches)

A mobile-only trader expects haptic punctuation on critical actions: Stage order (`OrderBar`), Confirm-live-mode switch (`settings/page.tsx:55-79`), fill notification, position close. iOS `navigator.vibrate` works on Android Chrome; on iOS Safari it is NOP but on installed PWA with `webkit-tap-highlight` and Apple's Taptic Engine hooks via `hapticFeedback.impact*` can be emulated via CSS transitions on touchend. The app has zero integration with either.

**Fix:** Add `frontend/src/lib/haptics.ts` wrapping `navigator.vibrate` with a no-op fallback, call `haptic("light")` in the Stage button, `haptic("heavy")` on live-mode toggle confirmation, `haptic("success")` on fill toast.

---

### 5. No pull-to-refresh on data-heavy lists (P1)

**File:** `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/pipeline/page.tsx`, `alerts/page.tsx`, `reports/page.tsx`

`grep -r "pull-to-refresh\|overscroll-behavior: contain" frontend/src` returns nothing. `globals.css:175` sets `overscroll-behavior: none` globally, which actively disables iOS rubber-band and therefore prevents even the default browser pull-refresh. There is no custom pull-to-refresh on the Pipeline (live positions), Alerts (triggered alerts), or Reports (P&L). A mobile user checking P&L must tap a button or wait for WebSocket. Mobile users expect PTR on every scroll container showing live data.

**Fix:** Add a `usePullToRefresh` hook wired to each list's refetch. Relax `overscroll-behavior: none` to `overscroll-behavior-y: contain` on `<html>` so the gesture still works but no chain-scroll.

---

### 6. No swipe affordances — can't swipe-to-dismiss alerts, positions, or notifications (P1)

**File:** `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/alerts/page.tsx:182-256`, `/Users/GK/Downloads/alphadesk/frontend/src/components/layout/NotificationCenter.tsx`, `/Users/GK/Downloads/alphadesk/frontend/src/components/composites/PositionsList.tsx`

No `onTouchStart/Move/End` handlers, no `react-swipeable`, no `useSwipe` hook. On iOS Mail / iMessage / every native list, swipe-left reveals Delete/Archive actions. In AlphaDesk the Alerts delete button is an X button inline in a flex row — it's 28px, adjacent to 6 other fixed-width columns, easy to mis-tap while scrolling. Notifications have a "Clear all" link; no per-notification swipe-dismiss. Positions offer no swipe-to-close.

**Fix:** Introduce a thin swipe-row primitive (framer-motion has one) and wire it to `AlertRow`, notification rows, and optionally position rows for a "close position" affordance gated behind a confirmation.

---

### 7. No bottom navigation tab bar — hamburger is the only path (P1)

**File:** `/Users/GK/Downloads/alphadesk/frontend/src/components/composites/TopBar.tsx:55-126`, `/Users/GK/Downloads/alphadesk/frontend/src/components/layout/TopBar.tsx:46-81`

Both TopBar variants use a top-left hamburger Sheet. On iPhone the thumb reaches the bottom of the screen most easily — top-left is a two-hand operation or awkward finger-stretch. Every iOS-native trading app (Robinhood, Webull, Schwab, IBKR mobile) uses a 5-item bottom tab bar for primary navigation. AlphaDesk has none. Combined with the 48px TopBar + 22px StatusBar that also sit at the top/bottom, the user's thumb must travel 800+ px between sections.

**Fix:** Add a `<BottomTabBar className="md:hidden">` with Desk / Trade / Alerts / Pipeline / More (open Sheet). Reserve 56px height + `env(safe-area-inset-bottom)`; hide on `md+`. Make it sticky-bottom on dashboard layout.

---

### 8. `overscroll-behavior: none` on `<html>` disables iOS rubber-band globally (P2)

**File:** `/Users/GK/Downloads/alphadesk/frontend/src/app/globals.css:173-176`

```css
html {
  background-color: var(--bg);
  overscroll-behavior: none;
}
```

This was likely added to stop horizontal browser-nav gestures from triggering on deep scrollables. But the same rule kills the vertical rubber-band bounce that mobile users rely on as a tactile scroll-end cue, AND prevents the browser's default pull-to-refresh from working. Feels dead to a phone user.

**Fix:** Scope it: `html { overscroll-behavior-x: none; }` or apply `overscroll-behavior: contain` only to specific containers (desk-main, rail, positions-list) that actually need chain-scroll containment.

---

### 9. PositionsList mobile: still no card layout, still a 60px-first-col grid (P2)

**File:** `/Users/GK/Downloads/alphadesk/frontend/src/components/composites/PositionsList.tsx:86-134` and later rows

The tabs now meet 44×44 (`h-8 px-3`) which is good. But the row itself is still `grid grid-cols-[60px_1fr_auto] gap-2.5 items-center px-[18px] py-2.5` with inline tiny text. On a 390px iPhone, 60+18×2+gap ≈ 100px left for symbol+info+price+pnl. Mobile-audit-r2 #14 recommended a stacked card below `md`. Not landed.

**Fix:** Below `md` render `grid grid-cols-1 gap-2 p-3` with each row as a card showing symbol/price on row 1, pnl/qty on row 2. Remove the 60px fixed col on mobile.

---

### 10. Order confirmation is a toast, not a native-feeling modal — no haptic, no iOS share sheet pattern (P2)

**File:** `/Users/GK/Downloads/alphadesk/frontend/src/components/composites/OrderBar.tsx` + the toast via `@/hooks/useToast`

Stage → Submit → toast slides in at top. A mobile-only trader staging a real-money order expects a bottom-sheet confirmation (iOS action-sheet pattern) with a 60-70% screen modal showing qty × price = total, with Apple-style "Confirm to Trade" Slide-to-confirm or at least a large sticky-bottom Confirm button that sits above the home indicator. The current flow is keyboard-desk-first: fill the row, click Stage, read the italic review copy, click Submit, hope.

**Fix:** Add a mobile-only `<Sheet side="bottom">` confirmation with big-font totals and an explicit Submit button 56px tall, honoring `env(safe-area-inset-bottom)`.

---

## What DID land from R2/R7/R15 (verification notes)

The following fixes from the R2 mobile-audit / R7 persona-5-mobile-a11y / R15 waves are confirmed in the current HEAD:

- `DeskLayout` mobile grid stack — `DeskLayout.tsx:66-79` (R2 #1 ✓)
- `PriceChartPanel` hero font downscale + range row wrap — `PriceChartPanel.tsx:248,295` (R2 #5/#6 ✓)
- `Input` primitive `text-base md:text-[13px]` — `input.tsx:22` (R2 #7 ✓)
- Alerts symbol input `text-base md:text-sm` — `alerts/page.tsx:93` (R7 #5 ✓)
- `CommandPalette` input `text-base md:text-sm` + visible search icon — `CommandPalette.tsx:254` (R2 #8 ✓)
- `AICopilot` width `w-full max-w-[400px] sm:w-[400px]` + input `text-base sm:text-xs` — `AICopilot.tsx:179,316` (R2 #9 ✓)
- `NotificationCenter` popover `w-[calc(100vw-2rem)] max-w-96` — `NotificationCenter.tsx:136` (R2 #10 ✓)
- `StatusBar` `overflow-x-auto` + `md:inline` gating of ⌘K — `StatusBar.tsx:52-83` (R2 #16 ✓)
- `PositionsList` tabs `h-8 px-3` → 44pt target — `PositionsList.tsx:141-145` (R2 #14 partial ✓)
- Composite `TopBar` hamburger Sheet with min-h-[44px] rows — `composites/TopBar.tsx:55-126` (persona-5 #6 ✓)
- Non-desk `TopBar` now lists `/strategies` — `layout/TopBar.tsx:40` (persona-5 #3 ✓)
- Settings toggle wrapped in 44×44 `role="switch"` button — `settings/page.tsx:50-79` (persona-5 #8 ✓)
- `TickerTape` `motion-reduce:animate-none` — `TickerTape.tsx:51` (persona-5 #4 ✓)
- Global `prefers-reduced-motion` media query — `globals.css:311-318` ✓
- `/strategies` listing page exists — `strategies/page.tsx` ✓

The mobile-layout surface is largely fixed. The mobile-first-class-citizen surface — PWA, safe-area, haptics, swipe, pull-to-refresh, bottom nav — is still entirely absent.
