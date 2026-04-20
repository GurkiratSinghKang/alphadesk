"""Tests for the Wave 2H market-surveillance additions (persona-76).

Covered:

* Restricted-symbol deny-list refused at order entry (P76-7).
* Wash-trade detection when an opposite-side order fires within 60s at
  ≤10bps (P76-1).
* Cancel-rate Redis buckets increment on cancel and are aggregated by
  ``_evaluate_cancel_rate`` (P76-2).
* Closing-auction throttle after 15:45 ET; ``allow_closing_auction=True``
  bypass (P76-3).
* Wave 3K (persona-87 P1 #1): every rejection + halt / resume transition
  now also lands an ``audit_log`` row via ``core.audit.write_audit``.
  These tests run under SKIP_DB_INIT=True so the DB row write is
  short-circuited — we assert against the structured ``alphadesk.audit``
  log record the helper always emits (the DB path is covered by
  ``backend/data/storage/tests/test_audit_log.py``).

Redis is always mocked — these are pure unit tests around the surveillance
helpers. ``create_order`` is not exercised here; the entrypoint is in a
separate integration suite. Each helper is tested in isolation so a broken
build surfaces on the single offending function.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
from fastapi import HTTPException
from zoneinfo import ZoneInfo

from api.routes import trades as trades_mod
from api.routes.trades import (
    CreateOrderRequest,
    OrderLeg,
    OrderSide,
    OrderType,
)


# --------------------------------------------------------------------------- #
# Capture helper for the ``alphadesk.audit`` logger (Wave 3K)                #
# --------------------------------------------------------------------------- #


class _AuditCapture(logging.Handler):
    """Collect log records emitted on the audit logger during a test."""

    def __init__(self) -> None:
        super().__init__()
        self.records: list[logging.LogRecord] = []

    def emit(self, record: logging.LogRecord) -> None:  # pragma: no cover — trivial
        self.records.append(record)


@pytest.fixture
def audit_capture() -> _AuditCapture:
    """Attach a capture handler to ``alphadesk.audit`` for the test body."""
    logger = logging.getLogger("alphadesk.audit")
    handler = _AuditCapture()
    handler.setLevel(logging.DEBUG)
    logger.addHandler(handler)
    prev_level = logger.level
    logger.setLevel(logging.DEBUG)
    try:
        yield handler
    finally:
        logger.removeHandler(handler)
        logger.setLevel(prev_level)


# --------------------------------------------------------------------------- #
# FakeRedis — minimal surface area for the helpers under test                #
# --------------------------------------------------------------------------- #


class FakeRedis:
    """Bare-bones Redis stub covering the commands our helpers use."""

    def __init__(self) -> None:
        self._strings: dict[str, str] = {}
        self._lists: dict[str, list[str]] = {}

    async def get(self, key: str) -> str | None:
        return self._strings.get(key)

    async def set(self, key: str, value: Any, **_kw: Any) -> bool:
        self._strings[key] = str(value)
        return True

    async def incr(self, key: str) -> int:
        cur = int(self._strings.get(key, "0") or "0")
        cur += 1
        self._strings[key] = str(cur)
        return cur

    async def incrbyfloat(self, key: str, amount: float) -> float:
        cur = float(self._strings.get(key, "0") or "0")
        cur += float(amount)
        self._strings[key] = str(cur)
        return cur

    async def expire(self, _key: str, _ttl: int) -> bool:
        # TTL is irrelevant for unit tests — we simulate a fast-forward by
        # clearing keys directly in tests that need it.
        return True

    async def delete(self, *keys: str) -> int:
        """Drop one or more keys. Used by ``_set_trading_halted(False)``."""
        count = 0
        for key in keys:
            if key in self._strings:
                del self._strings[key]
                count += 1
            if key in self._lists:
                del self._lists[key]
                count += 1
        return count

    async def lpush(self, key: str, value: str) -> int:
        self._lists.setdefault(key, []).insert(0, value)
        return len(self._lists[key])

    async def ltrim(self, key: str, start: int, end: int) -> bool:
        lst = self._lists.get(key, [])
        self._lists[key] = lst[start : end + 1]
        return True

    async def lrange(self, key: str, start: int, end: int) -> list[str]:
        lst = self._lists.get(key, [])
        if end == -1:
            return list(lst[start:])
        return list(lst[start : end + 1])


@pytest.fixture
def fake_redis(monkeypatch: pytest.MonkeyPatch) -> FakeRedis:
    """Install a shared FakeRedis in place of the real connection pool."""
    r = FakeRedis()

    async def _get_redis() -> FakeRedis:
        return r

    # Patch the module-level redis accessor. Helpers import ``get_redis``
    # lazily inside the call body, so monkey-patching the ``core.redis``
    # module attribute is sufficient.
    from core import redis as core_redis
    monkeypatch.setattr(core_redis, "get_redis", _get_redis)
    return r


# --------------------------------------------------------------------------- #
# Restricted-symbol rejection in _aggregate_risk_check                       #
# --------------------------------------------------------------------------- #


def _minimal_order(symbol: str = "AAPL", side: OrderSide = OrderSide.BUY) -> CreateOrderRequest:
    """Return a valid limit-order request for the given symbol/side."""
    return CreateOrderRequest(
        legs=[OrderLeg(
            symbol=symbol, side=side, qty=10, order_type=OrderType.LIMIT,
            limit_price=100.0,
        )],
        strategy=None,
        notes=None,
    )


@pytest.mark.asyncio
async def test_restricted_symbol_rejected_by_aggregate_risk_check(
    fake_redis: FakeRedis, monkeypatch: pytest.MonkeyPatch,
) -> None:
    from core import compliance
    monkeypatch.setattr(compliance, "RESTRICTED_SYMBOLS", frozenset({"GME"}))

    order = _minimal_order(symbol="GME")
    ok, reason = await trades_mod._aggregate_risk_check(order, username="alice")
    assert ok is False
    assert "restricted symbol" in reason.lower()


@pytest.mark.asyncio
async def test_allowed_symbol_not_rejected_by_restricted_list(
    fake_redis: FakeRedis, monkeypatch: pytest.MonkeyPatch,
) -> None:
    from core import compliance
    monkeypatch.setattr(compliance, "RESTRICTED_SYMBOLS", frozenset({"GME"}))

    # Short-circuit the downstream gross-notional / positions / sector
    # fetches so the test only exercises the restricted-symbol path.
    async def _zero_notional(_req: Any) -> float:
        return 0.0

    async def _zero_gross() -> float:
        return 0.0

    async def _no_positions() -> tuple[int, dict[str, float], float]:
        return 0, {}, 0.0

    monkeypatch.setattr(trades_mod, "_compute_order_notional", _zero_notional)
    monkeypatch.setattr(trades_mod, "_get_todays_gross_notional", _zero_gross)
    monkeypatch.setattr(
        trades_mod,
        "_get_open_position_count_and_sector_exposure",
        _no_positions,
    )

    order = _minimal_order(symbol="AAPL")
    ok, _ = await trades_mod._aggregate_risk_check(order, username="alice")
    assert ok is True


# --------------------------------------------------------------------------- #
# Wash-trade detection                                                       #
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_wash_trade_detected_on_opposite_side_within_window(
    fake_redis: FakeRedis,
) -> None:
    # Previous BUY at $100 lands 5s ago; a SELL at $100.05 is 5bps away.
    prev = {
        "side": "buy",
        "price": 100.0,
        "ts": (datetime.now(timezone.utc).timestamp() - 5),
    }
    fake_redis._lists["wash_trace:alice:AAPL"] = [json.dumps(prev)]

    order = _minimal_order(symbol="AAPL", side=OrderSide.SELL)
    # Override limit_price so ``_check_wash_trade`` uses our 100.05.
    order.legs[0].limit_price = 100.05

    ok, reason = await trades_mod._check_wash_trade("alice", order)
    assert ok is False
    assert "wash-trading pattern detected" in reason
    assert "AAPL" in reason


@pytest.mark.asyncio
async def test_wash_trade_not_triggered_when_price_far_apart(
    fake_redis: FakeRedis,
) -> None:
    # 200bps move — well outside the 10bps band.
    prev = {
        "side": "buy",
        "price": 100.0,
        "ts": (datetime.now(timezone.utc).timestamp() - 5),
    }
    fake_redis._lists["wash_trace:alice:AAPL"] = [json.dumps(prev)]

    order = _minimal_order(symbol="AAPL", side=OrderSide.SELL)
    order.legs[0].limit_price = 102.0  # 200bps

    ok, _ = await trades_mod._check_wash_trade("alice", order)
    assert ok is True


@pytest.mark.asyncio
async def test_wash_trade_not_triggered_after_window_expires(
    fake_redis: FakeRedis,
) -> None:
    # Previous order 120s ago — past the 60s window.
    prev = {
        "side": "buy",
        "price": 100.0,
        "ts": (datetime.now(timezone.utc).timestamp() - 120),
    }
    fake_redis._lists["wash_trace:alice:AAPL"] = [json.dumps(prev)]

    order = _minimal_order(symbol="AAPL", side=OrderSide.SELL)
    order.legs[0].limit_price = 100.05

    ok, _ = await trades_mod._check_wash_trade("alice", order)
    assert ok is True


@pytest.mark.asyncio
async def test_wash_trade_not_triggered_for_same_side(
    fake_redis: FakeRedis,
) -> None:
    # Prior BUY, incoming BUY — not an opposite-side cross, no wash.
    prev = {
        "side": "buy",
        "price": 100.0,
        "ts": (datetime.now(timezone.utc).timestamp() - 5),
    }
    fake_redis._lists["wash_trace:alice:AAPL"] = [json.dumps(prev)]

    order = _minimal_order(symbol="AAPL", side=OrderSide.BUY)
    order.legs[0].limit_price = 100.05

    ok, _ = await trades_mod._check_wash_trade("alice", order)
    assert ok is True


@pytest.mark.asyncio
async def test_wash_trade_user_scoped(fake_redis: FakeRedis) -> None:
    # Alice's prior BUY must NOT wash Bob's SELL — the counter is
    # per-user for audit + regulatory isolation.
    prev = {
        "side": "buy",
        "price": 100.0,
        "ts": (datetime.now(timezone.utc).timestamp() - 5),
    }
    fake_redis._lists["wash_trace:alice:AAPL"] = [json.dumps(prev)]

    order = _minimal_order(symbol="AAPL", side=OrderSide.SELL)
    order.legs[0].limit_price = 100.05

    ok, _ = await trades_mod._check_wash_trade("bob", order)
    assert ok is True


@pytest.mark.asyncio
async def test_record_fill_for_wash_detection_persists_entry(
    fake_redis: FakeRedis,
) -> None:
    await trades_mod._record_fill_for_wash_detection(
        "alice", "AAPL", "buy", 100.0,
    )
    entries = fake_redis._lists.get("wash_trace:alice:AAPL", [])
    assert len(entries) == 1
    rec = json.loads(entries[0])
    assert rec["side"] == "buy"
    assert rec["price"] == 100.0
    assert "ts" in rec


# --------------------------------------------------------------------------- #
# Cancel-rate monitoring                                                     #
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_record_cancel_for_rate_increments_bucket(
    fake_redis: FakeRedis,
) -> None:
    await trades_mod._record_cancel_for_rate("alice")
    await trades_mod._record_cancel_for_rate("alice")

    # Key format is ``cancel_rate:<user>:<YYYY-MM-DD-HH-MM>`` — we don't
    # need to spell it out, just confirm that a single user bucket grew.
    alice_keys = [k for k in fake_redis._strings if k.startswith("cancel_rate:alice:")]
    assert alice_keys
    total = sum(int(fake_redis._strings[k]) for k in alice_keys)
    assert total == 2


@pytest.mark.asyncio
async def test_record_submit_for_cancel_rate_increments_bucket(
    fake_redis: FakeRedis,
) -> None:
    await trades_mod._record_submit_for_cancel_rate("alice")

    keys = [k for k in fake_redis._strings if k.startswith("submit_rate:alice:")]
    assert keys
    assert int(fake_redis._strings[keys[0]]) == 1


@pytest.mark.asyncio
async def test_evaluate_cancel_rate_ratio_above_threshold(
    fake_redis: FakeRedis,
) -> None:
    # 8 cancels vs 2 submits in the current bucket → ratio 0.8 > 0.70.
    for _ in range(8):
        await trades_mod._record_cancel_for_rate("alice")
    for _ in range(2):
        await trades_mod._record_submit_for_cancel_rate("alice")

    ratio, cancels, submits = await trades_mod._evaluate_cancel_rate("alice")
    assert cancels == 8
    assert submits == 2
    assert ratio == pytest.approx(0.8)
    assert ratio > trades_mod.CANCEL_RATE_THRESHOLD


@pytest.mark.asyncio
async def test_evaluate_cancel_rate_ratio_below_threshold(
    fake_redis: FakeRedis,
) -> None:
    # 2 cancels vs 8 submits → ratio 0.20, well under the 0.70 threshold.
    for _ in range(2):
        await trades_mod._record_cancel_for_rate("alice")
    for _ in range(8):
        await trades_mod._record_submit_for_cancel_rate("alice")

    ratio, _, _ = await trades_mod._evaluate_cancel_rate("alice")
    assert ratio == pytest.approx(0.2)
    assert ratio <= trades_mod.CANCEL_RATE_THRESHOLD


@pytest.mark.asyncio
async def test_evaluate_cancel_rate_empty_buckets_yield_zero(
    fake_redis: FakeRedis,
) -> None:
    # No traffic at all — ratio must be 0, NOT NaN or an error.
    ratio, cancels, submits = await trades_mod._evaluate_cancel_rate("alice")
    assert cancels == 0
    assert submits == 0
    assert ratio == 0.0


# --------------------------------------------------------------------------- #
# Closing-auction throttle                                                   #
# --------------------------------------------------------------------------- #


def _force_et_time(monkeypatch: pytest.MonkeyPatch, hour: int, minute: int) -> None:
    """Pin the ET wall-clock so ``_is_after_closing_auction_cutoff`` is deterministic."""
    et = ZoneInfo("America/New_York")
    # Pick an arbitrary weekday that we know is a normal trading session.
    fixed_et = datetime(2025, 6, 10, hour, minute, 0, tzinfo=et)
    fixed_utc = fixed_et.astimezone(timezone.utc)

    class _FixedDatetime(datetime):
        @classmethod
        def now(cls, tz: Any = None) -> datetime:  # type: ignore[override]
            if tz is None:
                return fixed_utc.replace(tzinfo=None)
            return fixed_utc.astimezone(tz)

    monkeypatch.setattr(trades_mod, "datetime", _FixedDatetime)


def test_is_after_closing_auction_cutoff_before_1545(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _force_et_time(monkeypatch, 15, 30)  # 15:30 ET — before cutoff
    assert trades_mod._is_after_closing_auction_cutoff() is False


def test_is_after_closing_auction_cutoff_at_1545(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _force_et_time(monkeypatch, 15, 45)  # exactly at cutoff
    assert trades_mod._is_after_closing_auction_cutoff() is True


def test_is_after_closing_auction_cutoff_at_1559(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _force_et_time(monkeypatch, 15, 59)
    assert trades_mod._is_after_closing_auction_cutoff() is True


def test_is_after_closing_auction_cutoff_after_close(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _force_et_time(monkeypatch, 16, 15)  # after the close — window closed
    assert trades_mod._is_after_closing_auction_cutoff() is False


@pytest.mark.asyncio
async def test_closing_auction_throttle_blocks_large_order_after_1545(
    fake_redis: FakeRedis,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _force_et_time(monkeypatch, 15, 50)

    # Stub out unrelated gates so the test only exercises the auction
    # throttle path.
    async def _zero_gross() -> float:
        return 0.0

    async def _no_positions() -> tuple[int, dict[str, float], float]:
        return 0, {}, 0.0

    monkeypatch.setattr(trades_mod, "_get_todays_gross_notional", _zero_gross)
    monkeypatch.setattr(
        trades_mod,
        "_get_open_position_count_and_sector_exposure",
        _no_positions,
    )

    # Rolling 15-min counter already at 90% of the auction cap.
    cap = (
        trades_mod.DAILY_GROSS_NOTIONAL_CAP
        * trades_mod.CLOSING_AUCTION_THROTTLE_FRACTION
    )
    prefilled = cap * 0.9
    # Put the prefilled total into the current-minute bucket so
    # ``_sum_closing_auction_notional`` picks it up.
    from datetime import datetime as _dt
    now_key = _dt.now(timezone.utc).strftime("%Y-%m-%d-%H-%M")
    fake_redis._strings[f"closing_auction_notional:{now_key}"] = str(prefilled)

    # Incoming order with notional large enough to exceed the cap.
    big = trades_mod.PER_ORDER_NOTIONAL_CAP  # well above 10% head-room
    order = CreateOrderRequest(
        legs=[OrderLeg(
            symbol="AAPL", side=OrderSide.BUY, qty=10,
            order_type=OrderType.LIMIT, limit_price=big / 10,
        )],
        allow_closing_auction=False,
        strategy=None,
        notes=None,
    )
    ok, reason = await trades_mod._aggregate_risk_check(order, username="alice")
    assert ok is False
    assert "closing-auction throttle" in reason.lower()


@pytest.mark.asyncio
async def test_closing_auction_throttle_bypass_with_allow_flag(
    fake_redis: FakeRedis,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _force_et_time(monkeypatch, 15, 50)

    async def _zero_gross() -> float:
        return 0.0

    async def _no_positions() -> tuple[int, dict[str, float], float]:
        return 0, {}, 0.0

    monkeypatch.setattr(trades_mod, "_get_todays_gross_notional", _zero_gross)
    monkeypatch.setattr(
        trades_mod,
        "_get_open_position_count_and_sector_exposure",
        _no_positions,
    )

    # Even with a huge order AND a prefilled counter, the bypass flag
    # should let it through.
    cap = (
        trades_mod.DAILY_GROSS_NOTIONAL_CAP
        * trades_mod.CLOSING_AUCTION_THROTTLE_FRACTION
    )
    from datetime import datetime as _dt
    now_key = _dt.now(timezone.utc).strftime("%Y-%m-%d-%H-%M")
    fake_redis._strings[f"closing_auction_notional:{now_key}"] = str(cap * 10)

    order = CreateOrderRequest(
        legs=[OrderLeg(
            symbol="AAPL", side=OrderSide.BUY, qty=10,
            order_type=OrderType.LIMIT, limit_price=50.0,
        )],
        allow_closing_auction=True,
        strategy=None,
        notes=None,
    )
    ok, _ = await trades_mod._aggregate_risk_check(order, username="alice")
    assert ok is True


# --------------------------------------------------------------------------- #
# Wave 3K — audit-log wiring on rejections + halt/resume                     #
# --------------------------------------------------------------------------- #


def _find_audit_event(capture: _AuditCapture, event_name: str) -> logging.LogRecord | None:
    """Return the first log record on the audit logger with ``event=name``.

    Skips records without a ``username`` attribute — those are the
    pre-existing surveillance-audit warnings that still use the legacy
    ``user=`` key. The Wave 3K ``write_audit`` helper always sets
    ``username`` so ``_find_audit_event`` lets us uniquely pick the
    durable-audit record rather than the older breadcrumb.
    """
    for record in capture.records:
        if getattr(record, "event", None) != event_name:
            continue
        if not hasattr(record, "username"):
            continue
        return record
    return None


@pytest.mark.asyncio
async def test_wash_trade_reject_writes_audit_log(
    fake_redis: FakeRedis,
    audit_capture: _AuditCapture,
) -> None:
    """A wash-trade rejection must emit an ``event=wash_trade_rejected`` audit record.

    SKIP_DB_INIT=True in this test environment short-circuits the DB
    write, but ``core.audit.write_audit`` always emits the structured
    log record first — that record is what downstream aggregators
    consume today, and what regulators grep for during an audit.
    """
    prev = {
        "side": "buy",
        "price": 100.0,
        "ts": (datetime.now(timezone.utc).timestamp() - 5),
    }
    fake_redis._lists["wash_trace:alice:AAPL"] = [json.dumps(prev)]

    order = _minimal_order(symbol="AAPL", side=OrderSide.SELL)
    order.legs[0].limit_price = 100.05

    ok, _reason = await trades_mod._check_wash_trade("alice", order)
    assert ok is False

    rec = _find_audit_event(audit_capture, "wash_trade_rejected")
    assert rec is not None, "write_audit must emit an event=wash_trade_rejected record"
    assert getattr(rec, "username", None) == "alice"
    # Details fields are promoted to top-level LogRecord attrs by
    # core.audit.write_audit so the aggregator can query them natively.
    assert getattr(rec, "symbol", None) == "AAPL"
    assert getattr(rec, "side", None) == "sell"


@pytest.mark.asyncio
async def test_restricted_symbol_reject_writes_audit_log(
    fake_redis: FakeRedis,
    monkeypatch: pytest.MonkeyPatch,
    audit_capture: _AuditCapture,
) -> None:
    """A restricted-symbol rejection must emit ``event=restricted_symbol_rejected``."""
    from core import compliance
    monkeypatch.setattr(compliance, "RESTRICTED_SYMBOLS", frozenset({"GME"}))

    order = _minimal_order(symbol="GME")
    ok, _reason = await trades_mod._aggregate_risk_check(order, username="alice")
    assert ok is False

    rec = _find_audit_event(audit_capture, "restricted_symbol_rejected")
    assert rec is not None
    assert getattr(rec, "username", None) == "alice"
    # The details payload records every symbol the order tried to place
    # — useful when a multi-leg order hits the gate on leg 2+.
    symbols = getattr(rec, "symbols", None)
    assert symbols == ["GME"]


@pytest.mark.asyncio
async def test_halt_trading_writes_audit_log(
    fake_redis: FakeRedis,
    monkeypatch: pytest.MonkeyPatch,
    audit_capture: _AuditCapture,
) -> None:
    """/trades/halt must emit ``event=halt_trading`` with the acting user.

    Persona-87 P1 gap 3: the halt / resume endpoints were entirely
    unaudited before this wave.  We exercise the handler directly
    (bypassing FastAPI routing) since the goal is to confirm the
    ``write_audit`` wiring, not the request pipeline.
    """
    # Short-circuit the Alpaca cancel-all-orders call — the handler
    # swallows HTTP errors internally so this would otherwise reach out
    # to the live URL during the test.
    import httpx

    class _StubClient:
        def __init__(self, *a: Any, **kw: Any) -> None:
            pass

        async def __aenter__(self) -> Any:
            return self

        async def __aexit__(self, *a: Any, **kw: Any) -> None:
            return None

        async def delete(self, *a: Any, **kw: Any) -> Any:
            class _Resp:
                status_code = 200

            return _Resp()

    monkeypatch.setattr(httpx, "AsyncClient", _StubClient)

    # Build a minimal Request-shaped object the handler expects.
    class _FakeState:
        request_id = "req-halt-123"

    class _FakeRequest:
        headers: dict[str, str] = {}
        client = None
        state = _FakeState()

    resp = await trades_mod.halt_trading(req=_FakeRequest(), username="admin")
    assert resp["halted"] is True

    rec = _find_audit_event(audit_capture, "halt_trading")
    assert rec is not None
    assert getattr(rec, "username", None) == "admin"
    assert getattr(rec, "audit_request_id", None) == "req-halt-123"
    assert getattr(rec, "result", None) == "success"


@pytest.mark.asyncio
async def test_resume_trading_writes_audit_log(
    fake_redis: FakeRedis,
    audit_capture: _AuditCapture,
) -> None:
    """/trades/resume must emit ``event=resume_trading`` with the acting user."""
    # Seed the halt key so resume has real work to do.
    fake_redis._strings["trading:halted"] = json.dumps({"halted": True})

    class _FakeState:
        request_id = "req-resume-456"

    class _FakeRequest:
        headers: dict[str, str] = {}
        client = None
        state = _FakeState()

    resp = await trades_mod.resume_trading(req=_FakeRequest(), username="admin")
    assert resp["halted"] is False

    rec = _find_audit_event(audit_capture, "resume_trading")
    assert rec is not None
    assert getattr(rec, "username", None) == "admin"
    assert getattr(rec, "audit_request_id", None) == "req-resume-456"
    assert getattr(rec, "result", None) == "success"


@pytest.mark.asyncio
async def test_closing_auction_throttle_inactive_before_1545(
    fake_redis: FakeRedis,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _force_et_time(monkeypatch, 14, 0)  # 14:00 ET — well before the cutoff

    async def _zero_gross() -> float:
        return 0.0

    async def _no_positions() -> tuple[int, dict[str, float], float]:
        return 0, {}, 0.0

    monkeypatch.setattr(trades_mod, "_get_todays_gross_notional", _zero_gross)
    monkeypatch.setattr(
        trades_mod,
        "_get_open_position_count_and_sector_exposure",
        _no_positions,
    )

    # A prefilled counter is irrelevant before the cutoff — the gate must
    # not fire.
    cap = (
        trades_mod.DAILY_GROSS_NOTIONAL_CAP
        * trades_mod.CLOSING_AUCTION_THROTTLE_FRACTION
    )
    from datetime import datetime as _dt
    now_key = _dt.now(timezone.utc).strftime("%Y-%m-%d-%H-%M")
    fake_redis._strings[f"closing_auction_notional:{now_key}"] = str(cap * 10)

    order = CreateOrderRequest(
        legs=[OrderLeg(
            symbol="AAPL", side=OrderSide.BUY, qty=10,
            order_type=OrderType.LIMIT, limit_price=50.0,
        )],
        allow_closing_auction=False,
        strategy=None,
        notes=None,
    )
    ok, _ = await trades_mod._aggregate_risk_check(order, username="alice")
    assert ok is True
