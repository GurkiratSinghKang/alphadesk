"""Unit tests for :class:`WalkForwardObjective` under the new BacktestRunner.

Task-18 rewrite: the tuner objective now drives a single-window
:class:`~strategies._core.runners.backtest_runner.BacktestRunner` per
trial rather than the legacy F1 :class:`WalkForwardRunner`. These tests
cover the scoring path and the Pydantic-validation -inf fallback.

The legacy tests in this file covered ``_extract_metrics`` tripwires for
the train/test-split fallback; those no longer apply because the
objective does not introspect IS/OOS legs under the new contract.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from typing import Any

import pandas as pd
import pytest

from strategies._core.contracts import StrategyParams
from tuner.objective import WalkForwardObjective, search_space_from_params_model


# --------------------------------------------------------------------------- #
# Fakes                                                                       #
# --------------------------------------------------------------------------- #
class _DummyParams(StrategyParams):
    """Tiny params model exercising the three distribution types."""

    # Imported lazily via Field so the test module stays fast to import.
    pass


@dataclass
class _FakeResult:
    """Minimal stand-in for :class:`BacktestResult` for score testing."""

    metrics: dict = field(default_factory=dict)
    daily_returns: Any = field(default_factory=lambda: pd.Series([0.0] * 252))


class _DummyStrategy:
    """Drop-in strategy class just for `_score_from_result` unit tests.

    Does NOT need to satisfy the Strategy ABC — the tests only construct
    a WalkForwardObjective instance to access its scoring method, never
    calling ``__call__``.
    """
    PARAMS_MODEL = _DummyParams


def _obj(**overrides) -> WalkForwardObjective:
    kwargs = dict(
        strategy_cls=_DummyStrategy,
        bar_provider=object(),
        start=date(2020, 1, 1),
        end=date(2020, 12, 31),
    )
    kwargs.update(overrides)
    return WalkForwardObjective(**kwargs)


# --------------------------------------------------------------------------- #
# Scoring formula preservation                                                #
# --------------------------------------------------------------------------- #
class TestScoringFormula:
    """The penalised formula must match the legacy F1 formula byte-for-byte.

        score = sharpe
                - 0.05 * max(0, turnover_yr - 5.0)
                - 0.5  * max(0, max_drawdown - 0.30)
    """

    def test_sharpe_only_mode(self):
        """``scoring='sharpe'`` returns raw Sharpe with no penalty."""
        obj = _obj(scoring="sharpe")
        r = _FakeResult(metrics={"sharpe": 1.75, "max_drawdown": -0.9})
        assert obj._score_from_result(r) == pytest.approx(1.75)

    def test_penalised_no_penalty(self):
        """Sharpe below MDD threshold — score = sharpe."""
        obj = _obj(scoring="penalised")
        r = _FakeResult(
            metrics={"sharpe": 1.5, "max_drawdown": -0.25, "turnover": 0.0},
        )
        assert obj._score_from_result(r) == pytest.approx(1.5)

    def test_penalised_dd_penalty_active(self):
        """MDD = 40% → penalty = 0.5 * (0.40 - 0.30) = 0.05."""
        obj = _obj(scoring="penalised")
        r = _FakeResult(
            metrics={"sharpe": 2.0, "max_drawdown": -0.40, "turnover": 0.0},
        )
        expected = 2.0 - 0.5 * 0.10
        assert obj._score_from_result(r) == pytest.approx(expected)

    def test_penalised_turnover_penalty_active(self):
        """Turnover=10x over 252 days → turnover_yr=10; penalty=0.05*(10-5)=0.25."""
        obj = _obj(scoring="penalised")
        r = _FakeResult(
            metrics={"sharpe": 1.0, "max_drawdown": 0.0, "turnover": 10.0},
            daily_returns=pd.Series([0.0] * 252),
        )
        expected = 1.0 - 0.05 * 5.0
        assert obj._score_from_result(r) == pytest.approx(expected)

    def test_empty_metrics_returns_neg_inf(self):
        obj = _obj(scoring="penalised")
        r = _FakeResult(metrics={})
        assert obj._score_from_result(r) == -math.inf

    def test_nan_sharpe_returns_neg_inf(self):
        obj = _obj(scoring="penalised")
        r = _FakeResult(metrics={"sharpe": float("nan"), "max_drawdown": 0.0})
        assert obj._score_from_result(r) == -math.inf


# --------------------------------------------------------------------------- #
# Pydantic validation fallback                                                #
# --------------------------------------------------------------------------- #
class TestParamsValidation:
    """Invalid param combos caught by Pydantic → -inf, not an exception."""

    def test_validation_error_returns_neg_inf(self, caplog):
        """Passing an unknown field trips ``extra='forbid'`` on StrategyParams."""

        obj = _obj()
        # _DummyParams forbids extras; "bogus_field" triggers ValidationError.
        score = obj(params={"bogus_field": 123})
        # Plus a guard: the score stays -inf even if Optuna happens to
        # pass multiple trials with invalid param dicts.
        assert score == -math.inf


# --------------------------------------------------------------------------- #
# search_space_from_params_model                                              #
# --------------------------------------------------------------------------- #
class TestSearchSpaceTranslation:
    """Exercise each distribution type through the tune_space→SearchSpec path."""

    def test_translation_covers_float_int_categorical(self):
        from pydantic import Field
        from tuner.search import Categorical, FloatRange, IntRange

        class _Model(StrategyParams):
            flt: float = Field(
                default=1.0,
                json_schema_extra={"tune": {"low": 0.5, "high": 2.0, "type": "float"}},
            )
            integer: int = Field(
                default=5,
                json_schema_extra={"tune": {"low": 1, "high": 10, "type": "int"}},
            )
            cat: str = Field(
                default="a",
                json_schema_extra={
                    "tune": {"type": "categorical", "choices": ["a", "b", "c"]}
                },
            )
            fixed: int = Field(default=42)  # no tune descriptor

        space = search_space_from_params_model(_Model)
        assert set(space.keys()) == {"flt", "integer", "cat"}
        assert isinstance(space["flt"], FloatRange)
        assert space["flt"].low == 0.5
        assert space["flt"].high == 2.0
        assert isinstance(space["integer"], IntRange)
        assert space["integer"].low == 1
        assert space["integer"].high == 10
        assert isinstance(space["cat"], Categorical)
        assert space["cat"].choices == ("a", "b", "c")

    def test_unknown_type_raises(self):
        from pydantic import Field

        class _BadModel(StrategyParams):
            weird: float = Field(
                default=1.0,
                json_schema_extra={"tune": {"type": "uniform", "low": 0.0, "high": 1.0}},
            )

        with pytest.raises(ValueError, match="Unknown tune-space entry type"):
            search_space_from_params_model(_BadModel)
