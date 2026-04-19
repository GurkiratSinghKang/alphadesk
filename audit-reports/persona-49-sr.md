# Persona 49 — Screen Reader (VoiceOver / NVDA)

Wave 11 / Wave 16 follow-up audit. Verifies: skip-link, `<main>` landmark,
DialogTitle sr-only, `<th scope>`, TickerTape `role=region`, WsStatusBanner
`role`/`aria-live`, notification announcements.

## Status of prior remediations

- Wave 11 skip link: PRESENT on both desk and non-desk dashboard branches
  (`frontend/src/app/(dashboard)/layout.tsx:109-114, 135-140`).
- Wave 11 `<main id="main-content">`: PRESENT on desk (`DeskLayout.tsx:85-93`)
  and non-desk dashboard (`layout.tsx:147`).
- Wave 11 DialogTitle sr-only: PRESENT on CommandPalette
  (`CommandPalette.tsx:233-236`).
- Wave 11 `<th scope="col">`: Only partially applied — see finding F4.
- Wave 11 TickerTape `role="region"`: PRESENT (`TickerTape.tsx:43-45`),
  `aria-live="off"` correctly suppresses constant chatter.
- Wave 16 WsStatusBanner: PRESENT with correct `role` + `aria-live` split —
  `role="alert"`/`aria-live="assertive"` when failed, `role="status"`/
  `aria-live="polite"` for connecting and reconnecting
  (`WsStatusBanner.tsx:36-80`).

## Findings (10)

### F1 — `<main>` landmark missing on every auth/public page (P1)
`/login`, `/login/reset`, `/request-access`, `/privacy`, `/terms`, `/risk`,
`/docs`, `/not-found`. `MarketingShell` renders `<main>{children}</main>`
(`MarketingShell.tsx:132`) but has **no `id="main-content"` and no skip-link**,
so rotor navigation on these pages can't jump past the `<nav>` and footer
columns. `/login/layout.tsx` wraps in a plain `<div>` — no landmark at all
(`login/layout.tsx:11`). `not-found.tsx` and `login/reset/page.tsx` use bare
`<div>` with `<h1>` and no landmark.

### F2 — Notifications are silent for screen readers (P0)
`NotificationCenter.tsx` is a click-to-open `<Popover>` with no `aria-live`
region and no `role="log"` container. The producer `useNotifications.ts`
calls `addNotification(...)` directly on WS fills, alert triggers, and
`alphadesk:pipeline-status` events without also dispatching a toast. Only
`alphadesk:api-error` and `alphadesk:system-notify` reach the toast channel
(`(dashboard)/layout.tsx:46-73`). A blind trader gets zero announcement for
order fills, rejections, or alert triggers — the unread badge on the bell is
purely visual. Toaster already carries an `aria-live="polite"` region
(`toast.tsx:128-140`), so the fix is to pipe trade/alert/pipeline pushes
through the toast channel too, OR add a labelled `role="log" aria-live="polite"`
mirror in `NotificationCenter`.

### F3 — Strategies catalogue has nested `<main>` (P1)
`strategies/page.tsx:431` renders `<main aria-label="Strategies catalogue">`
**inside** the outer `(dashboard)/layout.tsx` `<main id="main-content">`
(line 147). Two `<main>` landmarks per document fails WCAG 1.3.1 and confuses
VoiceOver landmark rotor (shows two "main" entries). Change to `<section
aria-label="Strategies catalogue">`.

### F4 — `<th>` missing `scope="col"` on four data tables (P1)
`reports/page.tsx` lines 221–226, 262–267, 411–417, 597–601 (4 tables);
`analytics/page.tsx` lines 377–381 (monthly returns table);
`trade/page.tsx` lines 215–220 (open orders table);
`strategies/[id]/_strategy/PositionsSection.tsx` lines 64–82 (positions table).
None declare `scope`. Wave 11 only fixed `PerformanceMetrics.tsx` and
`OptionsPanel.tsx`. Without `scope`, NVDA's table-navigation mode cannot tie
cell values back to column headers — a blind trader reading a row hears the
numbers with no idea which is P&L vs. Avg Cost.

### F5 — OnboardingTour dialog lacks `aria-labelledby` (P1)
`OnboardingTour.tsx:298-304` sets `role="dialog" aria-modal="true"` but never
points `aria-labelledby` at the step `<h3>` on line 357. VoiceOver opens the
modal with "dialog" only — no step title is announced. Add `id` to the `<h3>`
and `aria-labelledby` on the outer container.

### F6 — Keyboard-shortcut overlay lacks `aria-labelledby` (P2)
`shortcut-overlay.tsx:127-134` uses `role="dialog" aria-modal="true"` but
doesn't reference the `<h2>Keyboard Shortcuts</h2>` on line 144. Same fix:
`id` on the h2, `aria-labelledby` on the dialog root.

### F7 — DashboardError has no `role="alert"` announcement (P1)
`components/error/DashboardError.tsx` renders a full-screen error with an h1
headline and a "Try again" button but no `role="alert"` / `aria-live="assertive"`
on the container. When an error throws after navigation, VoiceOver silently
re-focuses — the user has no cue that the page errored. Add `role="alert"` to
the top-level wrapper of the error surface.

### F8 — Mobile navigation `<nav>` missing label (P2)
`TopBar.tsx:65` renders `<nav>` inside the mobile `<SheetContent>` with no
`aria-label`. The desktop nav on line 91 correctly has `aria-label="Main
navigation"`. The mobile-drawer landmark collides with the desktop one on the
rotor as "navigation" twice. Set `aria-label="Mobile navigation"`.

### F9 — DeskLayout asides unlabelled (P2)
`DeskLayout.tsx:74-79, 95-106` emit two `<aside>` complementary landmarks
(StrategyRail + PositionsList/AIMemoPanel column) with no `aria-label`.
Rotor shows two generic "complementary" entries. Set `aria-label="Strategies"`
and `aria-label="Positions and AI memo"` respectively (or on the inner
composites).

### F10 — `PriceChartPanel` lightweight-chart canvas has no text summary (P2)
`PriceChartPanel.tsx:78-136` mounts a `lightweight-charts` canvas with no
`role="img" aria-label="…"` wrapper and no accompanying sr-only textual
summary of range/return/SMA status. A blind user reaches the flagship
chart and hears nothing. Minimum fix: wrap the chart `<div>` with
`role="img"` and an `aria-label` composed from symbol + range + latest close
+ change. Ideally emit a visually-hidden `<p>` under the chart summarising
the series (e.g. "AAPL 1M, 23 bars, +4.2%, last 187.43").

## Summary (250 words)

Wave 11 landmark work holds on the authenticated dashboard shell: both
branches of `(dashboard)/layout.tsx` emit the skip-link, `<main
id="main-content" tabIndex="-1">`, and the header/footer landmarks. Wave 16's
WsStatusBanner is correct — `role="alert" aria-live="assertive"` for failed,
polite status for connecting/reconnecting. The TickerTape `role="region"`
with `aria-live="off"` is also correct and avoids constant rotor chatter.

The largest gap is Finding F2: the notification pipeline is **completely
inaudible** to screen readers. Order fills, rejections, alert triggers, and
pipeline completions land in the notification store and bump the bell badge,
but the popover has no live region and the producer never toasts, so VoiceOver
says nothing when a live position gets filled — unacceptable for a trading
surface. F7 compounds this: route-level errors swap in without an assertive
alert.

Public / auth surfaces (F1) are the second-biggest bucket: `MarketingShell`
renders `<main>` without an `id`, so `/docs`, `/privacy`, `/terms`, `/risk`,
`/request-access` all ship without a skip link, and `/login`, `/login/reset`,
`/not-found`, and the `DashboardError` fallback have no landmark at all.

F3 (duplicate `<main>` on strategies), F4 (four tables missing `scope="col"`),
F5/F6 (two modals missing `aria-labelledby`), and F8/F9 (unlabelled nav +
asides) are mechanical fixes. F10 is a larger piece of work — the chart
needs a visually-hidden textual summary so blind traders can read the series
without the canvas.

Priority order for remediation: F2 → F7 → F1 → F4 → F3 → F5 → F10 → F6 → F8 → F9.
