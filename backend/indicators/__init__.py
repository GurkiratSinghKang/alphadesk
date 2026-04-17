"""AlphaDesk shared indicators library.

All indicators:

- operate on pandas Series / DataFrames indexed by timestamp,
- return float64 pd.Series or pd.DataFrame preserving the input index,
- propagate leading NaNs for warmup periods (warmup length documented per function),
- are vectorized with numpy/pandas; only Wilder smoothing and KAMA use a
  single Python loop, each O(n).

Textbook/academic references are cited in each function's docstring.
"""

from .momentum import rsi, connors_rsi, macd, adx, roc
from .trend import sma, ema, kama, donchian, ichimoku
from .volatility import atr, parkinson, garman_klass, realized_vol, hv
from .volume import vwap_session, vwap_rolling, obv, volume_zscore
from .stats import (
    zscore,
    pct_rank,
    ewma,
    ou_half_life,
    hurst,
    engle_granger_adf,
    ols_hedge_ratio,
    kalman_hedge_ratio,
)
from .options import (
    bs_price,
    bs_greeks,
    iv_from_price,
    iv_rank,
    iv_percentile,
    term_structure_slope,
)

__all__ = [
    # momentum
    "rsi",
    "connors_rsi",
    "macd",
    "adx",
    "roc",
    # trend
    "sma",
    "ema",
    "kama",
    "donchian",
    "ichimoku",
    # volatility
    "atr",
    "parkinson",
    "garman_klass",
    "realized_vol",
    "hv",
    # volume
    "vwap_session",
    "vwap_rolling",
    "obv",
    "volume_zscore",
    # stats
    "zscore",
    "pct_rank",
    "ewma",
    "ou_half_life",
    "hurst",
    "engle_granger_adf",
    "ols_hedge_ratio",
    "kalman_hedge_ratio",
    # options
    "bs_price",
    "bs_greeks",
    "iv_from_price",
    "iv_rank",
    "iv_percentile",
    "term_structure_slope",
]
