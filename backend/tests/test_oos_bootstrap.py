from __future__ import annotations

import pandas as pd

from scripts.oos_bootstrap import (
    attach_bootstrap_ci,
    block_bootstrap_sharpe_ci,
    bootstrap_ci_from_equity_frame,
)


def test_block_bootstrap_ci_is_deterministic_for_same_seed():
    returns = pd.Series([0.001, -0.002, 0.003, 0.0005] * 40)

    first = block_bootstrap_sharpe_ci(
        returns,
        block_size=8,
        iterations=200,
        seed=123,
    )
    second = block_bootstrap_sharpe_ci(
        returns,
        block_size=8,
        iterations=200,
        seed=123,
    )

    assert first["status"] == "ok"
    assert first == second
    assert first["ci95_low"] <= first["observed_sharpe"] <= first["ci95_high"]


def test_bootstrap_ci_from_equity_frame_uses_pct_change():
    equity = pd.DataFrame({"equity": [100.0, 101.0, 100.5, 102.0] * 20})

    ci = bootstrap_ci_from_equity_frame(
        equity,
        block_size=8,
        iterations=50,
        seed=7,
    )

    assert ci["status"] == "ok"
    assert ci["n_returns"] == len(equity) - 1


def test_insufficient_data_returns_status_not_fake_ci():
    ci = block_bootstrap_sharpe_ci([0.01, -0.01], block_size=21)

    assert ci["status"] == "insufficient_data"
    assert ci["ci95_low"] is None
    assert ci["ci95_high"] is None


def test_attach_bootstrap_ci_adds_flat_compat_fields():
    payload = {"metrics": {"sharpe": 1.0}}
    ci = {
        "method": "non_overlapping_block_bootstrap",
        "ci95_low": 0.1,
        "ci95_high": 2.0,
    }

    attach_bootstrap_ci(payload, ci)

    assert payload["sharpe_bootstrap_ci"] == ci
    assert payload["sharpe_ci95_low"] == 0.1
    assert payload["sharpe_ci95_high"] == 2.0
    assert payload["sharpe_ci_method"] == "non_overlapping_block_bootstrap"
