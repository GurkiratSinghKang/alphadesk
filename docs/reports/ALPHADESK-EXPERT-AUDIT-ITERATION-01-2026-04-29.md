# AlphaDesk Expert Audit - Iteration 01

Date: 2026-04-29 EDT
Branch: `feature/strategy-sota-foundation`
Scope: full AlphaDesk app with emphasis on trading safety, earnings-options workflow, dashboard UX, backend data/automation, and production readiness.

## Executive Summary

Five parallel expert-agent teams reviewed AlphaDesk from different operating perspectives: QA/product, frontend/design, backend/data, trader/portfolio manager, and architecture/performance. The first remediation pass focused on high-confidence fixes with direct user or capital-risk impact.

The iteration closed a P0 option-order risk bypass, a P1 webhook fail-open execution path, dashboard/order-ticket strategy drift, light-mode token breakage, tablet layout defects, mobile touch-target issues, misleading live-trading command copy, rejected-order success toasts, and scheduler state corruption that could mark failed windows complete.

This is not the end of the requested 20-cycle hardening loop. It is the first sealed bundle: bugs found, fixes applied, and targeted tests passing. Remaining items are prioritized below so subsequent iterations can continue without losing context.

## Expert Teams Deployed

- QA and product: end-to-end defects, false success states, copy and workflow trust issues.
- Frontend and design: theme system, responsive layout, dashboard density, strategy/order coherence.
- Backend and data: risk gates, pipeline correctness, market-data quality, Claude/agent reliability.
- Traders, hedge-fund PMs, and users: capital-risk behavior, trade readiness, portfolio context, strategy usefulness.
- Architecture and performance: auth boundaries, scheduler ownership, side-effect durability, rate limits, observability.

## Fixed In Iteration 01

### P0/P1 Trading Safety

- Fixed OCC option orders defaulting to `asset_class="equity"` when legacy clients omitted the asset class. OCC-shaped symbols are now normalized to uppercase and forced to option classification server-side.
- Fixed naked-short option checks so OCC-shaped sell legs cannot bypass protection by omitting `asset_class`.
- Fixed option quote freshness to fail closed when `quote_at_fill_ts` is absent. Equity-only legacy orders can still omit it; option orders must carry a fresh chain snapshot timestamp.
- Fixed frontend order submission to uppercase symbols, infer `asset_class` for OCC option symbols, and forward quote timestamps for priced/option orders.
- Fixed TradingView webhook trade execution fail-open behavior. If the aggregate risk gate errors, the webhook now returns `rejected_by_risk` and never invokes the execution agent.

### Backend Automation And Access Control

- Restricted `POST /pipeline/run` to admin users instead of any authenticated user.
- Fixed pipeline scheduler state so a window is marked complete only after the pipeline succeeds.
- Added in-progress and failed-at scheduler markers to prevent duplicate same-day windows and preserve failure visibility.

### Trading UI Correctness

- Fixed dashboard strategy summary drifting from the actual order ticket. The dashboard now controls the order bar strategy selection and submits the same strategy the user sees.
- Fixed `/trade` to show rejected/canceled broker or risk responses as errors instead of success toasts. Rejected orders no longer reset the ticket.
- Updated command palette live-trading copy so the UI no longer implies a user can enable real-capital routing locally. It now explains admin enablement is required.

### Theme, Layout, And Mobile UX

- Added missing legacy/raw CSS token aliases used by older arbitrary-value utilities (`--fg-border`, `--fg-accent`, `--fg-neg`, `--bg-accent-subtle`, `--neutral`, `--chart-*`, and related aliases). This fixes broken card borders, pending states, accent colors, and light-mode rendering gaps.
- Fixed shadcn semantic foreground aliases so primary/destructive/sidebar primary text resolve correctly in both light and dark modes.
- Fixed light-mode destructive foreground contrast.
- Added preferences rehydration inside `ThemeController` so light/system theme works on lightweight routes like `/login`, not only after the trading data bridge mounts.
- Fixed tablet layout overflow by moving the right-rail grid placement from `md` to `lg`, matching the actual two-column breakpoint.
- Raised the mobile nav trigger to a 44px minimum touch target.

## Verification

Targeted checks completed successfully:

- `cd frontend && npm test -- CommandPalette OrderBar apiMappers DashboardLayout TopBar ThemeToggle`
- `cd frontend && npm run typecheck`
- `source .venv/bin/activate && pytest backend/api/routes/tests/test_round6_risk_fixes.py -q`
- `source .venv/bin/activate && pytest backend/api/routes/tests/test_round6_risk_fixes.py backend/api/routes/tests/test_webhooks_live_gate.py -q`
- `source .venv/bin/activate && python -m py_compile backend/api/routes/webhooks.py backend/api/routes/trades.py backend/api/routes/pipeline.py backend/data/ingestion/pipeline_runner.py`

Latest targeted backend safety run: 26 passed.

## Remaining High-Priority Backlog

### P1: Manual Order Risk Gates Still Defer On Some Missing Account Data

The backend has improved fail-closed behavior for option freshness and webhook risk outages, but some account-dependent gates still defer when account data is unavailable. For real-capital mode, missing buying power/equity should generally degrade to "cannot approve" rather than "allow and hope broker rejects."

### P1: Earnings Options Play Is Still More Screener Than Strategy

The earnings page is much stronger than the starting point, but it still needs a true deployable decision framework:

- Expected move vs. historical earnings move.
- IV crush expectation and post-earnings vol percentile.
- Liquidity/width/open-interest quality score.
- Directional vs. neutral setup classification.
- Defined-risk order templates with bracket/risk preview.
- Persistent save/discard/order states across sessions and devices.

### P1: Market Data Provenance Needs Stronger Surface Area

Demo/synthetic/partial data is not uniformly visible across every dashboard, strategy, and order-entry surface. The app should make data quality and source trust impossible to miss before order placement.

### P1: Pipeline And Scheduler Need Single-Instance Ownership

The scheduler state now avoids marking failures complete, but it is still not a distributed lock. Multiple API workers can still race unless a Redis lock or dedicated worker owns scheduled jobs.

### P1: Broker Submission Should Be Behind Durable Ledger/Audit

The architecture team flagged that broker submission can happen before a durable ledger/audit boundary. For production trading, the intended order, risk decision, and idempotency key should be durably recorded before external side effects.

### P2: Claude/Agent Reliability And Cost Controls

Known gaps:

- Some Claude analysis cache paths are write-heavy and do not consistently reuse prior structured analysis.
- Agent Claude calls need hard request timeouts and clear retry policy.
- Prompt payloads for strategy refinement should be bounded by token/field budgets.
- Budget kill switches should actively refuse or degrade nonessential calls, not only log.

### P2: Dashboard Information Architecture

The dashboard still overweights a generic chart and underweights workflow context. A cleaner premium layout should prioritize:

- Account risk and mode.
- Today candidates and strategy queue.
- Open risk by strategy.
- Pending decisions and rejected/needs-data items.
- Watchlist and positions only where they help the next action.

### P2: Frontend Technical Debt

There are still many source lint issues outside the touched files, plus duplicated transport/contract mapping in frontend API utilities. Future cleanup should reduce local mappers and centralize generated/shared schemas.

### P3: Profile/User State

The profile menu cannot reliably show signed-in user identity because auth lives in HttpOnly cookies and no lightweight `/me` hydration path is wired into the chrome.

## Next Iteration Focus

Iteration 02 should continue with:

1. Fail-closed real-capital account-data gates.
2. Real quote snapshot propagation from option-chain rows into order tickets.
3. Earnings Options Play scoring upgrades and card-state persistence.
4. Dashboard redesign toward trade-readiness and risk workflow.
5. Claude timeout/cache/budget enforcement.
