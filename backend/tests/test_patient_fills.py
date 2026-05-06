"""M-O F-4 (2026-05-05) — patient mid-pricing tests.

Covers ``services.order_management.submit_combo_at_mid`` end-to-end with
a fake broker so the suite never reaches Alpaca:

* Initial submit lands at the COMBO MID computed from leg-stored bid/ask.
* When the broker doesn't fill within the per-walk window, the walker
  cancels and re-submits at ``mid + walk_step_pct * spread`` toward the
  worse side. With bid=$1.00 / ask=$1.10 and the default 10% step, the
  3 prices the walker sends to the broker are $1.05, $1.06, $1.07.
* Hitting the deadline without a fill returns ``unfilled`` (the walker
  intentionally does NOT slam at the ask/bid).
* When the order fills, the helper computes a ``FillQuality`` record
  (target / actual / slippage_pct).
* AMD-style 4-leg iron condor net $6.62 credit fills cleanly at mid →
  slippage 0%.

The walker accepts injectable ``sleep`` / ``now`` / ``submit_fn`` /
``cancel_fn`` / ``poll_fn`` callables so the tests drive virtual time
without ``asyncio.sleep`` actually blocking.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Callable

import pytest

from services.order_management import (
    DEFAULT_DEADLINE_SECONDS,
    DEFAULT_MAX_WALK_SECONDS,
    DEFAULT_MAX_WALKS,
    DEFAULT_WALK_STEP_PCT,
    FillQuality,
    OrderResult,
    compute_combo_mid_per_share,
    compute_combo_spread,
    compute_slippage_pct,
    submit_combo_at_mid,
    walk_price,
)


# ---------------------------------------------------------------------------
# Test doubles
# ---------------------------------------------------------------------------


def _occ(underlying: str, expiry: date, opt_type: str, strike: float) -> str:
    """Build the OCC option symbol the parser expects."""
    return (
        f"{underlying}{expiry.year % 100:02d}{expiry.month:02d}{expiry.day:02d}"
        f"{'C' if opt_type == 'call' else 'P'}"
        f"{int(round(strike * 1000)):08d}"
    )


@dataclass
class _StubContract:
    symbol: str
    bid: float
    ask: float
    last: float = 0.0
    underlying: str = "X"
    expiry: date = date(2026, 6, 19)
    strike: float = 100.0
    option_type: str = "call"


@dataclass
class _StubChain:
    contracts: list[_StubContract]


@dataclass
class _VirtualClock:
    """Simple monotonic clock that advances only when ``sleep`` is awaited.

    This lets the walker make synchronous progress through 30s walk windows
    + 120s deadlines without the tests actually waiting.
    """
    now: float = 0.0

    async def sleep(self, seconds: float) -> None:
        self.now += seconds

    def time(self) -> float:
        return self.now


@dataclass
class _FakeBroker:
    """Stand-in for the Alpaca submit / cancel / poll calls.

    ``script`` is a list of poll outcomes consumed in order. Each entry is
    one of:
        * ``("working", n)``  — return ``status="new"`` for n polls.
        * ``("filled", price)`` — return filled at ``price``.
        * ``("rejected",)``   — return rejected.
    """

    script: list[tuple] = field(default_factory=list)
    submitted_limits: list[float] = field(default_factory=list)
    cancelled_ids: list[str] = field(default_factory=list)
    next_order_id: int = 0
    current_order_id: str | None = None

    # Internal step counter into ``script``.
    _idx: int = 0
    _working_remaining: int = 0
    _terminal: dict[str, Any] | None = None

    async def submit(self, legs: list[Any], limit_price: float) -> str:
        self.next_order_id += 1
        self.submitted_limits.append(round(limit_price, 4))
        self.current_order_id = f"oid-{self.next_order_id}"
        # Reset the script consumption for the new order — each submit
        # gets its own poll script entry.
        self._working_remaining = 0
        self._terminal = None
        return self.current_order_id

    async def cancel(self, broker_id: str) -> None:
        self.cancelled_ids.append(broker_id)
        self.current_order_id = None

    async def poll(self, broker_id: str) -> dict[str, Any]:
        # Advance through the script as needed.
        if self._terminal is not None:
            return dict(self._terminal)
        if self._working_remaining <= 0 and self._idx < len(self.script):
            entry = self.script[self._idx]
            self._idx += 1
            if entry[0] == "working":
                self._working_remaining = int(entry[1])
            elif entry[0] == "filled":
                self._terminal = {
                    "status": "filled",
                    "filled_avg_price": float(entry[1]),
                }
                return dict(self._terminal)
            elif entry[0] == "rejected":
                self._terminal = {
                    "status": "rejected",
                    "filled_avg_price": None,
                }
                return dict(self._terminal)
        if self._working_remaining > 0:
            self._working_remaining -= 1
            return {"status": "new", "filled_avg_price": None}
        # Out of script — keep returning "working" so the deadline path fires.
        return {"status": "new", "filled_avg_price": None}


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------


def test_walk_price_buyer_walks_up() -> None:
    """Buyer pays MORE on each walk: 1.05 -> 1.06 -> 1.07 -> 1.08."""
    mid = 1.05
    spread = 0.10
    for i, expected in enumerate([1.05, 1.06, 1.07, 1.08]):
        price = walk_price(
            original_mid=mid,
            walk_index=i,
            walk_step_pct=0.10,
            combo_spread=spread,
            is_buyer=True,
        )
        assert price == pytest.approx(expected)


def test_walk_price_seller_walks_toward_zero() -> None:
    """Seller's worst direction is "collect less credit" — limit moves
    UP toward zero in signed broker convention.

    Seller's mid = -1.05 (collecting $1.05 credit). On unfilled walks
    the seller has to accept less credit = limit goes from -1.05 ->
    -1.04 -> -1.03 (less negative). ``compute_slippage_pct`` then
    inverts the sign so a fill at -1.04 vs -1.05 target shows up as a
    POSITIVE slippage (seller did worse than mid)."""
    mid = -1.05
    spread = 0.10
    for i, expected in enumerate([-1.05, -1.04, -1.03]):
        price = walk_price(
            original_mid=mid,
            walk_index=i,
            walk_step_pct=0.10,
            combo_spread=spread,
            is_buyer=False,
        )
        assert price == pytest.approx(expected)


def test_compute_slippage_zero_at_mid() -> None:
    assert compute_slippage_pct(
        target_price=1.05, actual_fill_price=1.05, is_buyer=True
    ) == pytest.approx(0.0)


def test_compute_slippage_buyer_paid_more() -> None:
    # Bought at 1.06 vs a 1.05 mid -> ~0.95% worse
    pct = compute_slippage_pct(
        target_price=1.05, actual_fill_price=1.06, is_buyer=True
    )
    assert pct > 0
    assert pct == pytest.approx((1.06 - 1.05) / 1.05)


def test_compute_slippage_seller_collected_less() -> None:
    # Seller target -6.62, actual -6.50 -> seller collected LESS than mid
    # so slippage is positive.
    pct = compute_slippage_pct(
        target_price=-6.62, actual_fill_price=-6.50, is_buyer=False
    )
    assert pct > 0


# ---------------------------------------------------------------------------
# Combo mid + spread
# ---------------------------------------------------------------------------


def _single_leg_buyer_order(bid: float, ask: float) -> tuple[list[dict], _StubChain]:
    expiry = date(2026, 6, 19)
    occ = _occ("AAA", expiry, "call", 100.0)
    legs = [{"occ_symbol": occ, "side": "buy", "quantity": 1, "limit_price": (bid + ask) / 2.0}]
    chain = _StubChain(contracts=[
        _StubContract(symbol=occ, bid=bid, ask=ask, underlying="AAA",
                      expiry=expiry, strike=100.0, option_type="call"),
    ])
    return legs, chain


def test_compute_combo_mid_single_leg_buyer() -> None:
    legs, chain = _single_leg_buyer_order(1.00, 1.10)
    mid = compute_combo_mid_per_share(legs, chain)
    # Buyer of a single $1.05 mid leg -> per-share NET DEBIT is +1.05
    assert mid == pytest.approx(1.05)


def test_compute_combo_spread_single_leg() -> None:
    legs, chain = _single_leg_buyer_order(1.00, 1.10)
    spread = compute_combo_spread(legs, chain)
    assert spread == pytest.approx(0.10)


# ---------------------------------------------------------------------------
# AMD-style iron condor — fills at mid -> slippage 0%
# ---------------------------------------------------------------------------


def _amd_iron_condor() -> tuple[list[dict], _StubChain]:
    """Build a 4-leg iron condor that nets $6.62 credit per share.

    Sign convention reminder for the helper:
        * SELL legs subtract from the combo mid (you collect premium).
        * BUY legs add to the combo mid (you pay premium).
    Net for a short iron condor is NEGATIVE (credit).

    Picked numbers so the per-share net credit is exactly $6.62
    (matches the AMD-style $662 net credit on a 1-contract combo).
    """
    expiry = date(2026, 6, 19)
    underlying = "AMD"
    long_put_occ = _occ(underlying, expiry, "put", 90.0)
    short_put_occ = _occ(underlying, expiry, "put", 95.0)
    short_call_occ = _occ(underlying, expiry, "call", 105.0)
    long_call_occ = _occ(underlying, expiry, "call", 110.0)

    legs = [
        {"occ_symbol": long_put_occ, "side": "buy", "quantity": 1, "limit_price": 0.50},
        {"occ_symbol": short_put_occ, "side": "sell", "quantity": 1, "limit_price": 4.00},
        {"occ_symbol": short_call_occ, "side": "sell", "quantity": 1, "limit_price": 4.12},
        {"occ_symbol": long_call_occ, "side": "buy", "quantity": 1, "limit_price": 1.00},
    ]
    chain = _StubChain(contracts=[
        _StubContract(symbol=long_put_occ, bid=0.45, ask=0.55,
                      underlying=underlying, expiry=expiry, strike=90.0,
                      option_type="put"),
        _StubContract(symbol=short_put_occ, bid=3.95, ask=4.05,
                      underlying=underlying, expiry=expiry, strike=95.0,
                      option_type="put"),
        _StubContract(symbol=short_call_occ, bid=4.07, ask=4.17,
                      underlying=underlying, expiry=expiry, strike=105.0,
                      option_type="call"),
        _StubContract(symbol=long_call_occ, bid=0.95, ask=1.05,
                      underlying=underlying, expiry=expiry, strike=110.0,
                      option_type="call"),
    ])
    return legs, chain


def test_amd_iron_condor_mid_is_negative_six_sixty_two() -> None:
    """Verify the test fixture really nets to -$6.62 (credit) per share.

    Mid per leg from the chain stubs:
        long put : (0.45+0.55)/2 = 0.50  -> +0.50 (long contributes positive)
        short put: (3.95+4.05)/2 = 4.00  -> -4.00
        short cal: (4.07+4.17)/2 = 4.12  -> -4.12
        long call: (0.95+1.05)/2 = 1.00  -> +1.00
        ───────────────────────────────────────
        flatten cost (compute_combo_mark)  = -6.62
        per-share NET (mid_per_share)      = +6.62  if you flatten
                                            but for a SELLER opening the
                                            position the credit is -6.62
                                            (seller's NET price is the
                                            negative of flatten).
    """
    legs, chain = _amd_iron_condor()
    mid = compute_combo_mid_per_share(legs, chain)
    # Seller opening an iron condor receives a credit -> NEGATIVE net mid.
    assert mid == pytest.approx(-6.62)


@pytest.mark.asyncio
async def test_iron_condor_fills_cleanly_at_mid_zero_slippage() -> None:
    legs, chain = _amd_iron_condor()
    clock = _VirtualClock()
    broker = _FakeBroker(script=[("filled", -6.62)])

    result = await submit_combo_at_mid(
        legs,
        chain=chain,
        submit_fn=broker.submit,
        cancel_fn=broker.cancel,
        poll_fn=broker.poll,
        sleep=clock.sleep,
        now=clock.time,
    )

    assert result.status == "filled"
    assert result.target_price == pytest.approx(-6.62)
    assert result.actual_fill_price == pytest.approx(-6.62)
    assert result.slippage_pct == pytest.approx(0.0)
    assert broker.submitted_limits == [pytest.approx(-6.62)]
    assert result.walks_performed == 0

    fq = result.fill_quality
    assert isinstance(fq, FillQuality)
    assert fq.slippage_pct == pytest.approx(0.0)


# ---------------------------------------------------------------------------
# Buyer single-leg walk path
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_buyer_first_walk_steps_to_one_oh_six() -> None:
    """bid=$1.00, ask=$1.10. Initial submit at $1.05; first walk at $1.06.

    The fake broker returns "working" through the entire first walk
    window, then fills on the SECOND order at $1.06. We assert the
    walker resubmitted exactly once at the walked price.
    """
    legs, chain = _single_leg_buyer_order(1.00, 1.10)
    clock = _VirtualClock()
    # Script: order #1 keeps polling "working" forever; once cancelled
    # and reposted, order #2 fills at 1.06 on the first poll.
    broker = _FakeBroker(script=[
        ("working", 10_000),  # consumed by order #1, never terminal
    ])

    # Override poll for the second order: force a fill at 1.06 once we
    # detect a SECOND submit. Simplest: track call count manually.
    submit_count = {"n": 0}
    original_submit = broker.submit

    async def submit_wrap(_legs: list[Any], limit: float) -> str:
        submit_count["n"] += 1
        oid = await original_submit(_legs, limit)
        if submit_count["n"] == 2:
            # Pre-load a "filled" terminal for the next poll cycle.
            broker._terminal = {"status": "filled", "filled_avg_price": float(limit)}
        return oid

    result = await submit_combo_at_mid(
        legs,
        chain=chain,
        submit_fn=submit_wrap,
        cancel_fn=broker.cancel,
        poll_fn=broker.poll,
        sleep=clock.sleep,
        now=clock.time,
    )

    assert result.status == "filled"
    assert result.walks_performed == 1
    assert broker.submitted_limits == [
        pytest.approx(1.05),  # initial mid
        pytest.approx(1.06),  # walk 1 = 1.05 + 0.10 * 0.10
    ]
    assert result.actual_fill_price == pytest.approx(1.06)


@pytest.mark.asyncio
async def test_buyer_three_walks_to_one_oh_seven() -> None:
    """3 walks for a buy order with bid=$1.00, ask=$1.10 → submitted
    limits [1.05, 1.06, 1.07] (initial + walks 1, 2)."""
    legs, chain = _single_leg_buyer_order(1.00, 1.10)
    clock = _VirtualClock()
    broker = _FakeBroker(script=[("working", 10_000)])

    # Force fill on the THIRD submit (walk 2 at 1.07).
    submit_count = {"n": 0}
    original_submit = broker.submit

    async def submit_wrap(_legs: list[Any], limit: float) -> str:
        submit_count["n"] += 1
        oid = await original_submit(_legs, limit)
        if submit_count["n"] == 3:
            broker._terminal = {"status": "filled", "filled_avg_price": float(limit)}
        return oid

    result = await submit_combo_at_mid(
        legs,
        chain=chain,
        submit_fn=submit_wrap,
        cancel_fn=broker.cancel,
        poll_fn=broker.poll,
        sleep=clock.sleep,
        now=clock.time,
    )

    assert result.status == "filled"
    assert result.walks_performed == 2
    assert broker.submitted_limits == [
        pytest.approx(1.05),  # initial
        pytest.approx(1.06),  # walk 1
        pytest.approx(1.07),  # walk 2
    ]
    assert result.actual_fill_price == pytest.approx(1.07)


@pytest.mark.asyncio
async def test_deadline_timeout_returns_unfilled() -> None:
    """Broker never fills → walker exhausts max walks within the deadline
    and returns ``unfilled`` (does NOT slam at ask/bid)."""
    legs, chain = _single_leg_buyer_order(1.00, 1.10)
    clock = _VirtualClock()
    broker = _FakeBroker(script=[("working", 10_000)])

    result = await submit_combo_at_mid(
        legs,
        chain=chain,
        submit_fn=broker.submit,
        cancel_fn=broker.cancel,
        poll_fn=broker.poll,
        sleep=clock.sleep,
        now=clock.time,
    )

    assert result.status == "unfilled"
    assert result.actual_fill_price is None
    assert result.fill_quality is None
    # 4 submissions total: initial + 3 walks at 1.05, 1.06, 1.07, 1.08
    assert broker.submitted_limits == [
        pytest.approx(1.05),
        pytest.approx(1.06),
        pytest.approx(1.07),
        pytest.approx(1.08),
    ]
    assert result.walks_performed == DEFAULT_MAX_WALKS
    # Final order was cancelled (the unfilled-cleanup branch) and at
    # least the prior walks were cancelled before each resubmit.
    assert len(broker.cancelled_ids) >= DEFAULT_MAX_WALKS


# ---------------------------------------------------------------------------
# Fill-quality record shape (F-3)
# ---------------------------------------------------------------------------


def test_fill_quality_dataclass_carries_target_actual_slippage() -> None:
    fq = FillQuality(target_price=1.05, actual_fill_price=1.06, slippage_pct=0.0095)
    assert fq.target_price == 1.05
    assert fq.actual_fill_price == 1.06
    assert fq.slippage_pct == pytest.approx(0.0095)


@pytest.mark.asyncio
async def test_filled_result_exposes_fill_quality_record() -> None:
    """Every filled OrderResult must yield a usable FillQuality (F-3
    requires the three columns target / actual / slippage_pct to be
    persistable)."""
    legs, chain = _single_leg_buyer_order(1.00, 1.10)
    clock = _VirtualClock()
    broker = _FakeBroker(script=[("filled", 1.05)])

    result = await submit_combo_at_mid(
        legs,
        chain=chain,
        submit_fn=broker.submit,
        cancel_fn=broker.cancel,
        poll_fn=broker.poll,
        sleep=clock.sleep,
        now=clock.time,
    )

    fq = result.fill_quality
    assert fq is not None
    assert fq.target_price == pytest.approx(1.05)
    assert fq.actual_fill_price == pytest.approx(1.05)
    assert fq.slippage_pct == pytest.approx(0.0)


# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------


def test_defaults_match_spec() -> None:
    """Defaults baked into the helper match the spec described in the
    M-O F-1 plan: 30s walk window, 10% step, max 3 walks, 120s deadline."""
    assert DEFAULT_MAX_WALK_SECONDS == 30
    assert DEFAULT_WALK_STEP_PCT == pytest.approx(0.10)
    assert DEFAULT_MAX_WALKS == 3
    assert DEFAULT_DEADLINE_SECONDS == 120
