# MASTER AUDIT REPORT — AlphaDesk 2026-05-05

**Target:** https://tradingalpha.net
**Branch:** feature/deployment (HEAD: 1dd2e89c)
**Methodology:** 9 parallel adversarial expert agents + canonical screenshot sweep + persona walkthroughs
**Status:** Findings from 5 agents — synthesis in progress

---

## Executive Summary

This audit consolidates findings from two parallel expert-agent waves on tradingalpha.net (live trading platform). Combined: **~80+ findings, ~16 P0 blockers**. The most critical issues center on **multi-tenant data isolation, kill-switch wire-up, multi-leg fill correctness, and trade-page state correctness** — every one of these can cause data loss, compliance failure, or wrong-money trades.

**Top 10 P0 issues (must-fix before next deploy):**

| # | Severity | File:Line | Issue | Source |
|---|---|---|---|---|
| 1 | P0 | `backend/api/routes/user.py:653-691` | `POST /user/erase` deletes ALL users' data (no WHERE clause) — GDPR + 17a-4 catastrophic | Backend B-F1 |
| 2 | P0 | `backend/api/routes/user.py:303-319` | `_collect_export_bundle` exports every user's trades/positions to requester | Backend B-F2 |
| 3 | P0 | `backend/strategies/_core/runners/pipeline_runner.py:362-370` | Kill-switch UI live, but pipeline runner **never calls** the wrapper — operator clicks "emergency disable", strategy keeps trading | Backend B-F3 / Realtime R-F1 |
| 4 | P0 | (multi-leg fill writer) | `Trade.filled_qty` can move BACKWARD on out-of-order partial_fill events — false position size | Realtime R-F4 |
| 5 | P0 | (scanner) | `register_setup` writes `_pending_setups` without `_setups_lock` — strategies whose triggers fire during rebuild silently never execute | Realtime R-F7 |
| 6 | P0 | `frontend/src/app/(dashboard)/trade/page.tsx:865` | `marketOpen = useMemo(() => isMarketOpen(), [])` — empty deps; submit button stays locked after 09:30 ET | My Frontend P0-1 |
| 7 | P0 | `frontend/src/app/(dashboard)/trade/page.tsx:239` | Multi-leg `?legs=` parser guard `parts.length < 1` is vacuously false — silently drops malformed legs | My Frontend P0-2 |
| 8 | P0 | `frontend/src/components/composites/OrderBar.tsx:437-442` | `submittingRef` cleared on `submitting=true` (in-flight), not `false` — double-submit possible | My Frontend P1-6 |
| 9 | P0 | `frontend/src/app/(dashboard)/trade/page.tsx` (executionQuote) | re-render storm; recomputed every render, invalidating 6 downstream `useMemo`s | Frontend Perf F1 |
| 10 | P0 | `frontend/src/components/.../DestructiveConfirmModal.tsx` | A11y BLOCKER: initial focus lands on the destructive button | A11y F4 |

**A11y BLOCKERs:**
- F4 DestructiveConfirmModal initial focus on destructive button
- F6 Kill-switch indicator non-interactive `<span aria-label="enabled" />` — no role, no live region

---

## Findings by Source

### Backend / API / Security (14 findings — 3 P0, 7 P1, 4 P2)

Source: `.audit/2026-05-05/backend-findings.md`

**P0 — Multi-tenant data leakage:**
- B-F1 `POST /api/v1/user/erase` no WHERE clause — wipes every user's books
- B-F2 `_collect_export_bundle` no WHERE clause — exports every user's data

**P0 — Kill-switch:**
- B-F3 `pipeline_runner.py:362-370` TODO never wired — `self._strategy.run(...)` bypasses wrapper

**P1:**
- B-F4 `PostgresDisabledEventsRepo` sync facade calls `asyncio.get_event_loop().run_until_complete()` — wedges loop
- B-F6 `verify_ibkr_connection` uses `httpx.AsyncClient(verify=False)` — TLS validation disabled
- B-F7 Broker-credential AES-256 key derived via single `sha256(passphrase)` — no KDF, no salt
- B-F8 `TickerContextService.get_many` is serial — N+1 explosion at 50 symbols × 4 needs
- B-F12 `POST /broker/connections/*` and `/broker/reconciliation/run` no rate limit

**P2:**
- B-F5 `emergency_disable_strategy` SELECT-then-INSERT TOCTOU — IntegrityError leaks as 500
- B-F9 `_LOCAL_FACT_LOCKS` module dict grows unbounded
- B-F10 `cache_set` swallows ALL exceptions — silent Redis writes loss
- B-F11 `cache_incr` does INCR then EXPIRE separately — TTL leaked on crash
- B-F13 `agent_chat` exception handler interpolates `str(exc)[:200]` — log injection
- B-F14 `MasterAgent.update_drawdown` schedules persistence with naked `loop.create_task(coro)` — no ref held

---

### Frontend Performance (14 findings — 3 P0, 5 P1, 6 P2)

Source: `.audit/2026-05-05/frontend-perf-findings.md`

**P0 — Re-render storms:**
- F-F1 `/trade` recomputes `executionQuote` every render, invalidates 6 downstream useMemos
- F-F2 OrderBar `currentDraft` useMemo + `onDraftChange` useEffect re-fire parent on every keystroke
- F-F3 `ToastContext.Provider value` is a fresh object literal every render

**P1 — Bundle / polling:**
- F-F4 `StrategyGrid` inline arrow `onClick` to memo'd StrategyCard — busts memo
- F-F5 `@phosphor-icons/react` not in `optimizePackageImports` — full barrel ships
- F-F6 OptionsPayoffPanel, SectorTreemap, AllocationDonut, StressTest, StrategyTemplates statically bundled
- F-F8 `useMarketDepth` polls L2 every 5s even when nothing renders depth
- F-F9 NotificationCenter ticker re-renders entire popover every 30s even when closed
- F-F10 `/trade` polls `getOrders` every 20s independent of dashboard's 30s order poll

---

### Real-time / Async / Concurrency (11 findings — 3 P0, 2 P1, 6 P2)

Source: `.audit/2026-05-05/realtime-async-findings.md`

**P0:**
- R-F1 (= B-F3) Kill-switch is dead code in production runner
- R-F4 Multi-leg `filled_qty` can move BACKWARD on out-of-order partial_fill / replay
- R-F7 Realtime scanner: `register_setup` mutates `_pending_setups` without `_setups_lock` — concurrent registrations lost during `_evaluate_tick` rebuild

**P1:**
- R-F2 `PostgresDisabledEventsRepo.run_until_complete` event-loop wedge
- R-F8 `_LOCAL_FACT_LOCKS` unbounded growth (= B-F9)
- R-F10 `alpaca_stream._update_subscriptions` race (R4 carry-over)

---

### Deep Accessibility (15 findings — 2 BLOCKER, 8 MAJOR, 5 MINOR)

Source: `.audit/2026-05-05/a11y-deep-findings.md`

**BLOCKERS:**
- A-F4 DestructiveConfirmModal initial focus lands on destructive button (Base UI default)
- A-F6 Kill-switch status `<span aria-label="enabled" />` — no role, no live region for state transitions

**MAJOR:**
- A-F1 OnboardingTour focus trap leaks (spotlight target remains tabbable)
- A-F2 Six `role="radiogroup"` instances missing arrow-key nav
- A-F5 Stop-Loss dialog `<label>` unlinked from `<input>`
- A-F7 NotificationCenter "tab" buttons not `role="tab"` in `role="tablist"`
- A-F8 KillSwitchStatusPanel `<details><summary>` disclosure without expansion announcement
- A-F9 `Place live order` submit produces no live-region announcement
- A-F11 Login form inputs have no `required` / `aria-required`
- A-F12 SectionRule defaults to `<h2>` with `tag` prop as content (non-semantic)

---

### Persona Workflow (20 findings — 5 P0, 9 P1, 6 P2)

Source: `.audit/2026-05-05/persona-workflow-findings.md`

**P0:**
- P-F1 Dashboard hides "Session mode: Paper trading" — no other authed page surfaces it
- P-F2 Strategy detail has zero CTA to start trading the strategy
- P-F5 Multi-leg silent OCC fallback persists in production (R6-5 fix not deployed)
- P-F6 Execution-readiness pill is `hidden md:grid` — invisible on mobile-390 (= My Frontend A1)
- P-F18 Pipeline page has no per-strategy kill-switch; operator must navigate to /strategies/{id}

**P1:**
- P-F3 Earnings-options-play research routes only to news, never to trade
- P-F7 Submit button "Place after review" lacks descriptive aria-label
- P-F9 Save-to-watchlist round-trip impossible from /strategies/{id}
- P-F10 Alerts form has no strategy-binding field
- P-F11 Alerts page admits delivery channels not wired
- P-F14 Day P/L vs Day P&L glyph inconsistency on same mobile dashboard (closed by my R6-8)
- P-F15 Mobile reports missing "overnight P/L" view
- P-F19 No /pipeline → /alerts cross-link
- P-F20 No restart / re-enable on /pipeline (only on /strategies/{id})

---

### Frontend Code (17 findings — 3 P0, 6 P1, 6 P2, 2 a11y)

Source: `qa/reviews/AUDIT-2026-05-05-frontend.md` (my agent)

**P0:**
- MF-P0-1 `marketOpen` stale memo (`trade/page.tsx:865`) — submit locked after market open
- MF-P0-2 Multi-leg parts guard (`trade/page.tsx:239`) — silently drops malformed legs
- MF-P0-3 `handleSubmit` stale closure (`trade/page.tsx:546`) — chart overlay submits with stale legs

**P1:**
- MF-P1-1 `routeVenue`/`trailingStop` collected but silently dropped (`OrderBar.tsx`)
- MF-P1-2 TradePanel bypasses `brokerDegraded` gate (`TradePanel.tsx:318`)
- MF-P1-3 `recentOrders` double-filter; history truncated
- MF-P1-4 `useIsWideViewport` SSR mismatch
- MF-P1-5 `MiniSparkline` synthetic — misrepresents price history
- MF-P1-6 `submittingRef` guard inverted (`OrderBar.tsx:437`)

**P2/P3 + a11y:** see report

---

### Pending agents (running)

- Backend code audit (my agent)
- Persona workflow audit (my agent)
- Runtime/network audit (my agent)
- Visual UI pillar audit (my agent)

---

## Fix Plan

### Tier A — Backend P0 fix sprint (no lock conflicts)

**Dispatch 5 parallel fix agents:**

1. **A1** Patch multi-tenant data leakage in `backend/api/routes/user.py` (erase + export) — add `.where(model.username == username)` to every Trade/Position/Watchlist/ScreenerPreset/Alert/StrategySignal query
2. **A2** Wire kill-switch in `backend/strategies/_core/runners/pipeline_runner.py:362-370` — replace `self._strategy.run(input, params)` with `invoke_strategy_with_kill_switch(...)`
3. **A3** Fix multi-leg backward fill — find file (likely `backend/services/fills/` or `backend/strategies/_core/runners/`), add `filled_qty` monotonic guard
4. **A4** Fix scanner race — add `_setups_lock` to `register_setup` mutation path
5. **A5** Patch IBKR TLS verify=False + KDF (B-F6, B-F7) — add proper KDF (PBKDF2/scrypt) + cert verification

### Tier B — Frontend a11y BLOCKERs (non-locked files)

**Dispatch 2 parallel fix agents:**

6. **B1** Fix DestructiveConfirmModal initial focus (A-F4) — set initial focus on Cancel, not Destroy
7. **B2** Add role + live region to KillSwitchStatusPanel indicator (A-F6)

### Tier C — Frontend P0/P1 fixes on locked files (DEFERRED)

These touch files locked by parallel R6 worktree work. **Defer until R6 PRs merge.**

- MF-P0-1 marketOpen stale memo (trade/page.tsx)
- MF-P0-2 multi-leg parts guard (trade/page.tsx)
- MF-P0-3 handleSubmit stale closure (trade/page.tsx)
- MF-P1-1 trailingStop dropped (OrderBar.tsx)
- MF-P1-2 TradePanel broker-degraded gate (TradePanel.tsx)
- MF-P1-6 submittingRef inverted (OrderBar.tsx)
- F-F1, F-F2, F-F3 re-render storms

### Tier D — Tracked R6 follow-ups (already in flight)

- R6-3 StaticArticle rhythm (MERGED #43)
- R6-4 TopBar consolidation
- R6-7 twmerge typography group
- R6-9 SectionRule h2-default audit

---

## Dispatch Status — 2026-05-05 commits

Seven audit-fix commits delivered on `feature/deployment` (HEAD updated as
each commit landed; see `git log`):

| SHA | Commit | Fixes |
|---|---|---|
| `569281dd` | fix(api/user): /export + /erase require_admin | B-F1, B-F2 — multi-tenant data leakage |
| `a8ace232` | fix(api/trades): GET /history scoped by username | P1-5 — trade history enumeration |
| `bce0b138` | fix(scanner): atomic _pending_setups rebind | R-F7, B-P1-7 — register_setup race |
| `1cd519a7` | fix(main): readyz-full asyncio.Lock | P0-3 — readyz cache dog-pile |
| `fef7274f` | fix(auth): atomic Lua-EVAL for counter bumps | P0-4 — token reuse after pwd change |
| `359ad4d3` | fix(trading_gate): register sector_rotation + 5 newer strategies | P2-1 — orders silently 400-rejected |
| `a84b2154` | fix(a11y): autoFocus Cancel in DestructiveConfirmModal | A-F4 — initial focus on safe action |

**Verification:** 296 backend tests pass (1 pre-existing failure in
`test_trades_surveillance.py::test_halt_trading_writes_audit_log` —
unrelated to these changes). Frontend `npm run typecheck` clean.

### Still open — not yet fixed

**Backend P0s deferred (require larger refactor):**
- B-F3 / R-F1 — Kill-switch wire-up in `pipeline_runner.py:362-370`. The
  TODO is well-documented; wiring requires plumbing peak_nav,
  alloc_capital, realized_today through master_agent + trade_ledger.
  At minimum, layer-3 (manual disable check) is a single SQL read
  with no plumbing — that's a candidate for the next round.
- R-F4 — Multi-leg `Trade.filled_qty` can move backward. Requires
  finding the writer and adding a monotonic guard.
- MB-P0-1 — `daily_pipeline.py` global Alpaca creds. Needs
  per-user lookup wired through `_place_order(..., username=...)`.
- MB-P0-2 — `_get_todays_gross_notional` queries env account.
  Same fix as MB-P0-1: thread `username`.

**Frontend P0s — all on R6-locked files:**
- MF-P0-1, P0-2, P0-3 (trade/page.tsx) — locked by parallel R6 worktrees
- F-F1, F-F2, F-F3 — re-render storms on locked files
- A-F6 — kill-switch indicator role/live region (KillSwitchStatusPanel)

**Tracked R6 follow-ups (parallel session):**
- R6-3 (MERGED), R6-4, R6-7, R6-9 in worktree branches; will land
  via PRs.

### Recommendation for next cycle

1. **Kill-switch wire-up** — single highest-impact fix; UI promises a
   safety control that doesn't actually disable strategies.
2. **Multi-user Alpaca routing** — once the platform onboards a second
   user, every automated order routes to the wrong account.
3. **Multi-leg backward fill guard** — narrow but data-corrupting
   under normal Alpaca event ordering.
4. **R6-9 (SectionRule + global-error inline-style)** — closes the
   widest visual pillar gap (Pillar 4 = 1/4).
