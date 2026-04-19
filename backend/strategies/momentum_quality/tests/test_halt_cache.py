"""Regression test: halt-filter must re-run on every cache access.

Previously ``_get_close_panel`` cached the halt-FILTERED panel at the
first asof it was fetched for. When the fetched window extended ~400
calendar days past that asof (the ffill buffer), subsequent rebalances
within the cache window served the stale dropped-columns set even if a
halted symbol had since resumed trading. A ticker that went flat in
January and resumed real prints by June would remain dropped for the
rest of the cache lifetime.

The fix caches the UNFILTERED panel and applies halt detection fresh on
every ``_get_close_panel`` call. This test pins that behaviour.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Iterable

import numpy as np
import pandas as pd

from backtest.types import Context
from strategies.momentum_quality.config import eligible_universe
from strategies.momentum_quality.strategy import MomentumQualityStrategy


class _HaltingBarProvider:
    """Bar provider where a configurable set of symbols goes flat over a window.

    ``halt_window`` — (start, end) dates during which ``halted_syms`` print
    identical closes. Outside that window they follow a normal random
    walk. All other symbols always have varying closes.
    """

    def __init__(
        self,
        symbols: Iterable[str],
        halted_syms: set[str],
        halt_window: tuple[date, date],
        n_bars: int = 900,
        seed: int = 7,
    ) -> None:
        self._symbols = list(symbols)
        self._halted = {s.upper() for s in halted_syms}
        self._halt_start, self._halt_end = halt_window
        rng = np.random.default_rng(seed)

        idx = pd.bdate_range(start="2022-06-01", periods=n_bars)
        self._idx = idx
        data: dict[str, np.ndarray] = {}
        for sym in self._symbols:
            rets = rng.normal(0.0, 0.012, n_bars)
            closes = 100.0 * np.exp(np.cumsum(rets))
            if sym.upper() in self._halted:
                # Freeze the close at the halt start and keep it flat
                # through the halt end. After the halt ends, resume
                # a random walk from the held value.
                halt_mask = (idx.date >= self._halt_start) & (
                    idx.date <= self._halt_end
                )
                if halt_mask.any():
                    frozen = closes[np.argmax(halt_mask)]
                    closes[halt_mask] = frozen
                    # Post-halt: walk forward from ``frozen``.
                    post_mask = idx.date > self._halt_end
                    if post_mask.any():
                        post_rets = rng.normal(0.0, 0.012, int(post_mask.sum()))
                        closes[post_mask] = frozen * np.exp(np.cumsum(post_rets))
            data[sym] = closes
        self._data = data

    def bars(
        self,
        symbols: Iterable[str],
        start,
        end,
        tf: str = "1D",
    ) -> pd.DataFrame:
        start = pd.Timestamp(start).tz_localize(None).normalize()
        end = pd.Timestamp(end).tz_localize(None).normalize()
        mask = (self._idx >= start) & (self._idx <= end)
        sub_idx = self._idx[mask]
        rows = []
        syms = [s.upper() for s in symbols]
        for sym in syms:
            if sym not in self._data:
                continue
            closes = self._data[sym][mask]
            opens = np.concatenate(([closes[0]], closes[:-1])) if len(closes) else closes
            rows.append(pd.DataFrame({
                "symbol": sym,
                "ts": pd.to_datetime(sub_idx, utc=True),
                "open": opens,
                "high": np.maximum(opens, closes),
                "low": np.minimum(opens, closes),
                "close": closes,
                "volume": 1_000_000,
            }))
        if not rows:
            return pd.DataFrame(
                columns=["symbol", "ts", "open", "high", "low", "close", "volume"]
            )
        return pd.concat(rows, ignore_index=True)


def _ctx(asof: date, provider) -> Context:
    return Context(
        asof=asof,
        cash=Decimal("100000"),
        equity=Decimal("100000"),
        positions=[],
        bar_provider=provider,
    )


class TestHaltCacheRefreshesPerCall:
    def test_resumed_symbol_not_dropped_on_cache_hit(self) -> None:
        """Symbol halted in Jan 2023, resumed in Jun 2023 → present in Jun panel.

        The strategy calls ``_get_close_panel`` at asof=2023-01-31 first,
        which fills the cache with the (now extended) window. On the
        second call at asof=2023-06-30 the cache still covers the range
        (``end`` = 2023-01-31 + 400 days ≈ 2024-03-06), so no re-fetch
        happens. The halt filter, however, must re-run and pick up the
        fact that X has resumed by June.
        """

        universe = list(eligible_universe())
        assert "AAPL" in universe, "test fixture relies on AAPL being eligible"
        halted_symbol = "AAPL"

        # AAPL halted Jan 15 - Apr 15, then resumes. By Jun 30, the most
        # recent 6 bars for AAPL are all varying (post-resume) — so the
        # Jun halt check should keep AAPL in the panel.
        provider = _HaltingBarProvider(
            symbols=universe,
            halted_syms={halted_symbol},
            halt_window=(date(2023, 1, 15), date(2023, 4, 15)),
            n_bars=900,
            seed=11,
        )

        s = MomentumQualityStrategy()
        s.configure({})

        # First call: asof inside the halt window. AAPL's trailing bars
        # are all identical → halt filter drops it.
        asof_jan = date(2023, 1, 31)
        ctx = _ctx(asof_jan, provider)
        list(s.universe(asof_jan, ctx))  # populate universe cache
        panel_jan = s._get_close_panel(ctx, universe, asof_jan)
        assert panel_jan is not None and not panel_jan.empty
        assert halted_symbol not in panel_jan.columns, (
            f"{halted_symbol} should have been dropped as halted at {asof_jan}; "
            f"columns={sorted(panel_jan.columns.tolist())[:5]}..."
        )

        # Sanity: verify the cache IS a hit on the subsequent call
        # (same symbols, and the second asof falls within ``end`` of the
        # cached entry). That's the precondition for the bug.
        from strategies.base import cache_of

        cache = cache_of(ctx)
        meta = cache.get("momentum_quality.close_panel")
        assert meta is not None
        assert halted_symbol in meta["data"].columns, (
            "Cache must hold the UNFILTERED panel — the halt filter "
            "should only be applied per-call, not at cache-write time."
        )

        # Second call: asof AFTER AAPL resumed. Cache hits (same symbols,
        # end >= asof_jun). Halt filter must re-run and KEEP AAPL.
        asof_jun = date(2023, 6, 30)
        ctx.asof = asof_jun
        panel_jun = s._get_close_panel(ctx, universe, asof_jun)
        assert panel_jun is not None and not panel_jun.empty
        assert halted_symbol in panel_jun.columns, (
            f"{halted_symbol} resumed trading by {asof_jun} but was still "
            "dropped — the halt filter is stale from the cache-miss pass. "
            f"columns={sorted(panel_jun.columns.tolist())[:5]}..."
        )

    def test_still_halted_symbol_still_dropped_on_cache_hit(self) -> None:
        """Symbol halted permanently should stay dropped on every call."""

        universe = list(eligible_universe())
        halted_symbol = "AAPL"

        # Halt from Jan all the way past Jun — never resumes.
        provider = _HaltingBarProvider(
            symbols=universe,
            halted_syms={halted_symbol},
            halt_window=(date(2023, 1, 15), date(2024, 12, 31)),
            n_bars=900,
            seed=13,
        )

        s = MomentumQualityStrategy()
        s.configure({})
        asof_jan = date(2023, 1, 31)
        ctx = _ctx(asof_jan, provider)
        list(s.universe(asof_jan, ctx))
        panel_jan = s._get_close_panel(ctx, universe, asof_jan)
        assert halted_symbol not in panel_jan.columns

        # Later call still hits the cache; the still-flat trailing bars
        # at asof_jun should keep AAPL dropped.
        asof_jun = date(2023, 6, 30)
        ctx.asof = asof_jun
        panel_jun = s._get_close_panel(ctx, universe, asof_jun)
        assert halted_symbol not in panel_jun.columns, (
            f"{halted_symbol} is still halted at {asof_jun} — halt filter "
            "must continue to drop it."
        )
