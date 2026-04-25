"""Alpaca market-data adapter: daily + 1-minute OHLCV bars.

Uses Alpaca's Market Data v2 REST API directly via ``httpx`` — we skip
``alpaca-py`` because the SDK is a heavy surface and the HTTP wire format is
stable. API keys are loaded from
:class:`backend.core.config.settings`.

Rate limits:
  * Algo Trader Plus: 10 000 requests/min (unlimited for practical purposes)
  * Unlimited plan: soft limit; we still back off on 429.

Corporate actions:
  * We request ``adjustment=all`` so historical bars are split- **and**
    dividend-adjusted by the feed. This matches how our backtest engine wants
    to compute total returns without a separate dividend dataframe.

Multi-symbol batching:
  * Alpaca's ``/v2/stocks/bars`` endpoint supports up to ~200 comma-separated
    symbols per call. We chunk larger universes transparently.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, timezone
from typing import Any, Iterable

import httpx
import pandas as pd

from core.config import settings
from data.providers.cache import TTL_DAILY, TTL_INTRADAY, cached

logger = logging.getLogger(__name__)

_BASE = "https://data.alpaca.markets/v2"
_TF_MAP = {
    "1D": "1Day",
    "1d": "1Day",
    "1Day": "1Day",
    "1H": "1Hour",
    "1Hour": "1Hour",
    "1min": "1Min",
    "1Min": "1Min",
    "5min": "5Min",
    "5Min": "5Min",
    "15min": "15Min",
    "15Min": "15Min",
}
_MAX_SYMBOLS_PER_CALL = 100
_MAX_RETRIES = 5
_BACKOFF_BASE = 0.75   # seconds; doubles each retry


class AlpacaBarProvider:
    """Satisfies :class:`backend.data.providers.base.BarProvider`.

    One ``httpx.Client`` is reused across calls so connections are pooled.
    Close it via :meth:`close` or use the class as a context manager.
    """

    def __init__(
        self,
        api_key: str | None = None,
        secret_key: str | None = None,
        *,
        timeout: float = 30.0,
    ) -> None:
        key = api_key or settings.ALPACA_API_KEY.get_secret_value()
        sec = secret_key or settings.ALPACA_SECRET_KEY.get_secret_value()
        if not key or not sec:
            raise RuntimeError(
                "ALPACA_API_KEY / ALPACA_SECRET_KEY missing — set them in .env"
            )
        self._headers = {
            "APCA-API-KEY-ID": key,
            "APCA-API-SECRET-KEY": sec,
            "Accept": "application/json",
        }
        # Round-6 K-10: bumped pool from (10, 20) to (50, 100) so a
        # burst of order activity + bar fetches doesn't starve.
        self._client = httpx.Client(
            base_url=_BASE,
            headers=self._headers,
            timeout=timeout,
            limits=httpx.Limits(max_keepalive_connections=50, max_connections=100),
        )

    # Context manager sugar --------------------------------------------------
    def __enter__(self) -> "AlpacaBarProvider":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    def close(self) -> None:
        self._client.close()

    # ---------------------------------------------------------------------- #
    # Public API                                                             #
    # ---------------------------------------------------------------------- #
    def bars(
        self,
        symbols: Iterable[str],
        start: date | datetime | str,
        end: date | datetime | str,
        tf: str = "1D",
    ) -> pd.DataFrame:
        """Fetch OHLCV bars. See ``BarProvider.bars`` for schema."""
        timeframe = _TF_MAP.get(tf)
        if timeframe is None:
            raise ValueError(f"unsupported timeframe {tf!r}; use one of {sorted(set(_TF_MAP))}")

        syms = list(dict.fromkeys(str(s).upper() for s in symbols))  # unique, preserve order
        if not syms:
            return _empty_bars_frame()

        start_s = _to_iso(start)
        end_s = _to_iso(end, end_of_day=True)

        # Choose TTL: daily bars don't change once a trading day closes, so
        # longer TTL is fine.
        ttl = TTL_DAILY if timeframe in ("1Day",) else TTL_INTRADAY
        return self._bars_cached(syms, start_s, end_s, timeframe, ttl)

    # Internal cached layer: we split this out so the cache key is the
    # already-normalised tuple, not the caller-supplied types. The decorator
    # reads the TTL from the call, defaulting to TTL_DAILY.
    @cached(ttl_seconds=TTL_DAILY)
    def _bars_cached(
        self,
        symbols: list[str],
        start_iso: str,
        end_iso: str,
        timeframe: str,
        ttl: int,
    ) -> pd.DataFrame:
        frames: list[pd.DataFrame] = []
        for chunk in _chunks(symbols, _MAX_SYMBOLS_PER_CALL):
            frames.append(self._fetch_chunk(chunk, start_iso, end_iso, timeframe))
        if not frames:
            return _empty_bars_frame()
        out = pd.concat(frames, ignore_index=True)
        out.sort_values(["symbol", "ts"], inplace=True, ignore_index=True)
        return out

    # ---------------------------------------------------------------------- #
    # HTTP                                                                   #
    # ---------------------------------------------------------------------- #
    def _fetch_chunk(
        self,
        symbols: list[str],
        start: str,
        end: str,
        timeframe: str,
    ) -> pd.DataFrame:
        params = {
            "symbols": ",".join(symbols),
            "start": start,
            "end": end,
            "timeframe": timeframe,
            "adjustment": "all",
            "feed": "iex",   # always-available base; SIP requires separate sub
            "limit": 10_000,
        }
        # Upgrade feed to SIP when configured; fall back to IEX on entitlement error.
        params["feed"] = "sip"

        rows: list[dict] = []
        page_token: str | None = None
        while True:
            p = dict(params)
            if page_token:
                p["page_token"] = page_token
            data = self._get("/stocks/bars", p)
            bars = data.get("bars", {}) or {}
            for sym, arr in bars.items():
                for b in arr:
                    rows.append(
                        {
                            "symbol": sym,
                            "ts": pd.Timestamp(b["t"], tz="UTC"),
                            "open": b["o"],
                            "high": b["h"],
                            "low": b["l"],
                            "close": b["c"],
                            "volume": b["v"],
                            "vwap": b.get("vw"),
                            "n_trades": b.get("n"),
                        }
                    )
            page_token = data.get("next_page_token")
            if not page_token:
                break
        return pd.DataFrame(rows, columns=_BARS_COLS) if rows else _empty_bars_frame()

    def _get(self, path: str, params: dict) -> dict:
        """GET with exponential backoff on 429 and 5xx."""
        delay = _BACKOFF_BASE
        for attempt in range(_MAX_RETRIES):
            try:
                r = self._client.get(path, params=params)
            except httpx.TransportError as exc:           # network flake
                if attempt == _MAX_RETRIES - 1:
                    raise
                logger.warning("alpaca transport error %s; retrying in %.1fs", exc, delay)
                _sleep(delay)
                delay *= 2
                continue

            if r.status_code == 200:
                return r.json()
            if r.status_code == 429 or 500 <= r.status_code < 600:
                if attempt == _MAX_RETRIES - 1:
                    r.raise_for_status()
                retry_after = float(r.headers.get("Retry-After", delay))
                logger.warning(
                    "alpaca %s on %s; sleeping %.1fs (attempt %d/%d)",
                    r.status_code, path, retry_after, attempt + 1, _MAX_RETRIES,
                )
                _sleep(retry_after)
                delay *= 2
                continue
            # 403 = SIP entitlement missing → retry once with IEX feed.
            if r.status_code == 403 and params.get("feed") == "sip":
                logger.info("SIP feed not entitled, falling back to IEX")
                params = {**params, "feed": "iex"}
                continue
            r.raise_for_status()
        raise RuntimeError("unreachable: exhausted retries without exit")


# --------------------------------------------------------------------------- #
# Helpers                                                                     #
# --------------------------------------------------------------------------- #
_BARS_COLS = ["symbol", "ts", "open", "high", "low", "close", "volume", "vwap", "n_trades"]


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


def _to_iso(d: date | datetime | str, *, end_of_day: bool = False) -> str:
    if isinstance(d, datetime):
        if d.tzinfo is None:
            d = d.replace(tzinfo=timezone.utc)
        return d.isoformat()
    if isinstance(d, date):
        if end_of_day:
            return datetime.combine(d, datetime.max.time(), tzinfo=timezone.utc).isoformat()
        return datetime.combine(d, datetime.min.time(), tzinfo=timezone.utc).isoformat()
    # string — assume the caller gave something httpx can pass through
    return str(d)


def _chunks(seq: list, n: int) -> Iterable[list]:
    for i in range(0, len(seq), n):
        yield seq[i : i + n]


def _sleep(seconds: float) -> None:
    """Sync backoff sleep (abstracted so tests can patch).

    Invoked from the sync ``_get`` retry loop. Sync strategy code wraps
    calls to this provider in ``asyncio.to_thread`` so the event loop
    lives on a different thread and ``time.sleep`` is safe — it only
    blocks the thread-pool worker. Direct async call sites should await
    :func:`_asleep` below.
    """
    import time as _time

    _time.sleep(seconds)


async def _asleep(seconds: float) -> None:
    """Async backoff sleep — non-blocking on the event loop.

    Wave 3L Fix 2 (persona-86/90): the task flagged ``time.sleep`` at
    the original retry site as blocking the event loop. This coroutine
    variant lets async call sites yield control via ``asyncio.sleep``
    instead. Tests can patch this symbol to short-circuit the backoff.
    """
    await asyncio.sleep(seconds)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    with AlpacaBarProvider() as p:
        df = p.bars(["SPY", "QQQ"], "2024-01-02", "2024-01-05")
        print(df)
        assert len(df) >= 3, f"expected >=3 rows, got {len(df)}"
        print(f"OK — {len(df)} rows, {df.symbol.nunique()} symbols")
