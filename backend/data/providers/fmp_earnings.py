"""FMP earnings provider: calendar, per-symbol surprises, consensus."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Iterable

import numpy as np
import pandas as pd

from data.providers._fmp_http import FMPHTTP
from data.providers.cache import TTL_DAILY, cached

_CALENDAR_COLS = [
    "symbol", "date", "eps_actual", "eps_estimated",
    "revenue_actual", "revenue_estimated", "last_updated",
    "announcement_when",
]
_SURPRISE_COLS = [
    "symbol", "date", "eps_actual", "eps_estimated",
    "surprise", "surprise_pct", "sue",
    "revenue_actual", "revenue_estimated",
]
# B-82: Explicit dtypes for the empty-frame fallback. Matches the dtypes
# of the populated frame (float64 for numbers, str for text, object for
# python date objects) so downstream pandas operations (concat, sort,
# `isin`) behave identically whether or not FMP returned rows.
_CALENDAR_DTYPES: dict[str, Any] = {
    "symbol": "str",
    "date": "object",
    "eps_actual": "float64",
    "eps_estimated": "float64",
    "revenue_actual": "float64",
    "revenue_estimated": "float64",
    "last_updated": "object",
    "announcement_when": "str",
}
_SURPRISE_DTYPES: dict[str, Any] = {
    "symbol": "str",
    "date": "object",
    "eps_actual": "float64",
    "eps_estimated": "float64",
    "surprise": "float64",
    "surprise_pct": "float64",
    "sue": "float64",
    "revenue_actual": "float64",
    "revenue_estimated": "float64",
}


class FMPEarningsProvider:
    """Satisfies :class:`backend.data.providers.base.EarningsProvider`."""

    def __init__(self, api_key: str | None = None, timeout: float = 30.0) -> None:
        self._http = FMPHTTP(api_key, timeout)

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> "FMPEarningsProvider":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    # ---- calendar -----------------------------------------------------------
    def calendar(
        self,
        start: date | datetime | str,
        end: date | datetime | str,
        symbols: Iterable[str] | None = None,
    ) -> pd.DataFrame:
        df = self._calendar_cached(_to_date_str(start), _to_date_str(end))
        if symbols is not None:
            df = df[df["symbol"].isin({s.upper() for s in symbols})].reset_index(drop=True)
        return df

    @cached(ttl_seconds=TTL_DAILY)
    def _calendar_cached(self, start: str, end: str) -> pd.DataFrame:
        data = self._http.get("/earnings-calendar", {"from": start, "to": end})
        if not data:
            return pd.DataFrame({c: pd.Series(dtype=_CALENDAR_DTYPES[c]) for c in _CALENDAR_COLS})
        rows = [
            {
                "symbol": item.get("symbol"),
                "date": _to_date(item.get("date")),
                "eps_actual": item.get("epsActual"),
                "eps_estimated": item.get("epsEstimated"),
                "revenue_actual": item.get("revenueActual"),
                "revenue_estimated": item.get("revenueEstimated"),
                "last_updated": _to_date(item.get("lastUpdated")),
                "announcement_when": _normalise_when(item.get("time")),
            }
            for item in data
        ]
        df = pd.DataFrame(rows, columns=_CALENDAR_COLS)
        df.sort_values(["date", "symbol"], inplace=True, ignore_index=True)
        return df

    # ---- surprises ----------------------------------------------------------
    def surprises(
        self,
        symbol: str,
        start: date | datetime | str,
        end: date | datetime | str,
    ) -> pd.DataFrame:
        return self._surprises_cached(
            symbol.upper(), _to_date_str(start), _to_date_str(end)
        )

    @cached(ttl_seconds=TTL_DAILY)
    def _surprises_cached(self, symbol: str, start: str, end: str) -> pd.DataFrame:
        data = self._http.get("/earnings", {"symbol": symbol, "limit": 160})
        if not data:
            return pd.DataFrame({c: pd.Series(dtype=_SURPRISE_DTYPES[c]) for c in _SURPRISE_COLS})

        rows = [
            {
                "symbol": symbol,
                "date": _to_date(item.get("date")),
                "eps_actual": item.get("epsActual"),
                "eps_estimated": item.get("epsEstimated"),
                "revenue_actual": item.get("revenueActual"),
                "revenue_estimated": item.get("revenueEstimated"),
            }
            for item in data
        ]
        df = pd.DataFrame(rows)
        df.sort_values("date", inplace=True, ignore_index=True)
        df["surprise"] = df["eps_actual"] - df["eps_estimated"]
        df["surprise_pct"] = np.where(
            df["eps_estimated"].abs() > 1e-9,
            df["surprise"] / df["eps_estimated"].abs(),
            np.nan,
        )
        # SUE = surprise / trailing std of last 8 surprises (exclusive of current)
        reported = df[df["surprise"].notna()].reset_index()
        sue_vals: list[float] = []
        for _, row in df.iterrows():
            d = row["date"]
            past = reported[reported["date"] < d]["surprise"].tail(8)
            if len(past) >= 4 and past.std(ddof=1) > 0:
                sue_vals.append(float(row["surprise"] / past.std(ddof=1)))
            else:
                sue_vals.append(float("nan"))
        df["sue"] = sue_vals
        df = df[(df["date"] >= _to_date(start)) & (df["date"] <= _to_date(end))]
        return df[_SURPRISE_COLS].reset_index(drop=True)

    # ---- consensus ----------------------------------------------------------
    def consensus(self, symbol: str, asof: date | datetime | str) -> dict:
        asof_d = _to_date(asof)
        data = self._http.get("/earnings", {"symbol": symbol.upper(), "limit": 20})
        none_result = {
            "symbol": symbol.upper(),
            "next_earnings_date": None,
            "eps_estimated": None,
            "revenue_estimated": None,
        }
        if not data:
            return none_result
        future = [r for r in data if _to_date(r.get("date")) > asof_d]
        future.sort(key=lambda r: _to_date(r.get("date")))
        if not future:
            return none_result
        nxt = future[0]
        return {
            "symbol": symbol.upper(),
            "next_earnings_date": _to_date(nxt.get("date")),
            "eps_estimated": nxt.get("epsEstimated"),
            "revenue_estimated": nxt.get("revenueEstimated"),
        }


# --- helpers ---------------------------------------------------------------
def _to_date(s: Any) -> date | None:
    if s is None:
        return None
    if isinstance(s, datetime):
        return s.date()
    if isinstance(s, date):
        return s
    try:
        return datetime.fromisoformat(str(s)[:10]).date()
    except (TypeError, ValueError):
        return None


def _to_date_str(s: Any) -> str:
    d = _to_date(s)
    if d is None:
        raise ValueError(f"cannot parse date: {s!r}")
    return d.isoformat()


def _normalise_when(v: Any) -> str:
    """Normalise FMP's ``time`` field into ``"amc" | "bmo" | "unknown"``.

    FMP returns ``"amc"`` (after-market close), ``"bmo"`` (before-market
    open), or an empty string. We emit ``"unknown"`` for anything we
    cannot classify so downstream consumers can distinguish a missing
    value from a genuine classification.
    """

    if v is None:
        return "unknown"
    s = str(v).strip().lower()
    if s in ("amc", "bmo"):
        return s
    return "unknown"
