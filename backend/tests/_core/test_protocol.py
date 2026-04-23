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
    """Save-and-restore _REGISTRY so this test doesn't nuke production
    strategy registrations (pead, earnings-options-play, etc.) in a
    full-suite run."""
    saved = dict(_REGISTRY)
    try:
        _REGISTRY.clear()

        @register_strategy(StrategyMeta(name="alpha"))
        class A(DummyStrategy):
            pass

        @register_strategy(StrategyMeta(name="beta"))
        class B(DummyStrategy):
            pass

        names = {m.name for m in list_strategies()}
        assert {"alpha", "beta"}.issubset(names)
    finally:
        _REGISTRY.clear()
        _REGISTRY.update(saved)
