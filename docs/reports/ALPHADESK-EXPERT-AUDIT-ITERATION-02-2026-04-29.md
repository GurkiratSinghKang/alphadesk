# AlphaDesk Expert Audit - Iteration 02

Date: 2026-04-29 EDT
Branch: `feature/strategy-sota-foundation`
Focus: live-mode account-data risk preflight.

## Summary

Iteration 02 closed the highest-priority remaining trading-safety gap from iteration 01: live orders could proceed when Alpaca account equity or buying power could not be fetched. That made the application depend on a broker-side rejection after AlphaDesk had already approved the order path.

The fix is live-only. Paper/dev mode preserves the existing skip behavior so local testing and paper trading do not become unusable when broker credentials are absent.

## Fixed

- Added `_live_broker_intent_enabled()` to detect the true live-capital state: `LIVE_TRADING_ENABLED=True` and Alpaca base URL pointing at the live broker.
- In live mode, `_aggregate_risk_check()` now rejects immediately when equity/buying-power account data is unavailable.
- In live mode, buy orders now reject when current buying power is unavailable or non-positive.
- Paper mode continues to pass the legacy account-data skip path.

## Verification

Local checks completed successfully:

- `source .venv/bin/activate && pytest backend/api/routes/tests/test_round6_risk_fixes.py -q`
- `source .venv/bin/activate && python -m py_compile backend/api/routes/trades.py`

Latest targeted risk run: 24 passed.

## Remaining Next Targets

- Propagate real option-chain quote timestamps into order tickets instead of relying on client fallback timestamps.
- Add persistent save/discard/order state for Earnings Options Play candidates.
- Tighten Claude timeouts, cache reuse, and budget kill-switch behavior.
- Redesign the dashboard around trade readiness and risk workflow rather than a generic chart-first layout.
