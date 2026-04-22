# backend/tests/_core/test_snapshots.py
"""Snapshot write+read round-trip for deterministic replay."""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from strategies._core.contracts import StrategyInput
from strategies._core.snapshots import SnapshotReader, SnapshotWriter


def _make_input(asof: date, seed: int = 42) -> StrategyInput:
    bars = pd.DataFrame({
        "open": [100.0, 101.0], "high": [102.0, 103.0], "low": [99.0, 100.0],
        "close": [101.0, 102.0], "volume": [1_000_000, 1_100_000],
    }, index=pd.MultiIndex.from_tuples(
        [(date(2024, 1, 1), "NVDA"), (date(2024, 1, 2), "NVDA")],
        names=["date", "symbol"],
    ))
    return StrategyInput(
        asof=asof, mode="backtest", bars=bars,
        cash=Decimal("100000"), equity=Decimal("100000"),
        positions=[], state={"tracked": "value"},
        seed=seed, rng=np.random.default_rng(seed),
    )


def test_snapshot_write_creates_parquet(tmp_path: Path):
    inp = _make_input(date(2024, 1, 2))
    writer = SnapshotWriter(tmp_path)
    sid = writer.write(inp)
    assert len(sid) == 16  # 16-char hex snapshot_id
    # Expect a parquet file at tmp_path/backtest/2024-01-02/{sid}/*.parquet
    bars_parquet = tmp_path / "backtest" / "2024-01-02" / sid / "bars.parquet"
    assert bars_parquet.exists()


def test_snapshot_roundtrip_preserves_data(tmp_path: Path):
    """Reading back a snapshot produces an identical-data StrategyInput."""
    inp = _make_input(date(2024, 1, 2))
    writer = SnapshotWriter(tmp_path)
    writer.write(inp)

    reader = SnapshotReader(tmp_path)
    restored = reader.read(date(2024, 1, 2))

    assert restored.asof == inp.asof
    assert restored.mode == inp.mode
    assert restored.seed == inp.seed
    pd.testing.assert_frame_equal(restored.bars, inp.bars)
    assert restored.state == inp.state
    assert restored.cash == inp.cash


def test_snapshot_rng_reconstructed_deterministically(tmp_path: Path):
    """rng is not serialized; reader reconstructs via np.random.default_rng(seed).
    Same seed → same first 5 draws."""
    inp = _make_input(date(2024, 1, 2), seed=123)
    writer = SnapshotWriter(tmp_path)
    writer.write(inp)

    reader = SnapshotReader(tmp_path)
    restored = reader.read(date(2024, 1, 2))

    assert list(inp.rng.integers(0, 1_000_000, size=5)) == list(
        restored.rng.integers(0, 1_000_000, size=5)
    )


def test_snapshot_reader_raises_on_missing(tmp_path: Path):
    reader = SnapshotReader(tmp_path)
    with pytest.raises(FileNotFoundError):
        reader.read(date(2024, 1, 2))


def test_snapshot_writer_id_deterministic(tmp_path: Path):
    """Writing the same input twice produces the same snapshot_id."""
    inp = _make_input(date(2024, 1, 2))
    writer = SnapshotWriter(tmp_path)
    sid1 = writer.write(inp)
    sid2 = writer.write(inp)
    assert sid1 == sid2
