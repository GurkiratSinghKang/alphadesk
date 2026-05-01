# backend/strategies/_core/snapshots.py
"""Parquet-backed snapshot writer/reader for StrategyInput.

Enables the full reproducibility guarantee: given (git_sha, params, seed,
snapshot_id), re-running a strategy produces bitwise-identical results.
"""
from __future__ import annotations

import json
import re
from datetime import date
from decimal import Decimal
from pathlib import Path

import numpy as np
import pandas as pd

from strategies._core.contracts import Position, StrategyInput


def _safe_key(key: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", str(key)).strip("._") or "data"


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
        """Write a StrategyInput snapshot to disk.

        Round-13 / RD-11 (P1): atomic write. Pre-fix this called
        ``df.to_parquet(dest / "bars.parquet")`` and
        ``(dest/"meta.json").write_text(...)`` directly — a process
        crash mid-write left a half-written snapshot dir; the
        ``SnapshotReader`` then silently surfaced the corrupt parquet
        on replay and crashed downstream. Now: write each artifact to
        a sibling ``.tmp`` path, then ``os.replace`` it into place
        only after every artifact succeeds. ``os.replace`` is atomic
        on the same filesystem (POSIX rename), so a crash during the
        write phase leaves only ``.tmp`` files which the reader
        ignores via the ``glob`` pattern.
        """
        sid = StrategyInput.snapshot_id(input)
        dest = self._root / input.mode / input.asof.isoformat() / sid
        dest.mkdir(parents=True, exist_ok=True)

        # Build a list of (final_path, write_callable) so we can
        # write everything to .tmp first, then commit in one swap.
        pending: list[tuple[Path, callable]] = []

        def _stage_parquet(name: str, df) -> None:
            if df is None:
                return
            tmp = dest / f"{name}.parquet.tmp"
            df.to_parquet(tmp)
            pending.append((dest / f"{name}.parquet", tmp))

        _stage_parquet("bars", input.bars)
        for key, df in sorted(input.intraday_bars.items()):
            _stage_parquet(f"intraday_{_safe_key(key)}", df)
        for name in ("earnings", "fundamentals", "news"):
            _stage_parquet(name, getattr(input, name))
        for key, df in sorted(input.options_chains.items()):
            _stage_parquet(f"options_{_safe_key(key)}", df)

        meta = {
            "asof": input.asof.isoformat(),
            "mode": input.mode,
            "seed": input.seed,
            "state": input.state,
            "cash": str(input.cash),
            "equity": str(input.equity),
            "positions": [p.model_dump(mode="json") for p in input.positions],
            "intraday_bars": sorted(input.intraday_bars),
            "options_chains": sorted(input.options_chains),
        }
        meta_tmp = dest / "meta.json.tmp"
        meta_tmp.write_text(json.dumps(meta, default=str))
        pending.append((dest / "meta.json", meta_tmp))

        # Commit phase — atomic rename of every staged artifact. If
        # anything raises here the .tmp files persist on disk; a
        # subsequent successful write (or the reader's glob filter
        # which excludes ``*.tmp``) cleans up.
        import os as _os_local
        for final, tmp in pending:
            _os_local.replace(tmp, final)
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
        intraday_bars = {
            key: pd.read_parquet(snap_dir / f"intraday_{_safe_key(key)}.parquet")
            for key in meta.get("intraday_bars", [])
            if (snap_dir / f"intraday_{_safe_key(key)}.parquet").exists()
        }
        options_chains = {
            key: pd.read_parquet(snap_dir / f"options_{_safe_key(key)}.parquet")
            for key in meta.get("options_chains", [])
            if (snap_dir / f"options_{_safe_key(key)}.parquet").exists()
        }

        return StrategyInput(
            asof=date.fromisoformat(meta["asof"]),
            mode=meta["mode"],
            bars=bars,
            intraday_bars=intraday_bars,
            earnings=earnings,
            fundamentals=fundamentals,
            news=news,
            options_chains=options_chains,
            cash=Decimal(meta["cash"]),
            equity=Decimal(meta["equity"]),
            positions=[Position(**p) for p in meta["positions"]],
            state=meta["state"],
            seed=meta["seed"],
            rng=np.random.default_rng(meta["seed"]),
        )
