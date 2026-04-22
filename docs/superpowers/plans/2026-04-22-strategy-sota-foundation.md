# Strategy SOTA Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate all 13 live strategies to a unified, Pydantic-v2-typed, reproducible shell with `Strategy.run(input, params) → result` as the one contract. Delete the legacy `backtest/engine.py` + `strategy_adapter.py` split. Add a per-strategy CLI and replay-grade reproducibility metadata.

**Architecture:** New `backend/strategies/_core/` package holds the contracts, protocol, registry, runners, snapshotter, and CLI scaffold. Each strategy package keeps its shape but `strategy.py` implements the new ABC, `config.py` gains a Pydantic `Params` model, `__main__.py` is new. Big-bang migration — legacy APIs deleted, not adapted.

**Tech Stack:** Python 3.12, Pydantic v2, pandas, numpy, argparse, Optuna (existing tuner), pytest, pytest-asyncio.

**Spec:** `docs/superpowers/specs/2026-04-22-strategy-sota-foundation-design.md`

---

## File Structure

### New files (Phase 1)

**`backend/strategies/_core/` package:**
- `__init__.py` — exports public surface + `RUNNER_VERSION = "1.0.0"` constant
- `contracts.py` — Pydantic types: `StrategyParams`, `Signal`, `OptionLeg`, `OrderType`, `TimeInForce`, `Position`, `Fill`, `StrategyInput`, `StrategyResult`, `Trade`, `ReproMeta`, `BacktestResult`, `BacktestConfig`
- `protocol.py` — `Strategy` ABC + `StrategyMeta` + `register_strategy` decorator + module-level `_REGISTRY`
- `reproducibility.py` — `get_git_sha()`, `param_hash()` helpers, `RUNNER_VERSION`
- `snapshots.py` — `SnapshotWriter`, `SnapshotReader` (parquet-backed)
- `providers.py` — provider abstractions + `default_bar_provider()`, `default_earnings_provider()`, etc. factories
- `fills.py` — `FillSimulator` (slippage + commission) + `Portfolio` ledger
- `runners/__init__.py` — re-exports all runners
- `runners/backtest_runner.py` — `BacktestRunner` class
- `runners/pipeline_runner.py` — `DailyPipelineRunner` class
- `runners/signal_runner.py` — `SignalRunner` class
- `cli.py` — `run_cli(strategy_cls)` + `_build_parser` + handlers for all 7 subcommands

**Test files (Phase 1):**
- `backend/tests/_core/test_contracts.py` — Pydantic roundtrip + validator tests
- `backend/tests/_core/test_protocol.py` — register_strategy + Strategy ABC
- `backend/tests/_core/test_reproducibility.py` — git_sha, param_hash, seed determinism
- `backend/tests/_core/test_snapshots.py` — round-trip of StrategyInput via parquet
- `backend/tests/_core/test_backtest_runner.py` — deterministic backtest across two runs
- `backend/tests/_core/test_signal_runner.py` — replay produces bitwise-identical results
- `backend/tests/_core/test_cli.py` — schema/validate-params/signal/backtest commands

### Modified files (Phase 2)

- `backend/strategies/pead/strategy.py` — REWRITE
- `backend/strategies/pead/config.py` — REWRITE (`DEFAULTS` → `PEADParams(StrategyParams)`)
- `backend/strategies/pead/__main__.py` — NEW
- `backend/strategies/pead/tests/test_strategy.py` — REWRITE fixtures
- `backend/data/ingestion/daily_pipeline.py` — rewire to `DailyPipelineRunner`
- `backend/data/ingestion/strategy_adapter.py` — DELETED
- `backend/backtest/engine.py` — DELETED after parity test
- `backend/backtest/types.py` — DELETED (types moved to `_core/contracts.py`)
- `backend/backtest/cli.py` — thin dispatcher forwarding `--strategy=NAME` to `strategies.NAME.__main__`
- `backend/tuner/runner.py` — read `cls.PARAMS_MODEL.tune_space()` instead of `search_space()`
- `backend/tuner/objective.py` — same
- `backend/strategies/registry.py` — tighten `register_strategy` signature
- `backend/strategies/base.py` — DELETED after all strategies migrated

### Modified files (Phase 3 — per strategy)

Applied identically to each of: momentum-quality, vrp-harvesting, earnings-vol-premium, regime-adaptive, ts-momentum, rsi2-reversal, dual-momentum, pairs-trading, kama-breakout, vwap-strategy, gap-fill, mean-reversion.

- `backend/strategies/<name>/strategy.py` — REWRITE
- `backend/strategies/<name>/config.py` — REWRITE
- `backend/strategies/<name>/__main__.py` — NEW
- `backend/strategies/<name>/tests/` — REWRITE fixtures

### Modified files (Phase 4 — frontend types)

- `frontend/src/types/index.ts` — add `OptionLeg`, `ReproMeta`, update `Signal`, `BacktestResult`
- `frontend/src/__tests__/setup-mocks.ts` — update mock shapes if needed

### Modified files (Phase 5 — cleanup + docs)

- `docs/STRATEGIES.md` — rewrite for new protocol
- `backend/strategies/<name>/spec.md` × 13 — small edits referencing new protocol
- `backend/strategies/_core/MIGRATION_NOTES.md` — NEW, documents any parity drift

---

## Phase 1 — `_core/` scaffolding (Tasks 1-12)

### Task 1: Package skeleton + `RUNNER_VERSION`

**Files:**
- Create: `backend/strategies/_core/__init__.py`
- Create: `backend/strategies/_core/runners/__init__.py`
- Create: `backend/tests/_core/__init__.py`

- [ ] **Step 1: Create the package skeleton**

```python
# backend/strategies/_core/__init__.py
"""Unified strategy shell — Pydantic-v2 contracts + ABC + runners + CLI.

Every strategy in AlphaDesk implements the Strategy ABC defined in
protocol.py, is driven by one of the runners in runners/, and is invoked
either programmatically or via `python -m strategies.<name>` (cli.py).

RUNNER_VERSION is stamped into every BacktestResult.repro so you can tell
when results came from a different runner release (bar iteration order,
fill model changes, seed-forking scheme, etc).
"""
RUNNER_VERSION = "1.0.0"
```

```python
# backend/strategies/_core/runners/__init__.py
"""Runners — orchestrate Strategy.run() for different invocation contexts."""
from strategies._core.runners.backtest_runner import BacktestRunner
from strategies._core.runners.pipeline_runner import DailyPipelineRunner
from strategies._core.runners.signal_runner import SignalRunner

__all__ = ["BacktestRunner", "DailyPipelineRunner", "SignalRunner"]
```

```python
# backend/tests/_core/__init__.py
```
(empty file — Python package marker)

- [ ] **Step 2: Verify package imports**

```bash
cd /Users/GK/Downloads/alphadesk/backend && /Users/GK/Downloads/alphadesk/.venv/bin/python -c "from strategies._core import RUNNER_VERSION; print(RUNNER_VERSION)"
```
Expected: `1.0.0`

Note: the `runners/__init__.py` imports will fail now because the three runner modules don't exist yet — that's fine, we'll add them in later tasks. To test just the top-level `__init__.py`, move the runners import to the end (after the RUNNER_VERSION export) or comment the runners import and re-enable it in Task 8.

- [ ] **Step 3: Comment out runners import temporarily**

```python
# backend/strategies/_core/runners/__init__.py
"""Runners — orchestrate Strategy.run() for different invocation contexts.

Re-enable imports after Tasks 8-10 land the runner modules.
"""
# from strategies._core.runners.backtest_runner import BacktestRunner
# from strategies._core.runners.pipeline_runner import DailyPipelineRunner
# from strategies._core.runners.signal_runner import SignalRunner
# __all__ = ["BacktestRunner", "DailyPipelineRunner", "SignalRunner"]
```

- [ ] **Step 4: Re-verify imports**

```bash
/Users/GK/Downloads/alphadesk/.venv/bin/python -c "from strategies._core import RUNNER_VERSION; print(RUNNER_VERSION)"
```
Expected: `1.0.0`

- [ ] **Step 5: Commit**

```bash
cd /Users/GK/Downloads/alphadesk
git add backend/strategies/_core/ backend/tests/_core/
git commit -m "feat(strategies): _core/ package skeleton + RUNNER_VERSION constant"
```

---

### Task 2: `StrategyParams` base class + `reproducibility.py` helpers

**Files:**
- Create: `backend/strategies/_core/reproducibility.py`
- Create: `backend/strategies/_core/contracts.py` (first pass — just StrategyParams)
- Test: `backend/tests/_core/test_reproducibility.py`
- Test: `backend/tests/_core/test_contracts.py` (first-pass)

- [ ] **Step 1: Write failing tests**

Create `backend/tests/_core/test_reproducibility.py`:

```python
"""Reproducibility helpers — git SHA, param hashing, RUNNER_VERSION wiring.

Every BacktestResult carries ReproMeta stamped from these helpers. A bug
here silently breaks replay for every strategy; these tests lock in the
invariants."""
from __future__ import annotations

import subprocess
from pathlib import Path

from strategies._core.reproducibility import get_git_sha


def test_get_git_sha_returns_head_commit():
    """Returns 40-char SHA of the current HEAD commit, matching git rev-parse."""
    expected = subprocess.check_output(
        ["git", "rev-parse", "HEAD"],
        cwd=Path(__file__).parents[3],
    ).decode().strip()
    assert get_git_sha() == expected


def test_get_git_sha_idempotent():
    """Calling twice yields the same result (tests any caching doesn't misbehave)."""
    assert get_git_sha() == get_git_sha()
```

Create `backend/tests/_core/test_contracts.py`:

```python
"""Core contract tests — Pydantic v2 roundtrip + validator behavior.

This file grows through Phase 1 as we add more contracts. Start with
StrategyParams + its tune_space()/param_hash() classmethods."""
from __future__ import annotations

import json

import pytest
from pydantic import Field, ValidationError

from strategies._core.contracts import StrategyParams


class ExampleParams(StrategyParams):
    """Test double — a strategy param model used only in these tests."""
    sue_threshold: float = Field(
        default=1.5, ge=0, le=5,
        json_schema_extra={"tune": {"low": 0.5, "high": 3.0, "type": "float"}},
    )
    holding_days: int = Field(
        default=40, ge=1, le=252,
        json_schema_extra={"tune": {"low": 10, "high": 90, "type": "int"}},
    )
    name: str = Field(default="test", description="Non-tuned field")


def test_params_default_instantiation():
    p = ExampleParams()
    assert p.sue_threshold == 1.5
    assert p.holding_days == 40


def test_params_frozen():
    """`frozen=True` means instances cannot be mutated."""
    p = ExampleParams()
    with pytest.raises(ValidationError):
        p.sue_threshold = 2.0


def test_params_extra_forbidden():
    """`extra=forbid` catches typos in param overrides at construction."""
    with pytest.raises(ValidationError, match="Extra inputs"):
        ExampleParams(sue_treshold=2.0)  # typo: treshold, not threshold


def test_params_validate_default():
    """A subclass that defaults to an invalid value should fail at class-def time,
    because validate_default=True."""
    with pytest.raises(ValidationError):
        class BrokenParams(StrategyParams):
            x: int = Field(default=-1, ge=0)
        BrokenParams()  # instantiation triggers the validation


def test_tune_space_excludes_non_tuned_fields():
    space = ExampleParams.tune_space()
    assert set(space.keys()) == {"sue_threshold", "holding_days"}
    assert "name" not in space  # no `tune` extra → excluded
    assert space["sue_threshold"]["low"] == 0.5
    assert space["holding_days"]["type"] == "int"


def test_param_hash_stable_across_runs():
    """Hash depends only on param values, not on hash random-seed."""
    p1 = ExampleParams(sue_threshold=1.7, holding_days=30)
    p2 = ExampleParams(sue_threshold=1.7, holding_days=30)
    assert ExampleParams.param_hash(p1) == ExampleParams.param_hash(p2)


def test_param_hash_changes_with_values():
    p1 = ExampleParams(sue_threshold=1.5)
    p2 = ExampleParams(sue_threshold=1.6)
    assert ExampleParams.param_hash(p1) != ExampleParams.param_hash(p2)


def test_param_hash_is_16_char_hex():
    p = ExampleParams()
    h = ExampleParams.param_hash(p)
    assert len(h) == 16
    int(h, 16)  # raises if not hex
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/GK/Downloads/alphadesk/backend && /Users/GK/Downloads/alphadesk/.venv/bin/python -m pytest tests/_core/ -v
```
Expected: ImportError on `strategies._core.reproducibility` and `strategies._core.contracts`.

- [ ] **Step 3: Implement reproducibility helpers**

```python
# backend/strategies/_core/reproducibility.py
"""Git SHA, param hashing, deterministic seed helpers. Used by runners
to stamp reproducibility metadata on every result."""
from __future__ import annotations

import functools
import subprocess
from pathlib import Path


@functools.lru_cache(maxsize=1)
def get_git_sha() -> str:
    """Return the 40-char SHA of the current HEAD commit.

    Cached because the repo HEAD doesn't change during a single process
    lifetime for any reasonable workflow (backtest/tuner/CLI). Caller
    expectation: this value is paired with params+data hash to enable
    deterministic replay.
    """
    try:
        sha = subprocess.check_output(
            ["git", "rev-parse", "HEAD"],
            cwd=_repo_root(),
            stderr=subprocess.DEVNULL,
        ).decode().strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        # Non-git environments (e.g. Docker image without .git/) fall back
        # to a placeholder. The RUNNER_VERSION gives coarse reproducibility
        # still, and operators should treat "unknown" as a signal to check
        # their deployment setup.
        return "unknown"
    return sha


def _repo_root() -> Path:
    """Walk up from this file to find the repository root (directory containing .git/)."""
    p = Path(__file__).resolve()
    while p != p.parent:
        if (p / ".git").exists():
            return p
        p = p.parent
    # Fallback: assume the current working dir is the repo root
    return Path.cwd()
```

- [ ] **Step 4: Implement `StrategyParams` base class**

```python
# backend/strategies/_core/contracts.py
"""Pydantic v2 core contracts for the unified strategy shell.

This module is the single source of truth for every data shape a strategy
author touches: params, input, result, signals, backtest result, the lot.
Every value that crosses a Strategy boundary is validated through one of
these models.

Nothing here imports anything strategy-specific; strategies subclass
StrategyParams in their own config.py.
"""
from __future__ import annotations

import hashlib

from pydantic import BaseModel, ConfigDict


class StrategyParams(BaseModel):
    """Base for every strategy's typed params model.

    Subclasses declare fields with `Field(default=..., ge=..., le=...,
    json_schema_extra={'tune': {...}})`. The `tune` extra is picked up by
    the Optuna-integrated tuner; non-tuned fields (no `tune` key) are
    fixed per run.

    Config invariants:
      * extra='forbid' — typos in param overrides become ValidationErrors
        at construction time rather than silently ignored
      * frozen=True — params are immutable after construction; a strategy
        cannot mutate its own params mid-run, preserving reproducibility
      * validate_default=True — defaults are validated when the model is
        instantiated (not at class-def time — Pydantic v2 limitation)
    """

    model_config = ConfigDict(extra="forbid", frozen=True, validate_default=True)

    @classmethod
    def tune_space(cls) -> dict[str, dict]:
        """Auto-derive Optuna distributions from Field(json_schema_extra={'tune': {...}}).

        Returns a dict keyed by field name; each value is the tune extras
        dict (e.g. {'low': 0.5, 'high': 3.0, 'type': 'float'}). The tuner
        translates these into trial.suggest_* calls.
        """
        space: dict[str, dict] = {}
        for name, field in cls.model_fields.items():
            extra = field.json_schema_extra
            if isinstance(extra, dict) and "tune" in extra:
                space[name] = extra["tune"]
        return space

    @classmethod
    def param_hash(cls, instance: "StrategyParams") -> str:
        """SHA-256 prefix (16 chars) of the canonical-JSON-serialized params.

        Stable across Python processes and machines: `round_trip=True` makes
        serialization deterministic even for Decimal/date values. This hash
        identifies a parameter configuration in logs and reproducibility
        metadata.
        """
        serialized = instance.model_dump_json(round_trip=True)
        return hashlib.sha256(serialized.encode("utf-8")).hexdigest()[:16]
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
/Users/GK/Downloads/alphadesk/.venv/bin/python -m pytest tests/_core/test_reproducibility.py tests/_core/test_contracts.py -v
```
Expected: all 9 tests PASS (2 reproducibility + 7 contracts).

- [ ] **Step 6: Commit**

```bash
git add backend/strategies/_core/reproducibility.py backend/strategies/_core/contracts.py \
        backend/tests/_core/test_reproducibility.py backend/tests/_core/test_contracts.py
git commit -m "feat(_core): StrategyParams base + git_sha/param_hash helpers"
```

---

### Task 3: `Signal`, `OptionLeg`, enums

**Files:**
- Modify: `backend/strategies/_core/contracts.py` (append)
- Modify: `backend/tests/_core/test_contracts.py` (append)

- [ ] **Step 1: Append failing tests**

Append to `backend/tests/_core/test_contracts.py`:

```python
from datetime import date

from strategies._core.contracts import (
    OptionLeg,
    OrderType,
    Signal,
    TimeInForce,
)


def test_signal_requires_exactly_one_sizing():
    """target_weight and quantity are mutually exclusive — exactly one must be set."""
    # Both set → error
    with pytest.raises(ValidationError, match="exactly one"):
        Signal(symbol="NVDA", asof=date(2024, 1, 1), order_type=OrderType.MKT,
               target_weight=0.5, quantity=10)
    # Neither set → error
    with pytest.raises(ValidationError, match="exactly one"):
        Signal(symbol="NVDA", asof=date(2024, 1, 1), order_type=OrderType.MKT)
    # Only weight → OK
    s = Signal(symbol="NVDA", asof=date(2024, 1, 1), order_type=OrderType.MKT, target_weight=0.5)
    assert s.target_weight == 0.5
    # Only quantity → OK
    s = Signal(symbol="NVDA", asof=date(2024, 1, 1), order_type=OrderType.MKT, quantity=10)
    assert s.quantity == 10


def test_signal_frozen():
    s = Signal(symbol="NVDA", asof=date(2024, 1, 1), order_type=OrderType.MKT, quantity=10)
    with pytest.raises(ValidationError):
        s.symbol = "AAPL"


def test_signal_with_option_legs():
    """Multi-leg option orders pack into a single Signal via `legs`."""
    s = Signal(
        symbol="NVDA",
        asof=date(2024, 1, 1),
        order_type=OrderType.LMT,
        target_weight=0.0,           # opens a risk-neutral position
        legs=[
            OptionLeg(occ_symbol="NVDA260425P00195000", side="sell", quantity=1),
            OptionLeg(occ_symbol="NVDA260425C00210000", side="sell", quantity=1),
        ],
    )
    assert len(s.legs) == 2
    assert s.legs[0].side == "sell"


def test_signal_tag_max_length():
    """tag caps at 256 chars so audit ledger entries stay bounded."""
    with pytest.raises(ValidationError, match="at most 256"):
        Signal(
            symbol="NVDA", asof=date(2024, 1, 1), order_type=OrderType.MKT,
            quantity=10, tag="x" * 257,
        )


def test_order_type_values():
    assert OrderType.MKT.value == "MKT"
    assert OrderType.MOO.value == "MOO"


def test_time_in_force_values():
    assert TimeInForce.DAY.value == "DAY"
    assert TimeInForce.GTC.value == "GTC"
```

- [ ] **Step 2: Verify fails**

```bash
/Users/GK/Downloads/alphadesk/.venv/bin/python -m pytest tests/_core/test_contracts.py -v
```
Expected: import error — `Signal`, `OptionLeg` etc. don't exist.

- [ ] **Step 3: Append implementation to `contracts.py`**

Append to `backend/strategies/_core/contracts.py`:

```python
from datetime import date
from enum import Enum
from typing import Literal

from pydantic import Field, model_validator


class OrderType(str, Enum):
    """Supported order types. MOO/MOC = market-on-open/close — commonly used
    by daily strategies to avoid intraday timing dependencies."""
    MKT = "MKT"
    LMT = "LMT"
    STP = "STP"
    STP_LMT = "STP_LMT"
    MOO = "MOO"
    MOC = "MOC"


class TimeInForce(str, Enum):
    """Order time-in-force. DAY is the common default; GTC for resting orders
    held across sessions; IOC/FOK for intraday immediate-or-cancel semantics."""
    DAY = "DAY"
    GTC = "GTC"
    IOC = "IOC"
    FOK = "FOK"


class OptionLeg(BaseModel):
    """One leg of a multi-leg options order. Packed into Signal.legs for
    strangles, iron condors, etc. The broker-side executor is responsible
    for routing multi-leg orders atomically where supported, or per-leg
    with risk-awareness where not."""

    model_config = ConfigDict(frozen=True)

    occ_symbol: str = Field(
        description="OCC option symbol, e.g. NVDA260425C00205000",
        pattern=r"^[A-Z]{1,6}\d{6}[CP]\d{8}$",
    )
    side: Literal["buy", "sell"]
    quantity: int = Field(ge=1, description="Number of contracts")
    limit_price: float | None = Field(default=None, ge=0)


class Signal(BaseModel):
    """One order intent emitted by a strategy on a single bar.

    Exactly one of `target_weight` or `quantity` must be set. `target_weight`
    is a fraction of portfolio equity (+0.05 = long 5%, −0.05 = short 5%);
    the executor translates to share count at fill time. `quantity` is an
    absolute signed share count the executor uses directly.

    `legs` populates for multi-leg options orders; equity orders leave it
    None.

    `tag` is a free-form audit label that surfaces in the trade ledger
    and slippage metadata; max 256 chars to keep logs bounded.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    symbol: str
    asof: date
    order_type: OrderType
    time_in_force: TimeInForce = TimeInForce.DAY
    target_weight: float | None = None
    quantity: int | None = None
    limit_price: float | None = Field(default=None, ge=0)
    stop_price: float | None = Field(default=None, ge=0)
    tag: str = Field(default="", max_length=256)
    legs: list[OptionLeg] | None = None

    @model_validator(mode="after")
    def _exactly_one_sizing(self) -> "Signal":
        has_w = self.target_weight is not None
        has_q = self.quantity is not None
        if has_w == has_q:  # both or neither
            raise ValueError(
                "Signal requires exactly one of target_weight or quantity "
                f"(target_weight={self.target_weight}, quantity={self.quantity})"
            )
        return self
```

- [ ] **Step 4: Run tests**

```bash
/Users/GK/Downloads/alphadesk/.venv/bin/python -m pytest tests/_core/test_contracts.py -v
```
Expected: all prior tests + 6 new tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/strategies/_core/contracts.py backend/tests/_core/test_contracts.py
git commit -m "feat(_core): Signal + OptionLeg + OrderType/TimeInForce enums"
```

---

### Task 4: `Position`, `Fill`, `StrategyInput`

**Files:**
- Modify: `backend/strategies/_core/contracts.py` (append)
- Modify: `backend/tests/_core/test_contracts.py` (append)

- [ ] **Step 1: Append failing tests**

```python
# in test_contracts.py
from datetime import date
from decimal import Decimal

import numpy as np
import pandas as pd

from strategies._core.contracts import Fill, Position, StrategyInput


def test_position_signed_quantity():
    p = Position(symbol="NVDA", quantity=100, avg_entry_price=Decimal("200.50"), entry_date=date(2024, 1, 1))
    assert p.quantity == 100
    p_short = Position(symbol="NVDA", quantity=-50, avg_entry_price=Decimal("200"), entry_date=date(2024, 1, 1))
    assert p_short.quantity == -50


def test_fill_frozen():
    f = Fill(symbol="NVDA", asof=date(2024, 1, 1), quantity=10, price=Decimal("200"))
    with pytest.raises(ValidationError):
        f.price = Decimal("201")


def test_strategy_input_basic_construction():
    bars = pd.DataFrame({
        "open": [100, 101], "high": [102, 103], "low": [99, 100],
        "close": [101, 102], "volume": [1_000_000, 1_100_000],
    }, index=pd.MultiIndex.from_tuples(
        [(date(2024, 1, 1), "NVDA"), (date(2024, 1, 2), "NVDA")],
        names=["date", "symbol"],
    ))
    seed = 42
    rng = np.random.default_rng(seed)
    inp = StrategyInput(
        asof=date(2024, 1, 2),
        mode="backtest",
        bars=bars,
        cash=Decimal("100000"),
        equity=Decimal("100000"),
        positions=[],
        state={},
        seed=seed,
        rng=rng,
    )
    assert inp.asof == date(2024, 1, 2)
    assert inp.mode == "backtest"
    assert inp.seed == 42
    assert len(inp.bars) == 2


def test_strategy_input_frozen():
    bars = pd.DataFrame()
    inp = StrategyInput(
        asof=date(2024, 1, 1), mode="backtest", bars=bars,
        cash=Decimal("0"), equity=Decimal("0"), positions=[],
        seed=0, rng=np.random.default_rng(0),
    )
    with pytest.raises(ValidationError):
        inp.asof = date(2024, 1, 2)


def test_strategy_input_snapshot_id_deterministic():
    """Same bars → same snapshot_id. Essential for replay."""
    bars = pd.DataFrame({
        "open": [100], "high": [102], "low": [99], "close": [101], "volume": [1_000_000],
    }, index=pd.MultiIndex.from_tuples([(date(2024, 1, 1), "NVDA")], names=["date", "symbol"]))

    def _make(seed):
        return StrategyInput(
            asof=date(2024, 1, 1), mode="backtest", bars=bars,
            cash=Decimal("100000"), equity=Decimal("100000"), positions=[],
            seed=seed, rng=np.random.default_rng(seed),
        )
    id1 = StrategyInput.snapshot_id(_make(1))
    id2 = StrategyInput.snapshot_id(_make(99))  # different seed, same data → same id
    assert id1 == id2  # seed/rng excluded from snapshot_id per spec


def test_strategy_input_snapshot_id_varies_with_data():
    b1 = pd.DataFrame({"close": [100]}, index=pd.MultiIndex.from_tuples([(date(2024, 1, 1), "NVDA")], names=["date", "symbol"]))
    b2 = pd.DataFrame({"close": [101]}, index=pd.MultiIndex.from_tuples([(date(2024, 1, 1), "NVDA")], names=["date", "symbol"]))

    def _make(b):
        return StrategyInput(
            asof=date(2024, 1, 1), mode="backtest", bars=b,
            cash=Decimal("100000"), equity=Decimal("100000"), positions=[],
            seed=0, rng=np.random.default_rng(0),
        )
    assert StrategyInput.snapshot_id(_make(b1)) != StrategyInput.snapshot_id(_make(b2))
```

- [ ] **Step 2: Verify fails**

```bash
/Users/GK/Downloads/alphadesk/.venv/bin/python -m pytest tests/_core/test_contracts.py -v
```

- [ ] **Step 3: Append implementation**

Append to `backend/strategies/_core/contracts.py`:

```python
from decimal import Decimal
from typing import Any

import numpy as np
import pandas as pd


class Position(BaseModel):
    """Current portfolio position in one symbol. Read-only in StrategyInput."""

    model_config = ConfigDict(frozen=True, arbitrary_types_allowed=True)

    symbol: str
    quantity: int = Field(description="Signed: + long, − short")
    avg_entry_price: Decimal
    entry_date: date
    tag: str = Field(default="", max_length=256)


class Fill(BaseModel):
    """One executed order. Returned by the fill simulator or the live broker;
    strategy sees it via on_fill() between bars."""

    model_config = ConfigDict(frozen=True, arbitrary_types_allowed=True)

    symbol: str
    asof: date
    quantity: int = Field(description="Signed: + long, − short")
    price: Decimal
    commission: Decimal = Decimal("0")
    signal_tag: str = Field(default="", max_length=256)


class StrategyInput(BaseModel):
    """Immutable snapshot of everything a strategy needs on one tick.

    Backtest: runner builds one per bar. Live: pipeline builds one per day.
    All time fields use `asof` (date) — the strategy must NOT read
    wall-clock. All randomness flows through `rng`, which the runner seeds
    deterministically from `seed`.

    Lookback windows (`bars`, `earnings`, `fundamentals`, `news`) are
    pre-sliced by the runner to the strategy's declared META.lookback_days
    (or META-declared requirement for each provider).
    """

    model_config = ConfigDict(frozen=True, arbitrary_types_allowed=True)

    asof: date
    mode: Literal["backtest", "paper", "live"]

    bars: pd.DataFrame
    earnings: pd.DataFrame | None = None
    fundamentals: pd.DataFrame | None = None
    news: pd.DataFrame | None = None

    cash: Decimal
    equity: Decimal
    positions: list[Position]

    state: dict[str, Any] = Field(default_factory=dict)

    seed: int
    rng: np.random.Generator = Field(exclude=True)   # not serialized; reconstructed from seed

    @classmethod
    def snapshot_id(cls, inst: "StrategyInput") -> str:
        """Hash of asof + mode + data DataFrames. Excludes seed, rng, state,
        positions, cash, equity — those are runtime state, not inputs to
        the strategy's alpha logic. Returns 16-char hex prefix of SHA-256.

        Essential for replay: a snapshot_id uniquely identifies the
        "data situation" the strategy faced. Given identical snapshot_id +
        params + seed + git_sha, strategy output is bitwise-identical."""
        h = hashlib.sha256()
        h.update(inst.asof.isoformat().encode())
        h.update(inst.mode.encode())
        h.update(pd.util.hash_pandas_object(inst.bars, index=True).values.tobytes())
        for df in (inst.earnings, inst.fundamentals, inst.news):
            if df is not None:
                h.update(pd.util.hash_pandas_object(df, index=True).values.tobytes())
        return h.hexdigest()[:16]
```

- [ ] **Step 4: Run tests**

```bash
/Users/GK/Downloads/alphadesk/.venv/bin/python -m pytest tests/_core/test_contracts.py -v
```
Expected: all prior tests + 6 new tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/strategies/_core/contracts.py backend/tests/_core/test_contracts.py
git commit -m "feat(_core): Position + Fill + StrategyInput with snapshot_id"
```

---

### Task 5: `StrategyResult`, `Trade`, `ReproMeta`, `BacktestResult`, `BacktestConfig`

**Files:**
- Modify: `backend/strategies/_core/contracts.py` (append)
- Modify: `backend/tests/_core/test_contracts.py` (append)

- [ ] **Step 1: Append failing tests**

```python
from datetime import datetime, timezone

from strategies._core.contracts import (
    BacktestConfig,
    BacktestResult,
    ReproMeta,
    StrategyResult,
    Trade,
)


def test_strategy_result_defaults():
    r = StrategyResult()
    assert r.signals == []
    assert r.state_update == {}
    assert r.diagnostics == {}
    assert r.warnings == []


def test_trade_roundtrip():
    t = Trade(
        symbol="NVDA",
        entry_date=date(2024, 1, 1),
        exit_date=date(2024, 1, 10),
        entry_price=Decimal("200"),
        exit_price=Decimal("210"),
        quantity=100,
        pnl=Decimal("1000"),
        tag="test",
    )
    dumped = t.model_dump()
    reloaded = Trade(**dumped)
    assert reloaded == t


def test_repro_meta_required_fields():
    m = ReproMeta(
        git_sha="abc123",
        param_hash="deadbeef" * 2,
        snapshot_root="cafe" * 4,
        seed=42,
        run_at=datetime.now(timezone.utc),
        strategy_name="pead",
        runner_version="1.0.0",
    )
    assert m.git_sha == "abc123"
    assert m.strategy_name == "pead"


def test_backtest_config_defaults():
    c = BacktestConfig(start=date(2023, 1, 1), end=date(2023, 12, 31))
    assert c.starting_cash == Decimal("100000")
    assert c.commission_per_share == Decimal("0.005")
    assert c.slippage_bps == 1.0
    assert c.fill_model == "next_open"
    assert c.snapshot_dir is None
    assert c.seed == 0
```

- [ ] **Step 2: Verify fails**

- [ ] **Step 3: Append implementation**

```python
# in contracts.py — append at the bottom
from datetime import datetime
from pathlib import Path


class StrategyResult(BaseModel):
    """What Strategy.run() returns on each bar.

    signals — entry/exit intents the executor will try to fill
    state_update — mutations to the strategy's state dict; runner shallow-merges
    diagnostics — strategy-specific observability (universe size, filter pass counts);
                  surfaces in `explain` CLI mode
    warnings — free-form warnings the strategy wants to flag (e.g. 'provider returned
               stale data'); aggregated into BacktestResult.warnings_by_asof
    """

    signals: list[Signal] = Field(default_factory=list)
    state_update: dict[str, Any] = Field(default_factory=dict)
    diagnostics: dict[str, Any] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)


class Trade(BaseModel):
    """One closed round-trip trade (entry + exit). `pnl` is signed; negative on loss.
    `exit_date` and `exit_price` are None for open positions (included in
    BacktestResult.trades for positions still open at backtest end)."""

    model_config = ConfigDict(frozen=True, arbitrary_types_allowed=True)

    symbol: str
    entry_date: date
    exit_date: date | None = None
    entry_price: Decimal
    exit_price: Decimal | None = None
    quantity: int                                   # signed: + long, − short
    pnl: Decimal | None = None                      # realized at close
    tag: str = Field(default="", max_length=256)


class ReproMeta(BaseModel):
    """Reproducibility metadata stamped on every BacktestResult.

    Given identical (git_sha, param_hash, snapshot_root, seed) → re-running
    the strategy produces bitwise-identical results. This is the "replay
    guarantee" that makes post-mortem debugging possible.

    runner_version is bumped on any behavior-changing runner release
    (bar iteration order, fill model, seed-forking scheme, etc). See
    strategies/_core/__init__.py for the constant.
    """

    model_config = ConfigDict(frozen=True)

    git_sha: str
    param_hash: str
    snapshot_root: str = Field(default="", description="Compound SHA of per-bar snapshot_ids; '' when no snapshots were written")
    seed: int
    run_at: datetime
    strategy_name: str
    runner_version: str


class BacktestConfig(BaseModel):
    """Configuration for a single BacktestRunner.run() invocation.

    Distinct from strategy params: this holds run-level settings (date
    range, capital, commission model) that are orthogonal to strategy
    logic. Changing these does NOT invalidate strategy params.
    """

    model_config = ConfigDict(frozen=True, arbitrary_types_allowed=True)

    start: date
    end: date
    starting_cash: Decimal = Decimal("100000")
    commission_per_share: Decimal = Decimal("0.005")
    slippage_bps: float = Field(default=1.0, ge=0)
    fill_model: Literal["next_open", "next_close", "midpoint"] = "next_open"
    snapshot_dir: Path | None = Field(
        default=None,
        description="If set, write per-bar StrategyInput snapshots to this dir for replay.",
    )
    seed: int = Field(default=0, ge=0)


class BacktestResult(BaseModel):
    """Aggregated result of a BacktestRunner.run().

    Contains time series (equity_curve, daily_returns) as pandas objects for
    analytics, and discrete artifacts (trades, signals_emitted) as lists of
    Pydantic models for round-trippable serialization.

    `repro` is the single source of truth for reproducibility metadata;
    see ReproMeta for replay semantics.
    """

    model_config = ConfigDict(arbitrary_types_allowed=True)

    equity_curve: pd.DataFrame                      # columns: cash, positions_value, equity, drawdown
    daily_returns: pd.Series
    trades: list[Trade]
    signals_emitted: list[Signal]
    metrics: dict[str, float]                       # sharpe, sortino, cagr, max_dd, calmar, turnover
    params: dict                                    # params.model_dump()
    start: date
    end: date
    repro: ReproMeta
    warnings_by_asof: dict[date, list[str]] = Field(default_factory=dict)
```

- [ ] **Step 4: Run tests**

```bash
/Users/GK/Downloads/alphadesk/.venv/bin/python -m pytest tests/_core/test_contracts.py -v
```
Expected: all prior + 4 new tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/strategies/_core/contracts.py backend/tests/_core/test_contracts.py
git commit -m "feat(_core): StrategyResult + Trade + ReproMeta + BacktestResult + BacktestConfig"
```

---

### Task 6: `Strategy` ABC + `StrategyMeta` + `register_strategy`

**Files:**
- Create: `backend/strategies/_core/protocol.py`
- Create: `backend/tests/_core/test_protocol.py`

- [ ] **Step 1: Write failing tests**

```python
# backend/tests/_core/test_protocol.py
"""Strategy ABC + registry decorator tests."""
from __future__ import annotations

from datetime import date
from typing import Any

import pytest
from pydantic import Field, ValidationError

from strategies._core.contracts import (
    Fill,
    StrategyInput,
    StrategyParams,
    StrategyResult,
)
from strategies._core.protocol import (
    Strategy,
    StrategyMeta,
    _REGISTRY,
    get_meta,
    get_strategy,
    list_strategies,
    register_strategy,
)


class DummyParams(StrategyParams):
    threshold: float = Field(default=1.0, ge=0)


class DummyStrategy(Strategy):
    PARAMS_MODEL = DummyParams

    def universe(self, asof: date, state: dict[str, Any]) -> list[str]:
        return ["SPY"]

    def run(self, input: StrategyInput, params: DummyParams) -> StrategyResult:
        return StrategyResult()


def test_strategy_meta_defaults():
    meta = StrategyMeta(name="test")
    assert meta.category == "equity"
    assert meta.kind == "autonomous"
    assert meta.lookback_days == 250
    assert meta.required_bars == ("daily",)
    assert meta.min_universe_size == 1


def test_register_strategy_decorator_sets_META_and_records():
    _REGISTRY.pop("dummy_reg", None)

    @register_strategy(StrategyMeta(name="dummy_reg", description="A test"))
    class Impl(DummyStrategy):
        pass

    assert Impl.META.name == "dummy_reg"
    assert Impl.META.params_model is DummyParams
    assert "dummy_reg" in _REGISTRY
    assert get_strategy("dummy_reg") is Impl
    assert get_meta("dummy_reg").description == "A test"


def test_register_strategy_rejects_missing_PARAMS_MODEL():
    class Bad(Strategy):
        def universe(self, asof, state):
            return []
        def run(self, input, params):
            return StrategyResult()

    with pytest.raises(TypeError, match="PARAMS_MODEL"):
        register_strategy(StrategyMeta(name="bad"))(Bad)


def test_register_strategy_rejects_invalid_kind():
    with pytest.raises(ValidationError):
        StrategyMeta(name="x", kind="engine")  # not in Literal


def test_strategy_abc_forbids_partial_implementation():
    """An instance missing universe() or run() can't be instantiated."""
    class MissingRun(Strategy):
        PARAMS_MODEL = DummyParams
        def universe(self, asof, state):
            return []

    with pytest.raises(TypeError, match="abstract"):
        MissingRun()


def test_on_fill_default_noop():
    s = DummyStrategy()
    update = s.on_fill(
        Fill(symbol="SPY", asof=date(2024, 1, 1), quantity=10, price=__import__("decimal").Decimal("400")),
        state={"foo": "bar"},
    )
    assert update == {}


def test_list_strategies_returns_all_registered():
    _REGISTRY.clear()

    @register_strategy(StrategyMeta(name="alpha"))
    class A(DummyStrategy):
        pass

    @register_strategy(StrategyMeta(name="beta"))
    class B(DummyStrategy):
        pass

    names = {m.name for m in list_strategies()}
    assert {"alpha", "beta"}.issubset(names)
```

- [ ] **Step 2: Verify fails**

```bash
/Users/GK/Downloads/alphadesk/.venv/bin/python -m pytest tests/_core/test_protocol.py -v
```
Expected: ImportError on `strategies._core.protocol`.

- [ ] **Step 3: Implement `protocol.py`**

```python
# backend/strategies/_core/protocol.py
"""Strategy ABC + registry decorator.

Every strategy in AlphaDesk inherits from Strategy, declares PARAMS_MODEL
(pointing at its Pydantic Params subclass), implements universe() and
run(), and registers itself via @register_strategy at import time.

This module is the single source of truth for what it means to be a
Strategy. The runners (in runners/) consume Strategy instances but
never import concrete strategy classes.
"""
from __future__ import annotations

import abc
from datetime import date
from typing import Any, Callable, ClassVar, Literal

from pydantic import BaseModel, ConfigDict

from strategies._core.contracts import (
    Fill,
    StrategyInput,
    StrategyParams,
    StrategyResult,
)


class Strategy(abc.ABC):
    """Every strategy inherits from this ABC.

    Required class-level declarations:
      PARAMS_MODEL — Pydantic subclass of StrategyParams validating the
                     strategy's parameters. Runner uses it to parse
                     CLI --params and serve JSON Schema.

    Required methods:
      universe(asof, state) — return symbols the runner should pre-fetch bars for
      run(input, params)    — pure-function alpha logic; return StrategyResult

    Optional methods:
      on_fill(fill, state)  — update state after a fill; default is no-op

    Purity invariants (enforced by runner construction + code review):
      * run() MUST NOT perform I/O (no provider access, no network)
      * run() MUST NOT read wall-clock time — input.asof is the only time source
      * run() MUST NOT use global RNG — input.rng is the only random source
      * state mutations flow ONLY through StrategyResult.state_update and
        on_fill() return values; no `self._state` on strategy instances
    """

    PARAMS_MODEL: ClassVar[type[StrategyParams]]
    """Subclass must set. Registry validates its presence."""

    META: ClassVar["StrategyMeta"]
    """Set by @register_strategy. Reading post-registration is fine."""

    @abc.abstractmethod
    def universe(self, asof: date, state: dict[str, Any]) -> list[str]:
        """Return symbols the runner should pre-fetch bars for on `asof`.

        Called BEFORE run(). May read state (for strategies with a dynamic
        universe tracked across bars) but MUST NOT read positions or params
        — those are signal-logic concerns. For static universes, return a
        constant list.
        """

    @abc.abstractmethod
    def run(
        self,
        input: StrategyInput,
        params: StrategyParams,
    ) -> StrategyResult:
        """Pure-function alpha logic. Deterministic given (input, params)."""

    def on_fill(
        self,
        fill: Fill,
        state: dict[str, Any],
    ) -> dict[str, Any]:
        """Optional state update after a fill. Default: no-op.

        Called BETWEEN run() calls by the runner; the returned dict is
        shallow-merged into state before the next bar. Strategies that
        need per-position memory (entry price for stops, ATR at entry)
        override this.
        """
        return {}


class StrategyMeta(BaseModel):
    """Registry metadata attached by @register_strategy. Frozen."""

    model_config = ConfigDict(frozen=True)

    name: str
    category: Literal["equity", "options", "pairs", "macro", "intraday", "smoke"] = "equity"
    description: str = ""
    kind: Literal["autonomous", "research"] = "autonomous"
    lookback_days: int = 250
    required_bars: tuple[Literal["daily", "1min", "5min", "1h"], ...] = ("daily",)
    min_universe_size: int = 1
    params_model: type[StrategyParams] | None = None
    """Set by @register_strategy from the class's PARAMS_MODEL attribute."""


_REGISTRY: dict[str, tuple[type[Strategy], StrategyMeta]] = {}


def register_strategy(meta: StrategyMeta) -> Callable[[type[Strategy]], type[Strategy]]:
    """Decorator that registers a Strategy subclass in the process-global registry.

    Usage:
        @register_strategy(StrategyMeta(name="pead", category="options", ...))
        class PEADStrategy(Strategy):
            PARAMS_MODEL = PEADParams
            ...

    Raises TypeError if the class doesn't declare PARAMS_MODEL. Stamps
    META onto the class post-registration so runners can read it via
    cls.META.
    """
    def decorator(cls: type[Strategy]) -> type[Strategy]:
        if not hasattr(cls, "PARAMS_MODEL"):
            raise TypeError(
                f"{cls.__name__} must declare PARAMS_MODEL: type[StrategyParams]"
            )
        frozen_meta = meta.model_copy(update={"params_model": cls.PARAMS_MODEL})
        cls.META = frozen_meta
        _REGISTRY[meta.name] = (cls, frozen_meta)
        return cls

    return decorator


def get_strategy(name: str) -> type[Strategy] | None:
    entry = _REGISTRY.get(name)
    return entry[0] if entry else None


def get_meta(name: str) -> StrategyMeta | None:
    entry = _REGISTRY.get(name)
    return entry[1] if entry else None


def list_strategies() -> list[StrategyMeta]:
    return [meta for _, meta in _REGISTRY.values()]
```

- [ ] **Step 4: Run tests**

```bash
/Users/GK/Downloads/alphadesk/.venv/bin/python -m pytest tests/_core/test_protocol.py -v
```
Expected: all 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/strategies/_core/protocol.py backend/tests/_core/test_protocol.py
git commit -m "feat(_core): Strategy ABC + StrategyMeta + register_strategy decorator"
```

---

### Task 7: `SnapshotWriter` + `SnapshotReader`

**Files:**
- Create: `backend/strategies/_core/snapshots.py`
- Create: `backend/tests/_core/test_snapshots.py`

- [ ] **Step 1: Write failing tests**

```python
# backend/tests/_core/test_snapshots.py
"""Snapshot write+read round-trip for deterministic replay."""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from strategies._core.contracts import StrategyInput
from strategies._core.snapshots import SnapshotReader, SnapshotWriter


def _make_input(asof: date, seed: int = 42) -> StrategyInput:
    bars = pd.DataFrame({
        "open": [100.0, 101.0], "high": [102.0, 103.0], "low": [99.0, 100.0],
        "close": [101.0, 102.0], "volume": [1_000_000, 1_100_000],
    }, index=pd.MultiIndex.from_tuples(
        [(date(2024, 1, 1), "NVDA"), (date(2024, 1, 2), "NVDA")],
        names=["date", "symbol"],
    ))
    return StrategyInput(
        asof=asof, mode="backtest", bars=bars,
        cash=Decimal("100000"), equity=Decimal("100000"),
        positions=[], state={"tracked": "value"},
        seed=seed, rng=np.random.default_rng(seed),
    )


def test_snapshot_write_creates_parquet(tmp_path: Path):
    inp = _make_input(date(2024, 1, 2))
    writer = SnapshotWriter(tmp_path)
    sid = writer.write(inp)
    assert len(sid) == 16  # 16-char hex snapshot_id
    # Expect a parquet file at tmp_path/backtest/2024-01-02/{sid}/*.parquet
    bars_parquet = tmp_path / "backtest" / "2024-01-02" / sid / "bars.parquet"
    assert bars_parquet.exists()


def test_snapshot_roundtrip_preserves_data(tmp_path: Path):
    """Reading back a snapshot produces an identical-data StrategyInput."""
    inp = _make_input(date(2024, 1, 2))
    writer = SnapshotWriter(tmp_path)
    writer.write(inp)

    reader = SnapshotReader(tmp_path)
    restored = reader.read(date(2024, 1, 2))

    assert restored.asof == inp.asof
    assert restored.mode == inp.mode
    assert restored.seed == inp.seed
    pd.testing.assert_frame_equal(restored.bars, inp.bars)
    assert restored.state == inp.state
    assert restored.cash == inp.cash


def test_snapshot_rng_reconstructed_deterministically(tmp_path: Path):
    """rng is not serialized; reader reconstructs via np.random.default_rng(seed).
    Same seed → same first 5 draws."""
    inp = _make_input(date(2024, 1, 2), seed=123)
    writer = SnapshotWriter(tmp_path)
    writer.write(inp)
    reader = SnapshotReader(tmp_path)
    restored = reader.read(date(2024, 1, 2))

    assert list(inp.rng.integers(0, 1_000_000, size=5)) == list(
        restored.rng.integers(0, 1_000_000, size=5)
    )


def test_snapshot_reader_raises_on_missing(tmp_path: Path):
    reader = SnapshotReader(tmp_path)
    with pytest.raises(FileNotFoundError):
        reader.read(date(2024, 1, 2))


def test_snapshot_writer_id_deterministic(tmp_path: Path):
    """Writing the same input twice produces the same snapshot_id."""
    inp = _make_input(date(2024, 1, 2))
    writer = SnapshotWriter(tmp_path)
    sid1 = writer.write(inp)
    sid2 = writer.write(inp)
    assert sid1 == sid2
```

- [ ] **Step 2: Verify fails**

- [ ] **Step 3: Implement `snapshots.py`**

```python
# backend/strategies/_core/snapshots.py
"""Parquet-backed snapshot writer/reader for StrategyInput.

Enables the Full reproducibility guarantee: given (git_sha, params, seed,
snapshot_id), re-running a strategy produces bitwise-identical results.
"""
from __future__ import annotations

import json
from datetime import date
from decimal import Decimal
from pathlib import Path

import numpy as np
import pandas as pd

from strategies._core.contracts import Position, StrategyInput


class SnapshotWriter:
    """Writes StrategyInput to a directory tree keyed by (mode, asof, snapshot_id).

    Layout:
        <root>/
          backtest/
            2024-01-02/
              <snapshot_id>/
                bars.parquet
                earnings.parquet     # optional, if present on input
                fundamentals.parquet # optional
                news.parquet         # optional
                meta.json            # asof, mode, seed, state, positions, cash, equity
          live/ ...

    The per-bar snapshot_id is StrategyInput.snapshot_id(input), which is
    a 16-char hex prefix of SHA-256 over (asof, mode, DataFrame hashes).
    """

    def __init__(self, root: Path):
        self._root = Path(root)
        self._root.mkdir(parents=True, exist_ok=True)

    def write(self, input: StrategyInput) -> str:
        sid = StrategyInput.snapshot_id(input)
        dest = self._root / input.mode / input.asof.isoformat() / sid
        dest.mkdir(parents=True, exist_ok=True)

        input.bars.to_parquet(dest / "bars.parquet")
        for name in ("earnings", "fundamentals", "news"):
            df = getattr(input, name)
            if df is not None:
                df.to_parquet(dest / f"{name}.parquet")

        meta = {
            "asof": input.asof.isoformat(),
            "mode": input.mode,
            "seed": input.seed,
            "state": input.state,
            "cash": str(input.cash),
            "equity": str(input.equity),
            "positions": [p.model_dump(mode="json") for p in input.positions],
        }
        (dest / "meta.json").write_text(json.dumps(meta, default=str))
        return sid


class SnapshotReader:
    """Read back a StrategyInput written by SnapshotWriter.

    Given an asof, finds the single snapshot directory under
    `<root>/*/<asof>/*/` and reconstructs the StrategyInput. The `rng`
    field is rebuilt from the stored `seed` — NOT serialized directly —
    so replay is deterministic even across machines/Python versions.
    """

    def __init__(self, root: Path):
        self._root = Path(root)

    def read(self, asof: date) -> StrategyInput:
        # Search across modes (backtest/paper/live) and snapshot_ids for this date
        asof_str = asof.isoformat()
        candidates = list(self._root.glob(f"*/{asof_str}/*"))
        if not candidates:
            raise FileNotFoundError(f"No snapshot found for asof={asof_str} under {self._root}")
        if len(candidates) > 1:
            # Multiple snapshots for same date → ambiguous; caller must pick one
            raise ValueError(
                f"Multiple snapshots for asof={asof_str}: {[str(p) for p in candidates]}. "
                "Use a more specific reader API in future."
            )
        snap_dir = candidates[0]

        bars = pd.read_parquet(snap_dir / "bars.parquet")
        earnings = pd.read_parquet(snap_dir / "earnings.parquet") if (snap_dir / "earnings.parquet").exists() else None
        fundamentals = pd.read_parquet(snap_dir / "fundamentals.parquet") if (snap_dir / "fundamentals.parquet").exists() else None
        news = pd.read_parquet(snap_dir / "news.parquet") if (snap_dir / "news.parquet").exists() else None

        meta = json.loads((snap_dir / "meta.json").read_text())

        return StrategyInput(
            asof=date.fromisoformat(meta["asof"]),
            mode=meta["mode"],
            bars=bars, earnings=earnings, fundamentals=fundamentals, news=news,
            cash=Decimal(meta["cash"]),
            equity=Decimal(meta["equity"]),
            positions=[Position(**p) for p in meta["positions"]],
            state=meta["state"],
            seed=meta["seed"],
            rng=np.random.default_rng(meta["seed"]),
        )
```

- [ ] **Step 4: Run tests**

```bash
/Users/GK/Downloads/alphadesk/.venv/bin/python -m pytest tests/_core/test_snapshots.py -v
```
Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/strategies/_core/snapshots.py backend/tests/_core/test_snapshots.py
git commit -m "feat(_core): SnapshotWriter + SnapshotReader parquet-backed round-trip"
```

---

### Task 8: `FillSimulator` + `Portfolio`

**Files:**
- Create: `backend/strategies/_core/fills.py`
- Create: `backend/tests/_core/test_fills.py`

- [ ] **Step 1: Write failing tests**

```python
# backend/tests/_core/test_fills.py
"""FillSimulator (slippage + commission) + Portfolio (position ledger)."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pandas as pd

from strategies._core.contracts import (
    BacktestConfig,
    OrderType,
    Position,
    Signal,
    TimeInForce,
)
from strategies._core.fills import FillSimulator, Portfolio


def _bar(price: float = 100.0) -> pd.Series:
    return pd.Series({"open": price, "high": price * 1.01, "low": price * 0.99,
                      "close": price * 1.005, "volume": 1_000_000})


def test_fill_simulator_next_open():
    cfg = BacktestConfig(start=date(2024, 1, 1), end=date(2024, 12, 31),
                         slippage_bps=1.0, fill_model="next_open")
    sim = FillSimulator(cfg)
    signal = Signal(symbol="NVDA", asof=date(2024, 1, 1),
                    order_type=OrderType.MOO, quantity=100)
    fills = sim.fill([signal], next_bars={"NVDA": _bar(100.0)}, asof=date(2024, 1, 2))
    assert len(fills) == 1
    f = fills[0]
    # Buy slippage: 1 bps added to open
    assert f.symbol == "NVDA"
    assert f.quantity == 100
    assert f.price == Decimal("100.01")              # 100 + 1bps
    assert f.commission == Decimal("0.50")           # 100 shares × $0.005


def test_fill_simulator_sell_slippage():
    cfg = BacktestConfig(start=date(2024, 1, 1), end=date(2024, 12, 31),
                         slippage_bps=1.0, fill_model="next_open")
    sim = FillSimulator(cfg)
    signal = Signal(symbol="NVDA", asof=date(2024, 1, 1),
                    order_type=OrderType.MOO, quantity=-100)  # sell
    fills = sim.fill([signal], next_bars={"NVDA": _bar(100.0)}, asof=date(2024, 1, 2))
    assert fills[0].price == Decimal("99.99")        # 100 − 1bps


def test_portfolio_apply_fill_updates_position_and_cash():
    p = Portfolio(Decimal("100000"))
    p.apply_fill(type("F", (), {
        "symbol": "NVDA", "asof": date(2024, 1, 1), "quantity": 100,
        "price": Decimal("200"), "commission": Decimal("0.50"),
    })())
    assert p.cash == Decimal("79999.50")             # 100k − 100*200 − 0.50
    snap = p.positions_snapshot()
    assert len(snap) == 1
    assert snap[0].symbol == "NVDA"
    assert snap[0].quantity == 100


def test_portfolio_closing_position_realizes_pnl():
    p = Portfolio(Decimal("100000"))

    class F:
        def __init__(self, qty, price):
            self.symbol = "NVDA"
            self.asof = date(2024, 1, 1)
            self.quantity = qty
            self.price = Decimal(str(price))
            self.commission = Decimal("0")
            self.signal_tag = ""

    p.apply_fill(F(100, 200))                        # buy 100 @ 200
    p.apply_fill(F(-100, 210))                       # sell 100 @ 210 → +1000 PnL
    assert p.cash == Decimal("101000")
    assert len(p.positions_snapshot()) == 0
    closed = p.closed_trades()
    assert len(closed) == 1
    assert closed[0].pnl == Decimal("1000")
```

- [ ] **Step 2: Verify fails**

- [ ] **Step 3: Implement `fills.py`**

```python
# backend/strategies/_core/fills.py
"""Fill simulation + portfolio ledger for BacktestRunner.

Kept simple: fills at next-bar open (or close, or midpoint) with a
slippage_bps adjustment and a flat per-share commission. Matches the
behavior of the legacy engine.py within the tolerance specified in the
spec's parity-test acceptance criteria.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Iterable

import pandas as pd

from strategies._core.contracts import (
    BacktestConfig,
    Fill,
    Position,
    Signal,
    Trade,
)


class FillSimulator:
    """Converts Signals into Fills using a configurable fill model + slippage.

    The caller (BacktestRunner) is responsible for supplying the "next bar"
    data for each signal's symbol; the simulator picks the reference price
    from that bar per config.fill_model.
    """

    def __init__(self, config: BacktestConfig):
        self._config = config

    def fill(
        self,
        signals: Iterable[Signal],
        next_bars: dict[str, pd.Series],
        asof: date,
    ) -> list[Fill]:
        """Convert signals to fills. `next_bars` maps symbol → next bar's OHLCV row."""
        fills: list[Fill] = []
        for s in signals:
            if s.quantity is None:
                # target_weight path: caller should have translated; skip here
                continue
            bar = next_bars.get(s.symbol)
            if bar is None:
                continue  # no fill — symbol not in next-bar universe

            ref_price = self._reference_price(bar)
            slip = ref_price * Decimal(str(self._config.slippage_bps / 10_000))
            # Buy side slips up, sell side slips down (adverse selection)
            fill_price = ref_price + slip if s.quantity > 0 else ref_price - slip
            commission = Decimal(abs(s.quantity)) * self._config.commission_per_share

            fills.append(Fill(
                symbol=s.symbol, asof=asof, quantity=s.quantity,
                price=fill_price.quantize(Decimal("0.01")),
                commission=commission.quantize(Decimal("0.01")),
                signal_tag=s.tag,
            ))
        return fills

    def _reference_price(self, bar: pd.Series) -> Decimal:
        if self._config.fill_model == "next_open":
            return Decimal(str(bar["open"]))
        if self._config.fill_model == "next_close":
            return Decimal(str(bar["close"]))
        # midpoint
        return (Decimal(str(bar["high"])) + Decimal(str(bar["low"]))) / Decimal("2")


class Portfolio:
    """Simple position ledger. Tracks cash, open positions, and closed trades.

    When a fill closes (or partially closes) an existing position, the
    realized PnL is booked into the corresponding Trade record. Opening
    fills add to the position's cumulative quantity with volume-weighted
    average entry price.
    """

    def __init__(self, starting_cash: Decimal):
        self._cash = starting_cash
        self._positions: dict[str, Position] = {}      # keyed by symbol
        self._trades: list[Trade] = []                 # closed round-trips
        self._open_trades: dict[str, Trade] = {}       # opening trade per symbol

    @property
    def cash(self) -> Decimal:
        return self._cash

    @property
    def equity(self) -> Decimal:
        # Simplification: BacktestRunner computes mark-to-market before each bar.
        # At portfolio level, equity = cash + sum(position.qty * avg_entry_price);
        # for MTM use mark_to_market(prices) instead.
        positions_value = sum(
            (p.quantity * p.avg_entry_price for p in self._positions.values()),
            start=Decimal("0"),
        )
        return self._cash + positions_value

    def positions_snapshot(self) -> list[Position]:
        return list(self._positions.values())

    def closed_trades(self) -> list[Trade]:
        return list(self._trades)

    def apply_fill(self, fill: Fill) -> None:
        self._cash -= Decimal(fill.quantity) * fill.price + fill.commission

        existing = self._positions.get(fill.symbol)
        if existing is None or (existing.quantity > 0) == (fill.quantity > 0):
            # No existing position or same-side add
            new_qty = (existing.quantity if existing else 0) + fill.quantity
            if new_qty == 0:
                self._close_position(fill.symbol, fill)
                return
            # Volume-weighted average entry price
            old_notional = (existing.avg_entry_price * existing.quantity) if existing else Decimal("0")
            new_notional = fill.price * Decimal(fill.quantity)
            avg_price = (old_notional + new_notional) / Decimal(new_qty)
            self._positions[fill.symbol] = Position(
                symbol=fill.symbol, quantity=new_qty,
                avg_entry_price=avg_price,
                entry_date=existing.entry_date if existing else fill.asof,
                tag=existing.tag if existing else fill.signal_tag,
            )
            if fill.symbol not in self._open_trades:
                self._open_trades[fill.symbol] = Trade(
                    symbol=fill.symbol, entry_date=fill.asof,
                    entry_price=fill.price, quantity=new_qty,
                    tag=fill.signal_tag,
                )
        else:
            # Opposite-side: closes or flips position
            if abs(fill.quantity) >= abs(existing.quantity):
                # Closes (and possibly flips)
                self._close_position(fill.symbol, fill)
                remainder = fill.quantity + existing.quantity  # signed
                if remainder != 0:
                    # Flipped: open new position with the remainder
                    self._positions[fill.symbol] = Position(
                        symbol=fill.symbol, quantity=remainder,
                        avg_entry_price=fill.price, entry_date=fill.asof,
                        tag=fill.signal_tag,
                    )
                    self._open_trades[fill.symbol] = Trade(
                        symbol=fill.symbol, entry_date=fill.asof,
                        entry_price=fill.price, quantity=remainder,
                        tag=fill.signal_tag,
                    )
            else:
                # Partial close
                new_qty = existing.quantity + fill.quantity  # signed, smaller magnitude
                self._positions[fill.symbol] = existing.model_copy(
                    update={"quantity": new_qty}
                )

    def _close_position(self, symbol: str, fill: Fill) -> None:
        existing = self._positions.pop(symbol, None)
        open_trade = self._open_trades.pop(symbol, None)
        if existing is None or open_trade is None:
            return
        pnl = (fill.price - existing.avg_entry_price) * Decimal(existing.quantity)
        self._trades.append(open_trade.model_copy(update={
            "exit_date": fill.asof,
            "exit_price": fill.price,
            "pnl": pnl,
        }))
```

- [ ] **Step 4: Run tests**

```bash
/Users/GK/Downloads/alphadesk/.venv/bin/python -m pytest tests/_core/test_fills.py -v
```
Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/strategies/_core/fills.py backend/tests/_core/test_fills.py
git commit -m "feat(_core): FillSimulator + Portfolio ledger"
```

---

### Task 9: Provider bundle

**Files:**
- Create: `backend/strategies/_core/providers.py`
- Create: `backend/tests/_core/test_providers.py`

- [ ] **Step 1: Write failing tests**

```python
# backend/tests/_core/test_providers.py
"""Provider abstraction + factory tests. Adapters over the existing FMP/Alpaca code."""
from __future__ import annotations

from datetime import date

import pandas as pd
import pytest

from strategies._core.providers import (
    BarProvider,
    EarningsProvider,
    FundamentalsProvider,
    ProviderBundle,
    default_provider_bundle,
)


def test_bar_provider_protocol_has_fetch_window():
    assert hasattr(BarProvider, "fetch_window")


def test_provider_bundle_instantiates_with_three_providers():
    class FakeBars:
        def fetch_window(self, symbols, asof, lookback_days):
            return pd.DataFrame()

    class FakeEarnings:
        def fetch_window(self, symbols, asof, lookback_days):
            return pd.DataFrame()

    class FakeFundamentals:
        def snapshot(self, symbols, asof):
            return pd.DataFrame()

    bundle = ProviderBundle(
        bars=FakeBars(),
        earnings=FakeEarnings(),
        fundamentals=FakeFundamentals(),
    )
    assert bundle.bars is not None
    assert bundle.earnings is not None


def test_default_provider_bundle_returns_bundle():
    """default_provider_bundle() returns a bundle with default backend providers.
    Not all strategies use earnings/fundamentals, so those may be None."""
    bundle = default_provider_bundle()
    assert bundle.bars is not None  # bars provider is required
```

- [ ] **Step 2: Verify fails**

- [ ] **Step 3: Implement `providers.py`**

```python
# backend/strategies/_core/providers.py
"""Provider abstractions + factories. Thin facades over existing AlphaDesk
backend provider classes (AlpacaBarProvider, FMPEarningsProvider, etc).

Runners accept a ProviderBundle rather than individual providers so
tests can swap in fakes easily.
"""
from __future__ import annotations

from datetime import date
from typing import Protocol

import pandas as pd


class BarProvider(Protocol):
    def fetch_window(
        self, symbols: list[str], asof: date, lookback_days: int
    ) -> pd.DataFrame:
        """Return bars for `symbols` over the `lookback_days` window ending at `asof`.

        Returned DataFrame has columns (open, high, low, close, volume) and
        a multi-index of (date, symbol). Missing symbols are omitted silently;
        callers handle empty windows.
        """
        ...


class EarningsProvider(Protocol):
    def fetch_window(
        self, symbols: list[str], asof: date, lookback_days: int
    ) -> pd.DataFrame:
        """Return earnings announcements for `symbols` over the window.

        DataFrame columns: symbol, report_date, report_time (BMO/AMC/DMT),
        eps_actual, eps_est, surprise.
        """
        ...


class FundamentalsProvider(Protocol):
    def snapshot(
        self, symbols: list[str], asof: date
    ) -> pd.DataFrame:
        """Return a point-in-time fundamentals snapshot for `symbols` on `asof`."""
        ...


class ProviderBundle:
    """Container for all providers a strategy might need. Not all strategies
    use all providers; missing providers are None and accessed via conditional
    checks in the runner."""

    def __init__(
        self,
        bars: BarProvider,
        earnings: EarningsProvider | None = None,
        fundamentals: FundamentalsProvider | None = None,
    ):
        self.bars = bars
        self.earnings = earnings
        self.fundamentals = fundamentals


def default_provider_bundle() -> ProviderBundle:
    """Return a ProviderBundle wired to the current AlphaDesk backend providers.

    Uses lazy imports to avoid circular-import issues when strategies/_core
    is imported at module-load time by the registry machinery.
    """
    # Lazy imports to keep strategies/_core/ independent of data/providers.
    from data.providers.alpaca_bars import AlpacaBarProvider
    from data.providers.fmp_earnings import FMPEarningsProvider

    return ProviderBundle(
        bars=AlpacaBarProvider(),
        earnings=FMPEarningsProvider(),
        fundamentals=None,
    )
```

- [ ] **Step 4: Run tests**

Note: `test_default_provider_bundle_returns_bundle` will fail if `AlpacaBarProvider` / `FMPEarningsProvider` can't be imported (e.g. missing env vars, missing dependencies). If that's the case in the dev environment, mark that one test `@pytest.mark.skipif(os.environ.get('ALPACA_API_KEY') is None, reason=...)`. Don't block the suite on provider wiring.

```bash
/Users/GK/Downloads/alphadesk/.venv/bin/python -m pytest tests/_core/test_providers.py -v
```
Expected: 2 tests PASS; 1 possibly skipped if the env doesn't have provider creds.

- [ ] **Step 5: Commit**

```bash
git add backend/strategies/_core/providers.py backend/tests/_core/test_providers.py
git commit -m "feat(_core): ProviderBundle + BarProvider/EarningsProvider/FundamentalsProvider protocols"
```

---

### Task 10: `BacktestRunner`

**Files:**
- Create: `backend/strategies/_core/runners/backtest_runner.py`
- Create: `backend/tests/_core/test_backtest_runner.py`

- [ ] **Step 1: Write failing test**

```python
# backend/tests/_core/test_backtest_runner.py
"""BacktestRunner — orchestrates bar-by-bar strategy execution + reproducibility."""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from typing import Any

import numpy as np
import pandas as pd
import pytest
from pydantic import Field

from strategies._core.contracts import (
    BacktestConfig,
    OrderType,
    Signal,
    StrategyInput,
    StrategyParams,
    StrategyResult,
)
from strategies._core.protocol import (
    Strategy,
    StrategyMeta,
    register_strategy,
)
from strategies._core.runners.backtest_runner import BacktestRunner


class SimpleParams(StrategyParams):
    buy_threshold: float = Field(default=100.0)


class FakeBarProvider:
    """Deterministic bar provider — synthesizes a price series."""
    def __init__(self, symbols: list[str], start: date, days: int, price_start: float = 100.0):
        self._symbols = symbols
        dates = [start + timedelta(days=i) for i in range(days)]
        self._df = pd.DataFrame([
            {"date": d, "symbol": sym, "open": price_start + i,
             "high": price_start + i + 1, "low": price_start + i - 1,
             "close": price_start + i + 0.5, "volume": 1_000_000}
            for i, d in enumerate(dates) for sym in symbols
        ]).set_index(["date", "symbol"])

    def fetch_window(self, symbols, asof, lookback_days):
        cutoff = asof - timedelta(days=lookback_days)
        return self._df.query("date >= @cutoff and date <= @asof")


class BuyTheDipStrategy(Strategy):
    """Test double: buys 1 share of SPY whenever close < buy_threshold."""
    PARAMS_MODEL = SimpleParams

    def universe(self, asof, state):
        return ["SPY"]

    def run(self, input, params):
        try:
            today = input.bars.xs(input.asof, level="date")
        except KeyError:
            return StrategyResult()
        signals = []
        for sym, row in today.iterrows():
            if row["close"] < params.buy_threshold and not any(p.symbol == sym for p in input.positions):
                signals.append(Signal(
                    symbol=sym, asof=input.asof,
                    order_type=OrderType.MOO, quantity=1,
                ))
        return StrategyResult(signals=signals)


def _make_bars(start: date, days: int):
    return FakeBarProvider(["SPY"], start, days, price_start=100.0)


def test_backtest_runner_produces_deterministic_results():
    """Two identical runs must produce bitwise-identical equity curves."""
    strat = BuyTheDipStrategy()
    # Must register so META is attached
    register_strategy(StrategyMeta(name="bttest", category="equity", lookback_days=5))(BuyTheDipStrategy)
    strat2 = BuyTheDipStrategy()

    cfg = BacktestConfig(
        start=date(2024, 1, 1), end=date(2024, 1, 10),
        starting_cash=Decimal("100000"), seed=42,
    )
    bars = _make_bars(cfg.start, 10)
    r1 = BacktestRunner(strat, cfg, bar_provider=bars).run(SimpleParams(buy_threshold=200.0))
    r2 = BacktestRunner(strat2, cfg, bar_provider=bars).run(SimpleParams(buy_threshold=200.0))

    # Metadata differs (run_at) but equity curves match
    pd.testing.assert_frame_equal(r1.equity_curve, r2.equity_curve)
    assert r1.signals_emitted == r2.signals_emitted
    assert r1.repro.param_hash == r2.repro.param_hash


def test_backtest_result_repro_metadata_populated():
    register_strategy(StrategyMeta(name="bttest2", category="equity", lookback_days=5))(BuyTheDipStrategy)
    cfg = BacktestConfig(
        start=date(2024, 1, 1), end=date(2024, 1, 10),
        starting_cash=Decimal("100000"), seed=42,
    )
    result = BacktestRunner(
        BuyTheDipStrategy(), cfg, bar_provider=_make_bars(cfg.start, 10)
    ).run(SimpleParams())
    m = result.repro
    assert len(m.param_hash) == 16
    assert m.strategy_name == "bttest2"
    assert m.seed == 42
    assert m.runner_version == "1.0.0"
```

- [ ] **Step 2: Verify fails**

- [ ] **Step 3: Implement `backtest_runner.py`**

```python
# backend/strategies/_core/runners/backtest_runner.py
"""BacktestRunner — orchestrates bar-by-bar execution of a Strategy.

Owns: provider I/O, per-bar StrategyInput construction, seeded RNG
forking (for reproducibility), portfolio ledger, fill simulation,
result aggregation.

Does NOT: define alpha logic (that's in strategy.run()), perform any
live broker I/O (that's DailyPipelineRunner's job).
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

import numpy as np
import pandas as pd

from strategies._core import RUNNER_VERSION
from strategies._core.contracts import (
    BacktestConfig,
    BacktestResult,
    ReproMeta,
    StrategyInput,
    StrategyParams,
    StrategyResult,
    Trade,
)
from strategies._core.fills import FillSimulator, Portfolio
from strategies._core.protocol import Strategy
from strategies._core.providers import BarProvider, EarningsProvider, FundamentalsProvider
from strategies._core.reproducibility import get_git_sha
from strategies._core.snapshots import SnapshotWriter


class BacktestRunner:
    def __init__(
        self,
        strategy: Strategy,
        config: BacktestConfig,
        bar_provider: BarProvider,
        earnings_provider: EarningsProvider | None = None,
        fundamentals_provider: FundamentalsProvider | None = None,
    ):
        self._strategy = strategy
        self._config = config
        self._bars = bar_provider
        self._earnings = earnings_provider
        self._fundamentals = fundamentals_provider
        self._executor = FillSimulator(config)
        self._portfolio = Portfolio(config.starting_cash)
        self._snapshotter = SnapshotWriter(config.snapshot_dir) if config.snapshot_dir else None

    def run(self, params: StrategyParams) -> BacktestResult:
        """Execute the full backtest. Deterministic given (strategy code, params, config, data)."""
        seed_seq = np.random.SeedSequence(self._config.seed)
        state: dict[str, Any] = {}
        per_bar_results: list[tuple[date, StrategyResult]] = []
        snapshot_ids: list[str] = []
        equity_rows: list[dict] = []

        trading_days = self._trading_days(self._config.start, self._config.end)
        for i, asof in enumerate(trading_days):
            # 1. Strategy declares universe
            symbols = self._strategy.universe(asof, state)
            if not symbols:
                equity_rows.append({
                    "date": asof, "cash": self._portfolio.cash,
                    "positions_value": Decimal("0"), "equity": self._portfolio.cash,
                })
                continue

            # 2. Pre-fetch data for the declared universe
            bars_window = self._bars.fetch_window(
                symbols, asof, self._strategy.META.lookback_days
            )
            earnings_window = (
                self._earnings.fetch_window(symbols, asof, self._strategy.META.lookback_days)
                if self._earnings else None
            )
            fundamentals_snap = (
                self._fundamentals.snapshot(symbols, asof) if self._fundamentals else None
            )

            # 3. Build frozen input with a deterministically-forked RNG
            bar_seed_seq = seed_seq.spawn(1)[0]
            bar_input = StrategyInput(
                asof=asof, mode="backtest",
                bars=bars_window, earnings=earnings_window, fundamentals=fundamentals_snap,
                cash=self._portfolio.cash, equity=self._portfolio.equity,
                positions=self._portfolio.positions_snapshot(),
                state=dict(state),
                seed=int(bar_seed_seq.entropy),
                rng=np.random.default_rng(bar_seed_seq),
            )

            # 4. Optional snapshot
            if self._snapshotter:
                snapshot_ids.append(self._snapshotter.write(bar_input))

            # 5. Call the pure function
            result = self._strategy.run(bar_input, params)
            per_bar_results.append((asof, result))

            # 6. State merge (shallow)
            state = {**state, **result.state_update}

            # 7. Fill signals against next bar (if one exists)
            next_asof = trading_days[i + 1] if i + 1 < len(trading_days) else None
            if next_asof is not None and result.signals:
                next_bars = self._next_bars(symbols, next_asof)
                fills = self._executor.fill(result.signals, next_bars, next_asof)
                for fill in fills:
                    self._portfolio.apply_fill(fill)
                    state = {**state, **self._strategy.on_fill(fill, state)}

            # 8. Mark to market
            equity_rows.append(self._mark_to_market(asof, bars_window))

        # 9. Build result
        return self._build_result(
            per_bar_results=per_bar_results,
            equity_rows=equity_rows,
            snapshot_ids=snapshot_ids,
            params=params,
        )

    def _trading_days(self, start: date, end: date) -> list[date]:
        """Return list of trading days between start and end. Uses a simple
        Mon-Fri calendar for this reference implementation; real strategies
        will want a market calendar (pandas_market_calendars) — out of scope
        for Phase 1 (the old engine.py also used a naïve calendar)."""
        days = []
        d = start
        while d <= end:
            if d.weekday() < 5:  # Mon-Fri
                days.append(d)
            d += timedelta(days=1)
        return days

    def _next_bars(self, symbols: list[str], asof: date) -> dict[str, pd.Series]:
        bars = self._bars.fetch_window(symbols, asof, lookback_days=1)
        result: dict[str, pd.Series] = {}
        for sym in symbols:
            try:
                row = bars.xs((asof, sym))
                result[sym] = row
            except KeyError:
                continue
        return result

    def _mark_to_market(self, asof: date, bars_window: pd.DataFrame) -> dict:
        try:
            today = bars_window.xs(asof, level="date")
        except KeyError:
            today = pd.DataFrame()
        positions_value = Decimal("0")
        for p in self._portfolio.positions_snapshot():
            if p.symbol in today.index:
                positions_value += Decimal(str(today.loc[p.symbol, "close"])) * Decimal(p.quantity)
            else:
                positions_value += p.avg_entry_price * Decimal(p.quantity)
        return {
            "date": asof,
            "cash": self._portfolio.cash,
            "positions_value": positions_value,
            "equity": self._portfolio.cash + positions_value,
        }

    def _build_result(
        self,
        per_bar_results,
        equity_rows,
        snapshot_ids,
        params,
    ) -> BacktestResult:
        equity_df = pd.DataFrame(equity_rows).set_index("date")
        equity_df["drawdown"] = self._drawdown(equity_df["equity"])
        daily_returns = equity_df["equity"].pct_change().fillna(0)

        # Build reproducibility metadata
        import hashlib
        snapshot_root = (
            hashlib.sha256("".join(snapshot_ids).encode()).hexdigest()[:16]
            if snapshot_ids else ""
        )

        return BacktestResult(
            equity_curve=equity_df,
            daily_returns=daily_returns,
            trades=self._portfolio.closed_trades(),
            signals_emitted=[s for _, r in per_bar_results for s in r.signals],
            metrics=self._compute_metrics(equity_df, daily_returns),
            params=params.model_dump(mode="json"),
            start=self._config.start,
            end=self._config.end,
            repro=ReproMeta(
                git_sha=get_git_sha(),
                param_hash=type(params).param_hash(params),
                snapshot_root=snapshot_root,
                seed=self._config.seed,
                run_at=datetime.now(timezone.utc),
                strategy_name=self._strategy.META.name,
                runner_version=RUNNER_VERSION,
            ),
            warnings_by_asof={d: r.warnings for d, r in per_bar_results if r.warnings},
        )

    @staticmethod
    def _drawdown(equity: pd.Series) -> pd.Series:
        cummax = equity.cummax()
        return (equity - cummax) / cummax

    @staticmethod
    def _compute_metrics(equity_df: pd.DataFrame, daily_returns: pd.Series) -> dict[str, float]:
        mean, std = float(daily_returns.mean()), float(daily_returns.std())
        sharpe = (mean / std * (252 ** 0.5)) if std > 0 else 0.0
        total_ret = float(equity_df["equity"].iloc[-1] / equity_df["equity"].iloc[0] - 1) if len(equity_df) > 1 else 0.0
        days = max((equity_df.index[-1] - equity_df.index[0]).days, 1) if len(equity_df) > 1 else 1
        cagr = (1 + total_ret) ** (365 / days) - 1 if total_ret > -1 else -1.0
        max_dd = float(equity_df["drawdown"].min()) if "drawdown" in equity_df else 0.0
        calmar = cagr / abs(max_dd) if max_dd < 0 else 0.0
        return {
            "sharpe": sharpe, "cagr": cagr, "total_return": total_ret,
            "max_drawdown": max_dd, "calmar": calmar,
        }
```

- [ ] **Step 4: Run tests**

```bash
/Users/GK/Downloads/alphadesk/.venv/bin/python -m pytest tests/_core/test_backtest_runner.py -v
```
Expected: all 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/strategies/_core/runners/backtest_runner.py backend/tests/_core/test_backtest_runner.py
git commit -m "feat(_core): BacktestRunner with deterministic replay + repro metadata"
```

---

### Task 11: `SignalRunner` + `DailyPipelineRunner` stubs

**Files:**
- Create: `backend/strategies/_core/runners/signal_runner.py`
- Create: `backend/strategies/_core/runners/pipeline_runner.py`
- Create: `backend/tests/_core/test_signal_runner.py`

- [ ] **Step 1: Write failing test**

```python
# backend/tests/_core/test_signal_runner.py
"""SignalRunner — one-off invocation for CLI, supports --replay for deterministic replay."""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from pathlib import Path

import numpy as np
import pandas as pd
from pydantic import Field

from strategies._core.contracts import (
    OrderType,
    Signal,
    StrategyInput,
    StrategyParams,
    StrategyResult,
)
from strategies._core.protocol import Strategy, StrategyMeta, register_strategy
from strategies._core.runners.signal_runner import SignalRunner
from strategies._core.snapshots import SnapshotWriter


class SimpleParams(StrategyParams):
    pass


class EmptyStrategy(Strategy):
    PARAMS_MODEL = SimpleParams

    def universe(self, asof, state):
        return ["SPY"]

    def run(self, input, params):
        signals = [
            Signal(symbol="SPY", asof=input.asof,
                   order_type=OrderType.MKT, quantity=10)
        ]
        return StrategyResult(signals=signals)


def test_signal_runner_replay_produces_identical_result(tmp_path: Path):
    """Write a snapshot, then replay — must produce the same StrategyResult."""
    # Register strategy so META is attached
    register_strategy(StrategyMeta(name="replay_test"))(EmptyStrategy)

    bars = pd.DataFrame({
        "open": [100.0], "high": [101.0], "low": [99.0],
        "close": [100.5], "volume": [1_000_000],
    }, index=pd.MultiIndex.from_tuples(
        [(date(2024, 1, 1), "SPY")], names=["date", "symbol"],
    ))

    seed = 42
    original_input = StrategyInput(
        asof=date(2024, 1, 1), mode="backtest", bars=bars,
        cash=Decimal("100000"), equity=Decimal("100000"),
        positions=[], state={},
        seed=seed, rng=np.random.default_rng(seed),
    )
    writer = SnapshotWriter(tmp_path)
    writer.write(original_input)

    runner = SignalRunner()
    result = runner.run_once(
        EmptyStrategy(), SimpleParams(),
        asof=date(2024, 1, 1),
        replay_from=tmp_path,
    )

    assert len(result.signals) == 1
    assert result.signals[0].symbol == "SPY"
    assert result.signals[0].quantity == 10
```

- [ ] **Step 2: Verify fails**

- [ ] **Step 3: Implement `signal_runner.py`**

```python
# backend/strategies/_core/runners/signal_runner.py
"""SignalRunner — one-off strategy invocation for CLI.

Used by `python -m strategies.<name> signal` and `explain`. No portfolio,
no fill simulation, no state persistence — just builds a StrategyInput
(or loads one from snapshot for --replay) and calls strategy.run().
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from pathlib import Path

import numpy as np

from strategies._core.contracts import StrategyInput, StrategyParams, StrategyResult
from strategies._core.protocol import Strategy
from strategies._core.providers import ProviderBundle
from strategies._core.snapshots import SnapshotReader


class SignalRunner:
    def __init__(self, providers: ProviderBundle | None = None):
        self._providers = providers

    def run_once(
        self,
        strategy: Strategy,
        params: StrategyParams,
        asof: date,
        replay_from: Path | None = None,
    ) -> StrategyResult:
        """Run strategy on one bar; return raw result.

        If `replay_from` is set, load the StrategyInput from a snapshot
        directory (enables --replay). Otherwise, build input from the
        provider bundle (which must be set).
        """
        if replay_from is not None:
            input = SnapshotReader(replay_from).read(asof)
        else:
            if self._providers is None:
                raise ValueError(
                    "SignalRunner needs either replay_from or a ProviderBundle"
                )
            input = self._build_from_providers(strategy, asof)
        return strategy.run(input, params)

    def _build_from_providers(self, strategy: Strategy, asof: date) -> StrategyInput:
        symbols = strategy.universe(asof, state={})
        bars = self._providers.bars.fetch_window(
            symbols, asof, strategy.META.lookback_days
        )
        earnings = (
            self._providers.earnings.fetch_window(symbols, asof, strategy.META.lookback_days)
            if self._providers.earnings else None
        )
        return StrategyInput(
            asof=asof, mode="backtest", bars=bars, earnings=earnings,
            cash=Decimal("100000"), equity=Decimal("100000"),
            positions=[], state={},
            seed=0, rng=np.random.default_rng(0),
        )
```

```python
# backend/strategies/_core/runners/pipeline_runner.py
"""DailyPipelineRunner — single-day live invocation.

Replaces the legacy strategy_adapter.py. Called by the existing daily
pipeline scheduler (data.ingestion.pipeline_runner) once per trading day
per strategy; returns a StrategyResult that the MasterAgent processes.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any

import numpy as np

from strategies._core.contracts import StrategyInput, StrategyParams, StrategyResult
from strategies._core.protocol import Strategy
from strategies._core.providers import ProviderBundle


class StateStore:
    """Abstract state persistence — read/write a strategy's state dict.

    Phase 1: in-memory dict-of-dicts placeholder. Phase 2 wires to Redis
    using the existing cache layer (backend/core/cache.py).
    """

    def __init__(self):
        self._data: dict[str, dict[str, Any]] = {}

    async def load(self, strategy_name: str) -> dict[str, Any]:
        return self._data.get(strategy_name, {})

    async def save(self, strategy_name: str, state: dict[str, Any]) -> None:
        self._data[strategy_name] = dict(state)


class DailyPipelineRunner:
    def __init__(
        self,
        strategy: Strategy,
        providers: ProviderBundle,
        state_store: StateStore,
    ):
        self._strategy = strategy
        self._providers = providers
        self._state_store = state_store

    async def run_today(
        self,
        params: StrategyParams,
        asof: date | None = None,
    ) -> StrategyResult:
        if asof is None:
            # For production, use a market calendar. Phase 1 uses today.
            from datetime import date as _date
            asof = _date.today()

        state = await self._state_store.load(self._strategy.META.name)
        symbols = self._strategy.universe(asof, state)
        bars = self._providers.bars.fetch_window(
            symbols, asof, self._strategy.META.lookback_days
        )
        earnings = (
            self._providers.earnings.fetch_window(symbols, asof, self._strategy.META.lookback_days)
            if self._providers.earnings else None
        )

        # Live mode uses a deterministic seed derived from strategy name + date
        # so replay from state_store is stable across process restarts on the same day.
        import hashlib
        seed_bytes = hashlib.sha256(f"{self._strategy.META.name}:{asof.isoformat()}".encode()).digest()[:4]
        seed = int.from_bytes(seed_bytes, "big")

        input = StrategyInput(
            asof=asof, mode="live", bars=bars, earnings=earnings,
            cash=Decimal("0"),  # live-mode cash comes from broker; strategy shouldn't depend on it
            equity=Decimal("0"),
            positions=[],       # populated from broker in a future task
            state=state,
            seed=seed,
            rng=np.random.default_rng(seed),
        )
        result = self._strategy.run(input, params)

        # Persist state update for the next day's run
        await self._state_store.save(
            self._strategy.META.name,
            {**state, **result.state_update},
        )
        return result
```

- [ ] **Step 4: Run tests**

```bash
/Users/GK/Downloads/alphadesk/.venv/bin/python -m pytest tests/_core/test_signal_runner.py -v
```
Expected: 1 test PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/strategies/_core/runners/signal_runner.py \
        backend/strategies/_core/runners/pipeline_runner.py \
        backend/tests/_core/test_signal_runner.py
git commit -m "feat(_core): SignalRunner (replay support) + DailyPipelineRunner scaffold"
```

---

### Task 12: CLI scaffold (`run_cli` + all 7 subcommands)

**Files:**
- Create: `backend/strategies/_core/cli.py`
- Create: `backend/tests/_core/test_cli.py`

- [ ] **Step 1: Write failing test**

```python
# backend/tests/_core/test_cli.py
"""CLI scaffolding tests — schema, validate-params, signal, backtest commands."""
from __future__ import annotations

import io
import json
from contextlib import redirect_stdout
from datetime import date
from pathlib import Path

from pydantic import Field

from strategies._core.cli import run_cli
from strategies._core.contracts import (
    OrderType,
    Signal,
    StrategyInput,
    StrategyParams,
    StrategyResult,
)
from strategies._core.protocol import Strategy, StrategyMeta, register_strategy


class CLIParams(StrategyParams):
    threshold: float = Field(
        default=1.5, ge=0, le=5,
        json_schema_extra={"tune": {"low": 0.5, "high": 3.0, "type": "float"}},
    )


class CLITestStrategy(Strategy):
    PARAMS_MODEL = CLIParams
    def universe(self, asof, state): return ["SPY"]
    def run(self, input, params): return StrategyResult()


register_strategy(StrategyMeta(name="cli_test"))(CLITestStrategy)


def test_cli_schema_dumps_params_json_schema(monkeypatch, capsys):
    monkeypatch.setattr("sys.argv", ["x", "schema", "params", "--pretty"])
    exit_code = run_cli(CLITestStrategy)
    assert exit_code == 0
    captured = capsys.readouterr()
    schema = json.loads(captured.out)
    assert "threshold" in schema["properties"]
    assert schema["properties"]["threshold"]["default"] == 1.5


def test_cli_validate_params_ok(tmp_path, monkeypatch, capsys):
    params_file = tmp_path / "p.json"
    params_file.write_text(json.dumps({"threshold": 2.0}))
    monkeypatch.setattr("sys.argv", ["x", "validate-params", str(params_file)])
    exit_code = run_cli(CLITestStrategy)
    assert exit_code == 0


def test_cli_validate_params_bad(tmp_path, monkeypatch, capsys):
    params_file = tmp_path / "p.json"
    params_file.write_text(json.dumps({"threshold": -1}))  # ge=0 violation
    monkeypatch.setattr("sys.argv", ["x", "validate-params", str(params_file)])
    exit_code = run_cli(CLITestStrategy)
    assert exit_code == 2


def test_cli_validate_params_rejects_unknown_field(tmp_path, monkeypatch):
    params_file = tmp_path / "p.json"
    params_file.write_text(json.dumps({"unknown": 99}))
    monkeypatch.setattr("sys.argv", ["x", "validate-params", str(params_file)])
    exit_code = run_cli(CLITestStrategy)
    assert exit_code == 2  # extra="forbid" → ValidationError
```

- [ ] **Step 2: Verify fails**

- [ ] **Step 3: Implement `cli.py`**

```python
# backend/strategies/_core/cli.py
"""Shared CLI scaffolding for per-strategy `__main__.py` dispatchers.

Every strategy's __main__.py is a ~5-line shim:
    from strategies._core.cli import run_cli
    from strategies.<name>.strategy import <Name>Strategy
    if __name__ == "__main__":
        raise SystemExit(run_cli(<Name>Strategy))

This module implements the 7 subcommands (backtest, signal, tune,
analyze-day, schema, validate-params, explain) against any Strategy class.
Subcommand argparse bindings auto-generate from the strategy's Params
model + StrategyMeta.

Exit codes (stable contract):
    0  success
    2  params validation failed
    3  data unavailable
    4  strategy raised during run()
    5  snapshot mismatch during --replay (data drift)
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from decimal import Decimal
from pathlib import Path

from pydantic import ValidationError

from strategies._core.contracts import (
    BacktestConfig,
    Signal,
    StrategyInput,
    StrategyParams,
    StrategyResult,
)
from strategies._core.protocol import Strategy


def run_cli(strategy_cls: type[Strategy]) -> int:
    parser = _build_parser(strategy_cls)
    args = parser.parse_args()
    try:
        return args.handler(strategy_cls, args)
    except ValidationError as e:
        print(e.json(indent=2), file=sys.stderr)
        return 2


def _build_parser(strategy_cls: type[Strategy]) -> argparse.ArgumentParser:
    meta = strategy_cls.META
    parser = argparse.ArgumentParser(
        prog=f"python -m strategies.{meta.name}",
        description=f"{meta.name} — {meta.description}",
    )
    sub = parser.add_subparsers(required=True, dest="cmd")

    _add_backtest(sub)
    _add_signal(sub)
    _add_tune(sub)
    _add_analyze_day(sub)
    _add_schema(sub)
    _add_validate(sub)
    _add_explain(sub)
    return parser


def _add_backtest(sub):
    p = sub.add_parser("backtest", help="Run full backtest over a date range")
    p.add_argument("--from", dest="start", type=date.fromisoformat, required=True)
    p.add_argument("--to", dest="end", type=date.fromisoformat, required=True)
    p.add_argument("--params", type=Path)
    p.add_argument("--starting-cash", type=Decimal, default=Decimal("100000"))
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--snapshot-dir", type=Path, default=None)
    p.add_argument("--out", type=Path, default=None)
    p.set_defaults(handler=_handle_backtest)


def _add_signal(sub):
    p = sub.add_parser("signal", help="Run one bar; print signals")
    p.add_argument("--asof", type=date.fromisoformat, required=True)
    p.add_argument("--params", type=Path)
    p.add_argument("--replay", type=Path, default=None)
    p.set_defaults(handler=_handle_signal)


def _add_tune(sub):
    p = sub.add_parser("tune", help="Optuna parameter search")
    p.add_argument("--trials", type=int, default=100)
    p.add_argument("--from", dest="start", type=date.fromisoformat, required=True)
    p.add_argument("--to", dest="end", type=date.fromisoformat, required=True)
    p.add_argument("--study-name", default=None)
    p.add_argument("--walk-forward", action="store_true")
    p.set_defaults(handler=_handle_tune)


def _add_analyze_day(sub):
    p = sub.add_parser("analyze-day", help="One live-pipeline run")
    p.add_argument("--asof", type=date.fromisoformat, default=None)
    p.add_argument("--params", type=Path)
    p.add_argument("--dry-run", action="store_true")
    p.set_defaults(handler=_handle_analyze_day)


def _add_schema(sub):
    p = sub.add_parser("schema", help="Dump Pydantic JSON Schema")
    p.add_argument("target", choices=["params", "input", "result", "signal", "all"], default="params")
    p.add_argument("--pretty", action="store_true")
    p.set_defaults(handler=_handle_schema)


def _add_validate(sub):
    p = sub.add_parser("validate-params", help="Validate a params JSON file")
    p.add_argument("file", type=Path)
    p.set_defaults(handler=_handle_validate)


def _add_explain(sub):
    p = sub.add_parser("explain", help="Verbose signal run with diagnostics")
    p.add_argument("--asof", type=date.fromisoformat, required=True)
    p.add_argument("--params", type=Path)
    p.add_argument("--replay", type=Path, default=None)
    p.add_argument("--format", choices=["text", "json"], default="text")
    p.set_defaults(handler=_handle_explain)


def _load_params(strategy_cls: type[Strategy], path: Path | None) -> StrategyParams:
    if path is None:
        return strategy_cls.PARAMS_MODEL()
    return strategy_cls.PARAMS_MODEL.model_validate_json(path.read_text())


# ─── Handlers ────────────────────────────────────────────────

def _handle_backtest(strategy_cls, args) -> int:
    from strategies._core.providers import default_provider_bundle
    from strategies._core.runners.backtest_runner import BacktestRunner

    params = _load_params(strategy_cls, args.params)
    providers = default_provider_bundle()
    runner = BacktestRunner(
        strategy=strategy_cls(),
        config=BacktestConfig(
            start=args.start, end=args.end,
            starting_cash=args.starting_cash,
            seed=args.seed, snapshot_dir=args.snapshot_dir,
        ),
        bar_provider=providers.bars,
        earnings_provider=providers.earnings,
        fundamentals_provider=providers.fundamentals,
    )
    result = runner.run(params)
    if args.out:
        _write_result(result, args.out)
    else:
        # Write summary to stdout (metrics + trade count); full result → --out
        summary = {
            "strategy": result.repro.strategy_name,
            "start": result.start.isoformat(),
            "end": result.end.isoformat(),
            "metrics": result.metrics,
            "trade_count": len(result.trades),
            "repro": result.repro.model_dump(mode="json"),
        }
        json.dump(summary, sys.stdout, indent=2, default=str)
    return 0


def _handle_signal(strategy_cls, args) -> int:
    from strategies._core.providers import default_provider_bundle
    from strategies._core.runners.signal_runner import SignalRunner

    params = _load_params(strategy_cls, args.params)
    runner = SignalRunner(providers=default_provider_bundle() if not args.replay else None)
    result = runner.run_once(strategy_cls(), params, args.asof, replay_from=args.replay)
    json.dump(result.model_dump(mode="json"), sys.stdout, indent=2, default=str)
    return 0


def _handle_tune(strategy_cls, args) -> int:
    from tuner.runner import run as tuner_run
    tuner_run(
        strategy_name=strategy_cls.META.name,
        params_model=strategy_cls.PARAMS_MODEL,
        trials=args.trials, start=args.start, end=args.end,
        study_name=args.study_name or f"{strategy_cls.META.name}_cli",
        walk_forward=args.walk_forward,
    )
    return 0


def _handle_analyze_day(strategy_cls, args) -> int:
    import asyncio
    from strategies._core.providers import default_provider_bundle
    from strategies._core.runners.pipeline_runner import DailyPipelineRunner, StateStore

    params = _load_params(strategy_cls, args.params)
    runner = DailyPipelineRunner(
        strategy=strategy_cls(),
        providers=default_provider_bundle(),
        state_store=StateStore(),
    )
    result = asyncio.run(runner.run_today(params, asof=args.asof))
    json.dump(result.model_dump(mode="json"), sys.stdout, indent=2, default=str)
    return 0


def _handle_schema(strategy_cls, args) -> int:
    mapping = {
        "params": strategy_cls.PARAMS_MODEL,
        "input":  StrategyInput,
        "result": StrategyResult,
        "signal": Signal,
    }
    if args.target == "all":
        out = {k: v.model_json_schema() for k, v in mapping.items()}
    else:
        out = mapping[args.target].model_json_schema()
    json.dump(out, sys.stdout, indent=2 if args.pretty else None)
    return 0


def _handle_validate(strategy_cls, args) -> int:
    try:
        params = strategy_cls.PARAMS_MODEL.model_validate_json(args.file.read_text())
    except ValidationError as e:
        print(e.json(indent=2), file=sys.stderr)
        return 2
    print(f"OK — {args.file} validates as {strategy_cls.PARAMS_MODEL.__name__}", file=sys.stderr)
    json.dump(params.model_dump(mode="json"), sys.stdout, indent=2)
    return 0


def _handle_explain(strategy_cls, args) -> int:
    """Same as signal, but prints diagnostics + universe + filter decisions."""
    from strategies._core.providers import default_provider_bundle
    from strategies._core.runners.signal_runner import SignalRunner

    params = _load_params(strategy_cls, args.params)
    runner = SignalRunner(providers=default_provider_bundle() if not args.replay else None)
    result = runner.run_once(strategy_cls(), params, args.asof, replay_from=args.replay)

    if args.format == "json":
        json.dump(result.model_dump(mode="json"), sys.stdout, indent=2, default=str)
    else:
        print(f"=== {strategy_cls.META.name} @ {args.asof} ===")
        print(f"\nSignals emitted: {len(result.signals)}")
        for s in result.signals:
            print(f"  • {s.symbol} {s.order_type.value} qty={s.quantity} tag={s.tag!r}")
        print(f"\nDiagnostics:")
        for k, v in result.diagnostics.items():
            print(f"  {k}: {v}")
        if result.warnings:
            print(f"\nWarnings:")
            for w in result.warnings:
                print(f"  ⚠ {w}")
    return 0


def _write_result(result, path: Path) -> None:
    if path.suffix == ".json":
        path.write_text(json.dumps(result.model_dump(mode="json"), indent=2, default=str))
    elif path.suffix == ".parquet":
        # Write the equity_curve as parquet; metadata in a companion JSON
        result.equity_curve.to_parquet(path)
        meta_path = path.with_suffix(".meta.json")
        meta = {
            "trades": [t.model_dump(mode="json") for t in result.trades],
            "metrics": result.metrics,
            "params": result.params,
            "repro": result.repro.model_dump(mode="json"),
        }
        meta_path.write_text(json.dumps(meta, indent=2, default=str))
    else:
        raise ValueError(f"Unsupported output extension: {path.suffix}")
```

- [ ] **Step 4: Run tests**

```bash
/Users/GK/Downloads/alphadesk/.venv/bin/python -m pytest tests/_core/test_cli.py -v
```
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/strategies/_core/cli.py backend/tests/_core/test_cli.py
git commit -m "feat(_core): CLI scaffolding with 7 subcommands (schema/backtest/signal/tune/...)"
```

---

## Phase 2 — pead migration + legacy deletion (Tasks 13-19)

Phase 2 migrates `pead` to the new shell as the reference, then deletes the legacy engine/adapter/types and rewires the daily pipeline + tuner. After Phase 2, only pead works; the other 12 strategies are BROKEN until Phase 3 sweeps them. This is the big-bang window — production is paper-mode only during this time.

### Task 13: Migrate `strategies/pead/config.py` to `PEADParams(StrategyParams)`

**Files:**
- Modify: `backend/strategies/pead/config.py`
- Modify: `backend/strategies/pead/tests/test_strategy.py` (update imports)

- [ ] **Step 1: Inspect current config.py**

Read `/Users/GK/Downloads/alphadesk/backend/strategies/pead/config.py`. Identify:
- The `DEFAULTS` dict keys + types
- Any `load_universe()` helper
- The `search_space()` function's Optuna distribution shape
- Any helpers imported from `.helpers`

- [ ] **Step 2: Write failing test**

Append to `backend/strategies/pead/tests/test_strategy.py` (or create if missing):

```python
import pytest
from pydantic import ValidationError

from strategies.pead.config import PEADParams


def test_pead_params_defaults_match_old_DEFAULTS():
    """The migration preserves default values byte-for-byte so backtests
    produce identical results pre/post-migration."""
    p = PEADParams()
    # Each of these assertions must match the pre-migration DEFAULTS dict.
    # Read the old config.py to fill in the exact defaults; these are placeholders:
    assert p.sue_threshold == 1.5
    assert p.holding_days == 40
    assert p.lookback_days >= 60


def test_pead_params_tune_space_populated():
    """tune_space() picks up tunable fields via Field(json_schema_extra)."""
    space = PEADParams.tune_space()
    assert "sue_threshold" in space
    assert "holding_days" in space
    assert space["sue_threshold"]["type"] == "float"


def test_pead_params_rejects_invalid_values():
    with pytest.raises(ValidationError):
        PEADParams(sue_threshold=-1)  # should have ge=0
    with pytest.raises(ValidationError):
        PEADParams(holding_days=0)    # should have ge=1
```

- [ ] **Step 3: Verify fails**

```bash
cd /Users/GK/Downloads/alphadesk/backend && /Users/GK/Downloads/alphadesk/.venv/bin/python -m pytest strategies/pead/tests/test_strategy.py::test_pead_params_defaults_match_old_DEFAULTS -v
```
Expected: ImportError or AttributeError.

- [ ] **Step 4: Rewrite `config.py`**

Rewrite `backend/strategies/pead/config.py` replacing `DEFAULTS` + `search_space()` with a single Pydantic model. **Read the current `config.py` carefully** — every field in the old `DEFAULTS` dict must appear in `PEADParams` with the same default value; every tuning distribution in the old `search_space()` must appear as `json_schema_extra={"tune": ...}` on the corresponding field. Preserve `load_universe()` as-is (it's still called from `universe()`).

Shape template (adapt to the actual fields the old config.py declares):

```python
"""PEAD (Post-Earnings Announcement Drift) — strategy params.

Replaces the legacy DEFAULTS dict + search_space() function. Single
Pydantic model is the source of truth for defaults, validation, tuning
space, and JSON Schema export.
"""
from __future__ import annotations

from pydantic import Field

from strategies._core.contracts import StrategyParams


class PEADParams(StrategyParams):
    sue_threshold: float = Field(
        default=1.5, ge=0, le=5,
        description="Standardized Unexpected Earnings threshold — SUE above this triggers entry.",
        json_schema_extra={"tune": {"low": 0.5, "high": 3.0, "type": "float"}},
    )
    holding_days: int = Field(
        default=40, ge=1, le=252,
        description="Calendar days to hold each position after entry.",
        json_schema_extra={"tune": {"low": 10, "high": 90, "type": "int"}},
    )
    lookback_days: int = Field(
        default=250, ge=60, le=750,
        description="Bar history needed per universe symbol.",
    )
    min_adv: float = Field(
        default=1_000_000.0, ge=0,
        description="Min 20-day avg dollar volume for inclusion (liquidity filter).",
    )
    min_price: float = Field(
        default=10.0, ge=0,
        description="Min share price to filter penny stocks.",
    )
    # ... mirror remaining DEFAULTS fields with appropriate validators.


# Keep load_universe helper in this file unchanged (it's called from strategy.py).
def load_universe() -> list[str]:
    # ... existing implementation unchanged
    ...
```

**If the old config.py has fields not covered above, ADD THEM to `PEADParams`.** No fields may be dropped — that would be a silent behavior change.

- [ ] **Step 5: Verify test passes**

```bash
/Users/GK/Downloads/alphadesk/.venv/bin/python -m pytest strategies/pead/tests/test_strategy.py -v -k "pead_params"
```
Expected: 3 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/strategies/pead/config.py backend/strategies/pead/tests/
git commit -m "feat(pead): migrate DEFAULTS + search_space() to PEADParams(StrategyParams)"
```

---

### Task 14: Rewrite `strategies/pead/strategy.py` to implement new `Strategy` ABC

**Files:**
- Modify: `backend/strategies/pead/strategy.py`
- Modify: `backend/strategies/pead/tests/test_strategy.py`

- [ ] **Step 1: Inspect current strategy.py**

Read `/Users/GK/Downloads/alphadesk/backend/strategies/pead/strategy.py`. Map each old method to its new home:
- `configure(params: dict)` → DELETED (params now typed, passed into run())
- `universe(asof, ctx)` → `universe(asof, state)` — replace `ctx.fundamentals_provider` access with `state` lookup; universe selection shouldn't need fundamentals anymore (move any fundamentals-based filter into `run()` where fundamentals is available via `input.fundamentals`)
- `generate_signals(asof, ctx)` → BODY goes into `run(input, params)`; replace `ctx.bar_provider.fetch_bars(...)` with `input.bars.xs(...)`, etc.
- `manage(asof, ctx)` → BODY also goes into `run(input, params)` and returns exit signals in `StrategyResult.signals` alongside entry signals
- `on_fill(fill, ctx)` → `on_fill(fill, state)` — replace `ctx.state` reads with `state` directly

- [ ] **Step 2: Write failing test (end-to-end)**

Append to `backend/strategies/pead/tests/test_strategy.py`:

```python
from datetime import date
from decimal import Decimal

import numpy as np
import pandas as pd

from strategies._core.contracts import StrategyInput
from strategies.pead.config import PEADParams
from strategies.pead.strategy import PEADStrategy


def test_pead_run_emits_signals_on_positive_surprise():
    """With a synthetic post-earnings-surprise fixture, PEAD must emit a buy signal."""
    # Build a minimal StrategyInput fixture — NVDA reported +10% earnings surprise yesterday,
    # price action is as expected.
    asof = date(2024, 1, 15)
    bars = pd.DataFrame([
        {"date": date(2024, 1, 10 + i), "symbol": "NVDA", "open": 200 + i, "high": 202 + i,
         "low": 199 + i, "close": 201 + i, "volume": 10_000_000}
        for i in range(6)
    ]).set_index(["date", "symbol"])
    earnings = pd.DataFrame([{
        "symbol": "NVDA", "report_date": date(2024, 1, 14),
        "report_time": "AMC", "eps_actual": 1.10, "eps_est": 1.00, "surprise": 0.10,
    }])
    inp = StrategyInput(
        asof=asof, mode="backtest", bars=bars, earnings=earnings,
        cash=Decimal("100000"), equity=Decimal("100000"),
        positions=[], state={},
        seed=42, rng=np.random.default_rng(42),
    )
    result = PEADStrategy().run(inp, PEADParams())
    # Expectation: at least one buy signal for NVDA (surprise > default sue_threshold)
    assert any(s.symbol == "NVDA" and (s.quantity or 0) > 0 or (s.target_weight or 0) > 0
               for s in result.signals)


def test_pead_run_deterministic_on_identical_input():
    """Same input + same params → bitwise-identical result."""
    # ... (reuse the fixture from above)
    # Assert result1.signals == result2.signals, result1.state_update == result2.state_update
```

- [ ] **Step 3: Verify fails**

```bash
/Users/GK/Downloads/alphadesk/.venv/bin/python -m pytest strategies/pead/tests/test_strategy.py -v -k "pead_run"
```
Expected: ImportError / AttributeError.

- [ ] **Step 4: Rewrite `strategy.py`**

```python
# backend/strategies/pead/strategy.py
"""Post-Earnings Announcement Drift strategy — new shell implementation.

The academic basis (SUE-driven positive-surprise drift) is unchanged from
the legacy implementation. Only the SHELL is migrated: the old
(configure, universe(ctx), generate_signals(ctx), manage(ctx), on_fill(ctx))
methods become (PARAMS_MODEL, universe(state), run(input, params),
on_fill(state)).

See spec.md in this package for the strategy's academic rationale.
"""
from __future__ import annotations

from datetime import date
from typing import Any

import pandas as pd

from strategies._core.contracts import (
    Fill,
    OrderType,
    Signal,
    StrategyInput,
    StrategyResult,
    TimeInForce,
)
from strategies._core.protocol import Strategy, StrategyMeta, register_strategy

from strategies.pead.config import PEADParams, load_universe
from strategies.pead.helpers import (
    compute_sue,
    passes_liquidity,
    # ... import whatever helpers.py exposes
)


@register_strategy(StrategyMeta(
    name="pead",
    category="options",       # ← KEEP current classification; if different, don't change unless spec says so
    description="Post-Earnings Announcement Drift — enter long on high-SUE beats, hold N days.",
    lookback_days=250,
))
class PEADStrategy(Strategy):
    PARAMS_MODEL = PEADParams

    def universe(self, asof: date, state: dict[str, Any]) -> list[str]:
        """Static universe loaded at strategy-init time (S&P 500 + earnings-universe).
        State is currently unused; accepted for future dynamic-universe support."""
        return load_universe()

    def run(
        self,
        input: StrategyInput,
        params: PEADParams,
    ) -> StrategyResult:
        """Emit PEAD signals for today.

        Entry logic (moved from old generate_signals):
          1. Find symbols reporting on input.asof - 1 (yesterday)
          2. Compute SUE from earnings history (input.earnings)
          3. If SUE > params.sue_threshold and liquidity filter passes → buy signal
          4. Tag signal with entry date + SUE for audit

        Exit logic (moved from old manage):
          5. For each open position, if held > params.holding_days → sell signal

        Port the existing logic from the old strategy.py as-is; the only
        change is data access (input.bars / input.earnings instead of
        ctx.bar_provider / ctx.earnings_provider).
        """
        signals: list[Signal] = []
        diagnostics: dict[str, Any] = {}
        warnings: list[str] = []
        state_update: dict[str, Any] = {}

        # ─── Entry signals ──────────────────────────────────
        if input.earnings is not None and not input.earnings.empty:
            # Yesterday's earnings announcements (PEAD enters T+1)
            yesterday = input.asof - pd.Timedelta(days=1)
            yesterday_earnings = input.earnings[
                input.earnings["report_date"] == yesterday
            ]
            diagnostics["earnings_announced_yesterday"] = len(yesterday_earnings)

            for _, er in yesterday_earnings.iterrows():
                sym = er["symbol"]
                # SUE computation: needs 4-12 quarters of history
                sue = compute_sue(
                    eps_actual=er.get("eps_actual"),
                    eps_est=er.get("eps_est"),
                    # ... rest of signature per the old strategy
                )
                if sue is None or sue < params.sue_threshold:
                    continue

                # Liquidity filter — get this symbol's bars window
                try:
                    sym_bars = input.bars.xs(sym, level="symbol")
                except KeyError:
                    warnings.append(f"no bars for {sym}")
                    continue

                if not passes_liquidity(sym_bars, min_adv=params.min_adv, min_price=params.min_price):
                    continue

                signals.append(Signal(
                    symbol=sym,
                    asof=input.asof,
                    order_type=OrderType.MOO,
                    time_in_force=TimeInForce.DAY,
                    target_weight=1.0 / 20,     # equal-weight with 20 concurrent positions target
                    tag=f"pead-entry-long-sue{sue:+.2f}",
                ))

                # Remember entry for exit logic (port from old on_fill)
                state_update.setdefault("entries", {})[sym] = input.asof.isoformat()

        # ─── Exit signals ──────────────────────────────────
        for pos in input.positions:
            entry_iso = input.state.get("entries", {}).get(pos.symbol)
            if entry_iso is None:
                continue
            held = (input.asof - date.fromisoformat(entry_iso)).days
            if held >= params.holding_days:
                signals.append(Signal(
                    symbol=pos.symbol,
                    asof=input.asof,
                    order_type=OrderType.MOC,
                    quantity=-pos.quantity,
                    tag=f"pead-exit-{held}d",
                ))

        diagnostics["entry_signals"] = sum(1 for s in signals if "entry" in s.tag)
        diagnostics["exit_signals"] = sum(1 for s in signals if "exit" in s.tag)

        return StrategyResult(
            signals=signals,
            state_update=state_update,
            diagnostics=diagnostics,
            warnings=warnings,
        )

    def on_fill(self, fill: Fill, state: dict[str, Any]) -> dict[str, Any]:
        """When an entry fills, record the entry price for stop-loss logic later.
        When an exit fills, clear the entry record."""
        entries = dict(state.get("entries", {}))
        if fill.quantity > 0 and "entry" in fill.signal_tag:
            # Opening position — already recorded in run(), don't overwrite
            pass
        elif fill.quantity < 0 and "exit" in fill.signal_tag:
            entries.pop(fill.symbol, None)
        return {"entries": entries}
```

**Note**: the code above is a template. The actual implementation must mirror the legacy strategy.py's exact logic. Any deviation produces parity-test failures in Task 16.

- [ ] **Step 5: Verify tests pass**

```bash
/Users/GK/Downloads/alphadesk/.venv/bin/python -m pytest strategies/pead/tests/test_strategy.py -v
```
Expected: all existing pead tests (the ones that were using the old API) are updated to use the new StrategyInput fixtures — this may require also editing the conftest.py to build StrategyInput instead of a fake Context. If the old tests relied on `ctx.bar_provider.fetch_bars`, rewrite to pass bars directly into StrategyInput.

- [ ] **Step 6: Commit**

```bash
git add backend/strategies/pead/strategy.py backend/strategies/pead/tests/
git commit -m "feat(pead): migrate strategy.py to Strategy.run(input, params) pure-function API"
```

---

### Task 15: Add `strategies/pead/__main__.py`

**Files:**
- Create: `backend/strategies/pead/__main__.py`

- [ ] **Step 1: Create file**

```python
# backend/strategies/pead/__main__.py
"""Entry point for `python -m strategies.pead <subcommand>`.

All subcommand logic lives in strategies._core.cli — this module is a
pure dispatch shim that wires the PEADStrategy class into the shared
CLI scaffolding.
"""
from strategies._core.cli import run_cli
from strategies.pead.strategy import PEADStrategy


if __name__ == "__main__":
    raise SystemExit(run_cli(PEADStrategy))
```

- [ ] **Step 2: Verify CLI works**

```bash
cd /Users/GK/Downloads/alphadesk/backend && /Users/GK/Downloads/alphadesk/.venv/bin/python -m strategies.pead schema params --pretty
```
Expected: prints pead params JSON Schema to stdout.

```bash
/Users/GK/Downloads/alphadesk/.venv/bin/python -m strategies.pead --help
```
Expected: shows usage with all 7 subcommands.

- [ ] **Step 3: Commit**

```bash
git add backend/strategies/pead/__main__.py
git commit -m "feat(pead): __main__.py wires PEADStrategy into shared CLI"
```

---

### Task 16: Parity test — legacy engine vs new BacktestRunner on pead

**Files:**
- Rename: `backend/backtest/engine.py` → `backend/backtest/engine_legacy.py` (preserve through Phase 2)
- Create: `backend/tests/test_pead_parity.py`

- [ ] **Step 1: Preserve the old engine temporarily**

```bash
git mv backend/backtest/engine.py backend/backtest/engine_legacy.py
```

Update any import statements inside `engine_legacy.py` that may break due to the file rename (e.g. self-references). Update `backend/backtest/cli.py` to import from `engine_legacy` for the legacy path.

- [ ] **Step 2: Write parity test**

```python
# backend/tests/test_pead_parity.py
"""Parity test: legacy engine vs new BacktestRunner producing the same trades.

Acceptance (from spec): zero trade-count difference, total P&L within 0.5%.
Any larger drift is a real bug that must be resolved before deleting
engine_legacy.py and moving on."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pandas as pd
import pytest

# The legacy engine and the new runner need different setup. Skip if
# the legacy providers can't be constructed (test env without data).

legacy_available = True
try:
    from backtest.engine_legacy import BacktestEngine, EngineConfig
except ImportError:
    legacy_available = False


@pytest.mark.skipif(not legacy_available, reason="legacy engine not available")
def test_pead_backtest_parity_2023_fixture():
    """Run pead over a 2023 fixture through both engines, assert bitwise-identical trades."""
    from strategies.pead.config import PEADParams
    from strategies.pead.strategy import PEADStrategy
    from strategies._core.contracts import BacktestConfig
    from strategies._core.runners.backtest_runner import BacktestRunner
    from strategies._core.providers import default_provider_bundle

    # --- Legacy run ---
    legacy_engine = BacktestEngine(
        strategy=PEADStrategy(),
        config=EngineConfig(
            start=date(2023, 1, 1), end=date(2023, 12, 31),
            starting_cash=Decimal("100000"),
        ),
        # ... fill in other constructor args the legacy API requires
    )
    legacy_result = legacy_engine.run()

    # --- New run ---
    providers = default_provider_bundle()
    new_runner = BacktestRunner(
        strategy=PEADStrategy(),
        config=BacktestConfig(
            start=date(2023, 1, 1), end=date(2023, 12, 31),
            starting_cash=Decimal("100000"),
            seed=0,
        ),
        bar_provider=providers.bars,
        earnings_provider=providers.earnings,
    )
    new_result = new_runner.run(PEADParams())

    # Acceptance criteria per spec
    assert len(legacy_result.trades) == len(new_result.trades), \
        f"trade count mismatch: legacy={len(legacy_result.trades)} new={len(new_result.trades)}"

    legacy_pnl = sum(t.pnl or Decimal("0") for t in legacy_result.trades)
    new_pnl = sum(t.pnl or Decimal("0") for t in new_result.trades)
    drift = abs(legacy_pnl - new_pnl) / abs(legacy_pnl) if legacy_pnl else Decimal("0")
    assert drift <= Decimal("0.005"), \
        f"P&L drift {drift:.2%} exceeds 0.5% threshold"
```

- [ ] **Step 3: Run parity test**

```bash
cd /Users/GK/Downloads/alphadesk/backend && /Users/GK/Downloads/alphadesk/.venv/bin/python -m pytest tests/test_pead_parity.py -v
```

If it passes: both engines agree; safe to proceed. If it fails with small drift: document in `docs/superpowers/specs/2026-04-22-strategy-sota-foundation-migration-notes.md` (create the file). If it fails with large drift: STOP, investigate — the migration has a real bug.

- [ ] **Step 4: Commit**

```bash
git add backend/backtest/engine_legacy.py backend/backtest/cli.py backend/tests/test_pead_parity.py
git commit -m "test(parity): pead legacy vs new BacktestRunner comparison fixture"
```

---

### Task 17: Delete `strategy_adapter.py` + rewire `daily_pipeline.py`

**Files:**
- Delete: `backend/data/ingestion/strategy_adapter.py`
- Modify: `backend/data/ingestion/daily_pipeline.py`

- [ ] **Step 1: Inspect current daily_pipeline.py**

Read `/Users/GK/Downloads/alphadesk/backend/data/ingestion/daily_pipeline.py`. Identify:
- Where it instantiates strategy adapters (`from strategy_adapter import ...`)
- Where it calls `adapter.screen()`, `adapter.analyze()`, `adapter.generate_trades()`
- How it feeds results to the MasterAgent

- [ ] **Step 2: Rewrite to use DailyPipelineRunner**

Replace adapter calls with `DailyPipelineRunner` calls:

```python
# Replace old pattern:
#   adapter = StrategyAdapter(strategy)
#   signals = adapter.generate_trades(...)

# With new pattern:
from strategies._core.runners.pipeline_runner import DailyPipelineRunner, StateStore
from strategies._core.providers import default_provider_bundle
from strategies._core.protocol import get_strategy, list_strategies

state_store = StateStore()
providers = default_provider_bundle()

for meta in list_strategies():
    if meta.kind != "autonomous":
        continue
    strategy_cls = get_strategy(meta.name)
    strategy_instance = strategy_cls()
    params = meta.params_model()  # use defaults; or load from param file if configured
    runner = DailyPipelineRunner(strategy_instance, providers, state_store)
    result = await runner.run_today(params)
    # Feed result.signals into MasterAgent as before
    master_agent.ingest_signals(meta.name, result.signals)
```

Delete `backend/data/ingestion/strategy_adapter.py` entirely. Any remaining callers become import-errors that must be fixed.

- [ ] **Step 3: Run full test suite**

```bash
cd /Users/GK/Downloads/alphadesk/backend && /Users/GK/Downloads/alphadesk/.venv/bin/python -m pytest -x
```

Expected failures: anything that imported `strategy_adapter`. Fix those imports OR skip those tests with a clear marker pending Phase 3 cleanup of the other 12 strategies.

- [ ] **Step 4: Commit**

```bash
git rm backend/data/ingestion/strategy_adapter.py
git add backend/data/ingestion/daily_pipeline.py
git commit -m "feat(pipeline): replace strategy_adapter.py with DailyPipelineRunner"
```

---

### Task 18: Rewire `tuner/runner.py` + `tuner/objective.py` to new Params + Runner

**Files:**
- Modify: `backend/tuner/runner.py`
- Modify: `backend/tuner/objective.py`

- [ ] **Step 1: Inspect current tuner**

Read both files. Identify:
- Where it calls `cfg.search_space()` (strategy-module-level function)
- Where it calls the legacy engine
- How it composes trial parameters into an engine invocation

- [ ] **Step 2: Rewire**

Replace `search_space()` calls with `PARAMS_MODEL.tune_space()`:

```python
# Old:
space = cfg.search_space()

# New:
params_model = strategy_cls.PARAMS_MODEL
space = params_model.tune_space()
```

In the objective function, translate Optuna trial into a validated Params instance:

```python
def objective(trial, strategy_cls, start, end, bar_provider):
    space = strategy_cls.PARAMS_MODEL.tune_space()
    trial_params = {}
    for name, cfg in space.items():
        if cfg["type"] == "float":
            trial_params[name] = trial.suggest_float(name, cfg["low"], cfg["high"])
        elif cfg["type"] == "int":
            trial_params[name] = trial.suggest_int(name, cfg["low"], cfg["high"])
        elif cfg["type"] == "categorical":
            trial_params[name] = trial.suggest_categorical(name, cfg["choices"])

    params = strategy_cls.PARAMS_MODEL(**trial_params)

    runner = BacktestRunner(
        strategy=strategy_cls(),
        config=BacktestConfig(start=start, end=end, seed=trial.number),
        bar_provider=bar_provider,
    )
    result = runner.run(params)
    # Score = sharpe minus drawdown penalty (preserve legacy formula exactly)
    return result.metrics["sharpe"] - 0.5 * abs(result.metrics["max_drawdown"])
```

- [ ] **Step 3: Run tuner tests**

```bash
/Users/GK/Downloads/alphadesk/.venv/bin/python -m pytest backend/tuner/ -v
```
Expected: tuner tests pass (assuming pead — the only migrated strategy — is used in the fixtures).

- [ ] **Step 4: Commit**

```bash
git add backend/tuner/runner.py backend/tuner/objective.py
git commit -m "feat(tuner): read Params.tune_space() + invoke new BacktestRunner"
```

---

### Task 19: Delete `engine_legacy.py` + `backtest/types.py` + `strategies/base.py`

**Files:**
- Delete: `backend/backtest/engine_legacy.py`
- Delete: `backend/backtest/types.py`
- Delete: `backend/strategies/base.py`
- Modify: `backend/backtest/cli.py` (thin dispatcher)
- Modify: `backend/backtest/config.py` (shim only)

- [ ] **Step 1: Verify parity test passed in Task 16**

Do not proceed until `test_pead_parity.py` is green. If it's red, fix whatever's wrong first.

- [ ] **Step 2: Convert `backend/backtest/cli.py` to thin dispatcher**

```python
# backend/backtest/cli.py
"""Top-level backtest dispatcher. Forwards `--strategy=NAME` to
`python -m strategies.NAME` so existing shell scripts keep working.

This is a compatibility shim — new code should use the per-strategy CLI
directly: `python -m strategies.pead backtest --from ... --to ...`
"""
from __future__ import annotations

import argparse
import importlib
import sys


def main() -> int:
    parser = argparse.ArgumentParser(
        prog="python -m backend.backtest",
        description="Legacy compatibility dispatcher — forwards to strategies.<name>.",
    )
    parser.add_argument("--strategy", required=True)
    # Everything else goes to the downstream CLI unchanged
    args, remaining = parser.parse_known_args()

    # Forward remaining args to strategies.<name>.__main__'s backtest subcommand
    mod = importlib.import_module(f"strategies.{args.strategy}.__main__")
    sys.argv = [f"strategies.{args.strategy}", "backtest", *remaining]
    return mod.run_cli(mod.__dict__["run_cli"]) if hasattr(mod, "run_cli") else 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 3: Delete the legacy files**

```bash
cd /Users/GK/Downloads/alphadesk
git rm backend/backtest/engine_legacy.py
git rm backend/backtest/types.py
git rm backend/strategies/base.py
```

Also: scan for remaining references and DELETE them or fix them.

```bash
cd backend && /Users/GK/Downloads/alphadesk/.venv/bin/python -c "
import ast, os
for root, _, files in os.walk('.'):
    if '.venv' in root or '__pycache__' in root: continue
    for f in files:
        if not f.endswith('.py'): continue
        path = os.path.join(root, f)
        with open(path) as fp: content = fp.read()
        for bad in ['from backtest.engine_legacy', 'from backtest.types', 'from strategies.base']:
            if bad in content:
                print(f'{path}: still references {bad}')
"
```

Fix each remaining reference — either delete the import, replace with the `_core` equivalent, or mark the consumer as Phase 3 work.

- [ ] **Step 4: Commit**

```bash
git add backend/backtest/ backend/strategies/
git commit -m "chore(_core): delete legacy engine_legacy.py + types.py + base.py"
```

---

## Phase 3 — Sweep 12 remaining strategies (Tasks 20-31)

Each strategy follows the **Strategy Migration Template** below. One task per strategy — parallelizable across multiple subagents (each task touches only that strategy's package + test file). Shared template is defined once; each task's per-strategy notes only flag anything strategy-specific that needs attention.

### Strategy Migration Template (SHARED)

For any strategy `<name>`:

1. **Read the old strategy code.**
   - `backend/strategies/<name>/strategy.py` — map old methods to new:
     - `configure(params: dict)` → DELETED (Pydantic Params are the contract)
     - `universe(asof, ctx)` → `universe(asof, state)` — replace `ctx.*_provider` with `state` or move the fundamentals-dependent logic into `run()`
     - `generate_signals(asof, ctx)` → body moves into `run(input, params)`; replace `ctx.bar_provider.fetch_bars(...)` with `input.bars.xs(...)`; earnings via `input.earnings`; fundamentals via `input.fundamentals`
     - `manage(asof, ctx)` → body also moves into `run(input, params)`; exit signals emitted alongside entry signals in the same `StrategyResult.signals` list
     - `on_fill(fill, ctx)` → `on_fill(fill, state)` with state dict input
   - `backend/strategies/<name>/config.py` — map `DEFAULTS` dict + `search_space()` function to a Pydantic `<Name>Params(StrategyParams)` model:
     - Each default value → `Field(default=..., ge=..., le=...)`
     - Each tunable field → `json_schema_extra={"tune": {"low": ..., "high": ..., "type": "float"|"int"|"categorical", ["choices": [...]]}}`
     - Preserve `load_universe()` + other helper functions unchanged
   - `backend/strategies/<name>/helpers.py` — UNCHANGED, pure-function helpers stay as-is

2. **Rewrite `config.py`**:

   ```python
   """<Name> — strategy params."""
   from __future__ import annotations

   from pydantic import Field

   from strategies._core.contracts import StrategyParams


   class <Name>Params(StrategyParams):
       # Mirror every field from the old DEFAULTS dict,
       # adding Field(json_schema_extra={"tune": {...}}) to any field
       # that appeared in the old search_space().
       param_a: float = Field(default=..., ge=..., le=..., json_schema_extra={"tune": {"low": ..., "high": ..., "type": "float"}})
       # ... etc
   ```

3. **Rewrite `strategy.py`**:

   ```python
   """<Name> — new shell implementation (academic rationale unchanged)."""
   from __future__ import annotations

   from datetime import date
   from typing import Any

   from strategies._core.contracts import (
       Fill, OrderType, Signal, StrategyInput, StrategyResult, TimeInForce,
   )
   from strategies._core.protocol import Strategy, StrategyMeta, register_strategy

   from strategies.<name>.config import <Name>Params, load_universe
   from strategies.<name>.helpers import ...  # unchanged


   @register_strategy(StrategyMeta(
       name="<name>",
       category="<equity|options|pairs|macro|intraday>",
       description="<one-line summary>",
       lookback_days=<N>,  # from old StrategyMeta or sensible default
   ))
   class <Name>Strategy(Strategy):
       PARAMS_MODEL = <Name>Params

       def universe(self, asof, state):
           return load_universe()

       def run(self, input, params):
           signals, diagnostics, warnings = [], {}, []
           state_update = {}

           # PORT old generate_signals() body here
           # PORT old manage() body here

           return StrategyResult(
               signals=signals, state_update=state_update,
               diagnostics=diagnostics, warnings=warnings,
           )

       def on_fill(self, fill, state):
           # PORT old on_fill() body here if any
           return {}
   ```

4. **Add `__main__.py`** (5-line dispatcher):

   ```python
   """Entry point for `python -m strategies.<name> <subcommand>`."""
   from strategies._core.cli import run_cli
   from strategies.<name>.strategy import <Name>Strategy

   if __name__ == "__main__":
       raise SystemExit(run_cli(<Name>Strategy))
   ```

5. **Rewrite tests** (`backend/strategies/<name>/tests/test_strategy.py`):

   - Build `StrategyInput` fixtures directly using `pd.DataFrame` instead of fake providers
   - Assertions on `Signal` shape carry over (Signal is Pydantic v2 now, same public fields)
   - If the old test constructed a `Context` and called `generate_signals(asof, ctx)`, replace with constructing `StrategyInput` and calling `strategy.run(input, params)`

6. **Run the strategy's tests + smoke-test the CLI**:

   ```bash
   /Users/GK/Downloads/alphadesk/.venv/bin/python -m pytest strategies/<name>/tests/ -v
   /Users/GK/Downloads/alphadesk/.venv/bin/python -m strategies.<name> schema params --pretty | head -20
   ```

7. **Commit**:

   ```bash
   git add backend/strategies/<name>/
   git commit -m "feat(<name>): migrate to Strategy.run(input, params) shell"
   ```

---

### Task 20: Migrate `momentum-quality`

Apply the Strategy Migration Template to `backend/strategies/momentum_quality/` (note: directory name uses `_` not `-`). Strategy-specific notes:

- Category: `equity` — cross-sectional momentum + quality factor composite
- Uses **fundamentals** (quality factors like ROIC, gross margin, debt-to-equity) — ensure `StrategyInput.fundamentals` is consumed; if the old strategy expected `ctx.fundamentals_provider.fetch_snapshot(...)`, move to `input.fundamentals.loc[...]`
- Holding period is quarterly (~63 trading days) — preserve the `rebalance_days` param
- `search_space()` likely has 3-5 tunable fields (momentum_lookback, quality_weight, universe_size, rebalance_days) — each becomes a `Field(..., json_schema_extra={"tune": ...})`

After migration, the strategy's daily pipeline should continue to run from the new `DailyPipelineRunner` via `data.ingestion.daily_pipeline.py` automatically.

Commit message: `feat(momentum_quality): migrate to Strategy.run(input, params) shell`

---

### Task 21: Migrate `vrp-harvesting`

Apply template to `backend/strategies/vrp_harvesting/`. Strategy-specific notes:

- Category: `options` — sells VIX-futures-backed vol premium
- Needs **options chain data** that the current `StrategyInput` doesn't carry (bars/earnings/fundamentals/news only). For Phase 3 the strategy can emit signals driven by the VIX term structure only; the options-chain lookup happens in the executor/MasterAgent downstream
- Alternatively: extend `StrategyInput` with an `options` DataFrame field — but that's a scope change beyond this sub-spec; deferred
- Signals are multi-leg (`Signal.legs: list[OptionLeg]`) — the new `Signal` model supports this

Commit: `feat(vrp_harvesting): migrate to Strategy.run(input, params) shell`

---

### Task 22: Migrate `earnings-vol-premium`

Apply template to `backend/strategies/earnings_vol_premium/`. Strategy-specific notes:

- Category: `options` — sells premium around earnings events
- Uses FMP earnings calendar (same as pead) — `input.earnings` is available
- Emits multi-leg strangle/straddle signals via `Signal.legs`
- Paused in high-vol regimes — this filter is part of `run()` logic, not a shell concern

Commit: `feat(earnings_vol_premium): migrate to Strategy.run(input, params) shell`

---

### Task 23: Migrate `regime-adaptive` (HMM Regime-Adaptive Allocation)

Apply template to `backend/strategies/regime_adaptive/`. Strategy-specific notes:

- Category: `macro`
- Stateful: maintains an HMM model fit across bars. The fitted model should live in `StrategyInput.state["hmm_model"]` — but scikit-learn objects don't serialize to JSON trivially
- Options: (a) pickle the model and store bytes in state; (b) keep the model as a class attribute on the strategy instance and NOT in state (violates purity but lets existing implementation work unchanged); (c) re-fit from scratch each bar (slow but pure)
- Recommended: (a) + document in the strategy's `spec.md` that state for this strategy contains non-trivial pickled bytes

Commit: `feat(regime_adaptive): migrate to Strategy.run(input, params) shell`

---

### Task 24: Migrate `ts-momentum` (Time-Series Momentum)

Apply template to `backend/strategies/ts_momentum/`. Strategy-specific notes:

- Category: `equity`
- 200-SMA trend-following on a small universe (usually SPY + a few sector ETFs)
- Straightforward migration — no fundamentals, no state beyond position-tracking

Commit: `feat(ts_momentum): migrate to Strategy.run(input, params) shell`

---

### Task 25: Migrate `rsi2-reversal`

Apply template to `backend/strategies/rsi2_reversal/`. Strategy-specific notes:

- Category: `equity` — short-term RSI(2) mean reversion
- Path-dependent: tracks consecutive down-days. State keys need careful namespacing (e.g. `state["rsi2_cooldown"][symbol] = date`)
- High win-rate / low-reward — trade-count will be high; make sure test fixtures cover the churn

Commit: `feat(rsi2_reversal): migrate to Strategy.run(input, params) shell`

---

### Task 26: Migrate `dual-momentum`

Apply template to `backend/strategies/dual_momentum/`. Strategy-specific notes:

- Category: `macro` — relative + absolute momentum selection
- Monthly rebalance (not daily) — the strategy's `run()` should check `input.asof.day == 1` (or first trading day of month) and no-op otherwise
- Simple state: last rebalance date

Commit: `feat(dual_momentum): migrate to Strategy.run(input, params) shell`

---

### Task 27: Migrate `pairs-trading`

Apply template to `backend/strategies/pairs_trading/`. Strategy-specific notes:

- Category: `pairs`
- Two-leg position management — state tracks the *pair* (both legs), not individual symbols
- Careful state namespacing: `state["pairs"][(sym_a, sym_b)] = {"entry_zscore": ..., "hedge_ratio": ...}`
- Universe is not a flat list but a list of pairs — `universe(asof, state)` returns the flattened list of all symbols across all active pairs

Commit: `feat(pairs_trading): migrate to Strategy.run(input, params) shell`

---

### Task 28: Migrate `kama-breakout`

Apply template to `backend/strategies/kama_breakout/`. Strategy-specific notes:

- Category: `equity` — Kaufman Adaptive Moving Average breakouts
- Marked `paper_only=True` in the old routing flags (see `backend/core/config.py:STRATEGY_PAPER_ONLY`). Preserve this — the MasterAgent reads it from `StrategyMeta`, not from Params
- If `StrategyMeta` doesn't have a `paper_only` field yet, add it as an optional bool default-False in `_core/protocol.py:StrategyMeta` (breaking change to meta — document carefully)

Commit: `feat(kama_breakout): migrate to Strategy.run(input, params) shell`

---

### Task 29: Migrate `vwap-strategy`

Apply template to `backend/strategies/vwap_strategy/`. Strategy-specific notes:

- Category: `intraday` — relies on 1-minute bars
- `StrategyMeta.required_bars = ("1min",)` — the daily-first assumption in Phase 1 runners means this strategy won't work end-to-end without additional runner support
- **For Phase 3 scope**: migrate the shell (shape changes) but mark the strategy `kind="research"` temporarily so it doesn't get scheduled by the daily pipeline. Full intraday support is a follow-up beyond this sub-spec.

Commit: `feat(vwap_strategy): migrate shell (intraday scheduling deferred)`

---

### Task 30: Migrate `gap-fill`

Apply template to `backend/strategies/gap_fill/`. Strategy-specific notes:

- Category: `equity` — opening-gap fade
- Event-driven per bar (gap > threshold at open → enter)
- Uses MOO orders — preserve `OrderType.MOO`
- Simple state: tracks open gap-fill positions expected to close by EOD

Commit: `feat(gap_fill): migrate to Strategy.run(input, params) shell`

---

### Task 31: Migrate `mean-reversion`

Apply template to `backend/strategies/mean_reversion/`. Strategy-specific notes:

- Category: `equity` — Bollinger band mean reversion on a basket
- Uses a 20-day SMA + stddev — purely in-bar computable from `input.bars`
- No state beyond position-tracking — minimal migration

Commit: `feat(mean_reversion): migrate to Strategy.run(input, params) shell`

---

## Phase 4 — Frontend types (Tasks 32-33)

### Task 32: Update `frontend/src/types/index.ts` for new `Signal` + `BacktestResult`

**Files:**
- Modify: `frontend/src/types/index.ts`

- [ ] **Step 1: Add new types + extend existing**

Add at the bottom of `index.ts`:

```typescript
// ─── Strategy SOTA foundation types ──────────────────────────
// Mirror of backend/strategies/_core/contracts.py — keep in sync.

export type OrderType = "MKT" | "LMT" | "STP" | "STP_LMT" | "MOO" | "MOC";
export type TimeInForce = "DAY" | "GTC" | "IOC" | "FOK";
export type OptionSide = "buy" | "sell";
export type StrategyKind = "autonomous" | "research";

export interface OptionLeg {
  occ_symbol: string;        // OCC option symbol, e.g. NVDA260425C00205000
  side: OptionSide;
  quantity: number;
  limit_price: number | null;
}

// UPDATE existing Signal type — add legs field
export interface Signal {
  symbol: string;
  asof: string;
  order_type: OrderType;
  time_in_force: TimeInForce;
  target_weight: number | null;
  quantity: number | null;
  limit_price: number | null;
  stop_price: number | null;
  tag: string;
  legs: OptionLeg[] | null;   // NEW — multi-leg option orders
}

export interface ReproMeta {
  git_sha: string;
  param_hash: string;
  snapshot_root: string;
  seed: number;
  run_at: string;              // ISO datetime
  strategy_name: string;
  runner_version: string;
}

// UPDATE existing BacktestResult — add repro + warnings_by_asof
export interface BacktestResult {
  equity_curve: unknown;       // pandas DataFrame, serialized as JSON orient="table"
  daily_returns: unknown;
  trades: Trade[];
  signals_emitted: Signal[];
  metrics: Record<string, number>;
  params: Record<string, unknown>;
  start: string;
  end: string;
  repro: ReproMeta;            // NEW
  warnings_by_asof: Record<string, string[]>;  // NEW
}

export interface Trade {
  symbol: string;
  entry_date: string;
  exit_date: string | null;
  entry_price: string;         // Decimal serialized as string
  exit_price: string | null;
  quantity: number;
  pnl: string | null;
  tag: string;
}
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/GK/Downloads/alphadesk/frontend && ./node_modules/.bin/tsc --noEmit 2>&1 | grep -v "preexisting" | head -10
```
Expected: no NEW errors introduced.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/types/index.ts
git commit -m "feat(types): add OptionLeg + ReproMeta; extend Signal with legs and BacktestResult with repro"
```

---

### Task 33: Smoke-test any frontend page that consumes `Signal` or `BacktestResult`

**Files:**
- Find + potentially modify: pages that display backtest results or signals

- [ ] **Step 1: Find consumers**

```bash
cd /Users/GK/Downloads/alphadesk/frontend && grep -rln "BacktestResult\|type.*Signal\b" src/ | head -20
```

Read each match. For any page that displays Signal or BacktestResult fields:
- If the page displays `signal.quantity` or similar existing fields — no change needed
- If the page wants to surface the new `repro.git_sha` or `signals_emitted.legs` — add new UI element

For Phase 4 scope, ZERO new UI is required — just ensure nothing BREAKS. The existing fields are preserved; the new fields are optional.

- [ ] **Step 2: Run frontend tests**

```bash
./node_modules/.bin/vitest run 2>&1 | tail -10
```
Expected: all tests pass.

- [ ] **Step 3: Commit** (only if changes were needed)

If no changes were needed, skip the commit and move to Phase 5.

---

## Phase 5 — Cleanup + docs (Tasks 34-36)

### Task 34: Update `docs/STRATEGIES.md`

**Files:**
- Modify: `docs/STRATEGIES.md` (or create if missing)

- [ ] **Step 1: Write or rewrite the docs**

Content outline:

```markdown
# Strategies

Every strategy in AlphaDesk is a Python package under `backend/strategies/<name>/`
implementing the `Strategy` ABC defined in `backend/strategies/_core/protocol.py`.

## Quick reference

- Protocol: `run(input: StrategyInput, params: StrategyParams) → StrategyResult`
- CLI: `python -m strategies.<name> {backtest,signal,tune,analyze-day,schema,validate-params,explain}`
- Registry: `@register_strategy(StrategyMeta(...))` in `strategy.py`
- Tests: fixtures build `StrategyInput` directly; no fake providers needed

## Building a new strategy

1. Create `backend/strategies/<name>/` package
2. Write `config.py` with `<Name>Params(StrategyParams)` — use `Field(json_schema_extra={"tune": ...})` for tunable fields
3. Write `strategy.py` implementing `Strategy`:
   - Set `PARAMS_MODEL = <Name>Params`
   - Implement `universe(asof, state) → list[str]`
   - Implement `run(input, params) → StrategyResult`
   - (Optional) override `on_fill(fill, state) → dict`
   - Decorate with `@register_strategy(StrategyMeta(name=..., lookback_days=..., ...))`
4. Write `__main__.py` (5-line CLI dispatcher)
5. Write `tests/test_strategy.py` with `StrategyInput` fixtures
6. Add to `backend/strategies/__init__.py` if the registry needs explicit discovery

## Purity invariants

`run()` MUST:
- Be deterministic given (input, params)
- NOT perform I/O (no provider access, no network)
- NOT read wall-clock time (use `input.asof`)
- NOT use global RNG (use `input.rng`)
- NOT mutate strategy instance state (return `state_update` instead)

## Available runners

- `BacktestRunner` — multi-bar backtest with equity curve, trades, metrics, ReproMeta
- `DailyPipelineRunner` — single-day live invocation (MasterAgent consumes the signals)
- `SignalRunner` — one-off signal generation; supports `--replay` from snapshot

## Reproducibility

Every `BacktestResult.repro` carries `(git_sha, param_hash, snapshot_root, seed, run_at, strategy_name, runner_version)`. Given identical tuple → bitwise-identical result. Use `SnapshotWriter` (via `--snapshot-dir` on the backtest CLI) to preserve input data for post-mortem replay.
```

- [ ] **Step 2: Commit**

```bash
git add docs/STRATEGIES.md
git commit -m "docs(strategies): new protocol + CLI + purity invariants reference"
```

---

### Task 35: Update each strategy's `spec.md`

**Files:**
- Modify: each of 13 `backend/strategies/<name>/spec.md`

- [ ] **Step 1: For each of the 13 strategies, append a migration note to `spec.md`**

```markdown
## Migration note (2026-04-22 SOTA shell)

This strategy was migrated from the legacy `generate_signals(asof, ctx)` /
`manage(asof, ctx)` API to the unified `run(input, params) → result`
pure-function contract. Academic rationale unchanged; only the shell
changed. See `docs/superpowers/specs/2026-04-22-strategy-sota-foundation-design.md`
for the migration design.

Key behavioral notes:
- Parameters are now a Pydantic `<Name>Params(StrategyParams)` model
  (typed, validated, JSON-Schema-exportable)
- Reproducibility metadata is attached to every backtest result
- Invoke via `python -m strategies.<name> <subcommand>`
```

Paste this into each of the 13 `spec.md` files. Substitute the strategy name in the `<Name>Params` placeholder and the `python -m strategies.<name>` path.

- [ ] **Step 2: Commit**

```bash
git add backend/strategies/*/spec.md
git commit -m "docs(strategies): append SOTA-shell migration note to every spec.md"
```

---

### Task 36: Tag release + final smoke test

**Files:**
- None (operational)

- [ ] **Step 1: Full test suite**

```bash
cd /Users/GK/Downloads/alphadesk/backend && /Users/GK/Downloads/alphadesk/.venv/bin/python -m pytest -x --tb=short
```
Expected: zero failures. Any skipped tests should be documented (e.g. provider-dependent tests that need live credentials).

- [ ] **Step 2: Full frontend suite + type-check**

```bash
cd ../frontend && ./node_modules/.bin/vitest run && ./node_modules/.bin/tsc --noEmit 2>&1 | head -20
```
Expected: zero failures, zero NEW type errors (pre-existing ones documented).

- [ ] **Step 3: CLI smoke test on 3 strategies**

```bash
cd ../backend
/Users/GK/Downloads/alphadesk/.venv/bin/python -m strategies.pead schema params --pretty >/dev/null && echo "pead: OK"
/Users/GK/Downloads/alphadesk/.venv/bin/python -m strategies.momentum_quality schema params --pretty >/dev/null && echo "momentum_quality: OK"
/Users/GK/Downloads/alphadesk/.venv/bin/python -m strategies.rsi2_reversal schema params --pretty >/dev/null && echo "rsi2_reversal: OK"
```

- [ ] **Step 4: Push + deploy**

```bash
cd /Users/GK/Downloads/alphadesk
git push origin feature/deployment
gh workflow run deploy.yml --ref feature/deployment
run_id=$(gh run list --branch feature/deployment --limit 1 --json databaseId --jq '.[0].databaseId')
until gh run view "$run_id" --json status --jq '.status' | grep -q completed; do sleep 45; done
gh run view "$run_id" --json conclusion
```
Expected: `"conclusion": "success"`.

- [ ] **Step 5: Production smoke**

```bash
ssh -i ~/.ssh/alphadesk root@178.156.145.213 \
  "docker exec alphadesk-backend python -m strategies.pead schema params --pretty | head -10"
```
Expected: prints pead params schema.

Verify the daily pipeline scheduler (which runs once per trading day) picks up the next bar successfully. Watch `docker logs alphadesk-backend --since 10m` for any errors during the first post-deploy run.

- [ ] **Step 6: Tag the release**

```bash
git tag -a strategy-sota-1.0 -m "Sub-spec 1: unified strategy shell complete"
git push origin strategy-sota-1.0
```

---

## Self-Review

### Spec coverage

Every spec section → at least one task:

| Spec section | Task(s) |
|--------------|---------|
| Architecture (new `_core/` layout) | Tasks 1–12 |
| Core contracts (Pydantic v2) | Tasks 2, 3, 4, 5 |
| Strategy protocol + base class | Task 6 |
| Runners (Backtest/Daily/Signal) | Tasks 10, 11 |
| Snapshot writer/reader | Task 7 |
| Per-strategy CLI | Task 12 |
| Migration map — pead reference | Tasks 13–19 |
| Migration map — sweep 12 | Tasks 20–31 |
| Frontend ripple | Tasks 32, 33 |
| Execution sequencing (5 phases) | Phases 1–5 grouping |
| Purity invariants | Enforced by ABC in Task 6; lint rule flagged as open question |
| Reproducibility metadata | Tasks 2, 10 |
| Parity test | Task 16 |

Open questions from spec:
- **Custom `ruff` lint rule** for purity enforcement — not in this plan. Should be a follow-up task OR added as a pre-commit check (see: the plan relies on code review to catch `np.random.*` usage in strategy bodies; a lint rule is a strengthening step that can land separately).
- **Parity test acceptance criteria** — Task 16 uses the spec's 0.5% threshold. 

### Placeholder scan

No "TBD" / "TODO" / "fill in details" markers. Tasks 20–31 use a shared Strategy Migration Template with per-strategy notes; each per-strategy task has its own content (strategy-specific notes + commit message). This satisfies the skill's requirement that each task be self-contained without blindly referring to "similar to task N".

### Type consistency

- `Strategy.PARAMS_MODEL: type[StrategyParams]` → consistent across Tasks 6 (declaration), 13–14 (pead), 20–31 (each strategy), 32 (CLI)
- `StrategyInput` shape (asof, mode, bars, earnings, fundamentals, news, cash, equity, positions, state, seed, rng) → consistent across Tasks 4 (definition), 7 (snapshot), 10 (backtest runner), 11 (signal + pipeline runners), 14 (pead usage)
- `StrategyResult` (signals, state_update, diagnostics, warnings) → consistent across Tasks 5 (definition), 14, 20–31 (each strategy)
- `BacktestResult.repro: ReproMeta` with 7 fields → consistent across Tasks 5 (definition), 10 (BacktestRunner._build_result), 32 (frontend type mirror)
- Exit codes (0/2/3/4/5) → consistent between spec and Task 12 (CLI handlers)

No drift found.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-22-strategy-sota-foundation.md` (36 tasks across 5 phases). Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task with the spec + plan as context, review each task between dispatches, two-stage review (spec compliance then code quality) on anything complex. ~3 calendar weeks of work, parallelizable across subagents in Phase 3 (one per strategy).

**2. Inline Execution** — Execute tasks in this session using `executing-plans` skill; batch execution with checkpoints. Would consume significant context; not recommended for a 36-task plan.

Which approach?
