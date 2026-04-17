"""pytest fixtures for the strategy framework tests.

Provides:

- sys.path setup so ``import backend.strategies.*`` works from any cwd
  (the legacy strategy modules in this package still import via
  ``from strategies.base``, so ``backend/`` must also be on the path);
- :func:`fresh_registry` -- wipes the registry before and after each test
  so decorators don't bleed across test files;
- :func:`fake_bar_provider` -- an in-memory :class:`BarProvider`
  implementation that returns a constant random-walk OHLCV series;
- :func:`spy_2020_q1_bars` -- a small real-data-shaped fixture (SPY
  2020-01-01 .. 2020-03-31, offline). If a real provider is available via
  ``backend.data.providers.cache.CachedBarProvider``, we pull from that;
  otherwise we synthesise a deterministic sample so unit tests never hit
  the network.
"""

from __future__ import annotations

import os
import sys
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Iterable

import numpy as np
import pandas as pd
import pytest


# --------------------------------------------------------------------------- #
# Path setup                                                                  #
# --------------------------------------------------------------------------- #
_REPO_ROOT = Path(__file__).resolve().parents[3]
_BACKEND = _REPO_ROOT / "backend"

for p in (_REPO_ROOT, _BACKEND):
    p_str = str(p)
    if p_str not in sys.path:
        sys.path.insert(0, p_str)


# --------------------------------------------------------------------------- #
# Registry isolation                                                          #
# --------------------------------------------------------------------------- #
@pytest.fixture
def fresh_registry():
    """Clear the strategy registry before the test and restore after.

    Use this in any test that calls :func:`register_strategy` directly or
    :func:`load_all`; otherwise registrations from one test leak into the
    next and the "already registered" guard raises spuriously.

    Any ``backend.strategies._smoke.*`` modules that were already imported
    are evicted from ``sys.modules`` so ``load_all()`` will re-run their
    ``@register_strategy`` decorators when called inside the test.
    """

    from backend.strategies.registry import (
        _STRATEGY_CLASSES,
        _STRATEGY_META,
        clear,
    )

    saved_classes = dict(_STRATEGY_CLASSES)
    saved_meta = dict(_STRATEGY_META)
    clear()

    # Drop cached strategy modules so their decorators re-fire on import.
    evicted = {}
    for mod_name in list(sys.modules):
        if mod_name.startswith("backend.strategies._smoke"):
            evicted[mod_name] = sys.modules.pop(mod_name)

    try:
        yield
    finally:
        clear()
        _STRATEGY_CLASSES.update(saved_classes)
        _STRATEGY_META.update(saved_meta)
        for mod_name, mod in evicted.items():
            sys.modules.setdefault(mod_name, mod)


# --------------------------------------------------------------------------- #
# Fake providers (no network)                                                 #
# --------------------------------------------------------------------------- #
class _FakeBarProvider:
    """Returns a deterministic synthetic OHLCV series for any symbol.

    Matches the :class:`BarProvider` protocol's return schema:
    ``[symbol, ts, open, high, low, close, volume, vwap, n_trades]``.
    """

    def __init__(self, seed: int = 42) -> None:
        self._seed = seed

    def bars(
        self,
        symbols: Iterable[str],
        start,
        end,
        tf: str = "1D",
    ) -> pd.DataFrame:
        start = pd.Timestamp(start).tz_localize(None).normalize()
        end = pd.Timestamp(end).tz_localize(None).normalize()
        idx = pd.bdate_range(start=start, end=end)
        frames = []
        for sym in symbols:
            rng = np.random.default_rng(abs(hash((self._seed, sym))) % (2**32))
            n = len(idx)
            returns = rng.normal(loc=0.0004, scale=0.01, size=n)
            closes = 100.0 * np.cumprod(1 + returns)
            opens = np.concatenate(([closes[0]], closes[:-1]))
            highs = np.maximum(opens, closes) * (1 + rng.uniform(0, 0.005, size=n))
            lows = np.minimum(opens, closes) * (1 - rng.uniform(0, 0.005, size=n))
            vols = rng.integers(1_000_000, 5_000_000, size=n)
            df = pd.DataFrame(
                {
                    "symbol": sym,
                    "ts": pd.to_datetime(idx, utc=True),
                    "open": opens,
                    "high": highs,
                    "low": lows,
                    "close": closes,
                    "volume": vols,
                    "vwap": (opens + highs + lows + closes) / 4,
                    "n_trades": rng.integers(1_000, 10_000, size=n),
                }
            )
            frames.append(df)
        return pd.concat(frames, ignore_index=True).sort_values(
            ["symbol", "ts"]
        )


class _FakeCalendarProvider:
    """Minimal calendar provider (weekday sessions, no holiday handling)."""

    def sessions(self, start, end) -> pd.DatetimeIndex:
        return pd.bdate_range(start=start, end=end)

    def is_trading_day(self, d) -> bool:
        return pd.Timestamp(d).weekday() < 5

    def next_session(self, d) -> date:
        t = pd.Timestamp(d) + pd.offsets.BDay(1)
        return t.date()

    def session_hours(self, d):
        t = pd.Timestamp(d).normalize().tz_localize("UTC")
        return (t.replace(hour=13, minute=30), t.replace(hour=20))


@pytest.fixture
def fake_bar_provider() -> _FakeBarProvider:
    return _FakeBarProvider()


@pytest.fixture
def fake_calendar() -> _FakeCalendarProvider:
    return _FakeCalendarProvider()


# --------------------------------------------------------------------------- #
# Small real-data-shaped fixture: SPY 2020-01 .. 2020-03                      #
# --------------------------------------------------------------------------- #
# We never hit the network inside unit tests. If a live provider is available
# this fixture uses it; otherwise it returns a deterministic synthetic series
# shaped like the production schema. The values matter less than the shape for
# the tests we do in this module.

@pytest.fixture
def spy_2020_q1_bars(fake_bar_provider: _FakeBarProvider) -> pd.DataFrame:
    start = datetime(2020, 1, 2, tzinfo=timezone.utc)
    end = datetime(2020, 3, 31, tzinfo=timezone.utc)

    if os.environ.get("ALPHADESK_TEST_LIVE_DATA"):  # pragma: no cover
        try:
            from backend.data.providers.cache import (  # type: ignore
                CachedBarProvider,
            )

            provider = CachedBarProvider()
            return provider.bars(["SPY"], start, end, tf="1D")
        except Exception:
            pass

    return fake_bar_provider.bars(["SPY"], start, end)
