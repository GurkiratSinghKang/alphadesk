"""VRP Harvest — SOTA shell (research stub pending options-chain support).

Short SPY strangle with long far-OTM put tail hedge. Signal is
``VRP = IV_30d_ATM - HV_realized_20d``; entry gate also requires term
contango and IV below a crisis kill-switch.

Current integration status:
  ``StrategyInput.options_chains`` is available, so the shell now measures
  actual chain IV/term structure/tail-hedge availability when present. It
  still emits diagnostics only until multi-leg options execution is proven
  in paper.
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
        kind="autonomous",
        description=(
            "Short SPY strangle + long far-OTM put tail hedge. Multi-leg "
            "signals are now priced via the native FillSimulator path "
            "(Plan B.1 full port); paper_only=True until paper validation "
            "of the live execution bridge graduates the strategy to live mode."
        ),
        lookback_days=_REQUIRED_LOOKBACK_DAYS,
        required_bars=("daily",),
        min_universe_size=1,
        # Plan B.1 full port: kind flipped research → autonomous; paper_only
        # remains True so DailyPipelineRunner gates live capital until
        # operator explicitly clears it after the 2-week paper runway.
        paper_only=True,
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

        chain = _chain_for_symbol(input.options_chains, params.underlying)
        chain_summary = _chain_summary(chain, input.asof, params.target_dte)

        # Proxy VRP: IV_30 ~= HV_30 * 1.15 (VRP premium historical average)
        # when a real chain is absent. Prefer actual ATM IV from the chain.
        hv_short = _hv_value(spy_closes, params.hv_period)
        hv_long = _hv_value(spy_closes, 60)
        if hv_short is None or hv_long is None:
            diagnostics["hv_warmup"] = True
            return StrategyResult(
                signals=[], diagnostics=diagnostics, warnings=warnings,
            )

        iv_proxy_30 = hv_short * 1.15
        iv_30 = chain_summary.get("atm_iv") or iv_proxy_30
        vrp = float(iv_30) - hv_short

        diagnostics["hv_short"] = hv_short
        diagnostics["hv_long"] = hv_long
        diagnostics["iv_proxy_30"] = iv_proxy_30
        diagnostics["iv_30"] = iv_30
        diagnostics["vrp"] = vrp
        diagnostics["options_chain_available"] = chain_summary["available"]
        diagnostics["options_chain"] = chain_summary
        term_gate = (
            bool(chain_summary.get("term_contango"))
            if params.term_structure_gate and chain_summary["available"]
            else None
        )
        tail_hedge_available = bool(chain_summary.get("tail_hedge_available"))
        diagnostics["term_structure_gate"] = term_gate
        diagnostics["tail_hedge_available"] = tail_hedge_available
        diagnostics["kill_switch_tripped"] = bool(float(iv_30) >= params.vix_kill_switch)
        proxy_entry_gate_open = bool(
            vrp >= params.vrp_entry_threshold
            and float(iv_30) >= params.min_iv_30
            and float(iv_30) < params.vix_kill_switch
        )
        paper_candidate_ready = bool(
            proxy_entry_gate_open
            and chain_summary["available"]
            and not chain_summary.get("is_demo", False)
            and (not params.term_structure_gate or term_gate is True)
            and tail_hedge_available
        )
        diagnostics["proxy_entry_gate_open"] = proxy_entry_gate_open
        diagnostics["paper_candidate_ready"] = paper_candidate_ready
        diagnostics["entry_gate_open"] = False
        diagnostics["entry_gate_blocked_reason"] = (
            "multi_leg_execution_bridge_not_enabled"
            if paper_candidate_ready
            else "options_chain_unavailable" if not chain_summary["available"]
            else "risk_or_chain_quality_gate_closed"
        )
        if not chain_summary["available"]:
            warnings.append(
                "Research shell: StrategyInput has no SPY options chain; "
                "VRP diagnostics are proxy-only and no strangle signals are emitted."
            )
        else:
            warnings.append(
                "Research shell: SPY options chain is available, but multi-leg "
                "execution remains disabled until paper validation is complete."
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


def _chain_for_symbol(
    chains: dict[str, pd.DataFrame],
    symbol: str,
) -> pd.DataFrame | None:
    chain = chains.get(symbol.upper())
    if chain is None:
        chain = chains.get(symbol)
    if chain is None or getattr(chain, "empty", True):
        return None
    return chain


def _chain_summary(
    chain: pd.DataFrame | None,
    asof: date,
    target_dte: int,
) -> dict[str, Any]:
    if chain is None or getattr(chain, "empty", True):
        return {"available": False}
    frame = chain.copy()
    for col in ("expiry", "strike", "option_type", "iv", "delta"):
        if col not in frame.columns:
            return {"available": False, "reason": f"missing_{col}"}
    frame["_expiry"] = pd.to_datetime(frame["expiry"], errors="coerce").dt.date
    frame["_strike"] = pd.to_numeric(frame["strike"], errors="coerce")
    frame["_iv"] = pd.to_numeric(frame["iv"], errors="coerce")
    frame["_delta"] = pd.to_numeric(frame["delta"], errors="coerce")
    frame["_type"] = frame["option_type"].astype(str).str.lower()
    frame = frame.dropna(subset=["_expiry", "_strike"])
    if frame.empty:
        return {"available": False, "reason": "no_valid_contracts"}
    frame["_dte"] = frame["_expiry"].apply(lambda d: (d - asof).days)
    target = frame.assign(_distance=(frame["_dte"] - target_dte).abs()).sort_values("_distance").head(1)
    target_expiry = target["_expiry"].iloc[0] if not target.empty else None
    expiry_frame = frame[frame["_expiry"] == target_expiry] if target_expiry else frame
    spot = float(frame.get("spot_price", pd.Series([0])).dropna().iloc[0] or 0)
    if spot > 0:
        atm = expiry_frame.iloc[(expiry_frame["_strike"] - spot).abs().argsort()[:4]]
    else:
        atm = expiry_frame.iloc[:4]
    atm_iv = float(atm["_iv"].dropna().mean()) if atm["_iv"].notna().any() else None
    expiries = (
        frame.groupby("_expiry")["_iv"].mean().dropna().sort_index()
        if "_iv" in frame.columns else pd.Series(dtype=float)
    )
    term_contango = None
    if len(expiries) >= 2:
        term_contango = bool(float(expiries.iloc[-1]) >= float(expiries.iloc[0]))
    put_rows = expiry_frame[expiry_frame["_type"].eq("put")]
    tail_rows = put_rows.loc[(put_rows["_delta"].abs() - 0.05).abs() <= 0.03]
    is_demo = bool(frame.get("is_demo", pd.Series([False])).fillna(False).astype(bool).any())
    return {
        "available": True,
        "contracts": int(len(frame)),
        "is_demo": is_demo,
        "target_expiry": target_expiry.isoformat() if target_expiry else None,
        "target_expiry_contracts": int(len(expiry_frame)),
        "atm_iv": atm_iv,
        "term_contango": term_contango,
        "tail_hedge_available": not tail_rows.empty,
    }


__all__ = ["VRPHarvestStrategy"]
