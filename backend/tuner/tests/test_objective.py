"""Unit tests for :class:`WalkForwardObjective`.

These tests focus on the tripwire added by audit A2#4: when
``tune_on="train"`` and the in-sample leg has no metrics (e.g. an Optuna
trial that produced zero trades in the train window), the objective must
return empty metrics — NOT silently fall back to OOS. Falling back to OOS
reintroduces selection-on-test leakage that Wave 5 explicitly removed.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date
from typing import Any

import pytest

from tuner.objective import WalkForwardObjective


# --------------------------------------------------------------------------- #
# Fakes                                                                       #
# --------------------------------------------------------------------------- #
@dataclass
class _FakeSeries:
    n: int = 252

    def __len__(self) -> int:
        return self.n


@dataclass
class _FakeResult:
    """Minimal stand-in for :class:`BacktestResult`."""

    metrics: dict = field(default_factory=dict)
    daily_returns: Any = field(default_factory=lambda: _FakeSeries(n=252))


@dataclass
class _FakeWF:
    """Minimal stand-in for :class:`WalkForwardResult` that allows the
    caller to independently populate IS and OOS legs.

    The existing tests in ``backend/strategies/tests/test_tuner.py`` only
    populate ``out_of_sample_result``; those tests predate the A2#4
    tripwire and rely on the (now-removed) OOS fallback. This fake
    mirrors the real :class:`WalkForwardResult` shape so we can exercise
    the tripwire path directly.
    """

    is_metrics: dict | None = None
    oos_metrics: dict | None = None
    is_days: int = 252
    oos_days: int = 252
    folds: list = field(default_factory=list)

    @property
    def in_sample_result(self):
        if self.is_metrics is None:
            return None
        return _FakeResult(
            metrics=dict(self.is_metrics),
            daily_returns=_FakeSeries(n=self.is_days),
        )

    @property
    def out_of_sample_result(self):
        if self.oos_metrics is None:
            return None
        return _FakeResult(
            metrics=dict(self.oos_metrics),
            daily_returns=_FakeSeries(n=self.oos_days),
        )

    @property
    def aggregated_metrics(self):
        return {}


class _DummyProvider:
    pass


class _DummyStrategy:
    name = "dummy"
    required_bars = ["daily"]
    required_lookback_days = 1

    def configure(self, p): ...

    def universe(self, a, c): return []

    def generate_signals(self, a, c): return []

    def manage(self, a, c): return []

    def on_fill(self, f, c): ...


def _obj(**overrides):
    kwargs = dict(
        strategy_cls=_DummyStrategy,
        bar_provider=_DummyProvider(),
        start=date(2020, 1, 1),
        end=date(2020, 12, 31),
        train_end=date(2020, 9, 30),
    )
    kwargs.update(overrides)
    return WalkForwardObjective(**kwargs)


# --------------------------------------------------------------------------- #
# Tripwire: tune_on="train" must NOT fall back to OOS                         #
# --------------------------------------------------------------------------- #
class TestNoTrainToOosFallback:
    """Audit A2#4: under ``tune_on="train"``, empty train metrics must
    yield empty metrics (and -inf score) — never an OOS read."""

    def test_empty_train_returns_empty_metrics(self):
        """IS present but metrics={} → _extract_metrics returns {}."""

        obj = _obj(tune_on="train")
        wf = _FakeWF(
            is_metrics={},  # zero-trades trial
            oos_metrics={"sharpe": 2.5, "turnover": 1.0, "max_drawdown": 0.05},
        )
        assert obj._extract_metrics(wf) == {}

    def test_missing_train_returns_empty_metrics(self):
        """IS missing entirely → _extract_metrics returns {} (no OOS peek)."""

        obj = _obj(tune_on="train")
        wf = _FakeWF(
            is_metrics=None,
            oos_metrics={"sharpe": 2.5, "turnover": 1.0, "max_drawdown": 0.05},
        )
        assert obj._extract_metrics(wf) == {}

    def test_empty_train_scores_neg_inf(self):
        """Empty metrics → _score_from_result returns -inf."""

        obj = _obj(tune_on="train")
        wf = _FakeWF(
            is_metrics={},
            oos_metrics={"sharpe": 2.5, "turnover": 1.0, "max_drawdown": 0.05},
        )
        assert obj._score_from_result(wf) == -math.inf

    def test_empty_train_count_days_zero(self):
        """Empty train → _count_days returns 0 (no OOS day-count peek)."""

        obj = _obj(tune_on="train")
        wf = _FakeWF(
            is_metrics={},
            oos_metrics={"sharpe": 2.5},
            is_days=0,
            oos_days=252,
        )
        # Train has no daily_returns (is_days=0 implies we simulate
        # no series); the guard returns 0 rather than falling back to OOS.
        # To be exact, set is_metrics=None so in_sample_result is None.
        wf2 = _FakeWF(
            is_metrics=None,
            oos_metrics={"sharpe": 2.5},
            oos_days=252,
        )
        assert obj._count_days(wf2) == 0

    def test_populated_train_used_normally(self):
        """Sanity: when train metrics ARE present, they're used."""

        obj = _obj(tune_on="train")
        wf = _FakeWF(
            is_metrics={"sharpe": 1.0, "turnover": 2.0, "max_drawdown": 0.10},
            oos_metrics={"sharpe": 9.0, "turnover": 9.0, "max_drawdown": 0.90},
        )
        metrics = obj._extract_metrics(wf)
        # If the tripwire were bypassed we'd read OOS sharpe=9.0; the
        # correct read yields train sharpe=1.0.
        assert metrics.get("sharpe") == 1.0

    def test_tune_on_test_still_reads_oos(self):
        """Debug mode ``tune_on="test"`` still reads OOS (explicit opt-in)."""

        obj = _obj(tune_on="test")
        wf = _FakeWF(
            is_metrics={},
            oos_metrics={"sharpe": 2.0, "turnover": 1.0, "max_drawdown": 0.05},
        )
        # Under tune_on="test" we deliberately read OOS — caller opted in.
        assert obj._extract_metrics(wf).get("sharpe") == 2.0
