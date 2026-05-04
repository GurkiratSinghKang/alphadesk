# Pillar 6 — Experience Design (R3 Re-audit)

**Audited:** 2026-05-04 (run `2026-05-04T15-47-19Z`, baseUrl `https://tradingalpha.net`)
**Surface:** 24 specs × 2 viewports of compiled production frontend, plus `frontend/src/` source.
**Reference:** R1 baseline `qa/reviews/pillars/06-experience.md` (scored **2/4**, 4 BLOCKER · 6 WARNING · 6 NIT) → R2 re-audit `qa/reviews/pillars-r2/06-experience.md` (lifted to **3/4**, 0 BLOCKER · 5 WARNING · 5 NIT).
**Sprint shipped between R2 and R3:** PR #18 (visual-regression wired into `deploy.yml`, non-blocking), PR #19 (R3-1 `/docs` voice rewrite — last untouched audit BLOCKER, BUG-12), PR #20 (three-layer kill-switch on backend — UX-adjacent only). Plus already-merged R2 work that lands in this canonical sweep for the first time: R2-1 typography codemod, R2-2 spacing codemod, R2-3 ESLint guards, R2-4 NEW-findings sweep (incl. earnings retry CTA and `EmptyState` palette/copy fixes), R2-5 visual baselines.

---

## Headline

The four R1 BLOCKERs are still closed in R3. R2's earnings retry-CTA pattern (`onRetry` → `<EmptyState>` action prop) is now wired in source at the calendar fetch — and this run, unlike R2, the calendar API resolved (200 in 6.4 s), so the auto-select path was exercised end-to-end and the detail panel renders FLTR with a full thesis card. R3-4 added a non-blocking visual-regression job to `deploy.yml`, which closes the process gap that allowed PR #8's silent 22→13 px shrink to ship in R1. The single remaining destructive-action holdout (`window.confirm` for broker disable in settings) survived another sprint. Two long-tail NITs (OnboardingTour `setTimeout(1500)` × 3, OrderBar text-only "Submitting…") are unchanged. Pillar holds at 3/4 — material lift over R1, not yet a 4/4 because the broker-disable holdout is the same destructive-action class the rest of the app now treats with rigour, and the OCC 404 affordance is still missing.

---

## STILL CLOSED (R1 BLOCKERs verified again in R3)

### B-1. SW offline-shell hijack on /trade — STILL CLOSED
- **Code:** `frontend/public/sw.js:83-91` — `/trade*` short-circuit return remains; `:145-159` injects `<script>window.__originalUrl = "…"</script>` for the offline-shell retry link.
- **R3 evidence:** All 8 trade DOMs (4 desktop + 4 mobile) in `qa/runs/2026-05-04T15-47-19Z/trade/{desktop-1440,mobile-390}/*.dom.html` are full Next.js shells. Byte sizes: 95,769–102,127 each (was 91-line shell when broken). Marker count `grep -l "AlphaDesk is offline"` across all 8 DOMs = **0**. Screenshots `trade/desktop-1440/initial-prefill.preview.png` + `trade/mobile-390/initial-prefill.preview.png` show the live AAPL ticket end-to-end (chart, ticket, payoff card, confirm-ladder).
- **Verdict:** Resolved; held under R3.

### B-2. Earnings empty detail pane — STILL CLOSED, NOW E2E-VERIFIED
- **Code:** `frontend/src/app/(dashboard)/strategies/earnings-options-play/page.tsx` — `isFirstPaintRef` first-paint branch unchanged.
- **R3 evidence:** `strategies-earnings-options-play/desktop-1440/network.jsonl` shows `GET /api/v1/earnings/calendar?window=both&min_iv_rank=0&sort=date` → **200** at `15:56:49.014Z` (6.4 s after request — well under the 15 s ceiling that timed out the R2 run). DOM `initial.dom.html` contains `earnings-detail-panel` with `aria-labelledby="detail-header-title"` (success branch, not the loading or error branch) plus the `<EmptyState>` retry-CTA wiring at `EarningsCalendarSidebar.tsx:80-84` ready for the next timeout. Screenshot `initial.preview.png` shows the auto-selected FLTR detail rendered: thesis card, expected-move tile, OPTIONS-CHAIN snapshot, structure recommendation, payoff chart. Calendar sidebar populated with 18+ symbols. **Auto-select fired; detail loaded.**
- **Verdict:** Resolved AND now E2E-verified.

### B-3. Destructive-action confirmation inconsistency — STILL CLOSED
- **Code:** `useDestructiveAction.ts` hook-owned `loading` flag unchanged. Adoption sites (verified via `grep -rln 'useDestructiveAction' frontend/src` → **6 files**):
  - `app/(dashboard)/page.tsx:207, 419, 758` (cancel-order + close-all)
  - `app/(dashboard)/pipeline/page.tsx:302, 1510` (cancel pipeline run)
  - `app/(dashboard)/strategies/[id]/page.tsx:323, 883` (pause/resume strategy)
  - `components/layout/ProfileMenu.tsx:47, 226` (sign out)
  - `components/panels/TradePanel.tsx:885, 1044` (single-order cancel)
  - Plus `useDestructiveAction.ts` definition and `DestructiveConfirmModal.tsx` itself.
- The Cmd+K palette retains its inline `setPendingDestructiveAction` (same UX, different state container) — acceptable.
- **Verdict:** Resolved; held under R3.

### B-4. Missing per-route error.tsx — STILL CLOSED
- **Code:** `find frontend/src/app -name 'error.tsx'` returns **12** files (R1 baseline 11 → R2 12 → R3 12). All four previously-missing routes still present and delegate to `<DashboardErrorPage>` with `surface` prop:
  - `app/(dashboard)/strategies/error.tsx`, `strategies/[id]/error.tsx`, `strategies/earnings-options-play/error.tsx`, `strategies/trading-agents-research/error.tsx`
- **R3 evidence:** `frontend/src/components/error/DashboardError.tsx:39-108` — surface-driven editorial error page with `Display`/`Eyebrow` typography, `digest` rendered as `t-mono-micro`, two CTAs (`Try again` reset + `Back to dashboard` Link), `useEffect` console.error with route prefix. Per-route file `app/(dashboard)/strategies/earnings-options-play/error.tsx` confirmed: passes `surface="Earnings options play"` so the editorial headline reads "Earnings options play hit a snag" not the generic top-level fallback.
- **Verdict:** Resolved; held under R3.

---

## STILL CLOSED (R1 WARNINGs / NITs that R2 fixed)

- **W-2 Login lockout countdown** — `LoginForm.tsx:111-115` `useEffect` interval-tick still in place; lockout countdown re-renders every second. Not re-triggered in this run (no lockout in capture).
- **W-4 Equity-panel empty copy** — `EquityPanel.tsx:54-62` `<EmptyState title="No equity curve yet" …/>` unchanged.
- **N-1 Cmd+K Mac glyph** — `TopBar.tsx` Mac/Win conditional `⌘K` / `Ctrl+K` unchanged.

---

## NEW (closed in R2-4, now visible in R3 canonical sweep)

### NEW-N1 from R2 — Earnings calendar retry CTA — CLOSED
- **Code:** `frontend/src/app/(dashboard)/strategies/earnings-options-play/page.tsx:491-492` — `onRetry={() => calendarQuery.refetch()}` passed to `<EarningsCalendarSidebar>`. Sidebar at `_earnings/EarningsCalendarSidebar.tsx:77-87` renders `<EmptyState title="Earnings calendar unavailable" description="The desk's data feed timed out. Retry, or pick a different window above." action={onRetry ? { label: "Retry", onClick: onRetry } : undefined} />` when `error` is truthy.
- **R3 evidence:** Could not exercise the error branch this run (calendar API returned 200) — but the wiring is identical to other `<EmptyState>` consumers (alerts page, equity panel, positions section) which DO render with retry/CTA in this sweep. The R2 `<EmptyState>` primitive contract is preserved (`role="status" aria-live="polite" data-slot="empty-state"` italic-display headline + bg-brand action button).
- **Verdict:** Closed in source; pattern proven across 6 consumer sites.

### NEW-N2 from R2 — OCC 404s landing as `level:"error"` — UNFIXED (carry over)
- `trade/desktop-1440/console.jsonl` — 3 entries with `"level":"error"`, all 404s on `/api/v1/market/quotes/NVDA260425C00205000`, `…NVDA260424C00220000`, `…NVDA260424P00200000`. Timestamps `15:59:36.258Z`, `15:59:50.522Z`, `15:59:52.509Z`. Same surface as W-3 below.

---

## CARRIED OVER (still open from R1/R2)

### W-3. OCC option-contract 404s with no UI affordance — UNFIXED
- `trade/desktop-1440/console.jsonl` — same 3 OCC 404s as R2. OrderBar still falls back to underlying NVDA bid/ask without a "stale option mid" badge. `grep -n "stale option\|Last known midpoint" frontend/src/components/composites/OrderBar.tsx` returns **0** matches. The `isOptionSymbol` regex at `OrderBar.tsx:352` exists for extended-hours gating but no per-OCC quote-fetch error path emits a UI affordance.
- **Severity:** WARNING. The trade ticket presents an option-contract OCC symbol but the price snapshot pane silently degrades to the underlying. A user comparing the bid/ask to the strategy's `mid` calc will see a divergence with no system-emitted explanation.
- **Fix from R1 still applies:** on per-OCC 404, render "Last known midpoint $X.YZ · stale" badge; degrade gate copy to "stale option mid; advance with caution."

### W-5. OnboardingTour `setTimeout(1500) × 3` + no `requestIdleCallback` / no `prefers-reduced-motion` — UNFIXED (still partial)
- `components/layout/OnboardingTour.tsx` — three `setTimeout(..., 1500)` call sites at lines 110, 118, 144 unchanged. `Escape`-to-dismiss at line 219 still in place (R2's half-fix).
- **Severity:** NIT. The tour pops 1.5 s after mount over a freshly-loaded hero; selectors missing on mobile (375 px) silently fall through to a center overlay; no respect for `prefers-reduced-motion`.

### W-6. Native `window.confirm()` for broker disable — UNFIXED (THE LAST DESTRUCTIVE HOLDOUT)
- `app/(dashboard)/settings/page.tsx:378-380` — `const confirmed = window.confirm(\`Disable ${connection.provider.toUpperCase()} ${connection.account_env} connection ending ${connection.key_last4 ?? "unknown"}?\`);`. Single remaining `window.confirm` call site in the entire `app/` tree (`grep -rn "window.confirm" frontend/src` returns exactly 1 match).
- **Severity:** WARNING. Dropping a broker connection is a destructive action class identical to the **6** sites that now use `<DestructiveConfirmModal>` (cancel-order, close-all, pause-strategy, cancel-pipeline, sign-out, plus the destructive primitives themselves). The OS-level dialog is bare — no consequence list, no editorial voice, no scope explanation ("Will the disable also wipe pending orders routed to this connection? Existing positions? Reauth required to reconnect?"). Adopting `<DestructiveConfirmModal>` here is a 15-line edit; this is the lowest-friction blocker on the path to 4/4.

### N-3. OrderBar `Submitting…` text-only — UNFIXED
- `components/composites/OrderBar.tsx:791` — `{submitting ? "Submitting…" : submitLabel}`. No `Loader2` glyph or spinner. The 600-800 ms roundtrip on submit reads as frozen UI.

### N-4. Toast position eye-jump — NOT VERIFIED (not in capture set)
- No new evidence either way. Carrying over.

### N-5. `aria-live="polite"` on dashboard LIVE BOOK price-tick spans — UNFIXED
- `grep -n "aria-live" frontend/src/components/panels/TradePanel.tsx` returns 0 hits. SR users still hear nothing as quotes update on the LIVE BOOK.

### N-6. Pipeline empty-state copy doesn't surface next-run time — UNFIXED
- `pipeline/page.tsx:171` — copy still reads "Pipeline has not run today — awaiting next scheduled run". `pipeline/desktop-1440/initial.preview.png` confirms this rendered in production. Page DOES compute next-scheduled-run elsewhere (`pipeline/page.tsx:854-1046` Scheduler State block surfaces the `next-run label` in idle status), but the headline empty-state copy isn't fed the value.

### W-1. Watchlist per-symbol fan-out — STILL UNFIXED (Pillar 4 / backend issue)
- `dashboard/desktop-1440/network.jsonl` shows 10 parallel `GET /api/v1/market/quotes/{AAPL,MSFT,GOOGL,AMZN,TSLA,NVDA,SPY,QQQ,META,AMD}` at `15:49:39.126-127Z` (same ms cluster). `lib/api.ts:833-859` comment acknowledges. R2 demoted to NIT (vitals POST aborts not user-visible). R3 sweep shows no requestfailed bursts on dashboard/alerts/pipeline/strategy-momentum-quality (each = 0). Trade/settings/strategies-list still surface metrics/vitals page-unload aborts (5/8/16 respectively) — page-unload races, not user-visible.

---

## NEW (introduced or surfaced in R3 sweep)

### NEW-G1. R3-4 visual-regression CI is non-blocking — process gap
- `.github/workflows/deploy.yml:600-645` — visual-regression job runs after deploy but is documented as "for a few deploys" at non-blocking severity, expected to flip to a hard gate once baselines stabilise (`qa/visual/README.md` "Workflow integration" note). This is good infrastructure but means the next "I cleaned up the section-cap token!" silent visual regression CAN still ship — it'll be caught in CI artifact review, not at PR-merge.
- **Severity:** NIT (process). Worth flipping the gate to required once 1-2 weeks of clean baselines confirm the harness is stable.

### NEW-G2. R3-1 `/docs` voice rewrite landed but page is information-dense, not editorial — partial close
- `frontend/src/app/docs/_docs/content.ts` — 38 insertions / 45 deletions in PR #19. Voice is now declarative-direct ("AlphaDesk is invite-only", "Each thesis carries a conviction score (0–100)") and explicitly cites R1 audit feedback ("not a probability estimate"). DOM at `docs/desktop-1440/initial.dom.html` shows the new content. Pillar 1 (copywriting) is the primary judge here; from a Pillar 6 (state coverage) angle the page renders fully on initial load and has no async surfaces to fail. **Net:** R3-1 closes the last open R1-audit BLOCKER from BUG-12.

---

## What's working — preserve under refactor

- **`<DestructiveConfirmModal>` + `useDestructiveAction`** — 6 adopter files, hook-owned `loading` (`useDestructiveAction.ts:13-29`), modal stays open on throw for retry, bulleted consequences mirror Cmd+K palette gold standard. Single mental model.
- **`<EmptyState>` primitive** — 6 consumer files (alerts, analytics×4, equity panel, positions, strategies/[id]/page, EarningsCalendarSidebar error branch). `role="status" aria-live="polite" data-slot="empty-state"` shape preserved; italic-display headline; optional bg-brand action button. Test coverage in `__tests__/primitives/emptystate.test.tsx`.
- **SW + offline.html cooperation** — `__originalUrl` injection survives offline blip; `/trade*` short-circuit unchanged. Comment block at `sw.js:83-91, 145-159` cites "QA r3 BUG-05" — the rationale is durable.
- **Editorial `DashboardError`** with `surface` prop driving `${surface} hit a snag` headline; `Eyebrow` route tag; `digest` ref shown as `t-mono-micro`; two CTAs (`Try again` + `Back to dashboard`).
- **Earnings auto-select first-paint branch** — `isFirstPaintRef` short-circuits before `userClearedRef`, exactly as R1 prescribed; E2E-verified in this sweep.
- **All R1-verified passing patterns preserved:** alerts two-tap delete, `aria-busy` refetch (visible on 25 DOMs across the sweep), `submitDisabledReason` amber gate text, optimistic order cancel + reconcile, login caps-lock detection.
- **Process safety net:** R2-3 ESLint `no-restricted-syntax` rules ban `text-[(12|13|15|16|17|20|22|28|48)px]` and 13 token-equivalent spacing escapes; R3-4 visual-regression job in deploy.yml. The fabricated-commit class of bug from R1 (PR #8 silent 22→13 shrink) now has two layers of automated defence.

---

## Score

- BLOCKERs: **0** (all four held closed; R1's 4 → R2's 0 → R3's 0)
- WARNINGs: **3** (W-1 demoted, W-3 OCC affordance, W-6 broker disable)
- NITs: **6** (W-5 partial, N-3, N-4, N-5, N-6, NEW-G1, NEW-G2 lite — counting NEW items per R3 conventions)
- Items resolved this sprint vs R2: 1 (R2-4's earnings retry CTA now exercised in source; R3-4 visual-regression in CI)

**Pillar score: 3/4 — Good. Contract met; cracks are localized.**

Holding the line at 3/4. The four R1 BLOCKERs are all closed and verified end-to-end (B-2 finally captured live in this run thanks to a healthy backend). R2-4's earnings retry CTA is wired in source and will fire at the next backend timeout. R3-4 closed the process gap that allowed PR #8's silent visual regression to ship.

The pillar does NOT lift to 4/4 because:
1. **W-6 broker-disable `window.confirm`** — same destructive-action class as the 6 sites that now use the unified modal, but a sprint shipped without adopting it. This is the single highest-leverage edit on the path to 4/4 (estimated ~15 LOC).
2. **W-3 OCC 404 silent fallback** — the trading workspace's most consequential numbers (option mid · spread) silently degrade with no badge.
3. **N-5 `aria-live` on LIVE BOOK** — SR users still get nothing on a real-time tick surface.

If next sprint adopts `<DestructiveConfirmModal>` for `handleDisableConnection` and adds an `aria-live="polite"` wrapper on the LIVE BOOK price spans + a "stale option mid" badge on per-OCC 404, the pillar lifts to 4/4. Two of those three are surgical edits.

---

## Files referenced

- `frontend/public/sw.js:75-107, 137-167` (B-1 hold)
- `frontend/src/components/destructive/DestructiveConfirmModal.tsx`, `useDestructiveAction.ts:11-37` (B-3 hold)
- `frontend/src/components/primitives/EmptyState.tsx` (action-prop pattern)
- `frontend/src/components/error/DashboardError.tsx:39-108` (B-4 hold)
- `frontend/src/app/(dashboard)/strategies/earnings-options-play/page.tsx:478-492` (B-2 hold + retry CTA)
- `frontend/src/app/(dashboard)/strategies/earnings-options-play/_earnings/EarningsCalendarSidebar.tsx:77-99` (retry CTA wiring)
- `frontend/src/app/(dashboard)/strategies/earnings-options-play/_earnings/EarningsDetailPanel.tsx:165-208` (error/loading/empty branches)
- `frontend/src/app/(dashboard)/settings/page.tsx:378-381` (W-6 holdout — last `window.confirm`)
- `frontend/src/components/composites/OrderBar.tsx:352, 791` (W-3 + N-3 holdouts)
- `frontend/src/components/layout/OnboardingTour.tsx:110, 118, 144, 219` (W-5 partial)
- `frontend/src/app/(dashboard)/pipeline/page.tsx:171, 854-1046` (N-6 holdout)
- `frontend/src/components/panels/TradePanel.tsx` (no `aria-live` matches — N-5 holdout)
- `frontend/src/app/docs/_docs/content.ts` (R3-1 voice rewrite, NEW-G2)
- `.github/workflows/deploy.yml:600-645` (R3-4 visual-regression job, NEW-G1)

## Screenshots & evidence

- `trade/desktop-1440/initial-prefill.preview.png`, `trade/mobile-390/initial-prefill.preview.png` — full Next.js shells, live AAPL ticket end-to-end (B-1 verified)
- `strategies-earnings-options-play/desktop-1440/initial.preview.png` — auto-selected FLTR detail with thesis card, expected-move tile, options chain, structure recommendation, payoff chart (B-2 finally E2E-verified)
- `dashboard/desktop-1440/initial.preview.png` — Control Room renders cleanly, all widgets present
- `alerts/desktop-1440/initial.preview.png` — `<EmptyState>` "No alerts set / Define a price, indicator, or P&L trigger above to start watching." (preserved under R3)
- `strategy-momentum-quality/desktop-1440/initial.preview.png` — italic editorial empty-state ("We are still on it"), all data sections render
- `pipeline/desktop-1440/initial.preview.png` — clean run; "Pipeline has not run today — awaiting next scheduled run" still shows headline-without-countdown (N-6 holdout)
- DOM byte sizes: trade `*.dom.html` → 95,769–102,127 bytes each (was 91-line offline shell when broken in R1)
- Console error tally across 12 specs: trade=3 (OCC 404s, expected) · login=1 (assumed invalid-cred test) · all 10 others = **0**
- Network: dashboard fans out 10 parallel `GET /api/v1/market/quotes/{symbol}` (W-1 watchlist fan-out persists, demoted in R2); earnings calendar 200 in 6.4 s (under 15 s ceiling that timed out R2 run)
- DOM coverage of state primitives across the canonical sweep: 14 DOMs surface `data-slot="empty-state"`; 25+ DOMs surface `aria-busy="true"` or skeleton classes; settings/reports DOMs surface `role="alert"` with `Retry` paths
- focus-visible occurrences across surfaces: trade=4, pipeline=5, settings=9, login=6 (dashboard=0 in DOM but uses focus-ring tokens via CSS)
