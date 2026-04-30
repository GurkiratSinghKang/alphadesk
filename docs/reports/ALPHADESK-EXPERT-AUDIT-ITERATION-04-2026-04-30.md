# AlphaDesk Expert Audit - Iteration 04

Date: 2026-04-30 EDT
Branch: `feature/strategy-sota-foundation`
Focus: Expert-team audit pass across order-entry seams, Earnings Options Play execution readiness, and non-manual broker paths.

## Summary

Iteration 04 used four review lanes: frontend/design, backend/trading safety, QA/product, and trader/portfolio-manager. The highest-risk pattern was not visual polish; it was ticket intent getting lost between strategy surfaces and broker submission. Several flows either dropped strategy identity, ignored plain-equity trade deep-links, or let option orders look fresh without a real option-chain timestamp.

This pass closes those gaps and tightens non-manual order safety. Dashboard and `/trade` tickets now preserve the selected strategy, chart trade links pre-fill real tickets, multi-leg option orders preserve each leg's own price, option timestamps are no longer fabricated, webhook/MCP order paths honor the admin halt, and option chain provenance fails closed when it cannot be verified.

## Expert Findings

- Frontend/design: chart limit deep-links were emitted but not consumed by `/trade`; the order ticket could submit with a default strategy instead of the intended strategy.
- Backend/trading safety: webhook and MCP order-entry paths shared aggregate risk gates but did not explicitly honor the admin halt before delegating.
- QA/product: the frontend could fabricate `quote_at_fill_ts` for option orders, making stale option data appear fresh to the backend.
- Trader/PM: multi-leg option orders could collapse per-leg limits into the top-level ticket price, which is unacceptable for spreads and earnings plays.
- QA/product: dashboard strategy selection did not reach the order API, weakening auditability and strategy-level reporting.

## Fixed

- `/trade` now parses plain-equity chart links such as `symbol`, `side`, `qty`, `type`, `limit`, `price`, `stop`, and `strategy`, then pre-fills the actual order ticket.
- `/trade` now forwards the selected strategy on submit, with the current ticket selection winning over a stale URL default.
- Dashboard staged orders now send `strategy` to the backend.
- `OrderBar` now adopts late-arriving default strategy and stop values, matching the existing deep-link behavior for symbol, side, quantity, type, and price.
- Frontend order mapping now preserves explicit per-leg prices for multi-leg options instead of copying the top-level price across every leg.
- Frontend order mapping no longer fabricates quote freshness timestamps for option orders; option tickets must carry a real chain snapshot timestamp.
- Shared backend risk pipeline now checks the admin halt before webhook/MCP orders can reach aggregate risk or broker submission.
- Backend option-chain provenance now fails closed when chain verification errors, instead of allowing the order through on a probe failure.

## Verification

Local checks completed successfully:

- `cd frontend && npm test -- apiMappers earnings-trade-flow trade-deeplink OrderBar`
- `cd frontend && npm run typecheck`
- `cd backend && /Users/GK/Downloads/alphadesk/.venv/bin/python -m pytest api/routes/tests/test_risk_pipeline.py api/routes/tests/test_round6_risk_fixes.py api/routes/tests/test_webhooks_live_gate.py mcp_servers/broker/tests/test_broker_live_gate.py`
- `git diff --check`

Latest focused results:

- Frontend: 4 test files, 126 tests passed.
- Backend: 38 tests passed.

## Remaining Next Targets

- Make "Queue order" durable instead of a local intent button.
- Add persistent save/discard/order state for Earnings Options Play cards.
- Improve mobile swipe-card execution flow with a web equivalent that supports compare, save, queue, and order review without hiding risk.
- Add explicit ticketable-quality gates to candidate cards so thin/no-chain ideas are visually separated from actionable trades.
- Continue dashboard redesign toward a cleaner command center: risk, opportunities, orders, and account health should be first-class; charting should be contextual rather than the page's default center of gravity.
