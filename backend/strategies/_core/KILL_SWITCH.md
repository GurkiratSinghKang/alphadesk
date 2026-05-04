# Three-Layer Kill-Switch — Operator Runbook

## Layers

| # | Layer | Trigger | Default | Resolution |
|---|---|---|---:|---|
| 1 | Drawdown | `(current_nav - peak_nav) / peak_nav <= threshold` | -8% | Manual re-enable via Layer 3 (`re_enable`) |
| 2 | Daily PnL | `realized_today / alloc_capital <= threshold` | -2% | Auto-resets at 00:00 UTC (next session) |
| 3 | Manual | Operator clicks emergency-disable | n/a | Operator clicks re-enable |

`is_enabled` short-circuits in order: Layer 1 → Layer 2 → Layer 3. The first non-enabled layer's `Decision` is returned and subsequent layers are not consulted.

## Querying disabled state

```sql
SELECT strategy, layer, triggered_at, reason, manual_actor
FROM strategy_disabled_events
WHERE resolved_at IS NULL
ORDER BY triggered_at DESC;
```

## Emergency disable from CLI

```python
from sqlalchemy.ext.asyncio import async_sessionmaker
from core.database import _get_engine
from strategies._core.kill_switch import KillSwitch, PostgresDisabledEventsRepo

engine = _get_engine()
async with async_sessionmaker(engine, expire_on_commit=False)() as session:
    ks = KillSwitch(repo=PostgresDisabledEventsRepo(session))
    ks.disable_manual("pead", actor="ops-oncall", reason="data feed degraded")
```

## Re-enable from CLI

```python
ks.re_enable("pead", actor="ops-oncall")
```

## How layers interact

- A Layer-1 drawdown disable doesn't also write a Layer-2 event even if Layer 2 would also trigger (short-circuit semantics).
- Operators investigating an event should look at its `layer` field to understand the trigger; the underlying state (NAV, PnL) is in `metrics`.
- Layer-3 (manual) overrides nothing automatic — it's a separate disable signal. A strategy can have a Layer-3 disable while also being in a Layer-1 drawdown; both must clear before the strategy resumes.

## Production wiring

`pipeline_runner.invoke_strategy_with_kill_switch` is the single production call site. Backtest and signal runners bypass it. A regression test (`test_kill_switch_pipeline.py::TestBacktestBypassesKillSwitch`) asserts that no `kill_switch` reference ever leaks into `backtest_runner.py` or `signal_runner.py`.

Note: the call-site swap (replacing the existing `self._strategy.run(...)` at `pipeline_runner.py:362` with `invoke_strategy_with_kill_switch(...)`) is deferred — see the `TODO(kill-switch-wire-up)` comment. It depends on building a real `KillSwitchContext` from `master_agent` allocation + trade_ledger realized PnL, which is plumbing that lives outside this kill-switch task.

## What is NOT in the kill-switch

- Portfolio-level circuit breakers (out of scope for this push)
- Heartbeat checks for stale signals (out of scope)
- Per-strategy threshold overrides via `StrategyMeta` (follow-on plan)
- Auto-reset of Layer 2 at 00:00 UTC — currently the operator must call `re_enable` for layer-3 events; layer-2 events naturally roll forward when the next session's `realized_today` resets (Layer 2 is a derived check, not a stored disable)

## Layered semantics: stored vs. derived

- **Layer 1 (stored):** triggers on threshold cross, **inserts a row** with `layer=1`. `is_enabled` returns disabled until the operator manually `re_enable`s (which today resolves the most recent Layer-3 row — for a Layer-1 disable, see "Manually clearing a Layer-1 event" below).
- **Layer 2 (stored, but ephemeral):** triggers and inserts a row, but the next session's PnL roll naturally puts the strategy back above threshold; the Layer-2 row remains in the table as audit history but does not block runs once the threshold ratio improves.
- **Layer 3 (stored, manual):** the row IS the disable signal. Operator action via `re_enable` resolves it.

### Manually clearing a Layer-1 event

The current implementation's `re_enable` resolves the most-recent unresolved **Layer-3** row only. To clear a stuck Layer-1 disable, an operator should run:

```sql
UPDATE strategy_disabled_events
SET resolved_at = NOW(), resolved_by = 'ops-name'
WHERE strategy = 'pead' AND layer = 1 AND resolved_at IS NULL
ORDER BY triggered_at DESC LIMIT 1;
```

A future iteration may extend `re_enable` to take an explicit `layer` parameter; for now, the manual SQL is the documented path.
