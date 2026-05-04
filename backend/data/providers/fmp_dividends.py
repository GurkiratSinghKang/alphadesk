"""FMP dividends provider: ex-dividend calendar + per-symbol history.

Plan C.2 prework: thin wrapper around FMP stable's
``/dividends-calendar`` and ``/historical-price-full/stock_dividend``
endpoints. Mirrors the shape and TTL conventions of
:class:`FMPEarningsProvider` so the daily pipeline can pre-fetch a
window of upcoming ex-dividend events for the dividend_capture strategy.

Schema (calendar):
    symbol, ex_date, declaration_date, record_date, payment_date,
    cash_amount, adj_cash_amount, frequency

Schema (per-symbol history):
    symbol, ex_date, cash_amount, record_date, payment_date

The strategy reads the calendar via ``StrategyInput.dividends`` (added
in this same milestone) — provider plumbing into the runner pre-fetch
path is a follow-on change.
"""

from __future__ import annotations

import logging
from datetime import date, datetime
from typing import Any, Iterable

import pandas as pd

from data.providers._fmp_http import FMPHTTP
from data.providers.cache import TTL_DAILY, cached


log = logging.getLogger(__name__)


_CALENDAR_COLS = [
    "symbol", "ex_date",
    "declaration_date", "record_date", "payment_date",
    "cash_amount", "adj_cash_amount", "frequency",
]
_HISTORY_COLS = ["symbol", "ex_date", "cash_amount", "record_date", "payment_date"]
_CALENDAR_DTYPES: dict[str, Any] = {
    "symbol": "str",
    "ex_date": "object",
    "declaration_date": "object",
    "record_date": "object",
    "payment_date": "object",
    "cash_amount": "float64",
    "adj_cash_amount": "float64",
    "frequency": "str",
}


class FMPDividendsProvider:
    """Satisfies the dividend-calendar protocol used by dividend_capture.

    Empty-frame fallbacks preserve dtypes (matches the FMPEarningsProvider
    convention, B-82) so downstream pandas operations behave identically
    whether or not FMP returned rows.
    """

    def __init__(self, api_key: str | None = None, timeout: float = 30.0) -> None:
        self._http = FMPHTTP(api_key, timeout)

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> "FMPDividendsProvider":
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
        """Upcoming / past ex-dividend events in the given window.

        FMP stable endpoint is ``/dividends-calendar``. Optional ``symbols``
        filter is applied client-side after the bulk fetch.
        """
        df = self._calendar_cached(_to_date(start), _to_date(end))
        if symbols:
            sym_set = {s.upper() for s in symbols}
            df = df[df["symbol"].astype(str).str.upper().isin(sym_set)]
        return df.reset_index(drop=True)

    @cached(ttl_seconds=TTL_DAILY)
    def _calendar_cached(self, start: date, end: date) -> pd.DataFrame:
        try:
            data = self._http.get(
                "/dividends-calendar",
                {"from": start.isoformat(), "to": end.isoformat()},
            )
        except Exception as exc:  # pragma: no cover - HTTP errors logged
            log.warning("fmp dividends-calendar fetch failed: %s", exc)
            return _empty_calendar()
        if not data:
            return _empty_calendar()

        df = pd.DataFrame(data)
        # FMP stable returns a mix of camelCase / snake_case; normalize.
        rename = {
            "date": "ex_date",
            "dividend": "cash_amount",
            "adjDividend": "adj_cash_amount",
            "declarationDate": "declaration_date",
            "recordDate": "record_date",
            "paymentDate": "payment_date",
        }
        df = df.rename(columns=rename)
        for col in _CALENDAR_COLS:
            if col not in df.columns:
                df[col] = pd.NA
        # Coerce date columns to python date objects; numeric columns stay float
        for date_col in ("ex_date", "declaration_date", "record_date", "payment_date"):
            df[date_col] = pd.to_datetime(df[date_col], errors="coerce").dt.date
        for num_col in ("cash_amount", "adj_cash_amount"):
            df[num_col] = pd.to_numeric(df[num_col], errors="coerce")
        df = df[df["ex_date"].notna() & df["symbol"].notna()]
        df["symbol"] = df["symbol"].astype(str).str.upper()
        return df[_CALENDAR_COLS].reset_index(drop=True)

    # ---- per-symbol history -------------------------------------------------
    def history(self, symbol: str) -> pd.DataFrame:
        """Full ex-dividend history for one symbol.

        Endpoint: ``/historical-price-full/stock_dividend``. Used for
        sanity-checking + tax-aware holding-period analysis.
        """
        return self._history_cached(symbol.upper())

    @cached(ttl_seconds=TTL_DAILY)
    def _history_cached(self, symbol: str) -> pd.DataFrame:
        try:
            data = self._http.get(
                "/historical-price-full/stock_dividend",
                {"symbol": symbol},
            )
        except Exception as exc:  # pragma: no cover
            log.warning("fmp dividend history fetch failed for %s: %s", symbol, exc)
            return _empty_history()
        # FMP returns either a flat list, or {"symbol": ..., "historical": [...]}
        if isinstance(data, dict) and "historical" in data:
            rows = data["historical"]
            sym = data.get("symbol", symbol)
        else:
            rows = data or []
            sym = symbol
        if not rows:
            return _empty_history()

        df = pd.DataFrame(rows)
        df["symbol"] = sym
        rename = {
            "date": "ex_date",
            "dividend": "cash_amount",
            "recordDate": "record_date",
            "paymentDate": "payment_date",
        }
        df = df.rename(columns=rename)
        for col in _HISTORY_COLS:
            if col not in df.columns:
                df[col] = pd.NA
        for date_col in ("ex_date", "record_date", "payment_date"):
            df[date_col] = pd.to_datetime(df[date_col], errors="coerce").dt.date
        df["cash_amount"] = pd.to_numeric(df["cash_amount"], errors="coerce")
        df = df[df["ex_date"].notna()]
        return df[_HISTORY_COLS].sort_values("ex_date", ascending=False).reset_index(drop=True)


# --------------------------------------------------------------------------- #
# Helpers                                                                     #
# --------------------------------------------------------------------------- #
def _to_date(s: date | datetime | str) -> date:
    if isinstance(s, datetime):
        return s.date()
    if isinstance(s, date):
        return s
    return datetime.fromisoformat(str(s)[:10]).date()


def _empty_calendar() -> pd.DataFrame:
    df = pd.DataFrame(columns=_CALENDAR_COLS)
    return df.astype(_CALENDAR_DTYPES, errors="ignore")


def _empty_history() -> pd.DataFrame:
    return pd.DataFrame(columns=_HISTORY_COLS)


__all__ = ["FMPDividendsProvider"]
