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
