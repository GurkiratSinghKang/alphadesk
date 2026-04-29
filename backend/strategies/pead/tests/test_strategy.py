"""Unit tests for the PEAD strategy on the unified shell.

Covers the spec's correctness gates plus the Task-13/14 migration invariants:

1. **PEADParams** — Task-13 Pydantic model parity with the old DEFAULTS dict
   and tune_space coverage of every tunable field.
2. **SUE computation** — synthetic 8-quarter surprise history, trailing σ
   known, expected SUE computed by hand.
3. **Directional gating** — positive SUE > threshold → long; negative SUE
   < -threshold → short (only when `allow_shorts=True`); |SUE| below
   threshold → no signal.
4. **Time-stop exit** — a position opened on D_entry exits at
   D_entry + holding_days via MOC.
5. **Overlapping earnings filter** — a name with another earnings date
   inside the holding window is skipped.
6. **Liquidity filter** — low-volume names are dropped before emitting.
7. **Determinism** — identical StrategyInput yields identical StrategyResult.

Tests drive ``strategy.run(input, params)`` directly with a hand-built
:class:`StrategyInput` so they run fast (<1s) and do not touch providers.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Iterable

import numpy as np
import pandas as pd
import pytest
from pydantic import ValidationError

from strategies._core.contracts import (
    OrderType,
    Position,
    StrategyInput,
    TimeInForce,
)
from strategies.pead.config import PEADParams, UNIVERSE_SEED
from strategies.pead.helpers import (
    compute_sue,
    has_overlapping_earnings,
    passes_liquidity,
    trading_days_between,
)
from strategies.pead.strategy import PEADStrategy


# --------------------------------------------------------------------------- #
# PEADParams (Task 13 — Pydantic v2 params model)                             #
# --------------------------------------------------------------------------- #
# The defaults below are the byte-for-byte copy of the historical
# ``DEFAULTS`` dict that lived in ``config.py`` before Task 13. Kept here
# as the reference source-of-truth so ``test_pead_params_defaults_match_old_DEFAULTS``
# catches any drift between the old dict and the new Pydantic model.
_OLD_DEFAULTS: dict = {
    "sue_threshold": 1.5,
    "holding_days": 40,
    "sue_lookback_quarters": 8,
    "max_concurrent_positions": 10,
    "allocation_per_position": 0.05,
    "allow_shorts": True,
    "universe_min_mcap_bn": 5,
    "sue_universe_rank_top_pct": 1.0,
    "adv_usd_min": 20_000_000.0,
    "price_min": 10.0,
    "min_quarters_for_sue": 4,
}


class TestPEADParams:
    def test_pead_params_defaults_match_old_DEFAULTS(self):
        """Every default in PEADParams must equal the pre-Task-13 DEFAULTS
        dict byte-for-byte — the Task-16 parity harness relies on this.
        """

        p = PEADParams()
        dumped = p.model_dump()
        # Every key from the old dict must appear in the model dump with
        # the same value and the same type.
        for k, expected in _OLD_DEFAULTS.items():
            assert k in dumped, f"PEADParams missing field {k!r}"
            actual = dumped[k]
            assert actual == expected, (
                f"PEADParams.{k} = {actual!r} but old DEFAULTS had {expected!r}"
            )
            assert type(actual) is type(expected), (
                f"PEADParams.{k} is {type(actual).__name__}, "
                f"old DEFAULTS had {type(expected).__name__}"
            )
        # No new fields snuck in without an equivalent in the old DEFAULTS.
        assert set(dumped) == set(_OLD_DEFAULTS), (
            f"PEADParams / old DEFAULTS key-set drift: "
            f"only-in-model={set(dumped) - set(_OLD_DEFAULTS)}, "
            f"only-in-old={set(_OLD_DEFAULTS) - set(dumped)}"
        )

    def test_pead_params_tune_space_populated(self):
        """Every tunable parameter from the old ``search_space()`` function
        must surface in ``PEADParams.tune_space()``.
        """

        space = PEADParams.tune_space()
        expected_tune_keys = {
            "sue_threshold",
            "holding_days",
            "sue_lookback_quarters",
            "max_concurrent_positions",
            "allocation_per_position",
            "allow_shorts",
            "universe_min_mcap_bn",
            "sue_universe_rank_top_pct",
        }
        assert set(space.keys()) == expected_tune_keys
        # Every descriptor must declare a ``type`` and carry either
        # low/high or a ``choices`` list — the tuner consumes those.
        for name, desc in space.items():
            assert "type" in desc, f"{name}: tune descriptor missing 'type'"
            if desc["type"] in ("float", "int"):
                assert "low" in desc and "high" in desc, (
                    f"{name}: {desc['type']} range missing low/high"
                )
            elif desc["type"] == "categorical":
                assert "choices" in desc and desc["choices"], (
                    f"{name}: categorical descriptor missing choices"
                )

    def test_pead_params_rejects_invalid_values(self):
        """Out-of-bounds or wrongly-typed overrides must fail construction.

        Exercises two distinct validators: ``sue_threshold`` (>0) and
        ``allocation_per_position`` (0<x<=1). Pydantic v2 surfaces these
        as ``ValidationError``.
        """

        # Non-positive SUE threshold.
        with pytest.raises(ValidationError):
            PEADParams(sue_threshold=-1.0)
        with pytest.raises(ValidationError):
            PEADParams(sue_threshold=0.0)
        # Out-of-range allocation.
        with pytest.raises(ValidationError):
            PEADParams(allocation_per_position=0.0)
        with pytest.raises(ValidationError):
            PEADParams(allocation_per_position=1.5)
        # Holding days must be positive.
        with pytest.raises(ValidationError):
            PEADParams(holding_days=0)
        # Unknown field — extra="forbid" rejects typos.
        with pytest.raises(ValidationError):
            PEADParams(no_such_field=42)


# --------------------------------------------------------------------------- #
# Fixtures                                                                    #
# --------------------------------------------------------------------------- #
def _synthetic_history(
    symbol: str,
    n: int = 12,
    base_date: date = date(2022, 1, 1),
    surprise_sigma: float = 0.05,
) -> list[dict]:
    """Generate ``n`` quarterly surprise rows with known trailing σ.

    Surprises alternate ±surprise_sigma so that the last-8 std is
    approximately ``surprise_sigma``. Returns rows with keys
    ``symbol``, ``date``, ``eps_actual``, ``eps_estimated``, ``surprise``.
    """

    rows = []
    for i in range(n):
        d = base_date + timedelta(days=90 * i)
        est = 1.00
        delta = surprise_sigma * (1 if i % 2 == 0 else -1)
        actual = est + delta
        rows.append(
            {
                "symbol": symbol,
                "date": d,
                "eps_actual": actual,
                "eps_estimated": est,
                "surprise": delta,
            }
        )
    return rows


def _bars_frame(
    symbols: Iterable[str],
    start: date,
    end: date,
    price: float = 100.0,
    volume: float = 5_000_000.0,
) -> pd.DataFrame:
    """Build a multi-index OHLCV DataFrame keyed on (date, symbol).

    This matches the shape that :class:`BarProvider.fetch_window` emits,
    which is what ``strategy._symbol_bars`` expects in the new shell.
    """

    idx = pd.bdate_range(start=start, end=end)
    rows = []
    for sym in symbols:
        for ts in idx:
            rows.append(
                {
                    "date": ts.date(),
                    "symbol": sym.upper(),
                    "open": price,
                    "high": price * 1.01,
                    "low": price * 0.99,
                    "close": price,
                    "volume": volume,
                }
            )
    df = pd.DataFrame(rows).set_index(["date", "symbol"]).sort_index()
    return df


def _earnings_frame(
    rows: list[dict],
    surprise_histories: dict[str, list[dict]] | None = None,
) -> pd.DataFrame:
    """Build a single DataFrame combining current-announcement rows
    (``rows``) with per-symbol historical surprise rows.

    The new shell uses a single pre-fetched earnings window rather than a
    separate calendar + per-symbol surprise fetch, so both live in one
    DataFrame keyed on (symbol, date).
    """

    all_rows: list[dict] = list(rows)
    if surprise_histories:
        for sym, hist in surprise_histories.items():
            # Add the symbol column to each row for the single-frame layout.
            for r in hist:
                r2 = dict(r)
                r2.setdefault("symbol", sym)
                all_rows.append(r2)
    if not all_rows:
        return pd.DataFrame(
            columns=[
                "symbol", "date", "eps_actual", "eps_estimated", "surprise",
                "revenue_actual", "revenue_estimated",
            ]
        )
    df = pd.DataFrame(all_rows)
    df["symbol"] = df["symbol"].astype(str).str.upper()
    return df.sort_values(["symbol", "date"], ignore_index=True)


def _make_input(
    asof: date,
    *,
    bars: pd.DataFrame | None = None,
    earnings: pd.DataFrame | None = None,
    positions: list[Position] | None = None,
    state: dict | None = None,
    cash: Decimal = Decimal("100000"),
    seed: int = 0,
) -> StrategyInput:
    return StrategyInput(
        asof=asof,
        mode="backtest",
        bars=bars if bars is not None else pd.DataFrame(),
        earnings=earnings,
        fundamentals=None,
        cash=cash,
        equity=cash,
        positions=list(positions or []),
        state=dict(state or {}),
        seed=seed,
        rng=np.random.default_rng(seed),
    )


# --------------------------------------------------------------------------- #
# Registration                                                                #
# --------------------------------------------------------------------------- #
class TestRegistration:
    def test_strategy_registered_with_new_meta(self):
        """Task-14 rewrite: registration goes via _core.protocol.register_strategy."""

        from strategies._core.protocol import get_strategy, get_meta

        cls = get_strategy("pead")
        assert cls is PEADStrategy
        meta = get_meta("pead")
        assert meta is not None
        assert meta.category == "equity"
        assert meta.lookback_days == 1100
        assert meta.required_bars == ("daily",)
        assert meta.min_universe_size == 10

    def test_params_model_attached(self):
        assert PEADStrategy.PARAMS_MODEL is PEADParams


# --------------------------------------------------------------------------- #
# SUE computation (pure helper — unchanged)                                    #
# --------------------------------------------------------------------------- #
class TestSUEMath:
    def test_sue_computation_matches_hand_calc(self):
        """Given 8 historical surprises ±0.05 alternating, trailing σ should
        equal the sample std of those surprises. A current +0.10 surprise
        (twice the typical magnitude) should yield SUE ≈ 0.10 / σ."""

        history_rows = _synthetic_history(
            "AAPL",
            n=8,
            base_date=date(2020, 1, 1),
            surprise_sigma=0.05,
        )
        history = pd.DataFrame(history_rows)
        history["surprise"] = history["eps_actual"] - history["eps_estimated"]

        # Expected trailing σ of the 8 historical surprises.
        expected_sigma = float(history["surprise"].std(ddof=1))
        assert expected_sigma > 0

        # Now compute SUE for a new announcement with +0.10 surprise.
        current_actual = 1.10
        current_est = 1.00
        asof = date(2022, 1, 1)

        sue = compute_sue(
            current_actual,
            current_est,
            history,
            asof,
            lookback_quarters=8,
            min_quarters=4,
        )
        assert sue is not None
        expected_sue = 0.10 / expected_sigma
        assert sue == pytest.approx(expected_sue, rel=1e-6)

    def test_sue_requires_min_quarters(self):
        """With only 2 historical quarters and min_quarters=4, SUE is None."""

        history = pd.DataFrame(
            [
                {"date": date(2021, 1, 1), "eps_actual": 1.0,
                 "eps_estimated": 1.0, "surprise": 0.0},
                {"date": date(2021, 4, 1), "eps_actual": 1.05,
                 "eps_estimated": 1.0, "surprise": 0.05},
            ]
        )
        sue = compute_sue(
            1.1, 1.0, history, date(2022, 1, 1),
            lookback_quarters=8, min_quarters=4,
        )
        assert sue is None

    def test_sue_returns_none_on_zero_sigma(self):
        """All-equal past surprises → σ == 0 → SUE undefined."""

        history = pd.DataFrame(
            [
                {"date": date(2020, 1, 1) + timedelta(days=90 * i),
                 "eps_actual": 1.0, "eps_estimated": 1.0, "surprise": 0.0}
                for i in range(8)
            ]
        )
        sue = compute_sue(
            1.1, 1.0, history, date(2022, 1, 1),
            lookback_quarters=8, min_quarters=4,
        )
        assert sue is None

    def test_sue_returns_none_when_actual_or_estimated_missing(self):
        hist = pd.DataFrame(_synthetic_history("X", n=8, surprise_sigma=0.05))
        hist["surprise"] = hist["eps_actual"] - hist["eps_estimated"]
        assert compute_sue(None, 1.0, hist, date(2022, 1, 1), 8, 4) is None
        assert compute_sue(1.1, None, hist, date(2022, 1, 1), 8, 4) is None


# --------------------------------------------------------------------------- #
# Direction gating                                                            #
# --------------------------------------------------------------------------- #
class TestDirectionGating:
    @staticmethod
    def _fixture(sue_delta: float, allow_shorts: bool):
        """Build a StrategyInput with AAPL reporting yesterday with a
        known positive or negative SUE.

        ``sue_delta`` is the surprise magnitude; typical σ is 0.05 so a
        delta of ±0.10 gives SUE ≈ ±2.0 (well above the 1.5 threshold).
        """

        asof = date(2022, 4, 15)           # Friday
        announce_day = asof - timedelta(days=1)  # Thursday (AMC)

        # 8 historical quarters of ±0.05 surprises → σ ≈ 0.0535.
        hist = _synthetic_history(
            "AAPL", n=8, base_date=date(2020, 1, 1), surprise_sigma=0.05,
        )
        est = 1.00
        actual = est + sue_delta
        cur = [
            {
                "symbol": "AAPL",
                "date": announce_day,
                "eps_actual": actual,
                "eps_estimated": est,
                "surprise": sue_delta,
                "revenue_actual": 100.0,
                "revenue_estimated": 100.0,
            }
        ]
        bar_start = asof - timedelta(days=200)
        bar_end = asof + timedelta(days=60)
        bars = _bars_frame(
            ["AAPL"], bar_start, bar_end, price=100.0, volume=5_000_000.0,
        )
        earnings = _earnings_frame(cur, {"AAPL": hist})

        params = PEADParams(
            sue_threshold=1.5,
            allow_shorts=allow_shorts,
            holding_days=40,
            max_concurrent_positions=10,
            allocation_per_position=0.05,
            sue_lookback_quarters=8,
            min_quarters_for_sue=4,
            sue_universe_rank_top_pct=1.0,
        )
        strat = PEADStrategy()
        inp = _make_input(asof, bars=bars, earnings=earnings)
        return strat, inp, params, asof

    def test_positive_sue_emits_long(self):
        strat, inp, params, asof = self._fixture(
            sue_delta=+0.10, allow_shorts=True,
        )
        result = strat.run(inp, params)
        entries = [s for s in result.signals if s.order_type == OrderType.MOO]
        assert len(entries) == 1
        s = entries[0]
        assert s.symbol == "AAPL"
        assert s.target_weight > 0
        assert s.target_weight == pytest.approx(0.05)
        assert "long" in s.tag

    def test_negative_sue_emits_short_when_allowed(self):
        strat, inp, params, asof = self._fixture(
            sue_delta=-0.10, allow_shorts=True,
        )
        result = strat.run(inp, params)
        entries = [s for s in result.signals if s.order_type == OrderType.MOO]
        assert len(entries) == 1
        s = entries[0]
        assert s.symbol == "AAPL"
        assert s.target_weight < 0
        assert s.target_weight == pytest.approx(-0.05)
        assert "short" in s.tag

    def test_negative_sue_skipped_when_shorts_disabled(self):
        strat, inp, params, asof = self._fixture(
            sue_delta=-0.10, allow_shorts=False,
        )
        result = strat.run(inp, params)
        entries = [s for s in result.signals if s.order_type == OrderType.MOO]
        assert entries == []

    def test_small_sue_does_not_emit(self):
        # 8 historical quarters of ±0.05 → σ ≈ 0.0535. A +0.02 surprise
        # yields SUE ≈ 0.37, well below the 1.5 threshold → no signal.
        strat, inp, params, asof = self._fixture(
            sue_delta=+0.02, allow_shorts=True,
        )
        result = strat.run(inp, params)
        entries = [s for s in result.signals if s.order_type == OrderType.MOO]
        assert entries == []


class TestAnnouncementTiming:
    def test_amc_prior_session_and_bmo_same_session_are_actionable(self):
        asof = date(2023, 4, 14)
        prior = asof - timedelta(days=1)
        calendar = pd.DataFrame([
            {"symbol": "AAPL", "date": prior, "announcement_when": "amc", "eps_actual": 1.2, "eps_estimated": 1.0},
            {"symbol": "MSFT", "date": asof, "announcement_when": "bmo", "eps_actual": 1.2, "eps_estimated": 1.0},
            {"symbol": "NVDA", "date": prior, "announcement_when": "unknown", "eps_actual": 1.2, "eps_estimated": 1.0},
        ])
        ann = PEADStrategy._yesterday_announcements(calendar, asof)
        assert set(ann["symbol"]) == {"AAPL", "MSFT", "NVDA"}

    def test_bmo_prior_session_is_not_reentered_late(self):
        asof = date(2023, 4, 14)
        prior = asof - timedelta(days=1)
        calendar = pd.DataFrame([
            {"symbol": "MSFT", "date": prior, "announcement_when": "bmo", "eps_actual": 1.2, "eps_estimated": 1.0},
        ])
        ann = PEADStrategy._yesterday_announcements(calendar, asof)
        assert ann.empty


# --------------------------------------------------------------------------- #
# Time-stop exit                                                              #
# --------------------------------------------------------------------------- #
class TestTimeStopExit:
    def test_40_day_time_stop_emits_moc_exit(self):
        """A position with entry_date = 40 business days ago should be
        exited today via MOC."""

        holding_days = 40
        today = date(2023, 5, 15)
        entry = pd.bdate_range(
            end=pd.Timestamp(today), periods=holding_days + 1,
        )[0].date()

        pos = Position(
            symbol="AAPL",
            quantity=100,
            avg_entry_price=Decimal("150"),
            entry_date=entry,
        )
        params = PEADParams(holding_days=holding_days)
        strat = PEADStrategy()
        # No earnings on this bar; only exits should fire.
        inp = _make_input(
            today, bars=pd.DataFrame(), earnings=None, positions=[pos],
        )
        result = strat.run(inp, params)
        exits = [s for s in result.signals if s.order_type == OrderType.MOC]
        assert len(exits) == 1
        assert exits[0].symbol == "AAPL"
        assert exits[0].target_weight == 0.0
        assert "time" in exits[0].tag

    def test_short_holding_period_no_exit(self):
        """Position just opened; 1-day hold well under holding_days=40."""

        today = date(2023, 5, 15)
        entry = today - timedelta(days=1)

        pos = Position(
            symbol="AAPL",
            quantity=100,
            avg_entry_price=Decimal("150"),
            entry_date=entry,
        )
        params = PEADParams(holding_days=40)
        strat = PEADStrategy()
        inp = _make_input(
            today, bars=pd.DataFrame(), earnings=None, positions=[pos],
        )
        result = strat.run(inp, params)
        exits = [s for s in result.signals if s.order_type == OrderType.MOC]
        assert exits == []


# --------------------------------------------------------------------------- #
# Overlapping-earnings filter (pure helper — unchanged)                       #
# --------------------------------------------------------------------------- #
class TestOverlappingEarnings:
    def test_has_overlapping_earnings_inside_horizon(self):
        cal = pd.DataFrame(
            [
                {"symbol": "AAPL", "date": date(2023, 6, 1)},
                {"symbol": "AAPL", "date": date(2023, 7, 15)},  # inside 40-day horizon
            ]
        )
        assert has_overlapping_earnings(cal, "AAPL", date(2023, 6, 1), 40) is True

    def test_has_overlapping_earnings_outside_horizon(self):
        cal = pd.DataFrame(
            [
                {"symbol": "AAPL", "date": date(2023, 6, 1)},
                {"symbol": "AAPL", "date": date(2024, 1, 1)},  # well outside 40-day
            ]
        )
        assert has_overlapping_earnings(cal, "AAPL", date(2023, 6, 1), 40) is False

    def test_signal_skipped_when_earnings_overlap(self):
        """A name with another earnings inside the holding window is
        silently dropped from entries."""

        asof = date(2023, 6, 15)            # Thursday
        announce_day = asof - timedelta(days=1)

        hist = _synthetic_history(
            "AAPL", n=8, base_date=date(2021, 1, 1), surprise_sigma=0.05,
        )
        # AAPL's current announcement + an overlapping announcement 20
        # days out → should be skipped.
        rows = [
            {
                "symbol": "AAPL",
                "date": announce_day,
                "eps_actual": 1.10,
                "eps_estimated": 1.00,
                "surprise": 0.10,
                "revenue_actual": 100.0,
                "revenue_estimated": 100.0,
            },
            {
                "symbol": "AAPL",
                "date": asof + timedelta(days=20),
                "eps_actual": None,  # future announcement
                "eps_estimated": None,
                "surprise": None,
                "revenue_actual": None,
                "revenue_estimated": None,
            },
        ]
        bars = _bars_frame(
            ["AAPL"], asof - timedelta(days=200),
            asof + timedelta(days=60),
            price=100.0, volume=5_000_000.0,
        )
        earnings = _earnings_frame(rows, {"AAPL": hist})

        params = PEADParams(
            sue_threshold=1.5,
            holding_days=40,
            allow_shorts=False,
            sue_lookback_quarters=8,
            sue_universe_rank_top_pct=1.0,
        )
        strat = PEADStrategy()
        inp = _make_input(asof, bars=bars, earnings=earnings)
        result = strat.run(inp, params)
        entries = [s for s in result.signals if s.order_type == OrderType.MOO]
        assert entries == []


# --------------------------------------------------------------------------- #
# End-to-end integration                                                      #
# --------------------------------------------------------------------------- #
class TestRunIntegration:
    def test_end_to_end_two_names(self):
        """Full run(): two names reporting yesterday — AAPL with a big SUE,
        MSFT with a tiny SUE below threshold — only AAPL enters."""

        asof = date(2023, 4, 14)             # Friday
        announce_day = asof - timedelta(days=1)

        aapl_hist = _synthetic_history(
            "AAPL", n=8, base_date=date(2021, 1, 1), surprise_sigma=0.05,
        )
        msft_hist = _synthetic_history(
            "MSFT", n=8, base_date=date(2021, 1, 1), surprise_sigma=0.05,
        )
        rows = [
            {
                "symbol": "AAPL",
                "date": announce_day,
                "eps_actual": 1.10,  # +0.10 surprise → SUE ~= 1.87
                "eps_estimated": 1.00,
                "surprise": 0.10,
                "revenue_actual": 100.0,
                "revenue_estimated": 100.0,
            },
            {
                "symbol": "MSFT",
                "date": announce_day,
                "eps_actual": 1.01,  # +0.01 surprise → SUE ~= 0.19 (below)
                "eps_estimated": 1.00,
                "surprise": 0.01,
                "revenue_actual": 100.0,
                "revenue_estimated": 100.0,
            },
        ]
        bars = _bars_frame(
            ["AAPL", "MSFT"], asof - timedelta(days=200),
            asof + timedelta(days=60),
            price=100.0, volume=5_000_000.0,
        )
        earnings = _earnings_frame(
            rows, {"AAPL": aapl_hist, "MSFT": msft_hist},
        )
        params = PEADParams(
            sue_threshold=1.5,
            holding_days=40,
            allow_shorts=True,
            max_concurrent_positions=10,
            allocation_per_position=0.05,
            sue_lookback_quarters=8,
            min_quarters_for_sue=4,
            sue_universe_rank_top_pct=1.0,
        )
        strat = PEADStrategy()
        inp = _make_input(asof, bars=bars, earnings=earnings)
        result = strat.run(inp, params)
        entries = [s for s in result.signals if s.order_type == OrderType.MOO]
        syms = [s.symbol for s in entries]
        assert "AAPL" in syms
        assert "MSFT" not in syms
        assert len(entries) == 1
        assert entries[0].order_type == OrderType.MOO

    def test_liquidity_filter_blocks_illiquid_names(self):
        """A stock with low dollar volume (below the 20M ADV floor) is
        skipped at the entry stage even with a large SUE."""

        asof = date(2023, 4, 14)             # Friday
        announce_day = asof - timedelta(days=1)

        hist = _synthetic_history(
            "AAPL", n=8, base_date=date(2021, 1, 1), surprise_sigma=0.05,
        )
        rows = [
            {
                "symbol": "AAPL",
                "date": announce_day,
                "eps_actual": 1.20,  # very large surprise
                "eps_estimated": 1.00,
                "surprise": 0.20,
                "revenue_actual": 100.0,
                "revenue_estimated": 100.0,
            },
        ]
        # Low volume: 10 * 10_000 = $100k dollar-vol → below 20M floor.
        bars = _bars_frame(
            ["AAPL"], asof - timedelta(days=200),
            asof + timedelta(days=60),
            price=10.0, volume=10_000.0,
        )
        earnings = _earnings_frame(rows, {"AAPL": hist})
        params = PEADParams(
            sue_threshold=1.5,
            holding_days=40,
            allow_shorts=True,
            adv_usd_min=20_000_000.0,
            price_min=10.0,
            sue_universe_rank_top_pct=1.0,
        )
        strat = PEADStrategy()
        inp = _make_input(asof, bars=bars, earnings=earnings)
        result = strat.run(inp, params)
        entries = [s for s in result.signals if s.order_type == OrderType.MOO]
        assert entries == []


# --------------------------------------------------------------------------- #
# Trading-days helper (pure helper — unchanged)                               #
# --------------------------------------------------------------------------- #
class TestTradingDaysBetween:
    def test_forty_business_days(self):
        today = date(2023, 5, 15)
        entry = pd.bdate_range(end=pd.Timestamp(today), periods=41)[0].date()
        assert trading_days_between(entry, today) == 40

    def test_same_day_returns_zero(self):
        d = date(2023, 1, 2)
        assert trading_days_between(d, d) == 0

    def test_accepts_datetime(self):
        dt = datetime(2023, 1, 2)
        end = date(2023, 1, 4)
        assert trading_days_between(dt, end) == 2


# --------------------------------------------------------------------------- #
# New-shell Task-14 tests                                                     #
# --------------------------------------------------------------------------- #
class TestPEADRunShell:
    def test_pead_run_emits_signals_on_positive_surprise(self):
        """A synthetic StrategyInput with NVDA +10% surprise should produce
        at least one buy signal on the new run() API.
        """

        asof = date(2023, 5, 25)  # Thursday
        announce_day = asof - timedelta(days=1)

        hist = _synthetic_history(
            "NVDA", n=8, base_date=date(2021, 1, 1), surprise_sigma=0.05,
        )
        rows = [
            {
                "symbol": "NVDA",
                "date": announce_day,
                "eps_actual": 1.10,   # +0.10 surprise → SUE well above 1.5
                "eps_estimated": 1.00,
                "surprise": 0.10,
                "revenue_actual": 100.0,
                "revenue_estimated": 100.0,
            }
        ]
        bars = _bars_frame(
            ["NVDA"], asof - timedelta(days=200),
            asof + timedelta(days=60),
            price=400.0, volume=10_000_000.0,
        )
        earnings = _earnings_frame(rows, {"NVDA": hist})

        params = PEADParams()
        strat = PEADStrategy()
        inp = _make_input(asof, bars=bars, earnings=earnings)
        result = strat.run(inp, params)

        buys = [
            s for s in result.signals
            if s.order_type == OrderType.MOO
            and s.target_weight is not None
            and s.target_weight > 0
        ]
        assert len(buys) >= 1, (
            f"Expected at least one buy signal on NVDA +10% surprise, "
            f"got result.signals={result.signals}, "
            f"diagnostics={result.diagnostics}"
        )
        assert any(s.symbol == "NVDA" for s in buys)

    def test_pead_run_deterministic_on_identical_input(self):
        """Two identical run() invocations on identical StrategyInput must
        return bitwise-identical Signal lists. Hard contract for the
        replay guarantee.
        """

        asof = date(2023, 5, 25)  # Thursday
        announce_day = asof - timedelta(days=1)

        hist = _synthetic_history(
            "NVDA", n=8, base_date=date(2021, 1, 1), surprise_sigma=0.05,
        )
        rows = [
            {
                "symbol": "NVDA",
                "date": announce_day,
                "eps_actual": 1.10,
                "eps_estimated": 1.00,
                "surprise": 0.10,
                "revenue_actual": 100.0,
                "revenue_estimated": 100.0,
            }
        ]
        bars = _bars_frame(
            ["NVDA"], asof - timedelta(days=200),
            asof + timedelta(days=60),
            price=400.0, volume=10_000_000.0,
        )
        earnings = _earnings_frame(rows, {"NVDA": hist})
        params = PEADParams()

        strat1 = PEADStrategy()
        strat2 = PEADStrategy()
        inp1 = _make_input(asof, bars=bars, earnings=earnings, seed=42)
        inp2 = _make_input(asof, bars=bars, earnings=earnings, seed=42)

        r1 = strat1.run(inp1, params)
        r2 = strat2.run(inp2, params)

        # Signal equality is structural (same fields → equal Pydantic
        # models) so this catches any nondeterministic tag formatting,
        # ordering, or weight drift.
        assert r1.signals == r2.signals, (
            f"Nondeterministic run: r1.signals={r1.signals}, "
            f"r2.signals={r2.signals}"
        )
