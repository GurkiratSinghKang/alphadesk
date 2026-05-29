"""Iter-29 — real account equity threaded through portfolio performance.

Previously every site in ``api/routes/portfolio.py`` that needed a
return-percentage denominator hardcoded ``base_equity = 100_000``. A
$250k account therefore saw ALL return percentages diluted by 2.5x.
This file regression-guards the fix:

  1. The ``_resolve_base_equity`` helper returns the user's real cached
     Alpaca equity when available.
  2. Demo-seed users (no broker, helper returns 0.0) fall back to the
     module default of 100k.
  3. Helper exceptions never reach the route; the route gets 100k and
     emits a single WARNING log.
  4. The performance route threads the resolved equity into every
     downstream computation path (ledger / DB / demo).
  5. The DB code path's old hardcoded ``100_000`` literal + its TODO
     comment are GONE — guarded by source inspection so a future
     refactor can't silently re-introduce them.

The tests stub the equity helper at its source (``api.routes.trades.
_get_account_equity_cached``) rather than importing a re-export, so a
future move to a different module surface is caught by ImportError
rather than by silently exercising a stale path.
"""

from __future__ import annotations

import inspect
import logging
from typing import Any

import pytest

from api.routes import portfolio as portfolio_mod


# --------------------------------------------------------------------------- #
# Helper: _resolve_base_equity                                                #
# --------------------------------------------------------------------------- #


class TestResolveBaseEquity:
    """Unit tests for the ``_resolve_base_equity`` shim."""

    @pytest.mark.asyncio
    async def test_connected_broker_returns_real_equity(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A user with a connected broker gets their actual equity back."""

        async def fake_cached(username: str | None) -> float:
            assert username == "real-user"
            return 250_000.0

        # Patch the canonical source. We patch on the trades module — the
        # local import inside _resolve_base_equity binds at call time.
        import api.routes.trades as trades_mod

        monkeypatch.setattr(
            trades_mod, "_get_account_equity_cached", fake_cached
        )

        result = await portfolio_mod._resolve_base_equity("real-user")
        assert result == 250_000.0

    @pytest.mark.asyncio
    async def test_demo_seed_user_falls_back_to_default(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Demo-seed users have no broker — helper returns 0.0, resolver
        returns the module default (100k), no exception."""

        async def fake_cached(username: str | None) -> float:
            return 0.0

        import api.routes.trades as trades_mod

        monkeypatch.setattr(
            trades_mod, "_get_account_equity_cached", fake_cached
        )

        result = await portfolio_mod._resolve_base_equity("demo-seed-user")
        assert result == portfolio_mod._DEFAULT_BASE_EQUITY
        # Match the helper's actual fallback value bit-for-bit so we
        # don't accidentally drift from the rest of the codebase.
        assert result == 100_000.0

    @pytest.mark.asyncio
    async def test_helper_exception_falls_back_with_warning(
        self,
        monkeypatch: pytest.MonkeyPatch,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        """Broker outage / cache fault → 100k fallback + a single WARNING
        log line. Critically: must NOT propagate the exception (no 500)."""

        async def broken_cached(username: str | None) -> float:
            raise RuntimeError("Alpaca returned 502 / cache miss")

        import api.routes.trades as trades_mod

        monkeypatch.setattr(
            trades_mod, "_get_account_equity_cached", broken_cached
        )

        with caplog.at_level(logging.WARNING, logger="api.routes.portfolio"):
            result = await portfolio_mod._resolve_base_equity("broken-broker")

        assert result == 100_000.0
        # Exactly one warning about the equity fallback (so we know the
        # resolver caught the exception rather than silently swallowing
        # without observability).
        equity_warnings = [
            rec for rec in caplog.records
            if rec.name == "api.routes.portfolio"
            and rec.levelno == logging.WARNING
            and "cached account equity" in rec.message
        ]
        assert len(equity_warnings) == 1, (
            f"Expected exactly one fallback WARNING; got "
            f"{[r.message for r in equity_warnings]}"
        )

    @pytest.mark.asyncio
    async def test_none_username_returns_default_without_helper_call(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Legacy un-authed callers (username=None) short-circuit to the
        default WITHOUT a broker round-trip. The cached helper is keyed by
        username; calling it with None would pin a shared bucket."""

        call_count = {"n": 0}

        async def fake_cached(username: str | None) -> float:
            call_count["n"] += 1
            return 999_999.0

        import api.routes.trades as trades_mod

        monkeypatch.setattr(
            trades_mod, "_get_account_equity_cached", fake_cached
        )

        result = await portfolio_mod._resolve_base_equity(None)
        assert result == 100_000.0
        assert call_count["n"] == 0, (
            "_resolve_base_equity(None) must NOT hit the equity cache — "
            "the None username would otherwise pin a shared bucket"
        )

    @pytest.mark.asyncio
    async def test_negative_equity_treated_as_failure(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Defensive: a negative equity (which the broker should never
        return, but if a future bug surfaces one) is treated as a
        failure and we fall back."""

        async def fake_cached(username: str | None) -> float:
            return -42.0

        import api.routes.trades as trades_mod

        monkeypatch.setattr(
            trades_mod, "_get_account_equity_cached", fake_cached
        )

        result = await portfolio_mod._resolve_base_equity("negative-user")
        assert result == 100_000.0


# --------------------------------------------------------------------------- #
# Route-level: get_performance threads resolved equity through every branch.  #
# --------------------------------------------------------------------------- #


class TestGetPerformanceThreadsEquity:
    """End-to-end via the route handler — assert the resolved equity is
    propagated to whichever computation path actually runs.

    We invoke the handler directly (not via TestClient + dependency
    overrides) because the route's behaviour we care about is "did it
    call ``_resolve_base_equity(username)`` and use the result as the
    denominator?" — that's most readable as a direct call with the
    pieces mocked at module scope.
    """

    @pytest.mark.asyncio
    async def test_real_equity_threaded_to_demo_path(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Force every real-data branch to fail so we land on the demo
        fallback, and confirm the demo equity curve uses the user's
        real equity (250k) as the denominator."""
        # 1. Stub the equity helper.
        import api.routes.trades as trades_mod

        async def fake_cached(username: str | None) -> float:
            return 250_000.0

        monkeypatch.setattr(
            trades_mod, "_get_account_equity_cached", fake_cached
        )

        # 2. Force ledger path to return no closed trades — the route
        # then walks past it.
        import data.ingestion.trade_ledger as ledger_mod

        class _FakeLedger:
            def get_closed_trades(self, *_a: Any, **_kw: Any) -> list:
                return []

        monkeypatch.setattr(ledger_mod, "TradeLedger", _FakeLedger)

        # 3. Force SKIP_DB_INIT=True so we skip the DB branch outright.
        from core.config import settings as _settings
        monkeypatch.setattr(_settings, "SKIP_DB_INIT", True)

        # 4. Drive the route.
        result = await portfolio_mod.get_performance(
            period="30d", username="rich-user"
        )

        assert result.is_demo is True, "Should have landed on demo path"

        # The demo path computes total_return_pct = total_return / base_equity * 100.
        # With base_equity=250_000 the denominator is 2.5x larger than the
        # legacy 100k, so the same total_return yields a 2.5x SMALLER pct.
        # Re-compute against legacy 100k and prove the value diverges.
        legacy_demo = portfolio_mod._demo_performance("30d")
        # Demo data is deterministic (rng seed=42) so both paths see the
        # same daily_pnls / total_return; only the denominator changes.
        assert result.total_return == legacy_demo.total_return, (
            "Demo PnL data must be deterministic between runs"
        )
        # New result's pct should be ~2.5x smaller than legacy's.
        # Tolerance accounts for PerformanceMetrics' rounding to 2 dp.
        ratio = legacy_demo.total_return_pct / result.total_return_pct
        assert abs(ratio - 2.5) < 0.05, (
            f"Expected real_equity_pct ≈ legacy_pct / 2.5 "
            f"(legacy={legacy_demo.total_return_pct}, "
            f"new={result.total_return_pct}, ratio={ratio:.3f})"
        )

    @pytest.mark.asyncio
    async def test_demo_seed_user_no_broker_uses_100k_default(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """When the helper returns 0.0 (demo-seed account, no broker),
        the route's denominator is 100k — matches legacy behavior so
        existing demo dashboards don't shift visually."""
        import api.routes.trades as trades_mod

        async def fake_cached(username: str | None) -> float:
            return 0.0  # demo-seed user, no broker

        monkeypatch.setattr(
            trades_mod, "_get_account_equity_cached", fake_cached
        )

        import data.ingestion.trade_ledger as ledger_mod

        class _FakeLedger:
            def get_closed_trades(self, *_a: Any, **_kw: Any) -> list:
                return []

        monkeypatch.setattr(ledger_mod, "TradeLedger", _FakeLedger)

        from core.config import settings as _settings
        monkeypatch.setattr(_settings, "SKIP_DB_INIT", True)

        result = await portfolio_mod.get_performance(
            period="30d", username="demo-seed"
        )
        legacy_demo = portfolio_mod._demo_performance("30d")

        # Demo seed (no broker) → denominator unchanged from legacy
        # 100k. The percentages should match the legacy demo output
        # bit-for-bit.
        assert result.total_return == legacy_demo.total_return
        assert result.total_return_pct == legacy_demo.total_return_pct

    @pytest.mark.asyncio
    async def test_broker_failure_does_not_500_the_route(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A broker / cache exception during equity resolution must not
        propagate as a 500 — the route still returns a usable response
        using the 100k fallback."""
        import api.routes.trades as trades_mod

        async def broken_cached(username: str | None) -> float:
            raise RuntimeError("Alpaca timeout while resolving equity")

        monkeypatch.setattr(
            trades_mod, "_get_account_equity_cached", broken_cached
        )

        import data.ingestion.trade_ledger as ledger_mod

        class _FakeLedger:
            def get_closed_trades(self, *_a: Any, **_kw: Any) -> list:
                return []

        monkeypatch.setattr(ledger_mod, "TradeLedger", _FakeLedger)

        from core.config import settings as _settings
        monkeypatch.setattr(_settings, "SKIP_DB_INIT", True)

        # Must not raise.
        result = await portfolio_mod.get_performance(
            period="30d", username="unlucky-user"
        )
        assert result is not None
        # The pct should match the legacy 100k demo so the dashboard
        # has a sane number rather than a divide-by-zero / NaN.
        legacy_demo = portfolio_mod._demo_performance("30d")
        assert result.total_return_pct == legacy_demo.total_return_pct


# --------------------------------------------------------------------------- #
# Source-level regression guards — keep the fix in place permanently.         #
# --------------------------------------------------------------------------- #


class TestSourceRegressionGuards:
    """Inspect the source of ``get_performance`` to prevent a future
    refactor from silently re-introducing a hardcoded denominator."""

    def _route_src(self) -> str:
        raw = inspect.getsource(portfolio_mod.get_performance)
        # Strip docstring + comments so a "this is what we used to do"
        # explanation never trips the assertion.
        from api.routes.tests.test_portfolio import (
            _strip_comments_and_docstrings,
        )
        return _strip_comments_and_docstrings(raw)

    def test_route_resolves_base_equity_from_username(self) -> None:
        """The route MUST call ``_resolve_base_equity(username)`` — that
        single call is what threads the user's actual equity through every
        downstream branch."""
        src = self._route_src()
        assert "_resolve_base_equity(username)" in src, (
            "iter-29 regression: route no longer threads the user's "
            "real cached equity into the performance computation. "
            "Re-add the `_resolve_base_equity(username)` call at the "
            "top of get_performance."
        )

    def test_no_hardcoded_100k_literal_in_route_body(self) -> None:
        """No ``100_000`` integer literal should appear in the executable
        body of ``get_performance`` — the route must use the resolved
        ``base_equity`` everywhere, and the centralised
        ``_DEFAULT_BASE_EQUITY`` constant when a fallback is needed.

        The previous code had ``base_equity = 100_000  # TODO: thread
        actual account equity`` baked directly into the DB branch; this
        test prevents that pattern from sneaking back in."""
        src = self._route_src()
        # Forms the prior code used:
        for forbidden in ("100_000", "100000"):
            assert forbidden not in src, (
                f"iter-29 regression: hardcoded denominator '{forbidden}' "
                f"re-appeared in get_performance executable body. Use the "
                f"resolved `base_equity` from `_resolve_base_equity` "
                f"(or the `_DEFAULT_BASE_EQUITY` constant for fallbacks)."
            )

    def test_todo_comment_removed(self) -> None:
        """The TODO comment that flagged the placeholder ('TODO: thread
        actual account equity') must be gone from the entire portfolio
        module — the work is done."""
        raw = inspect.getsource(portfolio_mod)
        assert "TODO: thread actual account equity" not in raw, (
            "iter-29 regression: the TODO comment came back. Either the "
            "fix was reverted or someone re-introduced the placeholder."
        )

    def test_resolved_equity_passed_to_ledger_builder(self) -> None:
        """The ledger path's call to ``_build_performance_from_pnls``
        must forward the resolved ``base_equity`` as a keyword arg."""
        src = self._route_src()
        # The literal call signature contains the kwarg.
        assert "base_equity=base_equity" in src, (
            "iter-29 regression: ledger-path call to "
            "_build_performance_from_pnls no longer forwards "
            "`base_equity`. The route will silently fall back to the "
            "function's default (100k), defeating the fix."
        )

    def test_resolved_equity_passed_to_demo_fallback(self) -> None:
        """The demo last-resort path must forward the resolved equity
        to ``_demo_performance``."""
        src = self._route_src()
        # The demo call must pass base_equity.
        assert "_demo_performance(period, base_equity=base_equity)" in src, (
            "iter-29 regression: demo last-resort call to "
            "_demo_performance no longer forwards `base_equity`. The "
            "demo equity curve will use 100k regardless of the user's "
            "real account size."
        )
