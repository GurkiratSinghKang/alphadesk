"""Polygon options provider: chain snapshot, contract bars, historical IV.

Implements :class:`backend.data.providers.base.OptionsProvider`.

Implementation notes:

* ``chain_snapshot(underlying, asof)`` — routes to the live snapshot endpoint
  for today's date (which includes Greeks) and to the
  ``/v3/reference/options/contracts?as_of=YYYY-MM-DD`` historical endpoint
  otherwise (which lists the contract universe but lacks Greeks).  Per the
  design spec, "acceptable if Greeks are empty on older snapshots".
* ``contract_bars`` — standard aggregates endpoint, same pagination as stock
  bars.
* ``historical_iv`` — Polygon's Developer tier does not expose a historical
  IV time-series directly; the default implementation returns an empty frame
  with the correct schema.  Callers who need historical IV should combine
  :meth:`chain_snapshot` with :meth:`contract_bars` and invert Black-Scholes
  via :mod:`py_vollib`.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from typing import Any

import pandas as pd

from backend.data.providers._polygon_http import PolygonHTTP
from backend.data.providers.cache import TTL_DAILY, TTL_INTRADAY, TTL_SNAPSHOT, cached

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

_CHAIN_COLS = [
    "contract_ticker", "underlying", "expiration", "strike", "option_type",
    "bid", "ask", "last", "volume", "open_interest",
    "iv", "delta", "gamma", "theta", "vega", "rho", "asof",
]
_CONTRACT_BAR_COLS = [
    "contract", "ts", "open", "high", "low", "close", "volume", "vwap", "n_trades"
]


class PolygonOptionsProvider:
    """Satisfies :class:`backend.data.providers.base.OptionsProvider`."""

    def __init__(self, api_key: str | None = None, timeout: float = 30.0) -> None:
        self._http = PolygonHTTP(api_key, timeout)

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> "PolygonOptionsProvider":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    # ---- chain_snapshot -----------------------------------------------------
    def chain_snapshot(
        self, underlying: str, asof: date | datetime | str
    ) -> pd.DataFrame:
        asof_d = _to_date(asof)
        today = datetime.now(timezone.utc).date()
        if asof_d >= today:
            return self._live_chain(underlying.upper(), asof_d)
        return self._historical_chain(underlying.upper(), asof_d)

    @cached(ttl_seconds=TTL_SNAPSHOT)
    def _live_chain(self, underlying: str, asof_d: date) -> pd.DataFrame:
        rows: list[dict] = []
        path = f"/v3/snapshot/options/{underlying}"
        for item in self._http.paginate(path, {"limit": 250}):
            details = item.get("details") or {}
            greeks = item.get("greeks") or {}
            last_quote = item.get("last_quote") or {}
            day = item.get("day") or {}
            rows.append(
                {
                    "contract_ticker": details.get("ticker"),
                    "underlying": underlying,
                    "expiration": _safe_date(details.get("expiration_date")),
                    "strike": details.get("strike_price"),
                    "option_type": details.get("contract_type"),
                    "bid": last_quote.get("bid"),
                    "ask": last_quote.get("ask"),
                    "last": (item.get("last_trade") or {}).get("price") or day.get("close"),
                    "volume": day.get("volume"),
                    "open_interest": item.get("open_interest"),
                    "iv": item.get("implied_volatility"),
                    "delta": greeks.get("delta"),
                    "gamma": greeks.get("gamma"),
                    "theta": greeks.get("theta"),
                    "vega": greeks.get("vega"),
                    "rho": greeks.get("rho"),
                    "asof": asof_d,
                }
            )
        return pd.DataFrame(rows, columns=_CHAIN_COLS) if rows else _empty_chain_frame()

    @cached(ttl_seconds=TTL_DAILY * 4)
    def _historical_chain(self, underlying: str, asof_d: date) -> pd.DataFrame:
        rows: list[dict] = []
        path = "/v3/reference/options/contracts"
        params = {
            "underlying_ticker": underlying,
            "as_of": asof_d.isoformat(),
            "expired": "true",
            "limit": 1000,
        }
        for item in self._http.paginate(path, params):
            rows.append(
                {
                    "contract_ticker": item.get("ticker"),
                    "underlying": underlying,
                    "expiration": _safe_date(item.get("expiration_date")),
                    "strike": item.get("strike_price"),
                    "option_type": item.get("contract_type"),
                    "bid": None, "ask": None, "last": None,
                    "volume": None, "open_interest": None,
                    "iv": None, "delta": None, "gamma": None,
                    "theta": None, "vega": None, "rho": None,
                    "asof": asof_d,
                }
            )
        return pd.DataFrame(rows, columns=_CHAIN_COLS) if rows else _empty_chain_frame()

    # ---- contract_bars ------------------------------------------------------
    def contract_bars(
        self,
        contract: str,
        start: date | datetime | str,
        end: date | datetime | str,
        tf: str = "1D",
    ) -> pd.DataFrame:
        if tf not in _TF_MAP:
            raise ValueError(f"unsupported timeframe {tf!r}")
        unit, mult = _TF_MAP[tf]
        ttl = TTL_DAILY if unit == "day" else TTL_INTRADAY
        return self._contract_bars_cached(
            contract, _to_date_str(start), _to_date_str(end), unit, mult, ttl
        )

    @cached(ttl_seconds=TTL_DAILY)
    def _contract_bars_cached(
        self, contract: str, start: str, end: str, unit: str, mult: int, ttl: int,
    ) -> pd.DataFrame:
        path = f"/v2/aggs/ticker/{contract}/range/{mult}/{unit}/{start}/{end}"
        rows: list[dict] = []
        for item in self._http.paginate(
            path, {"adjusted": "true", "sort": "asc", "limit": 50_000}
        ):
            rows.append(
                {
                    "contract": contract,
                    "ts": pd.Timestamp(item["t"], unit="ms", tz="UTC"),
                    "open": item["o"], "high": item["h"],
                    "low": item["l"], "close": item["c"],
                    "volume": item.get("v"), "vwap": item.get("vw"),
                    "n_trades": item.get("n"),
                }
            )
        if not rows:
            return pd.DataFrame({c: [] for c in _CONTRACT_BAR_COLS})
        out = pd.DataFrame(rows, columns=_CONTRACT_BAR_COLS)
        out.sort_values("ts", inplace=True, ignore_index=True)
        return out

    # ---- historical_iv ------------------------------------------------------
    def historical_iv(
        self,
        underlying: str,
        start: date | datetime | str,
        end: date | datetime | str,
    ) -> pd.DataFrame:
        """Polygon Developer tier does not expose historical IV; return empty.

        For live Black-Scholes inversion from chain + contract_bars, callers
        should combine :meth:`chain_snapshot` with :meth:`contract_bars` and
        use ``py_vollib.black_scholes.implied_volatility``.
        """
        start_d = _to_date(start)
        end_d = _to_date(end)
        logger.info(
            "historical_iv: Polygon Developer tier lacks this endpoint; "
            "returning empty frame for %s %s..%s", underlying, start_d, end_d,
        )
        return pd.DataFrame(
            {
                "date": pd.Series([], dtype="datetime64[ns]"),
                "underlying": pd.Series([], dtype="object"),
                "iv_atm_30d": pd.Series([], dtype="float64"),
                "iv_atm_60d": pd.Series([], dtype="float64"),
                "iv_atm_90d": pd.Series([], dtype="float64"),
            }
        )


# --------------------------------------------------------------------------- #
# Helpers                                                                     #
# --------------------------------------------------------------------------- #
def _empty_chain_frame() -> pd.DataFrame:
    return pd.DataFrame({c: [] for c in _CHAIN_COLS})


def _to_date(d: date | datetime | str) -> date:
    if isinstance(d, datetime):
        return d.date()
    if isinstance(d, date):
        return d
    return pd.Timestamp(d).date()


def _to_date_str(d: date | datetime | str) -> str:
    return _to_date(d).isoformat()


def _safe_date(s: str | None) -> date | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s).date()
    except (TypeError, ValueError):
        return None
