"""Bounded chain-snapshot wrapper around :class:`PolygonOptionsProvider`.

The default Polygon Developer-tier historical-chain endpoint
(``/v3/reference/options/contracts?as_of=YYYY-MM-DD&expired=true``)
returns *every* expired SPY option ever listed under that as_of
cursor, paging through tens of thousands of contracts. For
VRP Harvest we only need the two expirations near 30 DTE and 60 DTE
off today; we narrow the fetch via ``expiration_date.gte`` /
``expiration_date.lte`` so each bar fetches roughly 200-400 rows
instead of 30k.

We also implement a lightweight bid/ask/last fallback on top of the
narrow contract-bars endpoint: for each relevant contract we pull a
one-bar ``contract_bars`` lookup to get its close price. The strategy
then inverts BS for IV. This lets the historical path on Polygon
Developer tier still produce usable chain snapshots with mid-price
data, not just the contract metadata.
"""

from __future__ import annotations

import concurrent.futures
import contextvars
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

import pandas as pd

from data.providers.cache import TTL_DAILY, cached
from data.providers.polygon import PolygonOptionsProvider


log = logging.getLogger(__name__)


_CHAIN_COLS = [
    "contract_ticker", "underlying", "expiration", "strike", "option_type",
    "bid", "ask", "last", "volume", "open_interest",
    "iv", "delta", "gamma", "theta", "vega", "rho", "asof",
]


def _empty() -> pd.DataFrame:
    return pd.DataFrame({c: [] for c in _CHAIN_COLS})


def _to_date(d) -> date:
    if isinstance(d, datetime):
        return d.date()
    if isinstance(d, date):
        return d
    return pd.Timestamp(d).date()


class BoundedPolygonOptionsProvider:
    """Drop-in replacement for :class:`PolygonOptionsProvider` with bounded
    historical chain fetches suitable for VRP Harvest's daily loop.

    Parameters
    ----------
    lower_dte, upper_dte:
        Keep only contracts whose expiration is within ``[asof+lower_dte,
        asof+upper_dte]`` calendar days. Defaults cover the 15-90 DTE
        window we care about (30 DTE target ± 45).
    strike_pct:
        Only fetch contracts with strikes in
        ``[spot*(1-strike_pct), spot*(1+strike_pct)]``. Default 0.25
        (covers 25 % either side of spot — enough for 25Δ and 3Δ wings).
    """

    def __init__(
        self,
        inner: Optional[PolygonOptionsProvider] = None,
        *,
        lower_dte: int = 10,
        upper_dte: int = 90,
        strike_pct: float = 0.25,
    ) -> None:
        self._inner = inner or PolygonOptionsProvider()
        self.lower_dte = int(lower_dte)
        self.upper_dte = int(upper_dte)
        self.strike_pct = float(strike_pct)
        self._chain_cache: dict[tuple[str, date], pd.DataFrame] = {}
        # Spot cache so we can bound strike range without asking the caller.
        self._spot_cache: dict[tuple[str, date], float] = {}

    # -------- lifecycle -------------------------------------------------- #
    def close(self) -> None:
        self._inner.close()

    def __enter__(self) -> "BoundedPolygonOptionsProvider":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    # -------- spot hint -------------------------------------------------- #
    def set_spot(self, underlying: str, asof: date, spot: float) -> None:
        """Strategy may call this before :meth:`chain_snapshot` so we can
        narrow the strike range. When no spot hint exists we fall back to
        a wide range.
        """

        self._spot_cache[(underlying.upper(), _to_date(asof))] = float(spot)

    # -------- chain_snapshot -------------------------------------------- #
    def chain_snapshot(self, underlying: str, asof) -> pd.DataFrame:
        asof_d = _to_date(asof)
        sym = underlying.upper()
        key = (sym, asof_d)
        if key in self._chain_cache:
            return self._chain_cache[key]

        today = datetime.now(timezone.utc).date()
        if asof_d >= today:
            # Live endpoint already narrow-ish; delegate to the inner
            # provider. It returns Greeks on the snapshot.
            df = self._inner.chain_snapshot(sym, asof_d)
            self._chain_cache[key] = df
            return df

        df = self._fetch_bounded_contracts(sym, asof_d)
        if df is None or df.empty:
            self._chain_cache[key] = _empty()
            return self._chain_cache[key]

        # Enrich with a single-bar lookup for each contract ("last" close).
        df = self._enrich_with_last_close(df, asof_d)
        self._chain_cache[key] = df
        return df

    # -------- helpers --------------------------------------------------- #
    def _fetch_bounded_contracts(self, sym: str, asof_d: date) -> pd.DataFrame:
        """Paginate /v3/reference/options/contracts with bounded expiration.

        Delegates the actual HTTP work to a cached module-level helper so
        the result is persisted to ``~/.alphadesk/cache/`` and shared
        across trials. Spot-based narrowing is done *after* fetch so the
        cache key never depends on today's spot.
        """

        df = _fetch_contracts_cached(
            sym, asof_d.isoformat(), self.lower_dte, self.upper_dte,
            http_source=self._inner._http,
        )
        # Spot-based post-filter (does not affect the cached payload).
        spot = self._spot_cache.get((sym, asof_d))
        if spot is not None and self.strike_pct > 0 and not df.empty:
            mask = (df["strike"].astype(float) >= spot * (1.0 - self.strike_pct)) & (
                df["strike"].astype(float) <= spot * (1.0 + self.strike_pct)
            )
            df = df[mask].copy()
        return df

    def _enrich_with_last_close(
        self, df: pd.DataFrame, asof_d: date
    ) -> pd.DataFrame:
        """For each of a carefully selected subset of contracts in ``df``,
        pull the aggregate bar for ``asof`` and fill the ``last`` column.

        To minimise HTTP traffic we only enrich:
        - the two target expirations closest to 30 and 60 DTE (sufficient
          for IV_30, IV_60, and strangle/hedge leg selection)
        - a strike window of roughly ±12 % of spot (covers 25Δ, 16Δ, 10Δ,
          5Δ, and 3Δ wings on the put side, plus the ATM reading)
        - SPY trades at $1 strike increments for weeklies, so we down-sample
          to every 2 strikes which is still finer than we need.

        Contracts with no bar on ``asof`` are dropped from the returned
        DataFrame entirely (they are typically pre-listing or zero-volume
        junk strikes the leg-selector would ignore anyway).
        """

        if df is None or df.empty:
            return df

        inner = self._inner
        sym = df["underlying"].iloc[0]
        spot = self._spot_cache.get((sym.upper(), asof_d))
        # Only keep the two expirations closest to 30 and 60 DTE.
        exps = sorted({e for e in df["expiration"].unique() if e is not None})
        target_front = min(exps, key=lambda e: abs((e - asof_d).days - 30), default=None)
        target_back = min(exps, key=lambda e: abs((e - asof_d).days - 60), default=None)
        keep_exps = set(filter(None, [target_front, target_back]))
        df = df[df["expiration"].isin(keep_exps)].copy()

        if spot is not None:
            mask = (df["strike"].astype(float) >= spot * 0.88) & (
                df["strike"].astype(float) <= spot * 1.12
            )
            df = df[mask].copy()

        # Down-sample strikes to every $2 (SPY has $1 weekly + $5 monthly
        # strikes; $2 step keeps 16Δ and 5Δ both well covered but halves
        # the number of per-contract bar requests on weeklies).
        if not df.empty:
            df = df[df["strike"].astype(float) % 2 == 0].copy() if len(df) > 40 else df

        start_iso = (asof_d - timedelta(days=4)).isoformat()
        end_iso = asof_d.isoformat()
        tickers = [ct for ct in df["contract_ticker"].dropna().unique()]
        lasts: dict[str, float] = {}
        bids: dict[str, float] = {}
        asks: dict[str, float] = {}

        def _fetch_one(ct: str) -> tuple[str, Optional[float]]:
            try:
                bars = inner.contract_bars(ct, start_iso, end_iso, tf="1D")
            except Exception:
                return ct, None
            if bars is None or bars.empty:
                return ct, None
            bars = bars.sort_values("ts")
            px = float(bars["close"].iloc[-1])
            return ct, px if px > 0 else None

        if tickers:
            with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
                for ct, px in pool.map(_fetch_one, tickers):
                    if px is None:
                        continue
                    lasts[ct] = px
                    bids[ct] = px * 0.95
                    asks[ct] = px * 1.05
        df = df.copy()
        df["last"] = df["contract_ticker"].map(lasts)
        df["bid"] = df["contract_ticker"].map(bids)
        df["ask"] = df["contract_ticker"].map(asks)
        # Drop contracts for which enrichment produced nothing.
        df = df[df["last"].notna()].copy()
        return df

    # -------- contract_bars + historical_iv passthroughs ---------------- #
    def contract_bars(self, contract, start, end, tf: str = "1D"):
        return self._inner.contract_bars(contract, start, end, tf=tf)

    def historical_iv(self, underlying, start, end):
        return self._inner.historical_iv(underlying, start, end)


# --------------------------------------------------------------------------- #
# Module-level cached fetcher                                                 #
# --------------------------------------------------------------------------- #
class _ContractsCacheProxy:
    """Tiny shim that :func:`cached` attaches to so the cache key includes
    the provider class name. The cache decorator strips ``self`` from the
    key, so we use this module-level class for deterministic key building
    independent of any single :class:`BoundedPolygonOptionsProvider`
    instance.
    """

    @cached(ttl_seconds=TTL_DAILY * 4)
    def fetch(
        self,
        sym: str,
        asof_iso: str,
        lower_dte: int,
        upper_dte: int,
    ) -> pd.DataFrame:
        """Perform the bounded Polygon contracts listing.

        The actual HTTP client is passed via a ``contextvars.ContextVar``
        handoff so the cached signature stays minimal. ContextVar is
        asyncio-safe — concurrent VRP chain fetches each see their own
        client (concurrency-audit-r4 P0 #1).
        """

        http = _PENDING_HTTP.get()
        if http is None:
            raise RuntimeError(
                "_fetch_contracts_cached: no _PENDING_HTTP installed; "
                "this function must be called via _fetch_contracts_cached()."
            )
        asof_d = date.fromisoformat(asof_iso)
        exp_lo = (asof_d + timedelta(days=int(lower_dte))).isoformat()
        exp_hi = (asof_d + timedelta(days=int(upper_dte))).isoformat()
        params: dict[str, Any] = {
            "underlying_ticker": sym,
            "as_of": asof_d.isoformat(),
            "expired": "false",
            "limit": 1000,
            "expiration_date.gte": exp_lo,
            "expiration_date.lte": exp_hi,
        }
        rows: list[dict] = []
        try:
            for item in http.paginate("/v3/reference/options/contracts", params):
                rows.append(
                    {
                        "contract_ticker": item.get("ticker"),
                        "underlying": sym,
                        "expiration": pd.to_datetime(
                            item.get("expiration_date"), errors="coerce"
                        ).date()
                        if item.get("expiration_date")
                        else None,
                        "strike": item.get("strike_price"),
                        "option_type": item.get("contract_type"),
                        "bid": None, "ask": None, "last": None,
                        "volume": None, "open_interest": None,
                        "iv": None, "delta": None, "gamma": None,
                        "theta": None, "vega": None, "rho": None,
                        "asof": asof_d,
                    }
                )
        except Exception:
            log.exception("bounded contract fetch failed for %s %s", sym, asof_d)
        return pd.DataFrame(rows, columns=_CHAIN_COLS) if rows else _empty()


_PROXY = _ContractsCacheProxy()
# ContextVar so concurrent VRP chain fetches don't clobber each other's HTTP
# client. Each asyncio task / thread sees its own value (concurrency-audit-r4
# P0 #1). We deliberately do NOT use a module-level mutable global here.
_PENDING_HTTP: contextvars.ContextVar[Optional[Any]] = contextvars.ContextVar(
    "_vrp_pending_http", default=None,
)


def _fetch_contracts_cached(
    sym: str,
    asof_iso: str,
    lower_dte: int,
    upper_dte: int,
    *,
    http_source: Any,
) -> pd.DataFrame:
    """Module-level entry point to the cached contracts listing."""

    token = _PENDING_HTTP.set(http_source)
    try:
        return _PROXY.fetch(sym, asof_iso, int(lower_dte), int(upper_dte))
    finally:
        _PENDING_HTTP.reset(token)


__all__ = ["BoundedPolygonOptionsProvider"]
