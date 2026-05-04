# Pillar 6 — Experience Design (R4 re-audit)

**Score: 4/4**  (R1: 2/4, R2: 3/4, R3: 3/4 → now: **4/4**)
**Run:** qa/runs/2026-05-04T19-42-49Z (baseUrl `https://tradingalpha.net`)
**Audited:** 2026-05-04
**Surface:** 24 specs × 2 viewports of compiled production frontend, plus `frontend/src/` source.

---

## What changed since R3

R4 PR #30 closed the three R3-flagged holdouts in a single sprint, and PR #28 completed the empty-state recovery-action sweep across the dashboard. The pillar finally lifts to 4/4.

- **W-6 closed (the last destructive-action holdout).** `frontend/src/app/(dashboard)/settings/page.tsx:398-412` — `handleDisableConnection` now invokes `destructive.request({ title, description, consequences: [...3 lines...], confirmLabel: "Disable connection", onConfirm: () => executeDisableConnection(connection) })` instead of the bare `window.confirm`. Network-wide `grep -rn 'window\.confirm' frontend/src --include='*.tsx' --include='*.ts'` returns **0 matches** — the only remaining `alert(` token is a comment about XSS sanitization in `alerts/page.tsx:47`. All 7 destructive-action sites in the app now share the same modal mental model. `useDestructiveAction` adoption count: **13** (was 11 in R3) across **6 source files** + the hook + the modal.
- **W-3 closed (OCC 404 silent fallback).** `OrderBar.tsx:67-74,101-102,468-491` — new `optionsUnavailable?: { occ: string; underlying: string } | null` + `onRetryOptions?: () => void` props render an inline amber banner (`role="status" aria-live="polite" data-slot="order-bar-options-unavailable"`) when the parent detects a snapshot 404. `trade/page.tsx:360-420,1119-1122` — replaces the silent `.catch(() => {})` from R3: now tracks `optionsUnavailable` state, sets it when the OCC is missing from `getSnapshot` results, and the OrderBar's Retry button bumps an `optionsSnapshotRetry` tick that re-runs the snapshot effect (mirrors the existing `chartReloadKey` pattern). **E2E-verified in this sweep:** `trade/desktop-1440/single-leg-prefill.dom.html` contains `data-slot="order-bar-options-unavailable"` with the live banner text *"Options data unavailable for NVDA260425C00205000 — trading underlying NVDA instead"* and the Retry button. Console errors at `trade/desktop-1440/console.jsonl` show the same 3 OCC 404s the R3 sweep had — but now the user SEES the degradation instead of staring at "--" telemetry.
- **N-5 closed (TradePanel PositionsTab aria-live).** `TradePanel.tsx:790-807` — `<div aria-live="polite" aria-atomic="false" aria-relevant="text">` wraps the position-row map. `polite` (not `assertive`) is correct for continuous quote streams; `aria-atomic="false"` lets AT announce only the row that changed. Verified in `trade/{desktop-1440,mobile-390}/*.dom.html` — every trade DOM (8 files) contains exactly 1 `aria-live` region matching the new wrapper.
- **NEW (R4 PR #28) — Empty-state recovery actions wired across 5 dashboard surfaces.** Each empty state now offers a CTA that takes the user toward the action that would populate it:
  - `PnlAttribution.tsx:54-75` — *"No strategy P&L data yet"* + **Configure strategies →** button (routes to `/strategies`)
  - `LiveSignalFeed.tsx:464-477` — *"No signals yet"* + **Run pipeline →** button (routes to `/pipeline`)
  - `ActivityFeed.tsx:362-369` — *"No activity yet today"* + button to `/pipeline`
  - `StrategyGrid.tsx:263-272` — *"No strategies enabled"* + button to `/strategies`
  - `NotificationCenter.tsx:211-221` — *"No notifications yet"* / *"No {tab} notifications"* + button to `/settings`
  Empty states are no longer dead-ends; every one lands on a route that produces the missing data.
- **NEW-G1 unchanged.** `.github/workflows/deploy.yml:600-615` — visual-regression job retains `continue-on-error: true`. Comment at `:604-605` still notes "Drop continue-on-error once baselines have proven stable for a few deploys (per `qa/visual/README.md` 'Workflow integration' note)." Process gap is the same as R3 — non-blocking by design until baselines stabilise. **NIT (process), not a 4/4 blocker.**

The B-1 / B-2 / B-3 / B-4 R1 BLOCKERs all hold under R4. The earnings calendar resolved 200 in 3.1 s (`19:51:26.323Z` request → `19:51:29.422Z` response) and the detail panel rendered with `detail-header-title` present in DOM. Trade DOMs are full Next.js shells (97,041 / 97,200 bytes desktop / mobile) with **0** `AlphaDesk is offline` markers across all 8 capture files.

---

## Findings

### CLOSED in R4

| ID | Title | Evidence |
|---|---|---|
| **W-6** | Native `window.confirm` for broker disable | `settings/page.tsx:398-412` migrated to `useDestructiveAction` + `<DestructiveConfirmModal>`. `grep -rn 'window\.confirm' frontend/src` → 0 matches. |
| **W-3** | OCC option-contract 404s with no UI affordance | `OrderBar.tsx:67-74,101-102,468-491` new props + amber banner; `trade/page.tsx:360-420,1119-1122` parent wires retry tick; live banner captured in `single-leg-prefill.dom.html` |
| **N-5 (TradePanel)** | `aria-live` on LIVE BOOK price ticks | `TradePanel.tsx:790-807` `aria-live="polite" aria-atomic="false" aria-relevant="text"` wrapper; verified in 8 trade DOMs |
| **R4 PR #28 sweep** | Empty-state dead-ends across 5 dashboard composites | PnlAttribution / LiveSignalFeed / ActivityFeed / StrategyGrid / NotificationCenter all carry recovery-action buttons (verified in source) |

### STILL CLOSED (R1 BLOCKERs verified again under R4)

- **B-1 SW offline-shell hijack on /trade** — `sw.js:83-91` short-circuit unchanged; `:145-159` `__originalUrl` injection unchanged. All 8 trade DOMs are full Next.js shells (~97 KB each); `grep -l 'AlphaDesk is offline'` across all 8 → **0**.
- **B-2 Earnings empty detail pane** — `earnings-options-play/page.tsx:199,213-221` `isFirstPaintRef` first-paint branch unchanged. Calendar API resolved 200 in 3.1 s; `strategies-earnings-options-play/desktop-1440/initial.dom.html` contains `detail-header-title` (success branch). E2E-verified.
- **B-3 Destructive-action consistency** — Adopters of `useDestructiveAction`: dashboard, pipeline, settings, strategies/[id], ProfileMenu, TradePanel (6 files; 13 call sites — was 11 in R3). The `Cmd+K` palette retains its inline `setPendingDestructiveAction` (acceptable per R3).
- **B-4 Per-route error.tsx** — `find frontend/src/app -name 'error.tsx'` returns **12** files (R1: 11 → R2: 12 → R3: 12 → R4: 12). All four previously-missing routes still present and delegate to `<DashboardErrorPage>` with `surface` prop.

### STILL CARRIED OVER (NITs — none blocks 4/4)

- **W-5 OnboardingTour `setTimeout(1500) × 3` + no `prefers-reduced-motion`** — `OnboardingTour.tsx:110, 118, 144` unchanged. Escape-to-dismiss at `:219` still in place from R2's half-fix. NIT.
- **N-3 OrderBar `Submitting…` text-only** — `OrderBar.tsx:833` `{submitting ? "Submitting…" : submitLabel}` — still no `Loader2` glyph or spinner. NIT (600-800 ms roundtrip reads as frozen).
- **N-4 Toast position eye-jump** — Not in capture set. Carrying as not-verified.
- **N-6 Pipeline empty-state next-run time** — `pipeline/page.tsx:171` headline still reads *"Pipeline has not run today — awaiting next scheduled run"*; the `scheduler.next_scheduled_run` value at `:876-882` is computed elsewhere and could be threaded into the headline. NIT.
- **W-1 Watchlist per-symbol fan-out** — Backend / Pillar 4 issue. Demoted in R2; `dashboard/desktop-1440/network.jsonl` still shows the 10-symbol fan-out cluster.
- **NEW-G1 R3-4 visual-regression CI is non-blocking** — `deploy.yml:615` `continue-on-error: true` retained. Worth flipping the gate to required once 1-2 weeks of clean baselines confirm the harness is stable. NIT (process).

### NEW (introduced or surfaced in R4 sweep)

#### NEW-N1. Sibling `aria-live` gap on dashboard `PositionsList` — NIT (Pillar 6 nit, called out by the W-6 agent)

- `frontend/src/components/composites/PositionsList.tsx` — the dashboard's "Book" panel renders `<table>` markup for both Positions and Orders tabs (verified in `dashboard/desktop-1440/initial.dom.html` which contains `data-slot="positions-list"`). `grep -n 'aria-live' frontend/src/components/composites/PositionsList.tsx` returns **0 matches**.
- The component is a different surface than `TradePanel.PositionsTab` — TradePanel powers the right-rail Book on `/trade`, PositionsList powers the dashboard Book on `/`. R4-5 closed N-5 on the TradePanel side; the dashboard sibling is still silent.
- **Severity: NIT.** SR users on the dashboard route hear nothing as P&L marks tick. The fix is a 3-line edit identical to the TradePanel pattern: wrap the `<tbody>` (or its parent) with `aria-live="polite" aria-atomic="false" aria-relevant="text"`. This was flagged by the R4-5 W-3 agent in PR #30's notes — captured here so it doesn't get lost. **Not a 4/4 blocker** because the most consequential live-tick surface (TradePanel on /trade, where users actually watch quotes for execution decisions) IS now covered, and the pillar's contract is met. But it's the lowest-friction next edit.

#### NEW-N2. OCC 404s still land as `level:"error"` in console (informational)

- `trade/desktop-1440/console.jsonl` — same 3 OCC 404s as R2/R3 (NVDA260425C00205000, NVDA260424P00200000, NVDA260424C00220000). Now that W-3 surfaces these in the UI, the console-error tally is no longer a UX issue — it's a backend logging concern (Pillar 4). Treating as informational/closed from a Pillar 6 angle.

---

## What's working — preserve under refactor

- **`<DestructiveConfirmModal>` + `useDestructiveAction`** — now **6 adopter files / 13 call sites**, all funnel through the same hook with `loading` flag, modal-stays-open-on-throw, bulleted consequences. Single mental model across cancel-order, close-all, pause-strategy, cancel-pipeline, sign-out, **broker-disable (new)**.
- **`<EmptyState>` primitive + recovery-action pattern** — 6 primitive consumers (alerts, analytics×4, equity panel, positions, strategies/[id]/page, EarningsCalendarSidebar error branch) PLUS the 5 newly-wired dashboard composites with bespoke recovery CTAs. Empty states are no longer dead-ends across the app.
- **OrderBar W-3 banner** — `role="status" aria-live="polite"` + amber border + `font-mono` OCC + Retry button + parent retry-tick pattern. The pattern generalises to any "snapshot fan-out came back missing a leg" surface — useful template for future multi-leg ticket states.
- **TradePanel PositionsTab `aria-live`** — `polite + atomic="false" + relevant="text"` is the correct combo for continuous price streams. Wraps the `space-y-1` row container so per-row mutations announce without re-announcing the whole table.
- **SW + offline.html cooperation** — `__originalUrl` injection survives offline blip; `/trade*` short-circuit unchanged.
- **Editorial `DashboardError`** with `surface` prop driving `${surface} hit a snag` headline; `Eyebrow` route tag; `digest` ref shown as `t-mono-micro`.
- **Earnings auto-select first-paint branch** — `isFirstPaintRef` short-circuits before `userClearedRef`. E2E-verified again in this sweep with healthy backend.
- **Process safety net:** R2-3 ESLint guards (text/spacing token bans), R3-4 visual-regression in deploy.yml (non-blocking), now R4 closes the last destructive-action holdout. The R1-class fabricated-commit bug has multiple layers of defence.

---

## Score justification

**Pillar score: 4/4 — Excellent. Distinctive, opinionated, generalisable.**

The four R1 BLOCKERs are still closed (B-1 SW hijack, B-2 earnings auto-select, B-3 destructive consistency, B-4 per-route error.tsx). All three R3-identified "path to 4/4" holdouts closed in PR #30:

1. **W-6 broker-disable `window.confirm`** — migrated to `useDestructiveAction` with full consequence list ("Stops the periodic reconciler from reading this account · Existing trades, fills, and history remain in the local ledger · You can re-enable by re-entering credentials in the form above"). Network-wide `window.confirm` count is **0**.
2. **W-3 OCC 404 silent fallback** — replaced silent `.catch(() => {})` with `optionsUnavailable` state + amber banner + Retry tick. **E2E-captured in `single-leg-prefill.dom.html`** showing live degradation message for NVDA260425C00205000 → trading underlying NVDA. Trader is no longer staring at "--" telemetry with no explanation.
3. **N-5 TradePanel aria-live** — correct `polite + atomic="false" + relevant="text"` combo wrapping the position-row map. SR users on /trade now hear quote ticks.

R4 PR #28's empty-state recovery-action sweep is the bonus polish: the dashboard's 5 most prominent empty states (PnlAttribution, LiveSignalFeed, ActivityFeed, StrategyGrid, NotificationCenter) now offer a CTA that lands the user on a route that produces the missing data. No more "ok, what now?" dead-ends.

Remaining open items are all NITs that don't block the contract:
- **NEW-N1** dashboard PositionsList sibling `aria-live` is a 3-line follow-up identical to the TradePanel fix (acknowledged in PR #30 notes).
- **W-5 / N-3 / N-4 / N-6** are long-tail polish (onboarding-tour timing, OrderBar spinner glyph, toast jump, pipeline copy thread).
- **NEW-G1** visual-regression non-blocking is a deliberate phase-in flagged by `qa/visual/README.md` itself.

The pillar lifts because the trading workspace's most consequential surfaces all behave as designed: destructive actions are uniform and editorial; option-contract degradation is honest and recoverable; live price streams are accessible; empty states are productive. The single mental model — `DestructiveConfirmModal` for any irreversible action, `EmptyState` (or composite-local equivalent) with a recovery CTA for any zero-data state, `aria-live` on any continuous numeric stream — generalises to future surfaces without ad-hoc patterns.

- BLOCKERs: **0**
- WARNINGs: **0** (W-1 demoted long ago; W-3 + W-6 closed in R4; W-5 demoted to NIT)
- NITs: **6** (W-5 partial, N-3, N-4, N-6, NEW-G1, NEW-N1)
- Items resolved this sprint vs R3: **4** (W-3, W-6, N-5 TradePanel, R4-1 empty-state sweep)

---

## Files referenced

- `frontend/src/app/(dashboard)/settings/page.tsx:398-412` (W-6 close — useDestructiveAction migration)
- `frontend/src/components/composites/OrderBar.tsx:67-74, 101-102, 468-491, 833` (W-3 close + N-3 holdout)
- `frontend/src/app/(dashboard)/trade/page.tsx:360-420, 1119-1122` (W-3 parent wiring + retry tick)
- `frontend/src/components/panels/TradePanel.tsx:790-807` (N-5 close — aria-live wrapper)
- `frontend/src/components/composites/PositionsList.tsx` (NEW-N1 — dashboard sibling needs aria-live)
- `frontend/src/components/dashboard/PnlAttribution.tsx:54-75` (R4 PR #28 — Configure strategies →)
- `frontend/src/components/dashboard/LiveSignalFeed.tsx:464-477` (R4 PR #28 — Run pipeline →)
- `frontend/src/components/dashboard/ActivityFeed.tsx:362-369` (R4 PR #28)
- `frontend/src/components/dashboard/StrategyGrid.tsx:263-272` (R4 PR #28)
- `frontend/src/components/layout/NotificationCenter.tsx:211-221` (R4 PR #28)
- `frontend/public/sw.js:75-107, 137-167` (B-1 hold)
- `frontend/src/components/destructive/useDestructiveAction.ts`, `DestructiveConfirmModal.tsx` (B-3 hold)
- `frontend/src/app/(dashboard)/strategies/earnings-options-play/page.tsx:199,213-221` (B-2 hold)
- `frontend/src/components/error/DashboardError.tsx` (B-4 hold)
- `frontend/src/components/layout/OnboardingTour.tsx:110, 118, 144, 219` (W-5 partial)
- `frontend/src/app/(dashboard)/pipeline/page.tsx:171, 855-882` (N-6 holdout)
- `.github/workflows/deploy.yml:600-647` (R3-4 visual-regression non-blocking — NEW-G1 unchanged)

## Screenshots & evidence

- `trade/desktop-1440/single-leg-prefill.dom.html` — **W-3 banner E2E-captured**: `data-slot="order-bar-options-unavailable"` + amber styling + "Options data unavailable for NVDA260425C00205000 — trading underlying NVDA instead" + Retry button.
- `trade/{desktop-1440,mobile-390}/*.dom.html` — every one of the 8 trade DOMs has exactly **1 `aria-live` region** (the new TradePanel PositionsTab wrapper).
- `strategies-earnings-options-play/desktop-1440/initial.dom.html` — `detail-header-title` present (success branch). Calendar API: 200 in 3.1 s (request `19:51:26.323Z`, response `19:51:29.422Z`).
- DOM byte sizes: trade desktop-1440/initial-prefill = 97,041 bytes; mobile-390/initial-prefill = 97,200 bytes. Full Next.js shells, not 91-line offline fallbacks.
- Console error tally: `dashboard/alerts/pipeline/strategies-earnings-options-play` desktop-1440 = **0 errors each**. `trade/desktop-1440` = 3 OCC 404s (now surfaced via W-3 banner instead of silent telemetry).
- `grep -rn 'window\.confirm' frontend/src --include='*.tsx' --include='*.ts'` → **0 matches** (only remaining `alert(` is XSS comment in `alerts/page.tsx:47`).
- `useDestructiveAction` adoption: 13 call sites across 6 files (was 11 across 5 files in R3). `find frontend/src/app -name 'error.tsx'` → **12 files** (held).
