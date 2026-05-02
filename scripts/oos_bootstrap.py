"""Block-bootstrap confidence intervals for OOS Sharpe artefacts.

The live-flip checklist asks every phase-1 OOS evaluator to emit a
non-overlapping 21-trading-day block bootstrap around its point Sharpe. This
module keeps that logic identical across the strategy-specific scripts.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd

TRADING_DAYS = 252
DEFAULT_BLOCK_SIZE = 21
DEFAULT_ITERATIONS = 1000
DEFAULT_SEED = 20260502


def _as_returns(
    series: pd.Series | list[float] | tuple[float, ...],
    *,
    values_are_returns: bool = False,
) -> pd.Series:
    """Return a clean return series from either equity or return values."""

    s = pd.Series(series).dropna().astype(float)
    if s.empty:
        return s
    if values_are_returns:
        return s[np.isfinite(s)]
    return s.pct_change().replace([np.inf, -np.inf], np.nan).dropna()


def _annualized_sharpe(
    returns: pd.Series | np.ndarray,
    *,
    periods_per_year: int = TRADING_DAYS,
) -> float:
    r = np.asarray(returns, dtype=float)
    r = r[np.isfinite(r)]
    if len(r) < 2:
        return 0.0
    std = float(np.std(r, ddof=1))
    if not math.isfinite(std) or std < 1e-12:
        return 0.0
    return float(np.mean(r) / std * math.sqrt(periods_per_year))


def block_bootstrap_sharpe_ci(
    returns: pd.Series | list[float] | tuple[float, ...],
    *,
    values_are_returns: bool = True,
    block_size: int = DEFAULT_BLOCK_SIZE,
    iterations: int = DEFAULT_ITERATIONS,
    seed: int = DEFAULT_SEED,
    periods_per_year: int = TRADING_DAYS,
) -> dict[str, Any]:
    """Compute a 95% CI for annualized Sharpe via block bootstrap.

    Returns a JSON-ready payload. ``status`` is ``"ok"`` when a CI was
    computed and ``"insufficient_data"`` when there are too few returns.
    """

    r = _as_returns(returns, values_are_returns=values_are_returns)
    if block_size <= 0:
        raise ValueError("block_size must be positive")
    if iterations <= 0:
        raise ValueError("iterations must be positive")

    observed = _annualized_sharpe(r, periods_per_year=periods_per_year)
    if len(r) < block_size * 2:
        return {
            "status": "insufficient_data",
            "method": "non_overlapping_block_bootstrap",
            "block_size": block_size,
            "iterations": iterations,
            "seed": seed,
            "n_returns": int(len(r)),
            "n_blocks": 0,
            "observed_sharpe": observed,
            "ci95_low": None,
            "ci95_high": None,
        }

    values = r.to_numpy(dtype=float)
    n_blocks = len(values) // block_size
    trimmed = values[: n_blocks * block_size]
    blocks = trimmed.reshape(n_blocks, block_size)
    rng = np.random.default_rng(seed)
    samples = np.empty(iterations, dtype=float)
    for i in range(iterations):
        idx = rng.integers(0, n_blocks, size=n_blocks)
        boot = blocks[idx].reshape(-1)
        samples[i] = _annualized_sharpe(boot, periods_per_year=periods_per_year)

    low, high = np.percentile(samples, [2.5, 97.5])
    return {
        "status": "ok",
        "method": "non_overlapping_block_bootstrap",
        "block_size": block_size,
        "iterations": iterations,
        "seed": seed,
        "n_returns": int(len(r)),
        "n_blocks": int(n_blocks),
        "observed_sharpe": observed,
        "ci95_low": float(low),
        "ci95_high": float(high),
    }


def bootstrap_ci_from_equity_frame(
    equity_curve: pd.DataFrame | None,
    *,
    equity_col: str = "equity",
    return_col: str | None = None,
    block_size: int = DEFAULT_BLOCK_SIZE,
    iterations: int = DEFAULT_ITERATIONS,
    seed: int = DEFAULT_SEED,
) -> dict[str, Any]:
    """Extract returns from a backtest equity frame and compute the CI."""

    if equity_curve is None or getattr(equity_curve, "empty", True):
        return block_bootstrap_sharpe_ci(
            [],
            values_are_returns=True,
            block_size=block_size,
            iterations=iterations,
            seed=seed,
        )
    if return_col and return_col in equity_curve.columns:
        return block_bootstrap_sharpe_ci(
            equity_curve[return_col],
            values_are_returns=True,
            block_size=block_size,
            iterations=iterations,
            seed=seed,
        )
    if equity_col not in equity_curve.columns:
        raise KeyError(f"equity column {equity_col!r} not found")
    return block_bootstrap_sharpe_ci(
        equity_curve[equity_col],
        values_are_returns=False,
        block_size=block_size,
        iterations=iterations,
        seed=seed,
    )


def attach_bootstrap_ci(
    payload: dict[str, Any],
    ci: dict[str, Any],
    *,
    key: str = "sharpe_bootstrap_ci",
) -> dict[str, Any]:
    """Attach both structured and legacy flat CI fields to an artefact."""

    payload[key] = ci
    payload["sharpe_ci95_low"] = ci.get("ci95_low")
    payload["sharpe_ci95_high"] = ci.get("ci95_high")
    payload["sharpe_ci_method"] = ci.get("method")
    return payload


__all__ = [
    "DEFAULT_BLOCK_SIZE",
    "DEFAULT_ITERATIONS",
    "DEFAULT_SEED",
    "attach_bootstrap_ci",
    "block_bootstrap_sharpe_ci",
    "bootstrap_ci_from_equity_frame",
]
