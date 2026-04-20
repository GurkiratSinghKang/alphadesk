"""Polygon contract-listing + historical-pricing helpers for the
earnings_vol strategy.

The upstream :class:`PolygonOptionsProvider.chain_snapshot` uses
``as_of=<date>`` which Polygon interprets as "contracts active up to that
date" — i.e. only contracts that had already expired by ``asof`` are
returned. For our use case (T-1 close entry on the upcoming front-weekly
expiration) we need the opposite: contracts expiring shortly **after**
``asof`` but whose price data we can still fetch historically.

This module wraps the Polygon HTTP client and exposes two functions:

- :func:`list_weekly_contracts` — all contracts for ``underlying`` whose
  expiration is in ``[asof, asof + max_dte]``. Returns a chain-shaped
  DataFrame with contract_ticker + expiration + strike + option_type.
- :func:`contract_close` — daily close for a given contract on an arbitrary
  historical date (uses :meth:`OptionsProvider.contract_bars`).

Both honour the engine's cache via the ``@cached`` decorator to keep
tuning cheap.
"""

from __future__ import annotations

import logging
from datetime import date, datetime
from typing import Any, Optional

import pandas as pd

log = logging.getLogger("alphadesk.strategies.earnings_vol.polygon_helpers")


# --------------------------------------------------------------------------- #
# Simple LRU cache over the underlying HTTP path.                             #
# --------------------------------------------------------------------------- #
_CONTRACTS_CACHE: dict[tuple[str, str, str], pd.DataFrame] = {}
_BARS_CACHE: dict[tuple[str, str], Optional[float]] = {}
_CACHE_MAX = 4096


def _cache_get(d: dict, key) -> Any:
    return d.get(key)


def _cache_put(d: dict, key, value) -> None:
    if len(d) >= _CACHE_MAX:
        d.pop(next(iter(d)))
    d[key] = value


def list_weekly_contracts(
    options_provider: Any,
    underlying: str,
    asof: date,
    min_dte: int = 0,
    max_dte: int = 45,
) -> pd.DataFrame:
    """List all option contracts for ``underlying`` expiring in the
    window ``[asof + min_dte, asof + max_dte]``.

    Uses a direct HTTP call through the wrapped provider's ``_http``
    attribute (the :class:`PolygonHTTP` client). Returns a DataFrame with
    columns matching :mod:`backend.data.providers.polygon_options`
    ``_CHAIN_COLS`` so the strategy's existing pricing helpers work.

    Why this wrapper: the upstream provider's ``chain_snapshot`` uses
    ``as_of=asof`` which Polygon interprets as "contracts active on or
    before ``asof``", i.e. only already-expired ones. We need
    ``expiration_date.gte=asof`` without ``as_of`` to pick up the
    imminently-expiring contracts.
    """

    if not hasattr(options_provider, "_http"):
        raise AttributeError(
            "list_weekly_contracts expects an options provider with a "
            "_http attribute (PolygonHTTP). Got: "
            f"{type(options_provider).__name__}"
        )

    from datetime import timedelta as _td

    start_exp = (asof + _td(days=int(min_dte))).isoformat()
    end_exp = (asof + _td(days=int(max_dte))).isoformat()
    key = (underlying.upper(), start_exp, end_exp)
    cached = _cache_get(_CONTRACTS_CACHE, key)
    if cached is not None:
        return cached

    path = "/v3/reference/options/contracts"
    params = {
        "underlying_ticker": underlying.upper(),
        "expiration_date.gte": start_exp,
        "expiration_date.lte": end_exp,
        "expired": "true",       # include post-expiry; we're asking historical
        "limit": 1000,
    }
    rows: list[dict] = []
    try:
        for item in options_provider._http.paginate(path, params):
            exp = item.get("expiration_date")
            try:
                exp_d = datetime.fromisoformat(exp).date() if exp else None
            except Exception:
                exp_d = None
            rows.append(
                {
                    "contract_ticker": item.get("ticker"),
                    "underlying": underlying.upper(),
                    "expiration": exp_d,
                    "strike": item.get("strike_price"),
                    "option_type": item.get("contract_type"),
                    "bid": None, "ask": None, "last": None,
                    "volume": None, "open_interest": None,
                    "iv": None, "delta": None, "gamma": None,
                    "theta": None, "vega": None, "rho": None,
                    "asof": asof,
                }
            )
    except Exception as exc:
        log.warning("list_weekly_contracts: %s %s..%s failed: %s",
                    underlying, start_exp, end_exp, exc)
        return pd.DataFrame()

    cols = [
        "contract_ticker", "underlying", "expiration", "strike", "option_type",
        "bid", "ask", "last", "volume", "open_interest",
        "iv", "delta", "gamma", "theta", "vega", "rho", "asof",
    ]
    df = pd.DataFrame(rows, columns=cols) if rows else pd.DataFrame(columns=cols)
    _cache_put(_CONTRACTS_CACHE, key, df)
    return df


def contract_close(
    options_provider: Any,
    contract: str,
    asof: date,
) -> Optional[float]:
    """Daily close for ``contract`` on ``asof``.

    Falls back gracefully to the closest available close on or before
    ``asof`` within the last 5 sessions.
    """
    key = (contract, asof.isoformat())
    cached = _cache_get(_BARS_CACHE, key)
    if cached is not None or key in _BARS_CACHE:
        return cached

    from datetime import timedelta as _td
    try:
        bars = options_provider.contract_bars(
            contract, asof - _td(days=5), asof, tf="1D"
        )
    except Exception as exc:
        log.debug("contract_close: %s on %s failed: %s", contract, asof, exc)
        _cache_put(_BARS_CACHE, key, None)
        return None

    if bars is None or len(bars) == 0:
        _cache_put(_BARS_CACHE, key, None)
        return None
    df = pd.DataFrame(bars)
    if "ts" in df.columns and "close" in df.columns:
        df = df.copy()
        df["_date"] = pd.to_datetime(df["ts"]).dt.date
        df = df[df["_date"] <= asof]
        if not df.empty:
            try:
                val = float(df["close"].iloc[-1])
                if val > 0:
                    _cache_put(_BARS_CACHE, key, val)
                    return val
            except Exception:
                log.debug("contract_close: failed to parse close for %s %s", contract, asof, exc_info=True)
    _cache_put(_BARS_CACHE, key, None)
    return None


__all__ = [
    "list_weekly_contracts",
    "contract_close",
    "SyntheticBarProvider",
    "SYNTHETIC_LEDGER",
]


# --------------------------------------------------------------------------- #
# Synthetic-spread bar provider                                               #
# --------------------------------------------------------------------------- #
# The engine's multi-leg fill path uses the underlying bar's open/close as
# the per-spread price. That is wrong for an iron butterfly: we want the
# price to be the *net per-spread premium*. We solve this by using a
# synthetic symbol for the spread (e.g. ``EVOL:AAPL:20240503``) and
# wrapping the real BarProvider with :class:`SyntheticBarProvider`, which
# intercepts those symbols and returns a one-row DataFrame whose OHLCV is
# the computed net-spread price on ``asof``. The strategy publishes the
# (symbol, date) -> price entries through :data:`SYNTHETIC_LEDGER`; the
# wrapper reads them.
#
# The ledger is module-level (not on ``ctx.state``) because the engine
# passes the provider directly to its inner fill loop, and
# :class:`Portfolio` does not route through ``ctx``. A single-process
# backtest writes + reads in the same interpreter — safe.

SYNTHETIC_LEDGER: dict[tuple[str, date], float] = {}


class SyntheticBarProvider:
    """Wraps a real :class:`BarProvider`; intercepts synthetic ``EVOL:`` symbols.

    For any symbol in ``ctx.universe`` that begins with ``"EVOL:"`` we
    return a one-row bar on the requested session with open=high=low=close
    equal to the ledger entry. All other symbols are delegated to the
    underlying provider unmodified.
    """

    def __init__(self, inner: Any) -> None:
        self._inner = inner

    def bars(self, symbols, start, end, tf: str = "1D") -> pd.DataFrame:
        syms = list(symbols) if not isinstance(symbols, str) else [symbols]
        synthetic = [s for s in syms if str(s).startswith("EVOL:")]
        real = [s for s in syms if not str(s).startswith("EVOL:")]

        frames: list[pd.DataFrame] = []
        if real:
            try:
                df = self._inner.bars(real, start, end, tf=tf)
                if df is not None and len(df) > 0:
                    frames.append(pd.DataFrame(df))
            except Exception:
                log.debug(
                    "SyntheticBarProvider: inner.bars raised for %d real symbols",
                    len(real), exc_info=True,
                )

        if synthetic:
            start_d = pd.Timestamp(start).date()
            end_d = pd.Timestamp(end).date()
            rows = []
            # Iterate days between start and end; for each synthetic symbol
            # return a row per day it has a price in the ledger.
            from datetime import timedelta as _td
            current = start_d
            while current <= end_d:
                for sym in synthetic:
                    price = SYNTHETIC_LEDGER.get((str(sym), current))
                    if price is None:
                        continue
                    rows.append(
                        {
                            "symbol": str(sym),
                            "ts": pd.Timestamp(current),
                            "open": price,
                            "high": price,
                            "low": price,
                            "close": price,
                            "volume": 1,
                        }
                    )
                current += _td(days=1)
            if rows:
                frames.append(pd.DataFrame(rows))

        if not frames:
            return pd.DataFrame(
                columns=["symbol", "ts", "open", "high", "low", "close", "volume"]
            )
        return pd.concat(frames, ignore_index=True)

    # Passthroughs for any other methods the engine may call.
    def __getattr__(self, item):
        return getattr(self._inner, item)


def register_synthetic_price(symbol: str, asof: date, price: float) -> None:
    """Publish a synthetic bar price to the ledger."""
    SYNTHETIC_LEDGER[(symbol, asof)] = float(price)


def clear_synthetic_ledger() -> None:
    """Wipe all ledger entries (primarily for tests)."""
    SYNTHETIC_LEDGER.clear()
