"""Tests for the /api/v1/strategies route handlers.

Focus of these tests:

1. The catalogue returned by ``_load_strategies()`` contains all 12
   Phase 1 strategies declared in the registry.
2. Strategies whose OOS JSON lives in ``audit-reports/`` expose the
   Sharpe value from that JSON (not zero, not faked).
3. Strategies with *no* OOS JSON return ``sharpe_ratio=None`` -- never
   a zero placeholder.
4. The route tolerates either the hyphen form (``momentum-quality``)
   or the underscore form (``momentum_quality``) on lookup.
5. The ``/`` list endpoint still serves the hyphen form the frontend
   expects, with the same schema keys it has always had.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from backend.api.routes import strategies as strat_mod


# --------------------------------------------------------------------------- #
# Helpers                                                                     #
# --------------------------------------------------------------------------- #
_REPO_ROOT = Path(__file__).resolve().parents[4]
_AUDIT_DIR = _REPO_ROOT / "audit-reports"


def _oos_json_path(registry_name: str) -> Path:
    return _AUDIT_DIR / f"phase1-{registry_name}-oos.json"


def _expected_sharpe(registry_name: str) -> float | None:
    path = _oos_json_path(registry_name)
    if not path.exists():
        return None
    payload = json.loads(path.read_text())
    metrics = strat_mod._extract_oos_metrics(payload)
    if not metrics or "sharpe" not in metrics:
        return None
    return round(float(metrics["sharpe"]), 4)


# Real registry <-> route-ID pairs. The route shouldn't invent any
# additional registry strategies beyond what @register_strategy populates.
_PHASE_1_STRATEGIES = [
    ("momentum_quality", "momentum-quality"),
    ("pead", "pead"),
    ("vrp_harvest", "vrp-harvesting"),
    ("earnings_vol", "earnings-vol-premium"),
    ("regime_adaptive", "regime-adaptive"),
    ("ts_momentum", "ts-momentum"),
    ("rsi2_reversal", "rsi2-reversal"),
    ("dual_momentum", "dual-momentum"),
    ("pairs_trading", "pairs-trading"),
    ("kama_breakout", "kama-breakout"),
    ("orb", "orb"),
    ("vwap", "vwap-strategy"),
]


# --------------------------------------------------------------------------- #
# Tests                                                                       #
# --------------------------------------------------------------------------- #
class TestCatalogueShape:
    """Structural invariants of the in-module ``_STRATEGIES`` catalogue."""

    def test_catalogue_includes_all_12_registry_strategies(self) -> None:
        cat = strat_mod._STRATEGIES
        for reg_name, route_id in _PHASE_1_STRATEGIES:
            assert route_id in cat, (
                f"Route ID {route_id!r} (registry {reg_name!r}) missing from "
                f"strategy catalogue"
            )
            assert cat[route_id]["registry_name"] == reg_name

    def test_every_registry_strategy_carries_static_meta(self) -> None:
        cat = strat_mod._STRATEGIES
        for _, route_id in _PHASE_1_STRATEGIES:
            d = cat[route_id]
            # Registry meta fields are populated for registry-backed strategies.
            assert d["category"] is not None, route_id
            assert d["description"], route_id  # non-empty
            assert isinstance(d["required_bars"], list)
            assert isinstance(d["supports_shorts"], bool)
            assert isinstance(d["supports_options"], bool)

    def test_no_smoke_strategy_leaks_to_route(self) -> None:
        for sid in strat_mod._STRATEGIES:
            assert not sid.startswith("_smoke"), (
                f"Smoke strategy {sid!r} must not be exposed on the route"
            )
            assert sid != "buy_and_hold_spy"


class TestOOSMetricsPopulated:
    """The route must surface real OOS metrics, never zero placeholders."""

    @pytest.mark.parametrize(
        "registry_name,route_id",
        _PHASE_1_STRATEGIES,
        ids=[t[1] for t in _PHASE_1_STRATEGIES],
    )
    def test_sharpe_matches_oos_json_when_available(
        self, registry_name: str, route_id: str
    ) -> None:
        expected = _expected_sharpe(registry_name)
        actual = strat_mod._STRATEGIES[route_id]["sharpe_ratio"]
        if expected is None:
            # Missing JSON -> null, never 0.
            assert actual is None, (
                f"{route_id}: no OOS JSON on disk but sharpe_ratio={actual!r}. "
                "Missing metrics must be surfaced as None, not a fake zero."
            )
        else:
            assert actual == expected, (
                f"{route_id}: expected Sharpe {expected} from "
                f"{_oos_json_path(registry_name).name}, got {actual}"
            )

    def test_known_strategy_has_non_null_sharpe(self) -> None:
        # momentum_quality ships with a complete OOS JSON and must report
        # its actual Sharpe (~2.21).
        d = strat_mod._STRATEGIES["momentum-quality"]
        assert d["sharpe_ratio"] is not None
        assert d["sharpe_ratio"] > 1.0

    def test_missing_oos_returns_null_not_zero(self) -> None:
        # Neither dual_momentum nor kama_breakout ships an OOS JSON yet.
        for route_id in ("dual-momentum", "kama-breakout"):
            d = strat_mod._STRATEGIES[route_id]
            assert d["sharpe_ratio"] is None, route_id
            assert d["max_drawdown"] is None, route_id
            assert d["hit_rate"] is None, route_id

    def test_fallback_meta_has_null_metrics(self) -> None:
        # Strategies that don't live in the registry (kept in the fallback
        # table so the frontend catalogue stays intact) must also never
        # carry fabricated metrics.
        for route_id in ("claude-alpha", "manual-discretionary", "gap-fill"):
            d = strat_mod._STRATEGIES[route_id]
            assert d["sharpe_ratio"] is None, route_id
            assert d["max_drawdown"] is None, route_id


class TestIdMapping:
    """Hyphen <-> underscore tolerance."""

    @pytest.mark.parametrize(
        "input_id,canonical",
        [
            ("momentum-quality", "momentum-quality"),
            ("momentum_quality", "momentum-quality"),
            ("vrp-harvesting", "vrp-harvesting"),
            ("vrp_harvest", "vrp-harvesting"),
            ("earnings-vol-premium", "earnings-vol-premium"),
            ("earnings_vol", "earnings-vol-premium"),
            ("vwap-strategy", "vwap-strategy"),
            ("vwap", "vwap-strategy"),
            ("rsi2-reversal", "rsi2-reversal"),
            ("rsi2_reversal", "rsi2-reversal"),
            ("pead", "pead"),  # no transformation needed
            ("orb", "orb"),
        ],
    )
    def test_canonical_id_accepts_both_forms(
        self, input_id: str, canonical: str
    ) -> None:
        assert strat_mod._canonical_id(input_id) == canonical

    def test_canonical_id_returns_unchanged_for_unknown(self) -> None:
        assert strat_mod._canonical_id("does-not-exist") == "does-not-exist"
        assert strat_mod._canonical_id("") == ""

    def test_id_mapping_tables_are_inverses(self) -> None:
        # Every route ID covered by REGISTRY_TO_ROUTE must round-trip.
        for reg, route in strat_mod._REGISTRY_TO_ROUTE.items():
            assert strat_mod._ROUTE_TO_REGISTRY[route] == reg

    @pytest.mark.asyncio
    async def test_get_strategy_data_underscore_form(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # No Redis in tests -- short-circuit the override lookup.
        async def _no_override(strategy_id: str):
            return None

        monkeypatch.setattr(
            strat_mod, "_get_strategy_status_override", _no_override
        )
        d_hyphen = await strat_mod._get_strategy_data("momentum-quality")
        d_under = await strat_mod._get_strategy_data("momentum_quality")
        assert d_hyphen is not None
        assert d_under is not None
        assert d_hyphen["name"] == d_under["name"]
        assert d_hyphen["sharpe_ratio"] == d_under["sharpe_ratio"]


class TestReloadMetrics:
    """``_reload_oos_metrics()`` should refresh the in-memory catalogue."""

    def test_reload_returns_full_catalogue(self) -> None:
        refreshed = strat_mod._reload_oos_metrics()
        # The module global and the return value must be the same object
        # reference (we rebind ``_STRATEGIES`` to the freshly-built dict).
        assert refreshed is strat_mod._STRATEGIES
        # And the 12 registry strategies are still there.
        for _, route_id in _PHASE_1_STRATEGIES:
            assert route_id in refreshed


class TestResponseSchema:
    """Guard the response schemas the frontend depends on."""

    def test_strategy_summary_fields(self) -> None:
        # The frontend (frontend/src/lib/api.ts) reads id / name / status /
        # invested_amount / total_return_pct / win_rate /
        # active_positions_count / sparkline for each summary.
        required = {
            "id", "name", "description", "status", "invested_amount",
            "total_return_pct", "sharpe_ratio", "win_rate",
            "active_positions_count", "sparkline",
        }
        fields = set(strat_mod.StrategySummary.model_fields.keys())
        missing = required - fields
        assert not missing, f"StrategySummary missing required fields: {missing}"

    def test_strategy_performance_fields(self) -> None:
        required = {
            "name", "description", "status", "invested_amount",
            "current_value", "total_return_pct", "annualized_return_pct",
            "return_dollars", "win_rate", "sharpe_ratio", "max_drawdown",
            "active_positions_count", "equity_curve", "last_trade_date",
        }
        fields = set(strat_mod.StrategyPerformance.model_fields.keys())
        missing = required - fields
        assert not missing, (
            f"StrategyPerformance missing required fields: {missing}"
        )

    def test_sharpe_ratio_field_allows_null(self) -> None:
        # Explicitly validate that the pydantic model accepts None for
        # Sharpe / max_drawdown -- if someone re-adds `: float` without
        # `| None` the frontend loses its "missing data" signal.
        perf = strat_mod.StrategyPerformance(
            name="x", description="y", status=strat_mod.StrategyStatus.ACTIVE,
            invested_amount=0, current_value=0, total_return_pct=0,
            annualized_return_pct=0, return_dollars=0, win_rate=-1,
            sharpe_ratio=None, max_drawdown=None,
            active_positions_count=0, equity_curve=[], last_trade_date="",
        )
        assert perf.sharpe_ratio is None
        assert perf.max_drawdown is None

        summary = strat_mod.StrategySummary(
            id="x", name="x", description="x",
            status=strat_mod.StrategyStatus.ACTIVE,
            invested_amount=0, total_return_pct=0,
            sharpe_ratio=None, win_rate=0, active_positions_count=0,
        )
        assert summary.sharpe_ratio is None


class TestOOSMetricExtraction:
    """The shape-tolerant metrics extractor."""

    def test_flat_metrics(self) -> None:
        assert strat_mod._extract_oos_metrics(
            {"metrics": {"sharpe": 1.5, "max_drawdown": 0.1}}
        )["sharpe"] == 1.5

    def test_oos_metrics_shape(self) -> None:
        assert strat_mod._extract_oos_metrics(
            {"oos_metrics": {"sharpe": 2.0}}
        )["sharpe"] == 2.0

    def test_summary_shape(self) -> None:
        assert strat_mod._extract_oos_metrics(
            {"summary": {"sharpe": 0.9}}
        )["sharpe"] == 0.9

    def test_walkforward_oos_shape(self) -> None:
        assert strat_mod._extract_oos_metrics(
            {"walkforward": {"oos": {"sharpe": 6.1}}}
        )["sharpe"] == 6.1

    def test_tuned_metrics_shape(self) -> None:
        assert strat_mod._extract_oos_metrics(
            {"tuned": {"metrics": {"sharpe": 1.6}}}
        )["sharpe"] == 1.6

    def test_returns_none_for_unknown_shape(self) -> None:
        assert strat_mod._extract_oos_metrics({"wat": {"sharpe": 1.0}}) is None
        assert strat_mod._extract_oos_metrics({}) is None
        assert strat_mod._extract_oos_metrics(None) is None  # type: ignore[arg-type]
