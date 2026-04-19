"""Dollar-neutrality sizing test for the pairs_trading strategy.

Wave 2 switched the spread/z-score/OLS path to log-prices, making
``beta`` a log-elasticity (dimensionless, ~1 for cointegrated sibling
tickers) rather than a dollar-space hedge ratio. The CRITICAL question
this test answers: does downstream sizing still treat ``beta`` like a
share-count hedge ratio? If so, pairing a $400 stock with a $40 stock
would leave the book materially under-hedged (10:1 dollar imbalance).

The strategy emits ``Signal(target_weight=±pair_weight)`` for each leg.
``target_weight`` is a fraction of portfolio equity (see
``backend/strategies/signal.py``), so the two-leg dollar notionals are
``±pair_weight * equity`` by construction, independent of per-share
price. This test pins that property for a deliberately extreme price
asymmetry so any regression (e.g. a future refactor multiplying one leg
by ``beta_log``) trips it immediately.
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import numpy as np
import pandas as pd
import pytest

from backtest.types import Context
from strategies.pairs_trading.config import UNIVERSE
from strategies.pairs_trading.strategy import (
    ActivePair,
    PairsTradingStrategy,
)


class SyntheticBarProvider:
    """Wide->long flattener so strategy._fetch_close_matrix works."""

    def __init__(self, closes: pd.DataFrame) -> None:
        self._closes = closes.sort_index()

    def bars(self, symbols, start, end, tf: str = "1D") -> pd.DataFrame:
        syms = [s.upper() for s in symbols]
        mask = (self._closes.index >= pd.Timestamp(start)) & (
            self._closes.index
            <= pd.Timestamp(end) + pd.Timedelta(hours=23, minutes=59)
        )
        sub = self._closes.loc[mask, [s for s in syms if s in self._closes.columns]]
        rows: list[dict] = []
        for ts, row in sub.iterrows():
            for sym in sub.columns:
                px = row[sym]
                if pd.isna(px):
                    continue
                rows.append({
                    "symbol": sym,
                    "timestamp": ts,
                    "open": float(px),
                    "high": float(px),
                    "low": float(px),
                    "close": float(px),
                    "volume": 1_000_000,
                })
        return pd.DataFrame(rows)


def _build_context(
    asof: date, bar_provider: SyntheticBarProvider, state: dict | None = None
) -> Context:
    return Context(
        asof=asof,
        cash=Decimal("100000"),
        equity=Decimal("100000"),
        positions=[],
        bar_provider=bar_provider,
        state=state if state is not None else {},
    )


def _make_extreme_price_pair(
    n_bars: int = 400,
    seed: int = 41,
    py_level: float = 400.0,
    px_level: float = 40.0,
) -> pd.DataFrame:
    """Build a cointegrated pair where y trades at $400 and x trades at $40.

    Both series share the same log-return process — so in log-space they
    are cointegrated with beta ~ 1.0. In raw-price space they diverge by
    a factor of 10x. This is the contrived stress-test for dollar
    neutrality: a log-space beta used as a share-count multiplier would
    short 10x the dollars it should on the cheap leg.
    """

    rng = np.random.default_rng(seed)
    log_ret = rng.normal(0.0, 0.012, n_bars)
    shared = np.cumsum(log_ret)
    noise_y = rng.normal(0.0, 0.0025, n_bars)
    noise_x = rng.normal(0.0, 0.0025, n_bars)
    y = py_level * np.exp(shared + noise_y)
    x = px_level * np.exp(shared + noise_x)
    # Inject a terminal shock ONLY on the last bar so z on the last bar
    # is negative (y unusually low relative to x => long y, short x).
    # The shock is applied to the last-bar close only; rolling mean/std
    # is computed on bars [-z_window-1, -2] via .shift(1), so the prior
    # window's stats are undisturbed.
    idx = pd.date_range("2018-01-02", periods=n_bars, freq="B")
    df = pd.DataFrame({"AAPL": y, "MSFT": x}, index=idx)
    # Force a 3-sigma negative spread dislocation on the last bar:
    #   spread = log(y) - beta*log(x) ; reduce y by ~3 sigmas worth.
    spread = np.log(df["AAPL"]) - np.log(df["MSFT"])
    sigma = float(spread.tail(90).std())
    df.iloc[-1, df.columns.get_loc("AAPL")] = float(
        df["AAPL"].iloc[-1] * np.exp(-3.0 * sigma)
    )
    return df


class TestDollarNeutralitySizing:
    """Assert the two entry-signal legs are dollar-neutral for an extreme pair."""

    def test_entry_dollar_neutral_for_400_vs_40_pair(self) -> None:
        """y=$400/share, x=$40/share, beta_log≈1; legs must sum to ~$0 notional."""

        closes = _make_extreme_price_pair(
            n_bars=400, seed=41, py_level=400.0, px_level=40.0
        )
        # Sanity: the last-bar prices are order-of-magnitude different.
        # (The fixture applies a ~30% downward shock to y on the last bar,
        # so the raw ratio at the trigger instant is ~9x — well into the
        # regime where a share-count hedge ratio would break neutrality.)
        last_y = float(closes["AAPL"].iloc[-1])
        last_x = float(closes["MSFT"].iloc[-1])
        assert last_y > 8 * last_x, (
            f"Test fixture broken — expected y >> x, got y={last_y:.2f} x={last_x:.2f}"
        )

        # Fit log-OLS beta on the same window the strategy would use.
        from indicators.stats import engle_granger_adf

        log_y = np.log(closes["AAPL"])
        log_x = np.log(closes["MSFT"])
        _pv, _adf, beta_log, _res = engle_granger_adf(log_y, log_x)
        assert np.isfinite(beta_log), "OLS beta non-finite"
        # Both series share the same log-return process; beta should be ~1.
        assert 0.7 < float(beta_log) < 1.3, (
            f"Log-space beta should be ~1 for same-process pair; got {beta_log:.3f}"
        )

        # Stuff the synthetic closes into the universe frame.
        full = pd.DataFrame(
            index=closes.index, columns=list(UNIVERSE), dtype=float
        )
        full["AAPL"] = closes["AAPL"].values
        full["MSFT"] = closes["MSFT"].values
        provider = SyntheticBarProvider(full)

        s = PairsTradingStrategy()
        s.configure({
            "z_entry": 1.5,
            "z_stop": 10.0,
            "z_window": 45,
            "max_pairs": 3,
            "pair_weight": 0.10,
            "rescreen_days": 1000,  # disable rescreen inside this test
        })
        asof = closes.index[-1].date()
        active = [ActivePair(
            pair_id="AAPL-MSFT", sector="Tech", y="AAPL", x="MSFT",
            beta=float(beta_log),
            screen_pvalue=0.01, screen_halflife=10.0,
            last_screen_date=asof, last_watchdog_date=asof,
        )]
        state = {
            "pairs_trading.active": active,
            "pairs_trading.last_screen": asof,
        }
        ctx = _build_context(asof, provider, state=state)

        signals = list(s.generate_signals(asof, ctx))
        entry_sigs = [
            sig for sig in signals if sig.tag.startswith("pairs-entry")
        ]
        assert len(entry_sigs) == 2, (
            f"Expected two entry signals (one per leg); got {len(entry_sigs)}"
        )

        # Two weights with opposite signs.
        weights = {sig.symbol: float(sig.target_weight) for sig in entry_sigs}
        assert set(weights.keys()) == {"AAPL", "MSFT"}
        assert weights["AAPL"] * weights["MSFT"] < 0, (
            f"Legs must have opposite signs, got {weights}"
        )

        # DOLLAR-NEUTRALITY: target_weight is a fraction of portfolio
        # equity (see backend/strategies/signal.py). The two legs'
        # dollar notionals are therefore weight_i * equity, and the sum
        # should be ~0 regardless of per-share price. This is the
        # critical property under test — if a future refactor multiplies
        # one leg by beta_log (mistaking log-elasticity for a share-count
        # hedge ratio), the sum will diverge.
        equity = float(ctx.equity)
        dollar_y = weights["AAPL"] * equity
        dollar_x = weights["MSFT"] * equity
        net_dollar = dollar_y + dollar_x
        larger_leg = max(abs(dollar_y), abs(dollar_x))
        # Tolerance: ±1% of the larger leg. With equal-weight sizing this
        # is effectively zero (legs are exactly ±pair_weight*equity).
        assert abs(net_dollar) <= 0.01 * larger_leg, (
            f"Book is NOT dollar-neutral: net=${net_dollar:,.2f} vs "
            f"larger-leg=${larger_leg:,.2f}. weights={weights}, "
            f"beta_log={beta_log:.3f}"
        )

    def test_entry_two_leg_notionals_equal_in_magnitude(self) -> None:
        """Per-leg dollar notionals should match in magnitude exactly.

        The strategy sizes each leg at ``pair_weight * equity`` by
        construction (no beta multiplier), so abs(dollar_y) == abs(dollar_x).
        This is a stricter assertion than the ±1% tolerance above and
        catches any accidental asymmetric scaling.
        """

        closes = _make_extreme_price_pair(
            n_bars=400, seed=41, py_level=400.0, px_level=40.0
        )
        from indicators.stats import engle_granger_adf

        log_y = np.log(closes["AAPL"])
        log_x = np.log(closes["MSFT"])
        _pv, _adf, beta_log, _res = engle_granger_adf(log_y, log_x)

        full = pd.DataFrame(
            index=closes.index, columns=list(UNIVERSE), dtype=float
        )
        full["AAPL"] = closes["AAPL"].values
        full["MSFT"] = closes["MSFT"].values
        provider = SyntheticBarProvider(full)

        s = PairsTradingStrategy()
        s.configure({
            "z_entry": 1.5,
            "z_stop": 10.0,
            "z_window": 45,
            "max_pairs": 3,
            "pair_weight": 0.10,
            "rescreen_days": 1000,
        })
        asof = closes.index[-1].date()
        active = [ActivePair(
            pair_id="AAPL-MSFT", sector="Tech", y="AAPL", x="MSFT",
            beta=float(beta_log),
            screen_pvalue=0.01, screen_halflife=10.0,
            last_screen_date=asof, last_watchdog_date=asof,
        )]
        state = {
            "pairs_trading.active": active,
            "pairs_trading.last_screen": asof,
        }
        ctx = _build_context(asof, provider, state=state)

        signals = list(s.generate_signals(asof, ctx))
        entry_sigs = [
            sig for sig in signals if sig.tag.startswith("pairs-entry")
        ]
        assert len(entry_sigs) == 2
        w_y = abs(next(s.target_weight for s in entry_sigs if s.symbol == "AAPL"))
        w_x = abs(next(s.target_weight for s in entry_sigs if s.symbol == "MSFT"))
        assert w_y == pytest.approx(w_x, rel=1e-9), (
            f"Leg weights must match in magnitude (symmetric dollar sizing); "
            f"|w_y|={w_y:.6f} |w_x|={w_x:.6f}"
        )
