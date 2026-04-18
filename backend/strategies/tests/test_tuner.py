"""Unit tests for the tuner primitives.

These tests exercise the pure-Python plumbing (search space, scoring math,
Optuna integration) without touching the engine. The engine-integration
smoke test lives in :mod:`backend.backtest.tests` (F1).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date
from typing import Any

import pytest

from tuner.objective import WalkForwardObjective
from tuner.search import (
    Categorical,
    FloatRange,
    IntRange,
    ParameterSearch,
)


# --------------------------------------------------------------------------- #
# Search-space primitives                                                     #
# --------------------------------------------------------------------------- #
class TestSearchSpace:
    def test_int_range_suggests_int_in_bounds(self):
        optuna = pytest.importorskip("optuna")
        ranges = {"rsi_period": IntRange(2, 5)}

        observed: list[int] = []

        def obj(params):
            observed.append(params["rsi_period"])
            return 0.0

        search = ParameterSearch(
            space=ranges,
            objective_fn=obj,
            sampler="random",
            seed=1,
        )
        study = search.run(n_trials=25, study_name="t_int", storage="")
        assert len(study.trials) == 25
        assert all(2 <= v <= 5 and isinstance(v, int) for v in observed)

    def test_float_range_log(self):
        optuna = pytest.importorskip("optuna")
        space = {"lr": FloatRange(1e-4, 1e-1, log=True)}

        observed: list[float] = []

        def obj(params):
            observed.append(params["lr"])
            return 0.0

        search = ParameterSearch(
            space=space, objective_fn=obj, sampler="random", seed=2
        )
        search.run(n_trials=20, study_name="t_float", storage="")
        assert all(1e-4 <= v <= 1e-1 for v in observed)

    def test_categorical(self):
        pytest.importorskip("optuna")
        space = {"trend_sma": Categorical([100, 150, 200])}

        seen: set[int] = set()

        def obj(params):
            seen.add(params["trend_sma"])
            return float(params["trend_sma"])

        search = ParameterSearch(
            space=space, objective_fn=obj, sampler="random", seed=3
        )
        search.run(n_trials=30, study_name="t_cat", storage="")
        assert seen.issubset({100, 150, 200})

    def test_sampler_seed_reproducibility(self):
        pytest.importorskip("optuna")
        space = {"x": IntRange(0, 100)}

        def make():
            obs: list[int] = []
            ps = ParameterSearch(
                space=space,
                objective_fn=lambda p: (obs.append(p["x"]) or 0.0),
                sampler="tpe",
                seed=999,
            )
            ps.run(n_trials=15, study_name=f"seed_test_{id(obs)}", storage="")
            return obs

        obs1 = make()
        obs2 = make()
        # Note: Optuna's TPE sampler is seeded but can be non-deterministic
        # across versions for the first few trials (startup_trials RNG).
        # We assert that at least the bulk of suggestions repeat.
        assert obs1 == obs2


# --------------------------------------------------------------------------- #
# Objective scoring math                                                      #
# --------------------------------------------------------------------------- #
@dataclass
class _FakeResult:
    """Minimal stand-in for :class:`BacktestResult`."""

    metrics: dict = field(default_factory=dict)
    daily_returns: object = field(default_factory=lambda: _FakeSeries(n=252))


@dataclass
class _FakeSeries:
    n: int = 0

    def __len__(self) -> int:
        return self.n


@dataclass
class _FakeWF:
    """Minimal stand-in for :class:`WalkForwardResult`."""

    oos_metrics: dict
    folds: list = field(default_factory=list)
    n_days: int = 252

    @property
    def out_of_sample_result(self):
        return _FakeResult(
            metrics=self.oos_metrics,
            daily_returns=_FakeSeries(n=self.n_days),
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


class TestObjectiveScoring:
    def test_penalised_clean_strategy(self):
        """Sharpe 1.0 / low turnover / low DD -> no penalty."""

        obj = _obj()
        wf = _FakeWF(
            oos_metrics={"sharpe": 1.0, "turnover": 2.0, "max_drawdown": 0.10},
            n_days=252,
        )
        score = obj._score_from_result(wf)
        assert score == pytest.approx(1.0)

    def test_penalised_high_turnover(self):
        """turnover_yr = 8.0 -> penalty = 0.05 * (8 - 5) = 0.15."""

        obj = _obj()
        wf = _FakeWF(
            oos_metrics={"sharpe": 1.0, "turnover": 8.0, "max_drawdown": 0.10},
            n_days=252,
        )
        score = obj._score_from_result(wf)
        assert score == pytest.approx(1.0 - 0.15)

    def test_penalised_deep_drawdown(self):
        """MDD = 0.40 -> penalty = 0.5 * (0.40 - 0.30) = 0.05."""

        obj = _obj()
        wf = _FakeWF(
            oos_metrics={"sharpe": 1.0, "turnover": 2.0, "max_drawdown": 0.40},
            n_days=252,
        )
        score = obj._score_from_result(wf)
        assert score == pytest.approx(1.0 - 0.05)

    def test_penalised_both_penalties(self):
        """Combined: turnover_yr=10, MDD=0.50 -> 0.05*5 + 0.5*0.20 = 0.35."""

        obj = _obj()
        wf = _FakeWF(
            oos_metrics={"sharpe": 0.8, "turnover": 10.0, "max_drawdown": 0.50},
            n_days=252,
        )
        score = obj._score_from_result(wf)
        expected = 0.8 - 0.05 * 5 - 0.5 * 0.20
        assert score == pytest.approx(expected)

    def test_sharpe_mode_ignores_penalties(self):
        obj = _obj(scoring="sharpe")
        wf = _FakeWF(
            oos_metrics={"sharpe": 2.0, "turnover": 20.0, "max_drawdown": 0.80},
            n_days=252,
        )
        assert obj._score_from_result(wf) == pytest.approx(2.0)

    def test_nan_sharpe_returns_neg_inf(self):
        obj = _obj()
        wf = _FakeWF(
            oos_metrics={"sharpe": float("nan")},
            n_days=252,
        )
        assert obj._score_from_result(wf) == -math.inf

    def test_turnover_annualisation(self):
        """Half-year backtest with cum turnover 3.0 -> annualised ~ 6.0."""

        obj = _obj()
        wf = _FakeWF(
            oos_metrics={"sharpe": 1.0, "turnover": 3.0, "max_drawdown": 0.05},
            n_days=126,  # half a trading year
        )
        # turnover_yr = 3.0 * 252/126 = 6.0 -> penalty = 0.05 * (6-5) = 0.05
        assert obj._score_from_result(wf) == pytest.approx(1.0 - 0.05)

    def test_failed_backtest_returns_neg_inf(self):
        """If run_walkforward raises, __call__ returns -inf (never propagates)."""

        obj = _obj()

        def boom(params):
            raise RuntimeError("engine failure")

        obj._run_walkforward = boom  # type: ignore[assignment]
        assert obj({"x": 1}) == -math.inf

    def test_invalid_scoring_raises(self):
        with pytest.raises(ValueError):
            _obj(scoring="nonsense")


# --------------------------------------------------------------------------- #
# Runner CLI (argument parsing only; no actual optimisation)                  #
# --------------------------------------------------------------------------- #
class TestRunnerCLI:
    def test_parser_accepts_required_args(self):
        from tuner.runner import build_parser

        parser = build_parser()
        ns = parser.parse_args(
            [
                "--strategy=buy_and_hold_spy",
                "--trials=10",
                "--study-name=s",
                "--start=2020-01-01",
                "--end=2020-03-31",
            ]
        )
        assert ns.strategy == "buy_and_hold_spy"
        assert ns.trials == 10
        assert ns.start == date(2020, 1, 1)
        assert ns.sampler == "tpe"
        assert ns.scoring == "penalised"
