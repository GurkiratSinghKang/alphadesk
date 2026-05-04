# Pillar 6 — Experience Design (Re-audit)

**Audited:** 2026-05-04 (run `2026-05-04T13-45-11Z`, baseUrl `https://tradingalpha.net`)
**Surface:** 24 specs × 2 viewports of compiled production frontend, plus `frontend/src/` source.
**Reference:** Original `qa/reviews/pillars/06-experience.md` (scored **2/4**, 4 BLOCKER · 6 WARNING · 6 NIT).
**Sprint shipped between audits:** PR-1 (per-route `error.tsx` + editorial `DashboardError`), PR-2 (earnings auto-select first row), PR-3 (SW `/trade*` skip + `__originalUrl` injection in `offline.html`), PR-4 (`<DestructiveConfirmModal>` + `useDestructiveAction` unified across 5 sites), PR-6d (`<EmptyState>` primitive consolidation).

---

## Headline

The four BLOCKERs are closed. SW no longer hijacks `/trade` — all 12 trade DOMs (desktop+mobile) render the real ticket; per-route `error.tsx` exists at every previously-uncovered sub-route; the destructive modal pattern is now the single source of truth for cancel-order, close-all, pause-strategy, cancel-pipeline, and sign-out; the earnings auto-select bug is fixed in code (cannot E2E-confirm in this run because the `/api/v1/earnings/calendar` endpoint timed out at 15 000 ms — a backend issue surfaced by the existing "DATA UNAVAILABLE" banner). Two outstanding WARNINGs (W-3 silent OCC 404, W-6 `window.confirm` for broker disable) survived. The pillar now meets the contract; gaps that remain are real but localized.

---

## CLOSED (was BLOCKER → resolved)

### B-1. SW offline-shell hijack on /trade — FIXED
- **Code:** `frontend/public/sw.js:83-91` — explicit guard `if (url.pathname === "/trade" || url.pathname.startsWith("/trade/")) return;` returns from the `fetch` handler before `event.respondWith`, so the browser handles the request directly. `offline.html:84-105` now contains a `<!--FROM_URL_PLACEHOLDER-->` slot the SW (`sw.js:148-159`) injects with `<script>window.__originalUrl = "/trade?…"</script>`; the retry link's `onclick` rewrites `href` to that value before navigating.
- **Evidence:** All 6 desktop trade DOMs and 6 mobile trade DOMs in `qa/runs/2026-05-04T13-45-11Z/trade/{desktop-1440,mobile-390}/*.dom.html` are full Next.js shells (96–103 KB each, 0 occurrences of "AlphaDesk is offline"). Screenshot `trade/desktop-1440/initial-prefill.preview.png` shows the live AAPL chart, ticket, payoff card, and confirm-ladder. Compare prior run where 4/7 desktop DOMs were the 91-line offline shell.
- **Verdict:** Resolved.

### B-2. Earnings empty detail pane — FIXED IN CODE (cannot E2E-verify; backend timeout)
- **Code:** `frontend/src/app/(dashboard)/strategies/earnings-options-play/page.tsx:199-220` — new `isFirstPaintRef` ref + branch at line 215-220: `if (isFirstPaintRef.current) { isFirstPaintRef.current = false; setSelectedSymbol(visibleRows[0].symbol, "pointer"); return; }` runs unconditionally on first calendar resolution before `userClearedRef` is consulted, exactly as the original recommendation prescribed.
- **Evidence (current run):** `strategies-earnings-options-play/desktop-1440/network.jsonl` shows `GET /api/v1/earnings/calendar?window=both&min_iv_rank=0&sort=date` → `requestfailed net::ERR_ABORTED` at `13:54:09`, retried at `13:54:10`. The "DATA UNAVAILABLE" status-strip banner ("Latest: Request timed out after 15000ms") fires before the calendar resolves. Screenshot `initial.preview.png` therefore shows "Loading earnings…" in both panes and a 70 % vertical void below — but this is a backend timeout, not the auto-select bug. The auto-select can't fire because `visibleRows.length === 0`.
- **Verdict:** Code fix is correct and matches the prior recommendation. **Re-defer end-to-end verification** until the backend is healthy. This is logged as outstanding because the user-facing screen still looks broken in the current run, but the cause is now a different problem (Pillar 4/backend, not Pillar 6/UX state coverage).

### B-3. Destructive-action confirmation inconsistency — FIXED
- **Code:** `frontend/src/components/destructive/DestructiveConfirmModal.tsx` and `useDestructiveAction.ts` ship a shared modal whose `loading` state is **owned by the hook** (`useDestructiveAction.ts:17-29`), so consumers cannot double-submit; `setPending(null)` only fires after the awaited `onConfirm` resolves; on throw the modal stays open for retry. Adopted at:
  - Single-order cancel: `components/panels/TradePanel.tsx:960` (modal at line 1044)
  - Close-all/cancel-all from dashboard: `app/(dashboard)/page.tsx:457` (modal at line 758)
  - Pause/Resume strategy: `app/(dashboard)/strategies/[id]/page.tsx:435` (modal at line 883)
  - Cancel pipeline run: `app/(dashboard)/pipeline/page.tsx:593` (modal at line 1510)
  - Sign out: `components/layout/ProfileMenu.tsx:108` (modal at line 226)
- The Cmd+K palette retains its inline `setPendingDestructiveAction` modal (`components/layout/CommandPalette.tsx:103, 271, 301, 333`) — same bulleted UX, different state container. Acceptable because the palette is a single self-contained scope.
- **Verdict:** Resolved. Single mental model across the app.

### B-4. Missing per-route error.tsx — FIXED
- **Code:** `find frontend/src/app -name 'error.tsx'` now returns **12** files (was 11), the four previously-missing routes all present:
  - `app/(dashboard)/strategies/error.tsx` (surface "Strategies catalogue")
  - `app/(dashboard)/strategies/[id]/error.tsx`
  - `app/(dashboard)/strategies/earnings-options-play/error.tsx` (surface "Earnings options play")
  - `app/(dashboard)/strategies/trading-agents-research/error.tsx`
- All four delegate to `<DashboardErrorPage>` with a `surface` prop; `DashboardError.tsx:48-49` uses it for the `Eyebrow` route tag and as `${surface} hit a snag` headline. Editorial voice (Display + italic Newsreader fallback) at `DashboardError.tsx:74-86`. Console error logs are emitted with route prefix in each `useEffect`.
- **Verdict:** Resolved. Localized recovery is now possible at every strategies sub-route.

---

## CLOSED (was WARNING → resolved)

### W-2. Login lockout countdown — FIXED
- **Code:** `app/login/_login/LoginForm.tsx:111-115` — `useEffect(() => { if (!locked) return; const id = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(id); }, [locked])`. Tick fires every 1 s while locked; cleared on unlock. `lockoutRemainingMs` recomputes from `now` (line 103-109).
- **Verdict:** Resolved.

### W-4. Equity-panel empty copy with no recovery — FIXED
- **Code:** `app/(dashboard)/strategies/[id]/_strategy/EquityPanel.tsx:54-62` — replaces the bespoke "Not enough data for equity curve." with `<EmptyState title="No equity curve yet" description="The strategy needs at least one closed trade before this chart renders. Open a paper position to start tracking." />`. Concrete next-step copy.
- **Verdict:** Resolved.

---

## CLOSED (was NIT → resolved)

- **N-1 Cmd+K Mac glyph** — FIXED at `components/layout/TopBar.tsx:28, 138`: `const [isMac, setIsMac] = useState(false)` → `<kbd>{isMac ? "⌘K" : "Ctrl+K"}</kbd>`. (`OnboardingTour.tsx:62` still uses "Cmd+K (or Ctrl+K)" — acceptable in tour copy.)

---

## CARRIED OVER (still open)

### W-1. requestfailed bursts on authenticated mounts — PARTIALLY UNFIXED
- `trade/desktop-1440/network.jsonl`: 4 `net::ERR_ABORTED` POSTs (all to `/api/v1/metrics/vitals` — these are page-unload races, not user-visible failures).
- **Watchlist still per-symbol:** `dashboard/desktop-1440/network.jsonl` shows 6 parallel `GET /api/v1/market/quotes/{AAPL,MSFT,GOOGL,AMZN,NVDA,…}` at the same ms timestamp (`13:47:40.050-051`). `lib/api.ts:833-859` documents this in a comment ("There is no batched `/snapshots?symbols=A,B,C` endpoint. This function therefore fans out 6 individual requests.") — comment acknowledges the issue but doesn't fix it. Backend would need a `?symbols=` endpoint.
- **Other surfaces:** `strategies-list` 16 requestfailed, `settings` 11. All `metrics/vitals` race-aborts on unmount, not user-visible.
- **Severity:** Demoted to NIT. Vitals aborts are noise, not UX. Watchlist fan-out is a backend-shape issue (Pillar 4).

### W-3. OCC option-contract 404s with no UI affordance — UNFIXED
- `trade/desktop-1440/console.jsonl:1-3`: 3× `Failed to load resource: 404` for `/api/v1/market/quotes/NVDA260424C00220000`, `…P00200000`, `NVDA260425C00205000`. Same silent fallback as prior run. OrderBar still shows underlying NVDA bid/ask without a "stale option mid" badge.
- **Fix from prior audit still applies:** render "Last known midpoint $X.YZ · stale" badge on per-OCC 404; degrade gate copy.

### W-5. OnboardingTour still 1500 ms timeout, no `requestIdleCallback` / no `prefers-reduced-motion` — PARTIAL
- `components/layout/OnboardingTour.tsx:110, 118, 144` — three `setTimeout(..., 1500)` call sites unchanged.
- `OnboardingTour.tsx:214-219` — Esc binding present (good); `e.key === "Escape"` closes the tour. Score: half-fixed.

### W-6. Native `window.confirm()` for broker disable — UNFIXED
- `app/(dashboard)/settings/page.tsx:378-381` — `window.confirm(\`Disable ${connection.provider.toUpperCase()} ${connection.account_env} connection ending ${connection.key_last4 ?? "unknown"}?\`)`. Single remaining `window.confirm` call site in the entire `app/` tree. OS-level dialog, no styling, no scope explanation.
- Dropping a broker connection is a destructive action class identical to the 5 sites that now use `<DestructiveConfirmModal>`. Should be the 6th adopter.

### N-3. OrderBar `Submitting…` text-only — UNFIXED
- `components/composites/OrderBar.tsx:791` — `{submitting ? "Submitting…" : submitLabel}`. No `Loader2` glyph, no spinner, just text. The 600-800 ms roundtrip on submit reads as frozen UI.

### N-4. Toast position eye-jump — NOT VERIFIED (not in capture set)
- No new evidence either way. Carrying over.

### N-5. `aria-live="polite"` on dashboard LIVE BOOK price-tick spans — UNFIXED
- `grep -n 'aria-live' frontend/src/components/panels/TradePanel.tsx` returns 0 hits. SR users still hear nothing as quotes update on the dashboard book.

### N-6. Pipeline empty-state copy doesn't surface next-run time — UNFIXED
- `app/(dashboard)/pipeline/page.tsx:171` — copy still reads "Pipeline has not run today — awaiting next scheduled run". No countdown rendered. (Note: the file does compute next-scheduled-run elsewhere — `pipeline/page.tsx:854-1046` — but the headline copy isn't fed the value.)

---

## NEW (introduced or surfaced this run)

### NEW-N1. Earnings calendar API timeout (15 s) leaves the page in "Loading earnings…" forever
- `strategies-earnings-options-play/desktop-1440/network.jsonl` — `/api/v1/earnings/calendar` `requestfailed`. Status-strip banner at the top of the screen reads "DATA UNAVAILABLE · Strategies · grouped 1 backend issue; affected views stay cached, locked, or empty. Latest: Request timed out after 15000ms" — that's good editorial framing, but the strategy page's left+right columns just display "Loading earnings…" with no retry CTA, no "served from cache" affordance, no "switch to current week only" suggestion. Once the timeout fires, the user has no in-page recovery — they must click the topbar "Dismiss" or navigate away.
- **Severity:** WARNING. The status-strip is a brand affordance (good); but the page-local empty state during a timeout should mirror the alerts/equity pattern (concrete next step).
- **Fix:** when the calendar query is in `error` state (post-timeout), render `<EmptyState title="Earnings calendar unavailable" description="The window is timing out at 15 s. Try a narrower window, or retry." action={{ label: "Retry", onClick: () => refetch() }} />`.

### NEW-N2. Trade page `/api/v1/market/quotes/{OCC}` 404s land at `level:"error"` in console
- `trade/desktop-1440/console.jsonl` — 3 entries with `"level":"error"`. These are expected (option contract not in backend's symbol set) but should be downgraded to `warn` or filtered before they hit `console.error`, otherwise any error-rate alerting (Sentry, Datadog) will firehose. Cross-cuts with W-3.

---

## What's working — preserve under refactor

- **`<EmptyState>` primitive** (`components/primitives/EmptyState.tsx`) with `role="status"`, `aria-live="polite"`, `data-slot="empty-state"`, italic display headline, optional CTA. Used at `alerts/page.tsx:968`, `analytics/page.tsx:260, 332, 408, 531`, `EquityPanel.tsx:56`, `PositionsSection.tsx:54`, `strategies/[id]/page.tsx:780`. Six clean adopters; voice and chrome consistent.
- **`<DestructiveConfirmModal>` + `useDestructiveAction`** — hook-owned `loading` flag prevents double-submit; modal stays open on throw for retry; bulleted consequences list mirrors the Cmd+K gold-standard pattern.
- **SW + offline.html cooperation** — `__originalUrl` injection preserves deep-link state across an offline blip. Comment block at `sw.js:83-91, 145-159` explicitly cites "QA r3 BUG-05" — easy for future contributors to find the rationale.
- **Editorial `DashboardError`** with `Display`/`Eyebrow` typography, `surface` prop driving headline + eyebrow, `route` prop for telemetry, `digest` ref displayed as `t-mono-micro`.
- **All previously-passing patterns preserved:** alerts two-tap delete, `aria-busy` refetch, `submitDisabledReason`, optimistic order cancel + reconcile, login caps-lock detection.

---

## Score

- BLOCKERs closed: **4/4** (one closed in code, E2E-blocked by backend timeout — see B-2)
- WARNINGs closed: **2/6** (W-2 lockout tick, W-4 equity copy)
- NITs closed: **1/6** (N-1 ⌘K)
- NEW issues: 2 (both NIT/WARNING tier)
- Outstanding: 4 WARNING (W-1, W-3, W-5 partial, W-6) · 4 NIT (N-3, N-4, N-5, N-6) · 1 NEW WARNING

**Pillar score: 3/4 — Good. Contract met; cracks are localized.**

The four blockers — the headline failures of the prior audit — are all addressed at the code level with rigour (hook-owned loading state, surface-prop editorial errors, SW-injected deep-link recovery, idempotent first-paint auto-select). The remaining WARNINGs are all single-site issues (one option-quote 404 affordance, one window.confirm holdout, one onboarding-tour timing residue) plus one watchlist-fan-out that's a backend shape issue. None block the trading-workspace contract. Score lifts from 2/4 to 3/4; not 4/4 because W-3 and NEW-N1 still leave the user momentarily without a clear next step on a primary surface.

---

## Files referenced

- `frontend/public/sw.js:60-173`, `frontend/public/offline.html:84-105`
- `frontend/src/components/destructive/DestructiveConfirmModal.tsx`, `useDestructiveAction.ts`
- `frontend/src/components/primitives/EmptyState.tsx`
- `frontend/src/components/error/DashboardError.tsx`
- `frontend/src/app/(dashboard)/strategies/error.tsx`, `strategies/[id]/error.tsx`, `strategies/earnings-options-play/error.tsx`, `strategies/trading-agents-research/error.tsx`
- `frontend/src/app/(dashboard)/strategies/earnings-options-play/page.tsx:189-234`
- `frontend/src/app/(dashboard)/strategies/[id]/_strategy/EquityPanel.tsx:54-62`
- `frontend/src/app/login/_login/LoginForm.tsx:96-115`
- `frontend/src/components/layout/TopBar.tsx:28, 138`
- `frontend/src/app/(dashboard)/settings/page.tsx:378-381` (W-6 holdout)
- `frontend/src/components/composites/OrderBar.tsx:791` (N-3 holdout)
- `frontend/src/components/layout/OnboardingTour.tsx:110, 118, 144, 214-219` (W-5 partial)
- `frontend/src/app/(dashboard)/pipeline/page.tsx:171` (N-6 holdout)
- `frontend/src/lib/api.ts:833-859` (W-1 watchlist fan-out comment)

## Screenshots & evidence

- `trade/desktop-1440/initial-prefill.preview.png`, `single-leg-prefill.preview.png`, `validate-single-leg-prefill-fail.preview.png` (all real ticket, no offline shell)
- `strategies-earnings-options-play/desktop-1440/initial.preview.png`, `row-selected.preview.png`, `scrolled-mid.preview.png` (backend timeout — auto-select cannot E2E-verify)
- `dashboard/desktop-1440/initial.preview.png` (clean, all widgets render)
- `alerts/desktop-1440/initial.preview.png` (EmptyState in use, editorial copy)
- `pipeline/desktop-1440/initial.preview.png` (clean)
- `strategy-momentum-quality/desktop-1440/initial.preview.png` (clean)
- DOM byte sizes: `trade/desktop-1440/*.dom.html` → 96–103 KB each (was 91-line offline shell in 4/7 prior captures)
- Console error tally across 13 specs: `trade=3` (OCC 404s, expected) · `login=1` (assumed invalid-cred test) · all 11 others = 0
- Network: `dashboard/network.jsonl` shows 6 parallel `GET /api/v1/market/quotes/{symbol}` (W-1 watchlist fan-out persists)
- `strategies-earnings-options-play/network.jsonl` line 4: `requestfailed` for `/api/v1/earnings/calendar` at 13:54:09 (15 s timeout — NEW-N1)
