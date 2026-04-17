"""Polygon equity-bar provider.

Implements :class:`backend.data.providers.base.BarProvider` using Polygon's
``/v2/aggs/ticker/.../range/...`` endpoint. Kept as a failover / cross-check
against :class:`AlpacaBarProvider`. Our Options Developer plan does not
include stock-bar entitlement — the code is correct but will return 403 until
a Stocks plan is attached to the key.
"""

from __future__ import annotations

import logging
from datetime import date, datetime
from typing import Any, Iterable

import pandas as pd

from backend.data.providers._polygon_http import PolygonHTTP
from backend.data.providers.cache import TTL_DAILY, TTL_INTRADAY, cached

logger = logging.getLogger(__name__)

_TF_MAP = {
    "1D": ("day", 1),
    "1d": ("day", 1),
    "1Day": ("day", 1),
    "1H": ("hour", 1),
    "1Hour": ("hour", 1),
    "1min": ("minute", 1),
    "5min": ("minute", 5),
    "15min": ("minute", 15),
}

_BARS_COLS = ["symbol", "ts", "open", "high", "low", "close", "volume", "vwap", "n_trades"]


class PolygonStockBarProvider:
    """Equity OHLCV bars. Output schema matches :class:`AlpacaBarProvider`."""

    def __init__(self, api_key: str | None = None, timeout: float = 30.0) -> None:
        self._http = PolygonHTTP(api_key, timeout)

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> "PolygonStockBarProvider":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    def bars(
        self,
        symbols: Iterable[str],
        start: date | datetime | str,
        end: date | datetime | str,
        tf: str = "1D",
    ) -> pd.DataFrame:
        """Fetch OHLCV bars. See ``BarProvider.bars`` for schema."""
        if tf not in _TF_MAP:
            raise ValueError(f"unsupported timeframe {tf!r}")
        unit, mult = _TF_MAP[tf]
        syms = list(dict.fromkeys(str(s).upper() for s in symbols))
        start_s = _to_date_str(start)
        end_s = _to_date_str(end)
        ttl = TTL_DAILY if unit == "day" else TTL_INTRADAY
        return self._bars_cached(syms, start_s, end_s, unit, mult, ttl)

    @cached(ttl_seconds=TTL_DAILY)
    def _bars_cached(
        self,
        symbols: list[str],
        start: str,
        end: str,
        unit: str,
        mult: int,
        ttl: int,
    ) -> pd.DataFrame:
        frames: list[pd.DataFrame] = []
        for sym in symbols:
            path = f"/v2/aggs/ticker/{sym}/range/{mult}/{unit}/{start}/{end}"
            rows: list[dict] = []
            for item in self._http.paginate(
                path, {"adjusted": "true", "sort": "asc", "limit": 50_000}
            ):
                rows.append(
                    {
                        "symbol": sym,
                        "ts": pd.Timestamp(item["t"], unit="ms", tz="UTC"),
                        "open": item["o"],
                        "high": item["h"],
                        "low": item["l"],
                        "close": item["c"],
                        "volume": item.get("v"),
                        "vwap": item.get("vw"),
                        "n_trades": item.get("n"),
                    }
                )
            if rows:
                frames.append(pd.DataFrame(rows, columns=_BARS_COLS))
        if not frames:
            return _empty_bars_frame()
        out = pd.concat(frames, ignore_index=True)
        out.sort_values(["symbol", "ts"], inplace=True, ignore_index=True)
        return out


def _empty_bars_frame() -> pd.DataFrame:
    return pd.DataFrame({c: [] for c in _BARS_COLS}).astype(
        {
            "symbol": "object",
            "ts": "datetime64[ns, UTC]",
            "open": "float64",
            "high": "float64",
            "low": "float64",
            "close": "float64",
            "volume": "float64",
            "vwap": "float64",
            "n_trades": "float64",
        }
    )


def _to_date(d: date | datetime | str) -> date:
    if isinstance(d, datetime):
        return d.date()
    if isinstance(d, date):
        return d
    return pd.Timestamp(d).date()


def _to_date_str(d: date | datetime | str) -> str:
    return _to_date(d).isoformat()
