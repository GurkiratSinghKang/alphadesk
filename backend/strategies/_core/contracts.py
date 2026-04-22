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
