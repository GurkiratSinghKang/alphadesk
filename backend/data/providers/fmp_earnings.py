"""FMP earnings provider: calendar, per-symbol surprises, consensus."""

from __future__ import annotations

import csv
import json
import logging
from datetime import date, datetime
from pathlib import Path
from typing import Any, Iterable

import numpy as np
import pandas as pd

from core.config import settings
from data.providers._fmp_http import FMPHTTP
from data.providers.cache import TTL_DAILY, cached

log = logging.getLogger(__name__)

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
        df = self._calendar_cached(
            _to_date_str(start),
            _to_date_str(end),
            settings.EARNINGS_TIME_SOURCE_PATH or "",
        )
        if symbols is not None:
            df = df[df["symbol"].isin({s.upper() for s in symbols})].reset_index(drop=True)
        return df

    # Round-12 / EC-2 (P2): tightened from TTL_DAILY (7 days) to 1 hour.
    # FMP updates the ``announcement_when`` field intraday — a row that
    # arrived as "unknown" in the morning often becomes "amc" by lunch
    # and Bloomberg confirms by mid-afternoon. With a 7-day TTL the
    # ``_classify_report_state`` cutover (09:30 / 16:30 ET) ran against
    # stale "unknown" data — DMT was treated like BMO and the row's
    # state went stale. 1 hour matches typical broker-side latency on
    # FMP's calendar refresh and survives the BMO/AMC same-day cutover.
    @cached(ttl_seconds=60 * 60)
    def _calendar_cached(
        self,
        start: str,
        end: str,
        announcement_time_source_path: str = "",
    ) -> pd.DataFrame:
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
        df = _apply_announcement_time_source(df, announcement_time_source_path)
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
        # Batch P / P-5: ``> asof_d`` was a strict-future filter, which
        # excluded today's reports. The detail-page fallback path
        # (:func:`services.earnings_screener._fetch_next_earnings_date`)
        # therefore returned ``None`` whenever the symbol was reporting
        # later today — exactly the case where the user most expects the
        # detail page to render. Switch to ``>= asof_d`` so an event
        # printing AMC today or BMO this morning is still surfaced as
        # the "next" earnings date. The downstream consumer treats the
        # date as a planning anchor, not a strictly-future projection.
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
        future = [r for r in data if (_to_date(r.get("date")) or date.min) >= asof_d]
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


def _apply_announcement_time_source(df: pd.DataFrame, source_path: str) -> pd.DataFrame:
    """Overlay operator-supplied AMC/BMO timing onto the FMP calendar.

    FMP's stable calendar keeps the ``time`` field in its schema but often
    sends ``null`` for every row. A local CSV/JSON source gives ops a clean
    place to ingest a paid vendor export without PEAD or the earnings UI
    learning vendor-specific formats.
    """

    if not source_path or df.empty:
        return df
    overrides = _load_announcement_time_source(source_path)
    if not overrides:
        return df

    out = df.copy()
    applied = 0
    values: list[str] = []
    for row in out[["symbol", "date", "announcement_when"]].itertuples(index=False):
        key = (str(row.symbol).upper(), row.date)
        override = overrides.get(key)
        if override in {"amc", "bmo"}:
            values.append(override)
            applied += 1
        else:
            values.append(row.announcement_when)
    out["announcement_when"] = values
    if applied:
        log.info(
            "applied %d earnings announcement-time overrides from %s",
            applied,
            source_path,
        )
    return out


def _load_announcement_time_source(source_path: str) -> dict[tuple[str, date], str]:
    path = Path(source_path).expanduser()
    if not path.is_absolute():
        path = Path.cwd() / path
    if not path.exists():
        log.warning("earnings announcement-time source missing: %s", path)
        return {}

    try:
        if path.suffix.lower() == ".json":
            raw = json.loads(path.read_text())
            rows = list(_iter_json_time_rows(raw))
        else:
            with path.open(newline="") as f:
                rows = list(csv.DictReader(f))
    except (OSError, json.JSONDecodeError, csv.Error) as exc:
        log.warning("earnings announcement-time source unreadable: %s", exc)
        return {}

    out: dict[tuple[str, date], str] = {}
    for row in rows:
        symbol = str(
            row.get("symbol")
            or row.get("ticker")
            or row.get("Symbol")
            or row.get("Ticker")
            or ""
        ).strip().upper()
        dt = _to_date(
            row.get("date")
            or row.get("report_date")
            or row.get("earnings_date")
            or row.get("Date")
        )
        when = _normalise_when(
            row.get("announcement_when")
            or row.get("report_time")
            or row.get("time")
            or row.get("timing")
            or row.get("when")
        )
        if symbol and dt is not None and when in {"amc", "bmo"}:
            out[(symbol, dt)] = when
    return out


def _iter_json_time_rows(raw: Any) -> Iterable[dict[str, Any]]:
    if isinstance(raw, list):
        for row in raw:
            if isinstance(row, dict):
                yield row
        return
    if not isinstance(raw, dict):
        return
    for key, value in raw.items():
        if isinstance(value, dict):
            row = dict(value)
        else:
            row = {"announcement_when": value}
        if "symbol" not in row or "date" not in row:
            parts = str(key).replace(":", "|").split("|")
            if len(parts) >= 2:
                row.setdefault("symbol", parts[0])
                row.setdefault("date", parts[1])
        yield row
