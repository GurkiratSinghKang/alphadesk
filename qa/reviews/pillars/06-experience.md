# Pillar 6 — Experience Design

**Audited:** 2026-05-04 (run `2026-05-04T02-58-02Z`, baseUrl `https://tradingalpha.net`)
**Surface:** 24 specs × 2 viewports of compiled production frontend, plus `frontend/src/` source.
**Reference:** prior `qa/reviews/accessibility.md` (a11y scope, P0–P2) and `qa/reviews/regression-triage.md` (functional regression scope, P0–P2). This pillar extends both — does not duplicate.

---

## Headline

State coverage on the authenticated workspace is strong: skeletons, dim+`aria-busy` refetch, optimistic updates with toast reconciliation, intentional empty states with editorial voice and CTAs. High-signal patterns are real (two-tap delete on alerts, bulleted destructive modal in Cmd+K, `submitDisabledReason` next to OrderBar submit, role="alert" inline errors). But four categories of failure are reproducible, and one (offline-shell hijack of the trade ticket) silently breaks the most consequential flow. Pillar does **not** clear the bar.

---

## BLOCKER

### B-1. Service-worker offline shell hijacks the trade ticket on slow navigations — user sees "AlphaDesk is offline" with no path back to deep-link
- **Evidence:** Of 7 desktop trade DOMs in `qa/runs/2026-05-04T02-58-02Z/trade/desktop-1440/`, **4** are the 91-line static `public/offline.html` shell (navigate-fail, single-leg-prefill, validate-single-leg-prefill-fail, wait-fail); same 4 on mobile-390. Screenshot `trade/desktop-1440/navigate-fail.preview.png` shows "§ · NO CONNECTION / AlphaDesk is offline. … Try again". The harness reached the API on initial-prefill (full ticket renders) — this is `frontend/public/sw.js:127-141 navigationStrategy` deciding an in-flight nav timed out and serving the cached shell.
- **Why blocker:** (1) "Try again" `<a href="/" onclick="location.reload(); return false;">` — `href="/"` is dashboard, not the URL the user was on; CSP race or JS-disabled fallback yanks the user off `/trade?contract=…&legs=…` losing deep-link state. (2) Shell uses `-apple-system` + serif `Newsreader` — visually foreign to the dark workspace, reads as "product crashed" not "network blipped." (3) No telemetry; `react-query` cache not invalidated; "Try again" may rehydrate against stale data.
- **Fix:** Lengthen SW navigationStrategy timeout (or skip SW intercept for `/trade*` entirely). Replace `href="/"` with the original pathname+search. Add an analytics event on offline-shell render.
- **Cross-ref:** prior regression-triage P0#1 noted a 47.3h-stale-quote hard-block on /trade; this is a separate failure mode.

### B-2. Earnings-options-play renders a huge empty detail pane while the sidebar shows 6 selectable rows — auto-select did not fire
- **Evidence:** `strategies-earnings-options-play/desktop-1440/initial.preview.png` — left sidebar shows 6 calendar rows (ABNB, DDOG, MCD, NET, BABA, CSCO) with `Edge XX` chips; right detail pane is the literal string "Select a symbol from the sidebar." occupying ~70% of viewport. The auto-select effect at `frontend/src/app/(dashboard)/strategies/earnings-options-play/page.tsx:197-220` should have picked row 0 — it did not (URL-pin path interfered).
- **Why blocker:** This is the strategy detail page the earnings calendar exists for. UX critique flagged the empty pane previously; it persists. With 6 rows visibly available, instructional copy is actively wrong.
- **Fix:** auto-select on first calendar resolution unconditionally (kill the `userClearedRef` exception on first paint), OR fill the pane with editorial pre-selection content ("Highlighted: ABNB · Edge 31") so the pane is never instructional dead-space.

### B-3. Inconsistent destructive-action confirmation — palette is guarded with bulleted modal; in-page Cancel/Pause/Logout fire instantly
- **Evidence:**
  - Single-order cancel: `components/panels/TradePanel.tsx:987-1013`, `app/(dashboard)/page.tsx:413-431` — `await cancelOrder(id)` on click, toast only.
  - Pause/Resume strategy: `app/(dashboard)/strategies/[id]/page.tsx:716-739` — `handleToggle` posts immediately.
  - Pipeline Cancel: `app/(dashboard)/pipeline/page.tsx:553-595, 793-806` — destructive button, immediate POST.
  - Logout: `components/layout/ProfileMenu.tsx:83-102, 142` — fires on click; unsaved drafts gone.
  - Compare Cmd+K Cancel-All-Orders (`components/layout/CommandPalette.tsx:269-410`): bulleted modal with explicit consequences and labeled `Cancel orders` button. Same product, two patterns for same action class.
- **Why blocker:** Inconsistent destructive-action treatment is worse than uniformly absent — users learn wrong mental model. Pausing stops live orders; cancelling a working order loses laddering; pipeline cancel mid-run aborts a screener pass that costs API budget.
- **Fix:** adopt the palette's `setPendingDestructiveAction` modal for all four. Logout can stay lighter (inline confirm in dropdown).

### B-4. Missing per-route error.tsx for /strategies, /strategies/earnings-options-play, /strategies/momentum-quality, /strategies/trading-agents-research
- **Evidence:** `find frontend/src -name "error.tsx"` returns 11 (app/, app/(dashboard)/, settings, pipeline, trade, alerts, analytics, reports, strategies/[id]). There is **no** error.tsx in `app/(dashboard)/strategies/`, in earnings-options-play, momentum-quality, or trading-agents-research. Throws bubble to `(dashboard)/error.tsx` (`app/(dashboard)/error.tsx:17-30`) which renders generic "Something went wrong" with no `route` context — `DashboardError` accepts `route` and `headline` props (`components/error/DashboardError.tsx`), but the dashboard error page passes none.
- **Why blocker:** Strategies area is feature-rich (filtering, calendar, deep-link state). One bad render throws the user to a top-level "Something broke on the desk" with no localized recovery; deep-link is preserved but user has no clue which sub-page exploded.
- **Fix:** add per-route `error.tsx` for each of the four sub-routes, scoped to the calendar/research panel; pass `route="strategies"` / `"earnings-options-play"` to DashboardError.

---

## WARNING

### W-1. `requestfailed` storms on every authenticated route mount
- `trade/desktop-1440/network.jsonl`: 10 `net::ERR_ABORTED` GETs at 03:09:29 (depth, orders, strategies, bars, six watchlist quotes). Prior triage flagged metrics/vitals aborts (P1#5) and watchlist burst (P2#7).
- **Impact:** No skeletons on failed widgets; flicker as second-attempt resolves; brief "no working orders" misreads.
- **Fix:** batch quotes (`?symbols=AAPL,MSFT,…`); add SWR ttl at market store; set `aria-busy` on watchlist during refresh.

### W-2. Login lockout countdown copy is stale — does not tick
- `app/login/_login/LoginForm.tsx:215, 365-373` — `now` only updates when the user types or submits. "Try again in 9m 47s" stays frozen until the user touches the form; no `setInterval` to re-tick. Visible escape hatch (Reset lockout button, line 374-381) exists.
- **Fix:** `useEffect` ticking `now` once a second while `locked` is true.

### W-3. OCC option-contract quotes 404 silently — no UI affordance
- `trade/desktop-1440/console.jsonl` lines 5-6: `404` for `/api/v1/market/quotes/NVDA260424C00220000` and `…P00200000`. The fix to fetch OCC quotes (per prior P1#3) is in place, but backend can't price the option, and OrderBar silently falls back to underlying for "Bid · Ask · Spread."
- **Fix:** on per-OCC 404, render "Last known midpoint $X.YZ · stale" badge; degrade gate copy to "stale option mid; advance with caution."

### W-4. Empty equity curve copy on `/strategies/momentum-quality` offers no recovery
- `EquityPanel.tsx:53-70` — "Not enough data for equity curve." with no link to view trades, no status pill explaining whether the strategy is paused or awaiting first fill. Compare alerts page empty state (`alerts/page.tsx:969-995`) which gives the user a concrete next step.
- **Fix:** copy "No fills yet — equity curve appears after first round-trip closes" + `active · awaiting first fill` / `paused since {date}` status badge.

### W-5. Onboarding tour fires `setTimeout(1500)` after mount, no first-paint suppress
- `components/layout/OnboardingTour.tsx:102-122` — pops 1.5 s after mount over freshly loaded hero; selectors missing on mobile (375 px) silently fall through to center overlay; no `prefers-reduced-motion` suppress; no Esc-to-dismiss-with-mark-complete.
- **Fix:** delay 3 s + `requestIdleCallback`; bind Esc.

### W-6. Reset-to-defaults uses native `window.confirm()` — no editorial voice, no consequence list
- `app/(dashboard)/settings/page.tsx:378-381` — `window.confirm(\`Disable …\`)` for broker disable; same pattern for "Reset to defaults" (comment line 1162). OS-level dialog, no styling, no scope explanation.
- **Fix:** styled `Dialog` with consequence list ("Reset will: clear theme preferences, reset data-refresh to 30s, dismiss broker connections [N], wipe alert templates. Account, broker keys, historical orders not affected.").

---

## NIT

- **N-1.** Cmd+K hint reads `Ctrl+K` on Mac (top-bar search). Detect platform and render `⌘K`. Source: docs say correct but topbar hard-codes one variant.
- **N-2.** Esc-to-clear earnings selection works (`EarningsDetailPanel.tsx:141-155`) but has no visible affordance. Add a `t-meta` keyboard map at panel header.
- **N-3.** OrderBar `Submitting…` (line 782) has no inline spinner — just text. 600-800 ms roundtrip looks frozen. Mirror settings' `Loader2` pattern.
- **N-4.** Toast position (bottom-right) requires eye-jump from top-of-list cancel button (`TradePanel.tsx:1063-1076`). Add row-level "→ cancelled" inline transition.
- **N-5.** No `aria-live="polite"` on the dashboard LIVE BOOK price-tick spans. SR users hear nothing as quotes update.
- **N-6.** Pipeline empty-state copy "Pipeline has not yet run today — awaiting next scheduled run" doesn't surface next-run time. Show countdown.

---

## What's working — preserve under refactor

- **Two-tap delete on alerts** (`alerts/page.tsx:451-481`) — 4 s arm window, h-9 hit target, distinct armed `aria-label`. Correct destructive-action pattern; B-3 fix should not regress.
- **`aria-busy` + dim-without-skeleton refetch** (`EarningsCalendarSidebar.tsx:139`, `EarningsDetailPanel.tsx:218`).
- **`OrderBar.submitDisabledReason`** (`OrderBar.tsx:784-791`) — gate reason text in amber next to button + `data-state="stale"`.
- **Cmd+K destructive modal** (`CommandPalette.tsx:351-410`) — gold standard: bulleted consequences, OS-style labels.
- **Optimistic order cancel** (`page.tsx:413-431`) — instant `updateOrderStatus` + refresh-after. Keep; B-3 modal goes before this.
- **Login form** — caps-lock detection, password show/hide, lockout (`LoginForm.tsx`). Only nit is W-2.

---

## Score

- BLOCKERs: 4 (offline-shell trade hijack · empty earnings detail pane · destructive-action inconsistency · missing /strategies/* error boundaries)
- WARNINGs: 6
- NITs: 6

**Pillar score: 2/4 — Notable gaps, contract partially met.** The trading workspace itself is well-built; cracks are at the edges (SW offline shell, error boundary coverage, destructive-action consistency) and one critical interior failure (earnings empty-pane).

---

## Files referenced

- `frontend/src/app/(dashboard)/trade/page.tsx`, `app/(dashboard)/strategies/earnings-options-play/page.tsx` (197-220), `app/(dashboard)/strategies/[id]/page.tsx` (716-739), `app/(dashboard)/strategies/[id]/_strategy/EquityPanel.tsx` (53-70)
- `app/(dashboard)/alerts/page.tsx` (451-481, 969-995), `app/(dashboard)/pipeline/page.tsx` (553-595, 793-806, 1438-1490), `app/(dashboard)/settings/page.tsx` (350-425, 700-870), `app/(dashboard)/page.tsx` (413-482)
- `app/login/_login/LoginForm.tsx` (215, 365-388), `components/composites/OrderBar.tsx` (770-815), `components/panels/TradePanel.tsx` (987-1076)
- `components/layout/CommandPalette.tsx` (269-410), `components/layout/ProfileMenu.tsx` (83-102, 142), `components/layout/OnboardingTour.tsx` (60-178)
- `components/error/DashboardError.tsx`, `app/(dashboard)/error.tsx`, `app/error.tsx`, `app/global-error.tsx`
- `frontend/public/sw.js` (66-141), `frontend/public/offline.html`

## Screenshots & evidence

- `trade/desktop-1440/navigate-fail.preview.png`, `initial-prefill.preview.png`, `validate-single-leg-prefill-fail.preview.png`
- `strategies-earnings-options-play/desktop-1440/initial.preview.png`
- `strategy-momentum-quality/desktop-1440/initial.preview.png`, `pause-click.preview.png`
- `dashboard/desktop-1440/initial.preview.png`, `alerts/desktop-1440/initial.preview.png`, `settings/desktop-1440/initial.preview.png`, `pipeline/desktop-1440/initial.preview.png`, `login/desktop-1440/after-submit-invalid.preview.png`
- `trade/desktop-1440/console.jsonl` (2× 404 OCC, 2× HTTP/2 errors); `trade/desktop-1440/network.jsonl` (10 ERR_ABORTED at nav start). All other authenticated routes' console logs show 0 errors (10 routes verified).
