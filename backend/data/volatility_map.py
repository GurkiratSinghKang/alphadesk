"""Typical daily return volatilities per symbol.

Shared across the risk pipeline — :class:`MasterAgent` consumes this for
Value-at-Risk computation, position-level vol-budget sizing, and crowding
detection. The dictionary is *pre-S&P-500 coverage*: a small hand-curated
list of large-cap tickers plus a handful of sector ETFs. Once a per-symbol
realized-vol feed lands (planned under the "dynamic-vol" track) this map
becomes a fallback used only when the live estimate is missing or stale.

Methodology
-----------
Values are **one-year trailing realized daily volatility** (standard deviation
of daily log returns, sampled on US trading days), rounded to three decimals.
The window was snapshot once against end-of-2024 history. These are
deliberately stable floors — not meant to track intraweek regime shifts.

Notes
-----
* Units: daily σ, expressed as a decimal (``0.030`` = 3.0% daily vol).
* Interpretation follows the rest of the risk stack — see
  ``master_agent.calculate_vol_targeted_size`` for how this feeds position
  sizing, and ``master_agent.check_var`` for the VaR aggregation.
* When a symbol is absent from the map, callers fall back to a conservative
  category default (typically 0.025 for single-name equities); this file
  is the lookup of record for the explicitly-covered names only.
"""

from __future__ import annotations

#: Hand-curated realized daily volatility per ticker.
#:
#: Split across groupings below purely for readability — callers should
#: treat this as a single flat mapping. Strings must be uppercase tickers.
VOL_MAP_PRE_SP500: dict[str, float] = {
    # Mega-cap growth / high-beta single names
    "TSLA": 0.035,
    "NVDA": 0.030,
    "AMD": 0.030,
    "COIN": 0.040,
    "META": 0.025,
    "NFLX": 0.025,
    # Mega-cap tech at moderate vol
    "AAPL": 0.015,
    "MSFT": 0.014,
    "AMZN": 0.020,
    "GOOGL": 0.018,
    # Benchmark ETFs
    "SPY": 0.010,
    "QQQ": 0.013,
    # Financials
    "JPM": 0.015,
    "BAC": 0.018,
    # Cyclical / defensive large-caps
    "XOM": 0.016,
    "DIS": 0.020,
    "WMT": 0.012,
    "INTC": 0.035,
    "CSCO": 0.015,
    "ABBV": 0.016,
    "UNH": 0.028,
    "PG": 0.010,
    "MRK": 0.014,
    "KO": 0.009,
}


__all__ = ["VOL_MAP_PRE_SP500"]
