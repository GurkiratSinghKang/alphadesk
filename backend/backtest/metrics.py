"""Pure performance metrics over an equity or return series.

All metrics accept either a list / array of floats or a pandas Series. 252
trading days per year is assumed. Money-level accuracy isn't required here —
Decimal values should be cast to float before entering this module.
"""

from __future__ import annotations

from typing import Optional

import math

import numpy as np
import pandas as pd


TRADING_DAYS = 252


def _to_returns(series: pd.Series) -> pd.Series:
    """Coerce a return Series (handles equity curves by first-diff-pct)."""

    s = pd.Series(series).dropna().astype(float)
    if len(s) == 0:
        return s
    # Heuristic: if every value is > ~1, treat as equity curve and convert.
    if (s > 1).all():
        s = s.pct_change().dropna()
    return s


def _annualization_factor(periods_per_year: int = TRADING_DAYS) -> float:
    return math.sqrt(periods_per_year)


# Treat anything below this as "floating-point zero" for stdev checks. This
# catches the tiny residuals that numpy produces for a constant series
# (e.g. std([0.001]*100) ≈ 1e-20).
_FLOAT_EPS = 1e-12


def sharpe(returns: pd.Series, rf: float = 0.0, periods_per_year: int = TRADING_DAYS) -> float:
    """Annualised Sharpe ratio.

    rf is an *annual* risk-free rate; converted to per-period by dividing by
    ``periods_per_year``.
    """

    r = _to_returns(returns)
    if len(r) < 2:
        return 0.0
    excess = r - rf / periods_per_year
    std = excess.std(ddof=1)
    if not math.isfinite(std) or std < _FLOAT_EPS:
        return 0.0
    return float(excess.mean() / std * _annualization_factor(periods_per_year))


def sortino(returns: pd.Series, rf: float = 0.0, periods_per_year: int = TRADING_DAYS) -> float:
    r = _to_returns(returns)
    if len(r) < 2:
        return 0.0
    excess = r - rf / periods_per_year
    # Lower Partial Moment (LPM₂) downside deviation: sum of squared
    # negative returns divided by the TOTAL number of observations (not the
    # count of downside observations). Dividing by len(downside) systematically
    # understates Sortino when losses are infrequent.
    downside_sq = (excess.clip(upper=0.0) ** 2).sum()
    dd_std = math.sqrt(float(downside_sq) / len(excess))
    if not math.isfinite(dd_std) or dd_std < _FLOAT_EPS:
        return 0.0
    return float(excess.mean() / dd_std * _annualization_factor(periods_per_year))


def max_drawdown(equity: pd.Series) -> float:
    """Max drawdown as a *fraction* (e.g. 0.20 = -20%)."""

    eq = pd.Series(equity).dropna().astype(float)
    if len(eq) == 0:
        return 0.0
    running_max = eq.cummax()
    dd = eq / running_max - 1.0
    return float(abs(dd.min())) if len(dd) else 0.0


def cagr(equity: pd.Series, periods_per_year: int = TRADING_DAYS) -> float:
    eq = pd.Series(equity).dropna().astype(float)
    if len(eq) < 2 or eq.iloc[0] <= 0:
        return 0.0
    total_return = eq.iloc[-1] / eq.iloc[0]
    years = len(eq) / periods_per_year
    if years <= 0 or total_return <= 0:
        return 0.0
    return float(total_return ** (1.0 / years) - 1.0)


def calmar(equity: pd.Series, periods_per_year: int = TRADING_DAYS) -> float:
    mdd = max_drawdown(equity)
    if mdd == 0:
        return 0.0
    return cagr(equity, periods_per_year) / mdd


def turnover(daily_notional: pd.Series, equity: pd.Series) -> float:
    """Daily turnover ratio = sum(|notional traded|) / mean(equity)."""

    notional = pd.Series(daily_notional).dropna().astype(float)
    eq = pd.Series(equity).dropna().astype(float)
    if len(eq) == 0 or eq.mean() == 0:
        return 0.0
    return float(notional.abs().sum() / eq.mean())


def hit_rate(trade_pnls: pd.Series) -> float:
    """Fraction of winning trades.

    Break-even trades (pnl == 0) are scratch trades: they are neither a win
    nor a loss, so they are excluded from both numerator and denominator.
    ``wins / (wins + losses)`` — denominator skips pnl == 0.
    """

    t = pd.Series(trade_pnls).dropna().astype(float)
    wins = int((t > 0).sum())
    losses = int((t < 0).sum())
    decided = wins + losses
    if decided == 0:
        return 0.0
    return float(wins / decided)


def profit_factor(trade_pnls: pd.Series) -> float:
    t = pd.Series(trade_pnls).dropna().astype(float)
    gross_wins = float(t[t > 0].sum())
    gross_losses = float(-t[t < 0].sum())
    if gross_losses == 0:
        return float("inf") if gross_wins > 0 else 0.0
    return gross_wins / gross_losses


def tail_ratio(returns: pd.Series) -> float:
    """|5th percentile| / 95th percentile of returns.

    Low values (<1) mean big drawdown tails vs upside. High values mean fat
    right tail.
    """

    r = _to_returns(returns)
    if len(r) < 20:
        return 0.0
    p5 = float(np.percentile(r, 5))
    p95 = float(np.percentile(r, 95))
    if p95 == 0:
        return 0.0
    return abs(p5 / p95)


def alpha_beta(
    returns: pd.Series,
    benchmark_returns: pd.Series,
    rf: float = 0.0,
    periods_per_year: int = TRADING_DAYS,
) -> tuple[float, float]:
    """OLS alpha (annualised) and beta vs a benchmark."""

    r = _to_returns(returns)
    b = _to_returns(benchmark_returns)
    common = pd.concat([r, b], axis=1, join="inner").dropna()
    if len(common) < 2:
        return 0.0, 0.0
    r_ = common.iloc[:, 0].values - rf / periods_per_year
    b_ = common.iloc[:, 1].values - rf / periods_per_year
    var_b = float(np.var(b_, ddof=1))
    if var_b == 0:
        return 0.0, 0.0
    beta = float(np.cov(r_, b_, ddof=1)[0, 1] / var_b)
    alpha_daily = float(np.mean(r_) - beta * np.mean(b_))
    alpha_annual = alpha_daily * periods_per_year
    return alpha_annual, beta


def summary_dict(
    equity: pd.Series,
    returns: Optional[pd.Series] = None,
    trade_pnls: Optional[pd.Series] = None,
    benchmark_returns: Optional[pd.Series] = None,
    daily_notional: Optional[pd.Series] = None,
    rf: float = 0.0,
    periods_per_year: int = TRADING_DAYS,
) -> dict[str, float]:
    """Produce a single dict of standard metrics suitable for JSON."""

    if returns is None:
        returns = _to_returns(equity)

    out: dict[str, float] = {}
    out["sharpe"] = sharpe(returns, rf=rf, periods_per_year=periods_per_year)
    out["sortino"] = sortino(returns, rf=rf, periods_per_year=periods_per_year)
    out["calmar"] = calmar(equity, periods_per_year=periods_per_year)
    out["max_drawdown"] = max_drawdown(equity)
    out["cagr"] = cagr(equity, periods_per_year=periods_per_year)
    out["tail_ratio"] = tail_ratio(returns)

    if trade_pnls is not None:
        out["hit_rate"] = hit_rate(trade_pnls)
        out["profit_factor"] = profit_factor(trade_pnls)
    else:
        out["hit_rate"] = 0.0
        out["profit_factor"] = 0.0

    if daily_notional is not None:
        out["turnover"] = turnover(daily_notional, equity)
    else:
        out["turnover"] = 0.0

    if benchmark_returns is not None:
        a, b = alpha_beta(
            returns,
            benchmark_returns,
            rf=rf,
            periods_per_year=periods_per_year,
        )
        out["alpha"] = a
        out["beta"] = b
    else:
        out["alpha"] = 0.0
        out["beta"] = 0.0

    return out


__all__ = [
    "TRADING_DAYS",
    "sharpe",
    "sortino",
    "calmar",
    "max_drawdown",
    "cagr",
    "turnover",
    "hit_rate",
    "profit_factor",
    "tail_ratio",
    "alpha_beta",
    "summary_dict",
]
