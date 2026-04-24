# backend/strategies/_core/providers.py
"""Provider abstractions + factories. Thin facades over existing AlphaDesk
backend provider classes (AlpacaBarProvider, FMPEarningsProvider, etc).

Runners accept a ProviderBundle rather than individual providers so
tests can swap in fakes easily.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Protocol

import pandas as pd


class BarProvider(Protocol):
    def fetch_window(
        self, symbols: list[str], asof: date, lookback_days: int
    ) -> pd.DataFrame:
        """Return bars for `symbols` over the `lookback_days` window ending at `asof`.

        Returned DataFrame has columns (open, high, low, close, volume) and
        a multi-index of (date, symbol). Missing symbols are omitted silently;
        callers handle empty windows.
        """
        ...


class EarningsProvider(Protocol):
    def fetch_window(
        self, symbols: list[str], asof: date, lookback_days: int
    ) -> pd.DataFrame:
        """Return earnings announcements for `symbols` over the window.

        DataFrame columns: symbol, report_date, report_time (BMO/AMC/DMT),
        eps_actual, eps_est, surprise.
        """
        ...


class FundamentalsProvider(Protocol):
    def snapshot(
        self, symbols: list[str], asof: date
    ) -> pd.DataFrame:
        """Return a point-in-time fundamentals snapshot for `symbols` on `asof`."""
        ...


class ProviderBundle:
    """Container for all providers a strategy might need. Not all strategies
    use all providers; missing providers are None and accessed via conditional
    checks in the runner."""

    def __init__(
        self,
        bars: BarProvider,
        earnings: EarningsProvider | None = None,
        fundamentals: FundamentalsProvider | None = None,
    ):
        self.bars = bars
        self.earnings = earnings
        self.fundamentals = fundamentals


class _AlpacaBarAdapter:
    """Bridge ``AlpacaBarProvider.bars(symbols, start, end, tf)`` to the
    ``fetch_window(symbols, asof, lookback_days)`` protocol.

    The runner expects a ``(date, symbol)`` multi-index frame with OHLCV
    columns; AlpacaBarProvider returns a flat ``symbol/ts/open/.../volume``
    frame, so we convert here.
    """

    def __init__(self, inner: "AlpacaBarProvider"):
        self._inner = inner

    def fetch_window(
        self, symbols: list[str], asof: date, lookback_days: int
    ) -> pd.DataFrame:
        start = asof - timedelta(days=lookback_days)
        frame = self._inner.bars(symbols, start, asof, tf="1D")
        if frame is None or getattr(frame, "empty", True):
            return pd.DataFrame(
                columns=["open", "high", "low", "close", "volume"],
            )
        df = pd.DataFrame(frame)
        # Normalise ts → date, set multi-index (date, symbol).
        ts_col = next(
            (c for c in ("ts", "timestamp", "date") if c in df.columns),
            None,
        )
        if ts_col is None:
            return df
        df = df.copy()
        df["date"] = pd.to_datetime(df[ts_col], utc=True, errors="coerce") \
            .dt.tz_convert("UTC").dt.date
        df["symbol"] = df["symbol"].astype(str).str.upper()
        keep = [c for c in ("open", "high", "low", "close", "volume") if c in df.columns]
        df = df[["date", "symbol", *keep]].dropna(subset=["date", "symbol"])
        return df.set_index(["date", "symbol"]).sort_index()


class _FMPEarningsAdapter:
    """Bridge ``FMPEarningsProvider.calendar(start, end, symbols)`` to the
    ``fetch_window`` protocol."""

    def __init__(self, inner: "FMPEarningsProvider"):
        self._inner = inner

    def fetch_window(
        self, symbols: list[str], asof: date, lookback_days: int
    ) -> pd.DataFrame:
        # Caller's lookback_days covers the backward window (history for
        # SUE computation); we extend forward by a conservative 60 days so
        # strategies that check upcoming events within dte_target see them.
        start = asof - timedelta(days=lookback_days)
        end = asof + timedelta(days=60)
        try:
            frame = self._inner.calendar(start, end, symbols=symbols)
        except Exception:
            return pd.DataFrame()
        return frame if frame is not None else pd.DataFrame()


def default_provider_bundle() -> ProviderBundle:
    """Return a ProviderBundle wired to the current AlphaDesk backend providers.

    Uses lazy imports to avoid circular-import issues when strategies/_core
    is imported at module-load time by the registry machinery.

    Raises ImportError or configuration errors if backend providers are not
    properly configured (e.g. missing ALPACA_API_KEY). Tests that exercise
    this function should be marked skipif ALPACA_API_KEY is unset.
    """
    # Lazy imports to keep strategies/_core/ independent of data/providers.
    from data.providers.alpaca import AlpacaBarProvider
    from data.providers.fmp_earnings import FMPEarningsProvider

    return ProviderBundle(
        bars=_AlpacaBarAdapter(AlpacaBarProvider()),
        earnings=_FMPEarningsAdapter(FMPEarningsProvider()),
        fundamentals=None,
    )
