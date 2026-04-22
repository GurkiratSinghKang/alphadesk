# backend/strategies/_core/snapshots.py
"""Parquet-backed snapshot writer/reader for StrategyInput.

Enables the full reproducibility guarantee: given (git_sha, params, seed,
snapshot_id), re-running a strategy produces bitwise-identical results.
"""
from __future__ import annotations

import json
from datetime import date
from decimal import Decimal
from pathlib import Path

import numpy as np
import pandas as pd

from strategies._core.contracts import Position, StrategyInput


class SnapshotWriter:
    """Writes StrategyInput to a directory tree keyed by (mode, asof, snapshot_id).

    Layout:
        <root>/
          backtest/
            2024-01-02/
              <snapshot_id>/
                bars.parquet
                earnings.parquet     # optional, if present on input
                fundamentals.parquet # optional
                news.parquet         # optional
                meta.json            # asof, mode, seed, state, positions, cash, equity
          live/ ...

    The per-bar snapshot_id is StrategyInput.snapshot_id(input), which is
    a 16-char hex prefix of SHA-256 over (asof, mode, DataFrame hashes).
    """

    def __init__(self, root: Path):
        self._root = Path(root)
        self._root.mkdir(parents=True, exist_ok=True)

    def write(self, input: StrategyInput) -> str:
        sid = StrategyInput.snapshot_id(input)
        dest = self._root / input.mode / input.asof.isoformat() / sid
        dest.mkdir(parents=True, exist_ok=True)

        input.bars.to_parquet(dest / "bars.parquet")
        for name in ("earnings", "fundamentals", "news"):
            df = getattr(input, name)
            if df is not None:
                df.to_parquet(dest / f"{name}.parquet")

        meta = {
            "asof": input.asof.isoformat(),
            "mode": input.mode,
            "seed": input.seed,
            "state": input.state,
            "cash": str(input.cash),
            "equity": str(input.equity),
            "positions": [p.model_dump(mode="json") for p in input.positions],
        }
        (dest / "meta.json").write_text(json.dumps(meta, default=str))
        return sid


class SnapshotReader:
    """Read back a StrategyInput written by SnapshotWriter.

    Given an asof, finds the single snapshot directory under
    `<root>/*/<asof>/*/` and reconstructs the StrategyInput. The `rng`
    field is rebuilt from the stored `seed` — NOT serialized directly —
    so replay is deterministic even across machines/Python versions.
    """

    def __init__(self, root: Path):
        self._root = Path(root)

    def read(self, asof: date) -> StrategyInput:
        # Search across modes (backtest/paper/live) and snapshot_ids for this date
        asof_str = asof.isoformat()
        candidates = list(self._root.glob(f"*/{asof_str}/*"))
        if not candidates:
            raise FileNotFoundError(
                f"No snapshot found for asof={asof_str} under {self._root}"
            )
        if len(candidates) > 1:
            # Multiple snapshots for same date → ambiguous; caller must pick one
            raise ValueError(
                f"Multiple snapshots for asof={asof_str}: {[str(p) for p in candidates]}. "
                "Use a more specific reader API in future."
            )
        snap_dir = candidates[0]

        bars = pd.read_parquet(snap_dir / "bars.parquet")
        earnings = (
            pd.read_parquet(snap_dir / "earnings.parquet")
            if (snap_dir / "earnings.parquet").exists()
            else None
        )
        fundamentals = (
            pd.read_parquet(snap_dir / "fundamentals.parquet")
            if (snap_dir / "fundamentals.parquet").exists()
            else None
        )
        news = (
            pd.read_parquet(snap_dir / "news.parquet")
            if (snap_dir / "news.parquet").exists()
            else None
        )

        meta = json.loads((snap_dir / "meta.json").read_text())

        return StrategyInput(
            asof=date.fromisoformat(meta["asof"]),
            mode=meta["mode"],
            bars=bars,
            earnings=earnings,
            fundamentals=fundamentals,
            news=news,
            cash=Decimal(meta["cash"]),
            equity=Decimal(meta["equity"]),
            positions=[Position(**p) for p in meta["positions"]],
            state=meta["state"],
            seed=meta["seed"],
            rng=np.random.default_rng(meta["seed"]),
        )
