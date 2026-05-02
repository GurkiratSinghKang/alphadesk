# Live-Flip Readiness Completion Pass — 2026-05-02

## Pending Item Status

| Item from `00-live-flip-readiness.md` | Status | Evidence |
| --- | --- | --- |
| 9 strategies re-tuned with Wave 5 fix | Partially complete | `WalkForwardObjective` now scopes trials to TRAIN when `train_end` is set, and affected tune scripts label train fitness separately from final OOS. Full multi-hour retune batch was not run in this pass. |
| PEAD wired to data source with AMC/BMO populated | Code complete, data input pending | `FMPEarningsProvider.calendar()` overlays CSV/JSON timing data from `EARNINGS_TIME_SOURCE_PATH` before PEAD consumes the calendar. Production must provide the vendor export. |
| Bootstrap CI on all OOS Sharpes | Code complete | All OOS-producing scripts call the shared 21-day, 1000-iteration block bootstrap helper and emit `sharpe_bootstrap_ci`, `sharpe_ci95_low`, `sharpe_ci95_high`. Cached artefacts need rerun to carry fields. |
| 10 pre-existing test failures triaged | Complete | Focused readiness set passes locally: 12 passed in 3.73s. |

## Verification Run

- `PYTHONPATH=backend .venv/bin/pytest -q backend/tests/test_oos_bootstrap.py backend/data/providers/tests/test_fmp_earnings_time_source.py backend/tuner/tests/test_objective.py`
  - Result: 19 passed.
- `PYTHONPATH=backend .venv/bin/pytest -q backend/strategies/earnings_vol/tests/test_strategy.py::TestRun::test_historical_move_median_sorts_by_event_date_before_tail backend/strategies/regime_adaptive/tests/test_strategy.py::TestRegimeClassification::test_meanrevert_as_default backend/strategies/vwap/tests/test_strategy.py::TestRun::test_open_position_exits_before_session_end backend/api/routes/tests/test_strategies.py::TestOOSMetricsPopulated::test_missing_oos_returns_null_not_zero backend/data/ingestion/tests/test_trade_ledger_sync.py`
  - Result: 12 passed.
- `.venv/bin/python -m py_compile ...`
  - Result: touched OOS/tune/provider/tuner files compile cleanly.

## Retune Batch To Run On CI

These are intentionally not fire-and-forget from a laptop session because the readiness doc estimates 1-5 hours per strategy.

```bash
PYTHONPATH=backend .venv/bin/python scripts/tune_pead.py 30
PYTHONPATH=backend .venv/bin/python scripts/tune_pairs_trading.py 30
PYTHONPATH=backend .venv/bin/python scripts/tune_vrp_harvest.py --trials 25
PYTHONPATH=backend .venv/bin/python scripts/tune_earnings_vol.py 25
PYTHONPATH=backend .venv/bin/python scripts/tune_ts_momentum.py 40
PYTHONPATH=backend .venv/bin/python scripts/tune_regime_adaptive.py 40
PYTHONPATH=backend .venv/bin/python scripts/tune_kama.py 50
PYTHONPATH=backend .venv/bin/python scripts/tune_dual_momentum.py 15
PYTHONPATH=backend .venv/bin/python scripts/tune_orb.py
```

After the batch, rerun the dedicated OOS evaluators so the JSONs publish both final held-out metrics and bootstrap CIs.
