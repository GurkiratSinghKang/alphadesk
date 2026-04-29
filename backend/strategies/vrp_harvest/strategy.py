"""VRP Harvest — SOTA shell (research stub pending options-chain support).

Short SPY strangle with long far-OTM put tail hedge. Signal is
``VRP = IV_30d_ATM - HV_realized_20d``; entry gate also requires term
contango and IV below a crisis kill-switch.

Current integration status (2026-04):
  Full options-chain data is not yet part of ``StrategyInput``. This
  shell computes a simplified VRP proxy from SPY realized vol and
  emits no executable signals (``kind="research"``). The unified
  ``MasterAgent`` / executor consumes the diagnostics for monitoring.

When the options chain arrives in ``StrategyInput``, flip ``kind`` to
``autonomous`` and restore the full strangle + tail-hedge logic from
the pre-SOTA implementation (see git history before commit migrating
to SOTA shell).
"""

from __future__ import annotations

import logging
import math
from datetime import date
from typing import Any, Optional

import numpy as np
import pandas as pd

from indicators.volatility import hv

from strategies._core.contracts import (
    Signal,
    StrategyInput,
    StrategyResult,
)
from strategies._core.protocol import Strategy, StrategyMeta, register_strategy

from .config import UNDERLYING, VRPHarvestParams


log = logging.getLogger("alphadesk.strategies.vrp_harvest")

_NS = "vrp_harvest"
_REQUIRED_LOOKBACK_DAYS = 120
_MIN_TRADING_BARS = 30


@register_strategy(
    StrategyMeta(
        name="vrp_harvest",
        category="options",
        kind="research",  # options chain not yet in StrategyInput
        description=(
            "Short SPY strangle + long far-OTM put tail hedge. Research "
            "shell emits diagnostics only; full multi-leg signal emission "
            "awaits options-chain integration in StrategyInput."
        ),
        lookback_days=_REQUIRED_LOOKBACK_DAYS,
        required_bars=("daily",),
        min_universe_size=1,
    )
)
class VRPHarvestStrategy(Strategy):
    """Short-vol on SPY with a tail hedge (research shell)."""

    PARAMS_MODEL = VRPHarvestParams

    def universe(self, asof: date, state: dict[str, Any]) -> list[str]:
        return [UNDERLYING]

    def run(
        self,
        input: StrategyInput,
        params: VRPHarvestParams,
    ) -> StrategyResult:
        diagnostics: dict[str, Any] = {}
        warnings: list[str] = []

        spy_closes = _extract_underlying_closes(input.bars, params.underlying, asof=input.asof)
        if spy_closes is None or len(spy_closes) < _MIN_TRADING_BARS:
            diagnostics["warmup"] = True
            return StrategyResult(
                signals=[], diagnostics=diagnostics, warnings=warnings,
            )

        # Proxy VRP: IV_30 ~= HV_30 * 1.15 (VRP premium historical average);
        # this is a stand-in until the options chain lands in StrategyInput.
        hv_short = _hv_value(spy_closes, params.hv_period)
        hv_long = _hv_value(spy_closes, 60)
        if hv_short is None or hv_long is None:
            diagnostics["hv_warmup"] = True
            return StrategyResult(
                signals=[], diagnostics=diagnostics, warnings=warnings,
            )

        iv_proxy_30 = hv_short * 1.15
        vrp = iv_proxy_30 - hv_short  # ≈ 15% of realized-vol premium

        diagnostics["hv_short"] = hv_short
        diagnostics["hv_long"] = hv_long
        diagnostics["iv_proxy_30"] = iv_proxy_30
        diagnostics["vrp"] = vrp
        diagnostics["options_chain_available"] = False
        diagnostics["term_structure_gate"] = None
        diagnostics["tail_hedge_available"] = False
        diagnostics["kill_switch_tripped"] = bool(iv_proxy_30 >= params.vix_kill_switch)
        proxy_entry_gate_open = bool(
            vrp >= params.vrp_entry_threshold
            and iv_proxy_30 >= params.min_iv_30
            and iv_proxy_30 < params.vix_kill_switch
        )
        diagnostics["proxy_entry_gate_open"] = proxy_entry_gate_open
        diagnostics["entry_gate_open"] = False
        diagnostics["entry_gate_blocked_reason"] = "options_chain_unavailable"
        warnings.append(
            "Research shell: StrategyInput has no options chain yet; "
            "VRP diagnostics are proxy-only and no SPY strangle signals are emitted."
        )

        # Research stub: no trade signals emitted.
        return StrategyResult(
            signals=[],
            diagnostics=diagnostics,
            warnings=warnings,
        )


# --------------------------------------------------------------------------- #
# Pure helpers                                                                #
# --------------------------------------------------------------------------- #
def _extract_underlying_closes(
    bars: pd.DataFrame,
    underlying: str,
    asof: Optional[date] = None,
) -> Optional[pd.Series]:
    """Return the close-price series for ``underlying`` from ``input.bars``.

    Round-6 / I-14: ``asof`` lookahead guard. The runner pre-fetches a
    ``lookback_days`` window with ``asof`` as the right edge — but a
    multi-strategy run can stash a wider panel into ``state`` (e.g. when
    a sibling strategy needed a longer window) and pass the SAME bars
    frame through ``input.bars``. Without an explicit ``asof <=`` filter
    here, the HV computation could leak future closes into earlier bars
    and overstate realised vol. We trim to ``asof`` defensively.
    """
    if bars is None or getattr(bars, "empty", True):
        return None

    idx_names = tuple(bars.index.names or ())
    if "symbol" in idx_names and "date" in idx_names:
        try:
            sub = bars.xs(underlying, level="symbol").sort_index()
        except KeyError:
            return None
        closes = sub["close"].astype(float) if "close" in sub.columns else None
    else:
        frame = bars.copy()
        if "symbol" not in frame.columns or "close" not in frame.columns:
            return None
        sub = frame[frame["symbol"].astype(str).str.upper() == underlying.upper()]
        if sub.empty:
            return None
        ts_col = next((c for c in ("ts", "date", "ts_date") if c in sub.columns), None)
        if ts_col is None:
            return None
        sub = sub.sort_values(ts_col)
        closes = sub["close"].astype(float)
        # When the flat path has a ts column, also reindex by it so the
        # asof filter below has a comparable index.
        if closes is not None and ts_col in sub.columns:
            ts = pd.to_datetime(sub[ts_col], utc=False, errors="coerce")
            closes = closes.copy()
            closes.index = ts.values
    if closes is None:
        return None
    closes = closes.dropna()
    if asof is not None and not closes.empty:
        cutoff = pd.Timestamp(asof)
        try:
            closes = closes[closes.index <= cutoff]
        except TypeError:
            # Index type might not support direct comparison (mixed dtypes);
            # fall back to coercing both sides.
            idx = pd.to_datetime(pd.Series(closes.index), errors="coerce")
            mask = idx <= cutoff
            closes = closes[mask.values]
    return closes


def _hv_value(
    closes: pd.Series,
    period: int,
) -> Optional[float]:
    """Latest HV value (annualized). ``closes`` is a price series."""
    if closes.empty or len(closes) < period + 2:
        return None
    v = hv(closes, period=period)
    v = v.dropna()
    if v.empty:
        return None
    val = float(v.iloc[-1])
    return val if math.isfinite(val) else None


__all__ = ["VRPHarvestStrategy"]
