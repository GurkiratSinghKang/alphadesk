# Strategies

Every strategy in AlphaDesk is a Python package under `backend/strategies/<name>/`
implementing the `Strategy` ABC defined in
[`backend/strategies/_core/protocol.py`](../backend/strategies/_core/protocol.py).

## Quick reference

- **Protocol**: `run(input: StrategyInput, params: StrategyParams) → StrategyResult`
- **CLI**: `python -m strategies.<name> {schema,backtest,signal,tune,analyze-day,validate-params,explain}`
- **Registry**: `@register_strategy(StrategyMeta(...))` in `strategy.py` — see `strategies/_core/protocol.py`
- **Tests**: fixtures build `StrategyInput` directly; no fake providers

## Building a new strategy

1. Create `backend/strategies/<name>/` package.
2. Write `config.py` with `<Name>Params(StrategyParams)` — use `Field(json_schema_extra={"tune": ...})` for tunable fields.
3. Write `strategy.py` implementing `Strategy`:
   - Set `PARAMS_MODEL = <Name>Params`
   - Implement `universe(asof, state) → list[str]`
   - Implement `run(input, params) → StrategyResult`
   - (Optional) override `on_fill(fill, state) → dict`
   - Decorate with `@register_strategy(StrategyMeta(name=..., lookback_days=..., ...))`
4. Write `__main__.py` — 5-line CLI dispatcher:
   ```python
   from strategies._core.cli import run_cli
   from strategies.<name>.strategy import <Name>Strategy

   if __name__ == "__main__":
       raise SystemExit(run_cli(<Name>Strategy))
   ```
5. Write `tests/test_strategy.py` with `StrategyInput` fixtures built directly from `pd.DataFrame`.

## Purity invariants

`run()` **MUST**:

- Be deterministic given `(input, params)`.
- **NOT** perform I/O (no provider access, no network, no filesystem reads).
- **NOT** read wall-clock time — `input.asof` is the only time source.
- **NOT** use global RNG — `input.rng` is the only random source.
- **NOT** mutate strategy-instance state — return `state_update` instead.

State mutations flow only through `StrategyResult.state_update` (shallow-merged
by the runner between bars) and the optional `on_fill(fill, state) → dict`
return value (for per-position bookkeeping after a fill).

## Available runners

- **`BacktestRunner`** — multi-bar backtest with equity curve, trades, metrics,
  and a `ReproMeta` block stamped on every result.
- **`DailyPipelineRunner`** — single-day live invocation; `MasterAgent`
  consumes the emitted signals. Honors `meta.paper_only` (see below) by
  blocking live-mode emission.
- **`SignalRunner`** — one-off signal generation; supports `--replay` from a
  snapshot for post-mortem reproduction.

## Reproducibility

Every `BacktestResult.repro` carries
`(git_sha, param_hash, snapshot_root, seed, run_at, strategy_name, runner_version)`.

Given an identical tuple → bitwise-identical result. Use `SnapshotWriter`
(via `--snapshot-dir` on the backtest CLI) to preserve input data for
post-mortem replay.

## StrategyMeta flags

- **`kind`**: `"autonomous"` (run by the daily pipeline) or `"research"`
  (UI-only decision support; the pipeline skips it). Use `research` when
  the strategy still has no executable signal bridge, even if its data
  inputs are available.
- **`paper_only`**: default `False`. When `True`, `DailyPipelineRunner`
  returns an empty result with a diagnostic flag in live mode; the
  strategy still runs in `backtest` / `paper` modes. Use for strategies
  whose OOS track record hasn't cleared the bar for production capital.

## Current portfolio (13 strategies)

| Name | Category | Kind | `paper_only` |
|---|---|---|---|
| `pead` | equity | autonomous | – |
| `ts_momentum` | macro | autonomous | – |
| `dual_momentum` | macro | autonomous | – |
| `momentum_quality` | equity | autonomous | – |
| `rsi2_reversal` | equity | autonomous | – |
| `pairs_trading` | pairs | autonomous | – |
| `regime_adaptive` | macro | autonomous | – |
| `kama_breakout` | equity | autonomous | **✓** |
| `vwap` | intraday | autonomous | **✓** |
| `orb` | intraday | autonomous | **✓** |
| `vrp_harvest` | options | research | – |
| `earnings_vol` | options | research | – |
| `earnings-options-play` | options | research | – |

Research-kind strategies currently emit no trade signals pending:

- `vrp_harvest`, `earnings_vol`: multi-leg options signal emission and
  paper execution validation.
- `earnings-options-play`: product research screener; order placement stays
  human-triggered from the UI.

Paper-only autonomous strategies run in backtests/paper mode but are blocked
from live capital until their OOS evidence and execution telemetry graduate.
