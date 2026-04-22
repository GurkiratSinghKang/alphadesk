# Strategy SOTA Foundation — Design Spec (Sub-spec 1 of 3)

- **Date:** 2026-04-22
- **Author:** Claude (brainstorming session with GK)
- **Stage:** Design approved; pending writing-plans handoff.
- **Parent program:** "State-of-the-art strategy infrastructure" — decomposed into 3 sub-specs. This is Sub-spec 1 (foundation). Sub-specs 2 (tearsheet/notebook ergonomics) and 3 (TBD polish) will be brainstormed after this lands.

## Problem

AlphaDesk has 13 live trading strategies and 3 more planned. Each is a Python package that runs in three distinct contexts: the backtest engine, a daily production pipeline, and an Optuna-driven parameter tuner. Over time these three execution shells have accumulated a structural split — the engine calls `generate_signals(asof, ctx)` with a mutable `Context` object, while the daily pipeline goes through a compatibility adapter at `backend/data/ingestion/strategy_adapter.py` that presents a different `screen() / analyze() / generate_trades()` API. Every new strategy has to reason about both paths.

On top of that, the current shell has soft contracts — `StrategyMeta` is a frozen dataclass, parameters are untyped dicts, search spaces live in a separate `search_space()` function, results are mostly `pandas.DataFrame`s without validation. There is no per-strategy CLI, no reproducibility metadata on outputs, no JSON Schema export, no deterministic-replay guarantee, and no clean separation between alpha logic and data I/O.

This spec defines a unified, Pydantic-v2-typed, reproducible strategy shell that replaces both execution paths with one pure-function contract: `Strategy.run(input, params) → result`. All 13 live strategies migrate to this shell in a single big-bang release; legacy APIs are deleted outright. Production is expected to be down briefly during the migration window — acceptable per user direction.

## Goals

1. **Unified shell** — one callable pattern (`Strategy.run`) used by backtest, daily pipeline, tuner, CLI, and tests. No `screen/analyze/generate_trades` adapter.
2. **Pure-function core** — the strategy's `run()` method is a pure function of `(StrategyInput, StrategyParams) → StrategyResult`. No I/O inside, no clock reads, no global RNG.
3. **Typed contracts (Pydantic v2)** — `StrategyParams`, `StrategyInput`, `StrategyResult`, `Signal`, `BacktestResult` all Pydantic models with JSON Schema export. Per-strategy Params subclass carries validation constraints + Optuna search space in one field declaration.
4. **Full reproducibility** — every `BacktestResult` carries `(git_sha, param_hash, snapshot_root, seed, run_at, strategy_name, runner_version)`. Replay guarantee: given the same `(git_sha, params, data snapshot, seed)`, re-running produces bitwise-identical output.
5. **Per-strategy CLI** — `python -m strategies.<name>` with subcommands `backtest | signal | tune | analyze-day | schema | validate-params | explain`. Strategy-specific `--help` auto-generated from the Params model.
6. **Separation of universe selection from signal logic** — `universe(asof, state)` method picks symbols; `run()` never worries about what to fetch. Runner owns all I/O.
7. **Pead migrates end-to-end as a reference** in Phase 2; the other 12 follow the same template in Phase 3. Single atomic release — no mixed-API state.

## Non-goals (YAGNI)

- **Tearsheet generator** (HTML / PDF reports from `BacktestResult`) — sub-spec 2.
- **Notebook ergonomics** (`from strategies.pead import backtest; backtest(...).plot_equity()` convenience wrappers) — sub-spec 2.
- **MLflow / W&B experiment tracking** — separate future concern.
- **Incremental live-mode indicator updates** (avoiding full-lookback recompute each live day). Only matters if live runs become slow in practice; premature optimization.
- **Cross-strategy meta-analysis** (combining multiple strategies' P&L into a portfolio-level backtest). Separate concern; master agent is the right integration point.
- **Strategy-to-strategy communication** — deliberately forbidden. Every strategy sees only its own state and the runner-provided input. Keeps the pure-function contract clean.
- **New external data providers** beyond FMP / Alpaca / Newsdata already wired.
- **Dynamic param mutation at runtime** (adjusting thresholds in response to regime shifts). Params are immutable per run; regime-adaptive behavior lives inside the strategy body, not in post-hoc param fiddling.
- **Gradual / staged migration** — this spec is explicitly big-bang per user direction. One atomic release, all strategies move together.

## Decisions summary

| ID | Decision | Rationale |
|----|----------|-----------|
| D1 | Strategy contract is `run(input: StrategyInput, params: StrategyParams) → StrategyResult` | Pure-function signature makes alpha logic trivially testable and reproducible. Rejected: keep `generate_signals(asof, ctx)` (leaves I/O mixed into logic). Rejected: three explicit methods per mode (3× surface area). |
| D2 | `StrategyInput.bars` is a pre-sliced lookback window, not a single bar or full history | Strategy has what it needs to recompute indicators fresh. `state: dict` remains for path-dependent memory (open-position tracking). Rejected: just-today bar + state-owned indicators (forces every strategy to hand-roll rolling computations). |
| D3 | Per-strategy Params live in `strategies/<name>/config.py`, migrated in-place | Zero net new files per strategy. Single source of truth — Pydantic model → defaults, search space, JSON Schema, CLI help all derive from one place. Rejected: new `params.py` file per strategy (more churn). Rejected: inline in `strategy.py` (coupling). |
| D4 | Big-bang migration. All 13 strategies move atomically. No `LegacyStrategyAdapter`. Signal becomes Pydantic v2. `StrategyResult = {signals, state_update, diagnostics, warnings}` | One clean landing vs permanent two-API tax. Breaking changes acceptable per user. No mixed-API state. |
| D5 | Full reproducibility (replay guarantee) + Full CLI (`backtest | signal | tune | analyze-day | schema | validate-params | explain`) | Replay is the canonical value of reproducibility metadata; the hardest failure mode (non-deterministic drift) is the one worth paying to close. CLI surface cheap to implement once the contracts exist. |

## Architecture

One new package `backend/strategies/_core/` holds the contracts, protocol, registry, runners, CLI scaffold, and snapshotter. Strategy packages keep their existing file structure; `strategy.py` is rewritten to implement the new `run()`, `config.py` gains a Pydantic Params model, `__main__.py` is new (~8 lines).

```
backend/
  strategies/
    _core/                                 NEW
      __init__.py
      protocol.py                          Strategy ABC + StrategyMeta
      contracts.py                         StrategyParams, StrategyInput, StrategyResult,
                                           Signal, Fill, Position, ReproMeta, BacktestResult
      results.py                           BacktestResult helpers (metric computation, serialization)
      runners/
        __init__.py
        backtest_runner.py                 BacktestRunner — orchestrates bar-by-bar
        pipeline_runner.py                 DailyPipelineRunner — single-day live
        signal_runner.py                   SignalRunner — one-off CLI invocation
      snapshots.py                         SnapshotWriter/Reader (parquet-backed)
      cli.py                               shared argparse scaffolding
      reproducibility.py                   git_sha, param_hash, seed helpers
      providers.py                         ProviderBundle + factories (default_bar_provider, etc.)
    registry.py                            refactor: tighter register_strategy signature
    pead/
      __init__.py
      strategy.py                          REWRITTEN: implements Strategy.run()
      config.py                            REWRITTEN: PEADParams(StrategyParams)
      helpers.py                           unchanged
      __main__.py                          NEW
      tests/                               fixtures rewritten against StrategyInput
    momentum_quality/                      same template
    ... 11 more
  backtest/
    engine.py                              DELETED → strategies/_core/runners/backtest_runner.py
    types.py                               DELETED → strategies/_core/contracts.py
    cli.py                                 THIN: --strategy=<name> dispatches to strategies.<name>.__main__
    config.py                              thin shim; BacktestConfig moved to contracts.py
  data/ingestion/
    strategy_adapter.py                    DELETED
    daily_pipeline.py                      rewired to DailyPipelineRunner
    pipeline_runner.py                     unchanged (scheduler-level)
  tuner/
    runner.py                              minor: reads PARAMS_MODEL.tune_space()
    objective.py                           minor: same
  agents/master.py                         unchanged (consumes StrategyResult.signals identically)
  api/routes/strategies.py                 minor: /performance and /trades use same shape
  strategies/base.py                       DELETED → strategies/_core/protocol.py
```

**Structural invariants:**
- Exactly one place defines the Strategy contract: `strategies/_core/protocol.py`.
- Exactly one place defines data shapes: `strategies/_core/contracts.py`.
- Every caller (engine, pipeline, tuner, CLI, tests) invokes a strategy through `strategies/_core/runners/`. Direct calls to `strategy.run()` from outside `_core/` are forbidden; the runner wraps input construction and enforces purity.

## Core contracts

All in `strategies/_core/contracts.py`. Pydantic v2, frozen where mutation would surprise, JSON-Schema-exportable.

### Params base

```python
class StrategyParams(BaseModel):
    """Base for every strategy's typed params model."""
    model_config = ConfigDict(extra="forbid", frozen=True, validate_default=True)

    @classmethod
    def tune_space(cls) -> dict[str, dict]:
        """Auto-derive Optuna distributions from Field(json_schema_extra={'tune': {...}})."""
        return {
            name: field.json_schema_extra["tune"]
            for name, field in cls.model_fields.items()
            if field.json_schema_extra and "tune" in field.json_schema_extra
        }

    @classmethod
    def param_hash(cls, instance: "StrategyParams") -> str:
        """SHA-256(canonical JSON). Stable across Python runs. 16-char prefix for logs."""
        return hashlib.sha256(instance.model_dump_json(round_trip=True).encode()).hexdigest()[:16]
```

### Signal + OptionLeg

```python
class OrderType(str, Enum):
    MKT, LMT, STP, STP_LMT, MOO, MOC = "MKT", "LMT", "STP", "STP_LMT", "MOO", "MOC"

class TimeInForce(str, Enum):
    DAY, GTC, IOC, FOK = "DAY", "GTC", "IOC", "FOK"

class OptionLeg(BaseModel):
    occ_symbol: str                             # e.g. NVDA260425C00205000
    side: Literal["buy", "sell"]
    quantity: int
    limit_price: float | None = None

class Signal(BaseModel):
    """One order intent emitted by a strategy on a single bar."""
    model_config = ConfigDict(frozen=True, extra="forbid")

    symbol: str
    asof: date
    order_type: OrderType
    time_in_force: TimeInForce = TimeInForce.DAY
    target_weight: float | None = Field(default=None, description="Fraction of portfolio equity")
    quantity: int | None = Field(default=None, description="Signed share count")
    limit_price: float | None = None
    stop_price: float | None = None
    tag: str = Field(default="", max_length=256)
    legs: list[OptionLeg] | None = None          # multi-leg option orders

    @model_validator(mode="after")
    def _exactly_one_sizing(self) -> "Signal":
        if (self.target_weight is None) == (self.quantity is None):
            raise ValueError("Signal requires exactly one of target_weight or quantity")
        return self
```

### StrategyInput

```python
class Position(BaseModel):
    symbol: str
    quantity: int                               # signed
    avg_entry_price: Decimal
    entry_date: date
    tag: str = ""

class StrategyInput(BaseModel):
    """Immutable snapshot of everything a strategy needs on one tick."""
    model_config = ConfigDict(frozen=True, arbitrary_types_allowed=True)

    asof: date
    mode: Literal["backtest", "paper", "live"]

    # Pre-sliced lookback windows. Runner enforces size per strategy's META.lookback_days.
    bars: pd.DataFrame                          # multi-indexed (date, symbol); OHLCV
    earnings: pd.DataFrame | None = None
    fundamentals: pd.DataFrame | None = None
    news: pd.DataFrame | None = None

    # Portfolio state — read-only view.
    cash: Decimal
    equity: Decimal
    positions: list[Position]

    # Strategy-owned mutable memory (serializable dict).
    state: dict[str, Any] = Field(default_factory=dict)

    # Deterministic RNG. Every random call MUST go through this.
    seed: int
    rng: np.random.Generator                    # excluded from serialization

    @classmethod
    def snapshot_id(cls, inst: "StrategyInput") -> str:
        """Hash of everything except mutable state and rng. Enables replay."""
        h = hashlib.sha256()
        h.update(inst.asof.isoformat().encode())
        h.update(inst.mode.encode())
        h.update(pd.util.hash_pandas_object(inst.bars, index=True).values.tobytes())
        for df in (inst.earnings, inst.fundamentals, inst.news):
            if df is not None:
                h.update(pd.util.hash_pandas_object(df, index=True).values.tobytes())
        return h.hexdigest()[:16]
```

### StrategyResult

```python
class StrategyResult(BaseModel):
    signals: list[Signal] = Field(default_factory=list)
    state_update: dict[str, Any] = Field(default_factory=dict)
    diagnostics: dict[str, Any] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)
```

Explicitly rejected: per-bar `metrics` (belongs in aggregated `BacktestResult`), `debug` (use logging), per-bar P&L accounting (runner's job).

### Fill

```python
class Fill(BaseModel):
    model_config = ConfigDict(frozen=True)
    symbol: str
    asof: date
    quantity: int                               # signed
    price: Decimal
    commission: Decimal = Decimal("0")
    signal_tag: str = ""                        # backreference to Signal.tag
```

### BacktestResult + ReproMeta

```python
class ReproMeta(BaseModel):
    git_sha: str
    param_hash: str                             # StrategyParams.param_hash(params)
    snapshot_root: str                          # SHA-256 of concatenated per-bar snapshot_ids, or "" when snapshot_dir is None
    seed: int
    run_at: datetime
    strategy_name: str
    runner_version: str                         # constant string, module-level RUNNER_VERSION = "1.0.0" in strategies/_core/__init__.py,
                                                # bumped on any behavior-changing runner release (bar iteration order, fill model, seed-forking scheme)

class Trade(BaseModel):
    symbol: str
    entry_date: date
    exit_date: date | None
    entry_price: Decimal
    exit_price: Decimal | None
    quantity: int                               # signed
    pnl: Decimal | None
    tag: str = ""

class BacktestResult(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)
    equity_curve: pd.DataFrame                  # date, cash, positions_value, equity, drawdown
    daily_returns: pd.Series
    trades: list[Trade]
    signals_emitted: list[Signal]
    metrics: dict[str, float]                   # sharpe, sortino, cagr, max_dd, calmar, turnover
    params: dict                                # params.model_dump()
    start: date
    end: date
    repro: ReproMeta
    warnings_by_asof: dict[date, list[str]]
```

## Strategy protocol + base class

`strategies/_core/protocol.py`:

```python
class Strategy(abc.ABC):
    PARAMS_MODEL: ClassVar[type[StrategyParams]]
    META: ClassVar[StrategyMeta]                # set by @register_strategy

    @abc.abstractmethod
    def universe(self, asof: date, state: dict[str, Any]) -> list[str]:
        """Symbols the runner should pre-fetch bars for on `asof`.

        Called BEFORE run(). May read state; MUST NOT read positions or params.
        For static universes, return a constant list.
        """

    @abc.abstractmethod
    def run(
        self,
        input: StrategyInput,
        params: StrategyParams,
    ) -> StrategyResult:
        """Pure-function core. MUST be deterministic given (input, params).
        MUST NOT perform I/O, read wall-clock time, or use global RNG."""

    def on_fill(
        self,
        fill: Fill,
        state: dict[str, Any],
    ) -> dict[str, Any]:
        """Optional state update after a fill. Called BETWEEN run() calls.
        Default: no-op."""
        return {}


class StrategyMeta(BaseModel):
    model_config = ConfigDict(frozen=True)
    name: str
    category: Literal["equity", "options", "pairs", "macro", "intraday", "smoke"] = "equity"
    description: str = ""
    kind: Literal["autonomous", "research"] = "autonomous"
    lookback_days: int = 250
    required_bars: tuple[Literal["daily", "1min", "5min", "1h"], ...] = ("daily",)
    min_universe_size: int = 1
    params_model: type[StrategyParams] | None = None    # set by decorator


def register_strategy(meta: StrategyMeta) -> Callable[[type[Strategy]], type[Strategy]]:
    def decorator(cls: type[Strategy]) -> type[Strategy]:
        if not hasattr(cls, "PARAMS_MODEL"):
            raise TypeError(f"{cls.__name__} must declare PARAMS_MODEL: type[StrategyParams]")
        frozen_meta = meta.model_copy(update={"params_model": cls.PARAMS_MODEL})
        cls.META = frozen_meta
        _REGISTRY[meta.name] = (cls, frozen_meta)
        return cls
    return decorator
```

**Purity invariants enforced by the architecture:**
1. `run()` receives `StrategyInput` (pre-fetched) — no provider access inside.
2. `StrategyInput.asof` is the only time source — runner excludes wall-clock.
3. `StrategyInput.rng` is the only RNG — a custom `ruff` check rejects `np.random.*` / `random.*` / `numpy.random.*` in strategy packages.
4. State mutations flow through `StrategyResult.state_update` (shallow-merged by the runner via `state = {**state, **result.state_update}`) and `on_fill()` return values only. `self._state` is forbidden by code review.
5. Universe declaration is separate from signal logic. `universe()` never emits signals.

**Daily-first assumption:** All 13 currently-live strategies operate on daily bars. `StrategyInput.asof: date` and `BacktestRunner` iterating trading days reflect that. If an intraday strategy is added later, it will require extending `asof` to `datetime` and the runner to iterate bars instead of days — out of scope for this sub-spec, deferred to whenever an intraday strategy actually ships.

## Runners

### `BacktestRunner` (`runners/backtest_runner.py`)

Orchestrates bar-by-bar execution. Owns data fetching (via provider bundle), portfolio ledger, fill simulation, and reproducibility stamping.

Per-bar loop:

1. `symbols = strategy.universe(asof, state)`
2. Pre-fetch bars + earnings + fundamentals for `symbols` over `META.lookback_days`.
3. Build frozen `StrategyInput` with forked child `np.random.SeedSequence` per bar.
4. Optional: `SnapshotWriter.write(asof, input)` for replay.
5. `result = strategy.run(input, params)`.
6. Merge `result.state_update` into state.
7. Executor simulates fills using `config.fill_model` + slippage + commission.
8. For each fill: `state = {**state, **strategy.on_fill(fill, state)}`.

After the loop: aggregate `equity_curve`, compute `metrics` (reuses existing QuantLib helpers), stamp `ReproMeta`, return `BacktestResult`.

```python
class BacktestConfig(BaseModel):
    start: date
    end: date
    starting_cash: Decimal = Decimal("100000")
    commission_per_share: Decimal = Decimal("0.005")
    slippage_bps: float = 1.0
    fill_model: Literal["next_open", "next_close", "midpoint"] = "next_open"
    snapshot_dir: Path | None = None
    seed: int = 0
```

### `DailyPipelineRunner` (`runners/pipeline_runner.py`)

Single-day live invocation. Replaces `strategy_adapter.py`. Builds `StrategyInput` with `mode="live"` using live providers (Alpaca bars, FMP earnings, Newsdata), calls `run()` once, returns `StrategyResult`. Does NOT submit orders — the existing `MasterAgent` (portfolio gatekeeper) receives `result.signals` and applies global risk limits before forwarding to Alpaca.

State is loaded/persisted via a `StateStore` abstraction (in-process dict-of-dicts backed by Redis, existing infrastructure).

### `SignalRunner` (`runners/signal_runner.py`)

One-off invocation for CLI `signal` and `explain`. No portfolio, no executor. Supports `--replay` reading a snapshot from parquet — core of the reproducibility guarantee.

### `SnapshotWriter` / `SnapshotReader` (`snapshots.py`)

Writes `StrategyInput` to parquet keyed by `(strategy_name, asof, snapshot_id)`. Reader deterministically reconstructs an identical `StrategyInput` (including `seed`; `rng` reconstructed via `np.random.default_rng(seed)`). Enables:

```bash
python -m strategies.pead explain --asof 2024-03-15 --replay snapshots/pead/2024-03-15/
```

→ bitwise-identical `StrategyResult` as prod did on that day, assuming `git_sha` matches.

## Per-strategy CLI

Each strategy's `__main__.py` is 8 lines:

```python
from strategies._core.cli import run_cli
from strategies.pead.strategy import PEADStrategy
if __name__ == "__main__":
    raise SystemExit(run_cli(PEADStrategy))
```

Shared scaffolding in `_core/cli.py` provides these subcommands (auto-generated `--help` per strategy from `Params` model + `StrategyMeta`):

| Subcommand | Purpose |
|-----------|---------|
| `backtest` | `--from DATE --to DATE [--params FILE] [--seed N] [--snapshot-dir DIR] [--out FILE]` |
| `signal` | `--asof DATE [--params FILE] [--replay DIR]` |
| `tune` | `--trials N --from DATE --to DATE [--walk-forward]` |
| `analyze-day` | `[--asof DATE] [--params FILE] [--dry-run]` — live-provider one-shot |
| `schema {params\|input\|result\|signal\|all}` | dump Pydantic JSON Schema |
| `validate-params FILE` | validate a params JSON against `PARAMS_MODEL` |
| `explain --asof DATE [--format text\|json]` | verbose signal + diagnostics + filter reasons |

**Exit codes (stable contract):**
- `0` success
- `2` params validation failed
- `3` data unavailable
- `4` strategy raised during `run()`
- `5` snapshot mismatch during `--replay` (data drift)

The top-level `python -m backend.backtest --strategy=NAME ...` dispatcher stays as a convenience, forwarding to `strategies.NAME.__main__`.

## Migration map

### Per-strategy template (applied identically to all 13)

| File | Action | Detail |
|------|--------|--------|
| `strategy.py` | REWRITE | Delete `configure/generate_signals/manage/on_fill(ctx)`. Add `PARAMS_MODEL = <Name>Params`, `universe(asof, state)`, `run(input, params)`. Port old methods into `run()`; old `on_fill(fill, ctx)` becomes `on_fill(fill, state) → dict`. |
| `config.py` | REWRITE | `DEFAULTS` dict → `<Name>Params(StrategyParams)` Pydantic model with `Field(json_schema_extra={"tune": ...})`. `search_space()` deleted — auto-derived via `Params.tune_space()`. `load_universe()` kept. |
| `helpers.py` | UNCHANGED | Pure-function helpers (`compute_sue`, `passes_liquidity`, etc.) stay. |
| `__main__.py` | NEW | 8-line dispatch to `run_cli(<Name>Strategy)`. |
| `tests/test_strategy.py` | REWRITE | Fixtures build `StrategyInput` DataFrames directly instead of fake providers. Assertions on signals carry over unchanged. |
| `spec.md` | UNCHANGED | Academic rationale unchanged. |

### Non-strategy ripple

| File | Action |
|------|--------|
| `backend/backtest/engine.py` | DELETED → `strategies/_core/runners/backtest_runner.py` |
| `backend/backtest/types.py` | DELETED → `strategies/_core/contracts.py` |
| `backend/backtest/cli.py` | THIN dispatcher: `--strategy=NAME` → `strategies.NAME.__main__` |
| `backend/backtest/config.py` | Shims only; `BacktestConfig` moved to `contracts.py` |
| `backend/data/ingestion/strategy_adapter.py` | DELETED |
| `backend/data/ingestion/daily_pipeline.py` | Rewired: instantiates `DailyPipelineRunner` per strategy |
| `backend/data/ingestion/pipeline_runner.py` | UNCHANGED (scheduler-level) |
| `backend/tuner/runner.py` | Minor: reads `cls.PARAMS_MODEL.tune_space()` |
| `backend/tuner/objective.py` | Minor: same |
| `backend/agents/master.py` | UNCHANGED (consumes `StrategyResult.signals` identically) |
| `backend/api/routes/strategies.py` | Minor: `/performance`, `/trades` still work with the new shape |
| `backend/strategies/registry.py` | REFACTOR: tighter `register_strategy` signature, removes legacy dataclass path |
| `backend/strategies/base.py` | DELETED → `strategies/_core/protocol.py` |

### Frontend ripple

Types mirror the backend in `frontend/src/types/index.ts`. Expected small PRs:
- `Signal` gains `legs: OptionLeg[] | null`.
- `BacktestResult` gains `repro: ReproMeta`.
- Any analytics / reports page that deserializes `BacktestResult` surfaces the new field (likely read-only display).

### Execution sequencing (5 phases within this single spec)

1. **Phase 1 · Scaffolding** (~3-4 days). Build `strategies/_core/` — contracts, protocol, registry refactor, runners, snapshotter, CLI scaffold. Land alone — no strategies migrated yet. Tests: unit on contract round-trips, seed determinism, snapshot hash stability.
2. **Phase 2 · Reference migration (pead)** (~2-3 days). Migrate pead end-to-end, update its tests, delete `backtest/engine.py`, `backtest/types.py`, `strategy_adapter.py`, rewire `daily_pipeline.py` + `tuner/` to use `_core/`. Announce brief prod downtime; verify end-to-end in paper mode after landing.
3. **Phase 3 · Strategy sweep** (~7-10 days, parallelizable). Migrate the remaining 12 strategies through the template. Each strategy is an independent commit/PR; subagents can do 2-3 each in parallel.
4. **Phase 4 · Frontend types + contracts** (~1 day). Regenerate frontend types from new Pydantic schemas. Update any dashboard surfacing `Signal` or `BacktestResult` fields.
5. **Phase 5 · Cleanup + docs** (~1 day). Remove deprecated shims, update `docs/STRATEGIES.md`, update each strategy's `spec.md` to reference the new protocol.

**Total ~3 calendar weeks** with serial phase execution and parallel strategy sweep in phase 3.

## Risks + rollback

### Risks

1. **Pure-function purity leaks.** A strategy author uses `np.random` directly or `datetime.now()` inside `run()` → non-reproducible. Mitigations: (a) custom `ruff` lint rule rejects the forbidden imports in strategy packages; (b) snapshot-based test in phase 1 verifies two runs with the same input + same seed → identical result, bitwise.

2. **State serialization gotchas.** `state: dict[str, Any]` containing a `pandas.Timestamp` or `Decimal` may fail JSON round-trip. Mitigation: `StrategyParams` and `StrategyResult.state_update` constrain serializable types; runner validates state round-trips JSON in dev mode.

3. **Runner behavior drift.** New `BacktestRunner` produces slightly different fills than the old `engine.py` (ordering, slippage rounding). Mitigation: phase 2 includes a "parity test" — run pead's existing multi-year test fixture through both the old `engine.py` (kept as `engine_legacy.py` just through phase 2) and the new `BacktestRunner`, assert identical trades and equity curves. Acceptable drift = zero trade-count difference and total P&L within 0.5% (accounting for Decimal-rounding-order differences); anything larger is a real bug that must be resolved before phase 3. Document any accepted drift in `docs/superpowers/specs/2026-04-22-strategy-sota-foundation-migration-notes.md`.

4. **Production downtime in phase 2.** Between pead's migration landing and phase 3 completing, the master agent is serving only 1 of 13 strategies. Mitigation: land phase 2 on a Friday evening; paper-mode verification through the weekend; phase 3 starts Monday with known-good master agent. Or: land phase 2 + phase 3 in a single weekend sprint via parallel subagents.

5. **Tuner reproducibility regression.** Optuna's sampler seed + the strategy's seed must compose deterministically. Mitigation: tuner passes `trial.number` as a deterministic prefix to the seed sequence; one test locks in determinism.

### Rollback

- Phase 1 is additive (pure new code in `_core/`). Revertable as one commit.
- Phase 2 is irreversible as a single commit (deletes `engine.py`, migrates pead, rewires daily pipeline). Rollback = revert the commit; prod returns to pre-migration state with all 13 strategies working on the old API.
- Phase 3+ are per-strategy commits; revertable individually if a specific strategy's migration breaks.

No data-migration risk — `StrategyResult` and `BacktestResult` are not persisted; they're computed on demand. Existing trade ledger schema is untouched.

## Open questions

None remaining from the brainstorm. Two items flagged for the implementation plan to resolve early:

1. **`ruff` custom lint rule for purity enforcement** — where does it live, how is it enabled in CI? The plan must spec the mechanism (either a custom plugin or a regex-based `per-file-ignores` inverted, fail CI on match).
2. **Parity test between old `engine.py` and new `BacktestRunner`** — the plan must specify the fixture (pead on 2023 data, say) and the acceptable tolerance (ideally zero — bitwise — but if slippage rounding differs, document the drift as a migration note).

Ready for writing-plans.
