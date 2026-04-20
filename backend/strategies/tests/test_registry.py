"""Unit tests for the strategy registry + base protocol.

Covers:

- :func:`register_strategy` populates the registry with correct metadata.
- :func:`get_strategy` / :func:`list_strategies` return the expected values.
- Double-registration raises :class:`StrategyRegistrationError`.
- Idempotent re-registration of the *same* class is a no-op.
- :func:`load_all` walks subpackages and skips broken ones without failing.
- The bundled ``buy_and_hold_spy`` smoke strategy registers end-to-end.
"""

from __future__ import annotations

import pytest

from strategies.base import (
    Strategy,
    StrategyMeta,
    cache_of,
    calendar_of,
)
from strategies.registry import (
    StrategyRegistrationError,
    get_meta,
    get_strategy,
    list_names,
    list_strategies,
    load_all,
    register_strategy,
)
from strategies.signal import OptionLeg, OrderType, Signal


# --------------------------------------------------------------------------- #
# Small sample strategies used across tests                                   #
# --------------------------------------------------------------------------- #
def _make_dummy_strategy(strategy_name: str):
    """Build a minimal strategy class on the fly."""

    @register_strategy(
        name=strategy_name,
        category="equity",
        required_bars=("daily",),
        required_lookback_days=30,
        description=f"dummy {strategy_name}",
    )
    class _Dummy:
        name = strategy_name
        required_bars = ["daily"]
        required_lookback_days = 30

        def configure(self, params):
            self.params = dict(params)

        def universe(self, asof, ctx):
            return ["AAPL"]

        def generate_signals(self, asof, ctx):
            return []

        def manage(self, asof, ctx):
            return []

        def on_fill(self, fill, ctx):
            pass

    return _Dummy


# --------------------------------------------------------------------------- #
# register + get + list                                                       #
# --------------------------------------------------------------------------- #
class TestRegistration:
    def test_decorator_populates_registry(self, fresh_registry):
        cls = _make_dummy_strategy("widget_a")
        assert get_strategy("widget_a") is cls
        meta = get_meta("widget_a")
        assert isinstance(meta, StrategyMeta)
        assert meta.name == "widget_a"
        assert meta.category == "equity"
        assert meta.required_bars == ("daily",)
        assert meta.required_lookback_days == 30
        assert meta.description == "dummy widget_a"

    def test_name_defaults_to_class_attr(self, fresh_registry):
        @register_strategy()
        class _Z:
            name = "implicit_z"
            required_bars = ["daily"]
            required_lookback_days = 10

            def configure(self, params): ...

            def universe(self, asof, ctx): return []

            def generate_signals(self, asof, ctx): return []

            def manage(self, asof, ctx): return []

            def on_fill(self, fill, ctx): ...

        assert get_strategy("implicit_z") is _Z

    def test_missing_name_raises(self, fresh_registry):
        with pytest.raises(StrategyRegistrationError):
            @register_strategy()
            class _NoName:  # noqa: D401 - intentionally nameless
                required_bars = ["daily"]
                required_lookback_days = 1

                def configure(self, params): ...

                def universe(self, asof, ctx): return []

                def generate_signals(self, asof, ctx): return []

                def manage(self, asof, ctx): return []

                def on_fill(self, fill, ctx): ...

    def test_missing_method_raises(self, fresh_registry):
        with pytest.raises(StrategyRegistrationError, match="missing required"):
            @register_strategy(name="incomplete")
            class _Incomplete:  # missing generate_signals / manage
                name = "incomplete"
                required_bars = ["daily"]
                required_lookback_days = 1

                def configure(self, params): ...

                def universe(self, asof, ctx): return []

    def test_duplicate_name_raises(self, fresh_registry):
        _make_dummy_strategy("widget_dup")
        with pytest.raises(StrategyRegistrationError, match="already registered"):
            _make_dummy_strategy("widget_dup")

    def test_idempotent_same_class(self, fresh_registry):
        """Importing the same module twice must not raise."""

        from strategies.registry import _STRATEGY_CLASSES, register_strategy

        class _Foo:
            name = "idempotent"
            required_bars = ["daily"]
            required_lookback_days = 1

            def configure(self, p): ...

            def universe(self, a, c): return []

            def generate_signals(self, a, c): return []

            def manage(self, a, c): return []

            def on_fill(self, f, c): ...

        wrapped = register_strategy(name="idempotent")(_Foo)
        register_strategy(name="idempotent")(_Foo)  # second pass = no-op
        assert _STRATEGY_CLASSES["idempotent"] is wrapped


class TestListing:
    def test_list_strategies_returns_meta(self, fresh_registry):
        _make_dummy_strategy("widget_b")
        _make_dummy_strategy("widget_a")
        metas = list_strategies()
        assert [m.name for m in metas] == ["widget_a", "widget_b"]
        assert all(isinstance(m, StrategyMeta) for m in metas)

    def test_list_names(self, fresh_registry):
        _make_dummy_strategy("alpha")
        _make_dummy_strategy("beta")
        assert list_names() == ["alpha", "beta"]

    def test_unknown_raises(self, fresh_registry):
        with pytest.raises(KeyError):
            get_strategy("no_such_strategy")
        with pytest.raises(KeyError):
            get_meta("no_such_strategy")


# --------------------------------------------------------------------------- #
# load_all                                                                    #
# --------------------------------------------------------------------------- #
class TestLoadAll:
    def test_discovers_buy_and_hold_spy(self, fresh_registry):
        loaded = load_all()
        assert any("_smoke.buy_and_hold_spy" in name for name in loaded)
        names = [m.name for m in list_strategies()]
        assert "buy_and_hold_spy" in names

    def test_broken_package_does_not_break_load(self, fresh_registry, tmp_path, monkeypatch):
        """A subpackage that raises on import must be logged and skipped."""

        # Build a temporary package tree with two modules: one good, one broken.
        pkg_root = tmp_path / "fake_strategies"
        pkg_root.mkdir()
        (pkg_root / "__init__.py").write_text("\n")

        good_dir = pkg_root / "good"
        good_dir.mkdir()
        (good_dir / "__init__.py").write_text(
            "from strategies.registry import register_strategy\n"
            "@register_strategy(name='good_strategy')\n"
            "class _Good:\n"
            "    name = 'good_strategy'\n"
            "    required_bars = ['daily']\n"
            "    required_lookback_days = 1\n"
            "    def configure(self, p): ...\n"
            "    def universe(self, a, c): return []\n"
            "    def generate_signals(self, a, c): return []\n"
            "    def manage(self, a, c): return []\n"
            "    def on_fill(self, f, c): ...\n"
        )

        bad_dir = pkg_root / "bad"
        bad_dir.mkdir()
        (bad_dir / "__init__.py").write_text(
            "raise RuntimeError('intentional import failure')\n"
        )

        import sys as _sys

        monkeypatch.syspath_prepend(str(tmp_path))
        # Drop any caches so importlib re-executes the modules.
        for mod in list(_sys.modules):
            if mod.startswith("fake_strategies"):
                del _sys.modules[mod]

        loaded = load_all("fake_strategies")
        assert "fake_strategies.good" in loaded
        assert "fake_strategies.bad" not in loaded
        assert "good_strategy" in list_names()


# --------------------------------------------------------------------------- #
# Protocol / dataclass surface                                                #
# --------------------------------------------------------------------------- #
class TestSurface:
    def test_protocol_is_runtime_checkable(self, fresh_registry):
        cls = _make_dummy_strategy("shape_check")
        instance = cls()
        assert isinstance(instance, Strategy)

    def test_signal_importable_from_both_places(self):
        from backtest.types import Signal as EngineSignal
        from strategies.signal import Signal as StratSignal

        assert StratSignal is EngineSignal

    def test_option_leg_importable(self):
        from backtest.types import OptionLeg as EngineLeg
        from strategies.signal import OptionLeg as StratLeg

        assert StratLeg is EngineLeg

    def test_order_type_enum_exposed(self):
        assert OrderType.MOO.value == "market_on_open"
        assert OrderType.MOC.value == "market_on_close"

    def test_signal_construction(self):
        s = Signal(symbol="SPY", target_weight=1.0, order_type=OrderType.MOO)
        assert s.symbol == "SPY"
        assert s.target_weight == 1.0
        assert s.order_type is OrderType.MOO

    def test_cache_of_reads_state_field(self):
        from backtest.types import Context

        ctx = Context(asof=None, cash=None, equity=None)  # type: ignore[arg-type]
        cache = cache_of(ctx)
        cache["foo"] = 1
        assert ctx.state["foo"] == 1  # proves it's the same dict

    def test_calendar_of_fallback(self):
        from backtest.types import Context

        class _Cal:
            pass

        cal = _Cal()
        ctx = Context(asof=None, cash=None, equity=None, calendar_provider=cal)  # type: ignore[arg-type]
        assert calendar_of(ctx) is cal


# --------------------------------------------------------------------------- #
# Smoke strategy                                                              #
# --------------------------------------------------------------------------- #
class TestSmokeStrategy:
    def test_registers_and_generates_signal_once(self, fresh_registry):
        # load_all discovers the smoke strategy package
        load_all()
        cls = get_strategy("buy_and_hold_spy")

        instance = cls()
        instance.configure({})

        from backtest.types import Context
        from decimal import Decimal
        from datetime import date as _date

        ctx = Context(
            asof=_date(2020, 1, 2),
            cash=Decimal("100000"),
            equity=Decimal("100000"),
        )

        # First call emits exactly one Signal with target_weight=1.0
        sigs = list(instance.generate_signals(_date(2020, 1, 2), ctx))
        assert len(sigs) == 1
        sig = sigs[0]
        assert sig.symbol == "SPY"
        assert sig.target_weight == 1.0

        # Second call is idempotent (state cached in ctx.state)
        sigs2 = list(instance.generate_signals(_date(2020, 1, 3), ctx))
        assert sigs2 == []

    def test_search_space_is_empty(self, fresh_registry):
        load_all()
        cls = get_strategy("buy_and_hold_spy")
        assert cls.search_space() == {}
