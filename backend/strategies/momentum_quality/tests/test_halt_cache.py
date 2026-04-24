"""Regression tests: halt detection runs per-asof and drops/keeps correctly.

In the SOTA shell there is no panel cache — bars flow through
``input.bars`` every call. :func:`close_panel_from_bars` runs halt detection
against the supplied ``asof``. These tests verify it drops a halted symbol
when its trailing bars are flat and keeps it once real prints resume.
"""

from __future__ import annotations

from datetime import date
from typing import Iterable

import numpy as np
import pandas as pd

from strategies.momentum_quality.config import eligible_universe
from strategies.momentum_quality.helpers import close_panel_from_bars


def _build_halting_bars(
    symbols: Iterable[str],
    halted_syms: set[str],
    halt_window: tuple[date, date],
    seed: int = 11,
) -> pd.DataFrame:
    """Multi-index (date, symbol) bar frame with a configurable halt window."""
    idx = pd.bdate_range(start="2022-06-01", periods=900)
    rng = np.random.default_rng(seed)
    rows: list[pd.DataFrame] = []
    for sym in symbols:
        rets = rng.normal(0.0, 0.012, len(idx))
        closes = 100.0 * np.exp(np.cumsum(rets))
        if sym.upper() in {s.upper() for s in halted_syms}:
            mask = (idx.date >= halt_window[0]) & (idx.date <= halt_window[1])
            if mask.any():
                frozen = closes[np.argmax(mask)]
                closes[mask] = frozen
                post = idx.date > halt_window[1]
                if post.any():
                    post_rets = rng.normal(0.0, 0.012, int(post.sum()))
                    closes[post] = frozen * np.exp(np.cumsum(post_rets))
        opens = np.concatenate(([closes[0]], closes[:-1]))
        rows.append(pd.DataFrame({
            "symbol": sym,
            "date": [d.date() for d in idx],
            "open": opens,
            "high": np.maximum(opens, closes),
            "low": np.minimum(opens, closes),
            "close": closes,
            "volume": 1_000_000,
        }))
    return pd.concat(rows, ignore_index=True).set_index(["date", "symbol"]).sort_index()


class TestHaltFilterPerAsof:
    def test_resumed_symbol_kept_after_resume(self) -> None:
        universe = list(eligible_universe())
        assert "AAPL" in universe
        bars = _build_halting_bars(
            symbols=universe,
            halted_syms={"AAPL"},
            halt_window=(date(2023, 1, 15), date(2023, 4, 15)),
        )

        panel_jan = close_panel_from_bars(bars, date(2023, 1, 31))
        assert panel_jan is not None and not panel_jan.empty
        assert "AAPL" not in panel_jan.columns, (
            "AAPL's trailing bars are all flat on 2023-01-31 — halt filter "
            "should drop it."
        )

        panel_jun = close_panel_from_bars(bars, date(2023, 6, 30))
        assert panel_jun is not None and not panel_jun.empty
        assert "AAPL" in panel_jun.columns, (
            "AAPL resumed trading by 2023-06-30 — halt filter must re-run "
            "per-asof and keep AAPL."
        )

    def test_still_halted_symbol_stays_dropped(self) -> None:
        universe = list(eligible_universe())
        bars = _build_halting_bars(
            symbols=universe,
            halted_syms={"AAPL"},
            halt_window=(date(2023, 1, 15), date(2024, 12, 31)),
            seed=13,
        )

        panel_jan = close_panel_from_bars(bars, date(2023, 1, 31))
        assert "AAPL" not in panel_jan.columns

        panel_jun = close_panel_from_bars(bars, date(2023, 6, 30))
        assert "AAPL" not in panel_jun.columns, (
            "AAPL is still halted on 2023-06-30 — halt filter must keep "
            "dropping it."
        )
