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


# ---------------------------------------------------------------------------
# Task 3: OrderType, TimeInForce, OptionLeg, Signal
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Task 4: Position, Fill, StrategyInput
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Task 5: StrategyResult, Trade, ReproMeta, BacktestConfig, BacktestResult
# ---------------------------------------------------------------------------

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
