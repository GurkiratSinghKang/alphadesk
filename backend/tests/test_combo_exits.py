"""Combo exit-hardening tests (P0 — STRATEGY-HARDENING-AUDIT 2026-05-05).

These tests cover:
* OE-1 : :func:`services.combo_calc.compute_combo_mark` correctness on
  iron condor and credit-spread leg sets, including the unquoted-leg
  fallback / refusal path.
* OE-2 : :func:`data.ingestion.daily_pipeline._check_exits` combo branch —
  fires on combined mark crossing ``stop_loss_combo_mark``, leaves single-
  leg trades on the legacy code path, defers when the chain is unavailable
  and no leg fallbacks are stored.
* OE-4 : heartbeat staleness detector raises an ERROR when
  ``exit_monitor:last_run`` is older than the threshold during market hours.

The tests intentionally do NOT spin up the real options chain — every
chain reference is a hand-built dataclass-style stub matching the
``OptionContract`` contract fields the calc relies on.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any

import pytest


# ---------------------------------------------------------------------------
# Test doubles — minimal OptionContract + OptionChain stand-ins so the
# tests don't depend on the real services.options models (which would drag
# in fastapi imports for no reason here).
# ---------------------------------------------------------------------------


@dataclass
class _StubContract:
    symbol: str
    underlying: str
    expiry: date
    strike: float
    option_type: str  # "call" | "put"
    bid: float = 0.0
    ask: float = 0.0
    last: float = 0.0


@dataclass
class _StubChain:
    contracts: list[_StubContract]


def _occ(underlying: str, expiry: date, opt_type: str, strike: float) -> str:
    """Build the OCC option symbol the parser expects."""
    return (
        f"{underlying}{expiry.year % 100:02d}{expiry.month:02d}{expiry.day:02d}"
        f"{'C' if opt_type == 'call' else 'P'}"
        f"{int(round(strike * 1000)):08d}"
    )


def _build_iron_condor_legs(
    spot: float,
    expiry: date,
    short_put: float = 95.0,
    long_put: float = 90.0,
    short_call: float = 105.0,
    long_call: float = 110.0,
    qty: int = 1,
) -> list[dict]:
    """Standard 4-leg iron condor in the strategy_runner dict shape."""
    underlying = "AMD"
    return [
        {
            "occ_symbol": _occ(underlying, expiry, "put", long_put),
            "side": "buy",
            "quantity": qty,
            "limit_price": 0.5,
        },
        {
            "occ_symbol": _occ(underlying, expiry, "put", short_put),
            "side": "sell",
            "quantity": qty,
            "limit_price": 1.0,
        },
        {
            "occ_symbol": _occ(underlying, expiry, "call", short_call),
            "side": "sell",
            "quantity": qty,
            "limit_price": 1.2,
        },
        {
            "occ_symbol": _occ(underlying, expiry, "call", long_call),
            "side": "buy",
            "quantity": qty,
            "limit_price": 0.6,
        },
    ]


def _build_iron_condor_chain(expiry: date) -> _StubChain:
    underlying = "AMD"
    return _StubChain(
        contracts=[
            _StubContract(
                symbol=_occ(underlying, expiry, "put", 90.0),
                underlying=underlying,
                expiry=expiry,
                strike=90.0,
                option_type="put",
                bid=0.45,
                ask=0.55,
            ),
            _StubContract(
                symbol=_occ(underlying, expiry, "put", 95.0),
                underlying=underlying,
                expiry=expiry,
                strike=95.0,
                option_type="put",
                bid=0.95,
                ask=1.05,
            ),
            _StubContract(
                symbol=_occ(underlying, expiry, "call", 105.0),
                underlying=underlying,
                expiry=expiry,
                strike=105.0,
                option_type="call",
                bid=1.15,
                ask=1.25,
            ),
            _StubContract(
                symbol=_occ(underlying, expiry, "call", 110.0),
                underlying=underlying,
                expiry=expiry,
                strike=110.0,
                option_type="call",
                bid=0.55,
                ask=0.65,
            ),
        ]
    )


# ---------------------------------------------------------------------------
# OE-1: compute_combo_mark
# ---------------------------------------------------------------------------


def test_compute_combo_mark_iron_condor_at_entry() -> None:
    """A balanced iron condor where short legs ≈ 1.00–1.20, long legs ≈ 0.50–0.60.

    Combo mark (cost-to-flatten):
        +long_put  * 100 = +0.50 * 100 =  +50
        -short_put * 100 = -1.00 * 100 = -100
        -short_call * 100 = -1.20 * 100 = -120
        +long_call * 100 = +0.60 * 100 =  +60
        ─────────────────────────────────────
        net                              = -110

    The negative number is correct: at entry the position represents a
    NET CREDIT (short premium > long premium). Closing it costs $110 less
    than entry — but wait, closing means flattening AT entry mid would
    pay $110 of credit BACK. The combo mark is the dollar cost to FLATTEN
    right now. -$110 means flattening would PAY you $110 (you collected
    more from the shorts than you'd pay for the longs).
    """
    from services.combo_calc import compute_combo_mark

    expiry = date.today() + timedelta(days=7)
    legs = _build_iron_condor_legs(spot=100.0, expiry=expiry)
    chain = _build_iron_condor_chain(expiry)

    mark = compute_combo_mark(legs, chain)

    assert mark is not None
    # Sum: +50 - 100 - 120 + 60 = -110
    assert mark == pytest.approx(-110.0, abs=0.5)


def test_compute_combo_mark_credit_spread_losing() -> None:
    """A credit spread where the short leg ballooned (underlying ran through
    the short strike). Expect mark MORE NEGATIVE than entry — the cost to
    flatten increased.
    """
    from services.combo_calc import compute_combo_mark

    expiry = date.today() + timedelta(days=7)
    underlying = "AMD"
    legs = [
        {
            "occ_symbol": _occ(underlying, expiry, "call", 105.0),
            "side": "sell",
            "quantity": 1,
        },
        {
            "occ_symbol": _occ(underlying, expiry, "call", 110.0),
            "side": "buy",
            "quantity": 1,
        },
    ]
    # Short call ballooned from 1.20 -> 5.00; long call from 0.60 -> 2.50
    # Mark = -5.00*100 + 2.50*100 = -500 + 250 = -250
    chain = _StubChain(
        contracts=[
            _StubContract(
                symbol=_occ(underlying, expiry, "call", 105.0),
                underlying=underlying,
                expiry=expiry,
                strike=105.0,
                option_type="call",
                bid=4.95,
                ask=5.05,
            ),
            _StubContract(
                symbol=_occ(underlying, expiry, "call", 110.0),
                underlying=underlying,
                expiry=expiry,
                strike=110.0,
                option_type="call",
                bid=2.45,
                ask=2.55,
            ),
        ]
    )

    mark = compute_combo_mark(legs, chain)
    assert mark is not None
    assert mark == pytest.approx(-250.0, abs=1.0)


def test_compute_combo_mark_falls_back_to_leg_mid_when_chain_missing() -> None:
    """If the chain is None, the calc uses each leg's stored ``limit_price``
    (recommender ``mid``) as a fallback. Useful for cold-start before the
    first chain refresh in a process."""
    from services.combo_calc import compute_combo_mark

    expiry = date.today() + timedelta(days=7)
    legs = _build_iron_condor_legs(spot=100.0, expiry=expiry)

    mark = compute_combo_mark(legs, chain=None)
    assert mark is not None
    # Sum: +0.5 - 1.0 - 1.2 + 0.6 = -1.1; * 100 = -110
    assert mark == pytest.approx(-110.0, abs=0.5)


def test_compute_combo_mark_returns_none_when_majority_unquoted() -> None:
    """If 3 of 4 legs have neither a chain quote nor a stored fallback, the
    calc refuses to return a number (returns ``None``). The caller MUST
    treat None as "skip this tick" rather than firing an exit on a stale
    spread mark."""
    from services.combo_calc import compute_combo_mark

    expiry = date.today() + timedelta(days=7)
    underlying = "AMD"
    # 4 legs, no fallback mids, empty chain → all 4 unquoted → returns None.
    legs = [
        {"occ_symbol": _occ(underlying, expiry, "put", 90.0), "side": "buy", "quantity": 1},
        {"occ_symbol": _occ(underlying, expiry, "put", 95.0), "side": "sell", "quantity": 1},
        {"occ_symbol": _occ(underlying, expiry, "call", 105.0), "side": "sell", "quantity": 1},
        {"occ_symbol": _occ(underlying, expiry, "call", 110.0), "side": "buy", "quantity": 1},
    ]
    chain = _StubChain(contracts=[])

    mark = compute_combo_mark(legs, chain)
    assert mark is None


def test_compute_combo_mark_ignores_malformed_leg() -> None:
    """A leg missing ``side`` is skipped, but the rest still contribute. If
    only ONE leg is malformed in a 4-leg condor, the computed mark uses
    the 3 valid legs.
    """
    from services.combo_calc import compute_combo_mark

    expiry = date.today() + timedelta(days=7)
    legs = _build_iron_condor_legs(spot=100.0, expiry=expiry)
    legs[0] = {"banana": True}  # malformed
    chain = _build_iron_condor_chain(expiry)

    mark = compute_combo_mark(legs, chain)
    # 3 legs remain: -100 - 120 + 60 = -160
    assert mark == pytest.approx(-160.0, abs=0.5)


# ---------------------------------------------------------------------------
# OE-2: _check_exits combo branch
# ---------------------------------------------------------------------------


class _FakeClient:
    """Minimal httpx-shape stub for _check_exits' broker calls."""

    def __init__(self) -> None:
        self.deleted: list[str] = []

    async def get(self, *args: Any, **kwargs: Any) -> Any:  # pragma: no cover
        class _Resp:
            status_code = 200

            def json(self) -> list[dict]:
                return []

        return _Resp()

    async def delete(self, url: str, *args: Any, **kwargs: Any) -> Any:
        self.deleted.append(url)

        class _Resp:
            status_code = 200

            def json(self) -> dict:
                return {}

        return _Resp()


@pytest.mark.asyncio
async def test_check_exits_combo_fires_on_combo_mark_below_threshold(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A combo with stop_loss_combo_mark = -200 must close when the spread
    bleeds to -250 (mark drops below threshold). The single-leg path must
    be untouched.
    """
    from data.ingestion import daily_pipeline as dp

    expiry = date.today() + timedelta(days=7)
    legs = _build_iron_condor_legs(spot=100.0, expiry=expiry)

    open_trades = [
        {
            "id": 42,
            "symbol": "AMD",
            "shares": 1,
            "side": "long",
            "strategy": "earnings_options_play",
            "legs": legs,
            "stop_loss_combo_mark": -200.0,
        }
    ]

    placed: list[dict] = []
    ledger_updates: list[tuple[int, dict]] = []

    class _Ledger:
        def get_open_positions(self) -> list[dict]:
            return open_trades

        def update(self, trade_id: int, patch: dict) -> bool:
            ledger_updates.append((trade_id, patch))
            return True

    # Bleeding chain: short call ran through, mark drops to ~-250.
    underlying = "AMD"
    bleeding_chain = _StubChain(
        contracts=[
            _StubContract(
                symbol=_occ(underlying, expiry, "put", 90.0),
                underlying=underlying,
                expiry=expiry,
                strike=90.0,
                option_type="put",
                bid=0.10,
                ask=0.20,
            ),
            _StubContract(
                symbol=_occ(underlying, expiry, "put", 95.0),
                underlying=underlying,
                expiry=expiry,
                strike=95.0,
                option_type="put",
                bid=0.20,
                ask=0.30,
            ),
            _StubContract(
                symbol=_occ(underlying, expiry, "call", 105.0),
                underlying=underlying,
                expiry=expiry,
                strike=105.0,
                option_type="call",
                bid=4.95,
                ask=5.05,
            ),
            _StubContract(
                symbol=_occ(underlying, expiry, "call", 110.0),
                underlying=underlying,
                expiry=expiry,
                strike=110.0,
                option_type="call",
                bid=2.45,
                ask=2.55,
            ),
        ]
    )

    async def _fake_chain(trade: dict) -> Any:
        return bleeding_chain

    async def _order(client: Any, symbol: str, qty: int, side: str, **kwargs: Any) -> dict:
        placed.append({"symbol": symbol, "qty": qty, "side": side})
        return {"id": f"ord-{symbol}-{side}", "status": "accepted"}

    monkeypatch.setattr(dp, "_fetch_chain_for_combo", _fake_chain)
    monkeypatch.setattr(dp, "_place_order", _order)

    closed = await dp._check_exits(_FakeClient(), _Ledger())

    assert len(closed) == 1
    assert closed[0]["kind"] == "combo"
    assert closed[0]["reason"] == "stop_loss_combo"
    assert closed[0]["symbol"] == "AMD"
    # Each of the 4 legs is closed with the OFFSETTING side.
    sides = [(p["side"]) for p in placed]
    assert sides.count("buy") == 2  # the two shorts get bought back
    assert sides.count("sell") == 2  # the two longs get sold
    # Ledger row marked closed.
    assert ledger_updates and ledger_updates[0][0] == 42
    assert ledger_updates[0][1]["status"] == "closed"
    assert ledger_updates[0][1]["exit_reason"] == "stop_loss_combo"


@pytest.mark.asyncio
async def test_check_exits_combo_does_not_fire_when_mark_above_threshold(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """At entry the mark is ~-110. Threshold of -200 is BELOW that. Nothing
    should fire.
    """
    from data.ingestion import daily_pipeline as dp

    expiry = date.today() + timedelta(days=7)
    legs = _build_iron_condor_legs(spot=100.0, expiry=expiry)
    chain = _build_iron_condor_chain(expiry)

    placed: list[dict] = []

    class _Ledger:
        def get_open_positions(self) -> list[dict]:
            return [
                {
                    "id": 1,
                    "symbol": "AMD",
                    "shares": 1,
                    "side": "long",
                    "strategy": "earnings_options_play",
                    "legs": legs,
                    "stop_loss_combo_mark": -200.0,
                }
            ]

        def update(self, *a: Any, **k: Any) -> bool:
            placed.append({"update": True})
            return True

    async def _fake_chain(trade: dict) -> Any:
        return chain

    async def _no_order(*a: Any, **k: Any) -> dict:
        placed.append({"order": True})
        return {"id": "should-not-fire"}

    monkeypatch.setattr(dp, "_fetch_chain_for_combo", _fake_chain)
    monkeypatch.setattr(dp, "_place_order", _no_order)

    closed = await dp._check_exits(_FakeClient(), _Ledger())

    assert closed == []
    assert placed == []  # no orders, no ledger updates


@pytest.mark.asyncio
async def test_check_exits_single_leg_path_unchanged(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """OE-2 must not regress single-leg behaviour. A long-equity stop fires
    exactly as before.
    """
    from data.ingestion import daily_pipeline as dp

    placed: list[dict] = []
    exits: list[dict] = []

    class _Ledger:
        def get_open_positions(self) -> list[dict]:
            return [
                {
                    "id": 7,
                    "symbol": "TSLA",
                    "shares": 10,
                    "entry_price": 100.0,
                    "stop_loss": 95.0,
                    "take_profit": 110.0,
                    "side": "long",
                    "strategy": "rsi2_reversal",
                    # NOTE: no legs, no stop_loss_combo_mark — single-leg path.
                }
            ]

        def record_exit(
            self, symbol: str, shares: int, price: float, reason: str,
            side: str | None = None,
        ) -> None:
            exits.append({"symbol": symbol, "reason": reason, "price": price})

    async def _positions(client: Any, **kwargs: Any) -> list[dict]:
        # Mark dropped through the stop.
        return [{"symbol": "TSLA", "current_price": 94.0}]

    async def _order(
        client: Any, symbol: str, qty: int, side: str, **kwargs: Any,
    ) -> dict:
        placed.append({"symbol": symbol, "qty": qty, "side": side})
        return {"id": "single-leg-1", "status": "accepted"}

    async def _fill(client: Any, order_id: str, **kwargs: Any) -> float:
        return 94.0

    monkeypatch.setattr(dp, "_get_positions", _positions)
    monkeypatch.setattr(dp, "_place_order", _order)
    monkeypatch.setattr(dp, "_poll_fill_price", _fill)

    closed = await dp._check_exits(_FakeClient(), _Ledger())

    assert len(closed) == 1
    assert closed[0]["reason"] == "stop_loss"
    assert exits == [{"symbol": "TSLA", "reason": "stop_loss", "price": 94.0}]
    assert placed == [{"symbol": "TSLA", "qty": 10, "side": "sell"}]


@pytest.mark.asyncio
async def test_check_exits_combo_defers_when_mark_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When the chain is unreachable AND the legs carry no fallback mids,
    the calc returns None and the exit checker MUST defer (no order
    placed) rather than firing on a 0.0 implied mark.
    """
    from data.ingestion import daily_pipeline as dp

    expiry = date.today() + timedelta(days=7)
    underlying = "AMD"
    # Legs with NO limit_price/mid — purely OCC-only.
    legs = [
        {"occ_symbol": _occ(underlying, expiry, "put", 90.0), "side": "buy", "quantity": 1},
        {"occ_symbol": _occ(underlying, expiry, "put", 95.0), "side": "sell", "quantity": 1},
        {"occ_symbol": _occ(underlying, expiry, "call", 105.0), "side": "sell", "quantity": 1},
        {"occ_symbol": _occ(underlying, expiry, "call", 110.0), "side": "buy", "quantity": 1},
    ]

    placed: list[dict] = []

    class _Ledger:
        def get_open_positions(self) -> list[dict]:
            return [
                {
                    "id": 99,
                    "symbol": "AMD",
                    "shares": 1,
                    "side": "long",
                    "strategy": "earnings_options_play",
                    "legs": legs,
                    "stop_loss_combo_mark": -200.0,
                }
            ]

        def update(self, *a: Any, **k: Any) -> bool:
            placed.append({"update": True})
            return True

    async def _no_chain(trade: dict) -> Any:
        return None  # provider unreachable

    async def _no_order(*a: Any, **k: Any) -> dict:
        placed.append({"order": True})
        return {"id": "should-not-fire"}

    monkeypatch.setattr(dp, "_fetch_chain_for_combo", _no_chain)
    monkeypatch.setattr(dp, "_place_order", _no_order)

    closed = await dp._check_exits(_FakeClient(), _Ledger())

    assert closed == []
    # Specifically: NO order placed, NO ledger close. Defer = correct.
    assert all("order" not in p for p in placed)


# ---------------------------------------------------------------------------
# OE-4: heartbeat fail-safe
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_exit_monitor_heartbeat_logs_error_when_stale(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Heartbeat older than EXIT_MONITOR_STALE_AFTER_SEC during market hours
    triggers an ERROR log. (Once OPEN-2 lands the same hook will also
    fire a pager alert; the log line is the canonical signal today.)
    """
    import logging

    from data.ingestion import pipeline_runner as pr

    # Force market-hours-true.
    monkeypatch.setattr(pr, "_is_market_hours", lambda: True)

    stale_ts = datetime.now(timezone.utc) - timedelta(
        seconds=pr.EXIT_MONITOR_STALE_AFTER_SEC + 60
    )

    async def _fake_cache_get(key: str) -> Any:
        if key == "exit_monitor:last_run":
            return {"ts": stale_ts.isoformat()}
        return None

    # Replace the cache_get import inside the heartbeat function. Because
    # _check_exit_monitor_heartbeat does ``from core.redis import cache_get``
    # at call time, monkeypatch the core.redis module's cache_get.
    import core.redis as _cr
    monkeypatch.setattr(_cr, "cache_get", _fake_cache_get)

    caplog.set_level(logging.ERROR, logger="alphadesk.pipeline.scheduler")
    await pr._check_exit_monitor_heartbeat()

    assert any(
        "STALE" in record.message for record in caplog.records
    ), "Expected STALE heartbeat ERROR log"


@pytest.mark.asyncio
async def test_exit_monitor_heartbeat_quiet_when_fresh(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """A fresh heartbeat (within threshold) must not log ERROR."""
    import logging

    from data.ingestion import pipeline_runner as pr

    monkeypatch.setattr(pr, "_is_market_hours", lambda: True)

    fresh_ts = datetime.now(timezone.utc) - timedelta(seconds=30)

    async def _fake_cache_get(key: str) -> Any:
        if key == "exit_monitor:last_run":
            return {"ts": fresh_ts.isoformat()}
        return None

    import core.redis as _cr
    monkeypatch.setattr(_cr, "cache_get", _fake_cache_get)

    caplog.set_level(logging.ERROR, logger="alphadesk.pipeline.scheduler")
    await pr._check_exit_monitor_heartbeat()

    assert not any(
        "STALE" in record.message for record in caplog.records
    ), "Fresh heartbeat must not warn"


@pytest.mark.asyncio
async def test_exit_monitor_heartbeat_skips_outside_market_hours(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Outside RTH the monitor is paused — staleness is the expected state
    and must NOT log an error.
    """
    import logging

    from data.ingestion import pipeline_runner as pr

    monkeypatch.setattr(pr, "_is_market_hours", lambda: False)

    very_stale = datetime.now(timezone.utc) - timedelta(hours=12)

    async def _fake_cache_get(key: str) -> Any:
        return {"ts": very_stale.isoformat()}

    import core.redis as _cr
    monkeypatch.setattr(_cr, "cache_get", _fake_cache_get)

    caplog.set_level(logging.ERROR, logger="alphadesk.pipeline.scheduler")
    await pr._check_exit_monitor_heartbeat()

    assert not any(
        "STALE" in record.message for record in caplog.records
    ), "Outside RTH should be quiet"
