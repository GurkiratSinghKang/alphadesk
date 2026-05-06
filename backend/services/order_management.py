"""Patient working-order helper for multi-leg option combos (M-O F-1).

Real options brokers (TastyTrade, IBKR's "Adaptive" routing) work limit
orders by starting at the combo MID and walking the price toward the
worse side every N seconds until filled or until the user-specified
deadline. AlphaDesk previously submitted limit orders at user-specified
prices and never re-priced — that left fills on the table whenever the
trader anchored on the displayed quote (which itself was usually the
near-side, not the mid).

This module adds an OPTIONAL execution mode for combos: ``submit_combo_at_mid``
sends the order at the computed combo mid, waits ``max_walk_seconds``, and
if unfilled cancels and re-submits at ``mid + walk_step_pct * combo_spread``
toward the worse side for the trader. Up to ``max_walks`` (default 3)
walks happen within the overall ``deadline_seconds`` budget. If still
unfilled at the deadline the working order is cancelled and the helper
returns ``unfilled`` — the helper deliberately does NOT slam at the
ask/bid, so the trader sees an explicit "didn't fill at acceptable
price" outcome rather than a worst-case fill.

Walk direction
--------------
The combo can either pay (DEBIT, buyer) or collect (CREDIT, seller).

* Buyer (net debit): mid is the cost; worse = higher. Each walk adds
  ``walk_step_pct * combo_spread`` to the limit, paying more.
* Seller (net credit): mid is the credit collected; worse = lower (you
  give up some of the collected credit). Each walk subtracts
  ``walk_step_pct * combo_spread`` from the limit.

The combo direction is inferred from the sum of per-leg signed mids:
positive sum = buyer (debit), negative sum = seller (credit). Callers
can also force the direction explicitly via ``is_buyer``.

Slippage measurement (F-3)
--------------------------
Every fill yields a ``FillQuality`` record with:

* ``target_price``     : the ORIGINAL combo mid at submit time (per share).
* ``actual_fill_price``: the broker's reported fill price.
* ``slippage_pct``     : (actual - target) / target. Positive when the
  trader paid more than mid (buyer above mid, seller below mid). A
  filled-at-mid order has slippage 0.0.

The route layer (``api.routes.trades.create_order``) persists these
fields to the ``trades`` table when ``?fill_mode=patient`` is used so
the team can build dashboards over fill quality without scraping the
broker logs.

Testability
-----------
The submit / cancel / poll callables are injected as parameters so unit
tests can simulate "filled at mid", "filled after second walk", and
"deadline timeout" without spinning up Alpaca or fastapi. The default
``DefaultBrokerHooks`` wraps the existing ``api.routes.trades`` Alpaca
helpers; the real-trade path uses that, the test path uses a fake.
"""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Iterable

from services.combo_calc import compute_combo_mark

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------

# Conservative defaults that mirror TastyTrade's "Send price improvement"
# pattern. 30s between walks is long enough that a thin combo can fill at
# the inside without artificial nudging; 10% of the spread per walk and a
# 3-walk cap means we cover at most 30% of the spread before giving up,
# which keeps the worst-case slippage bounded. The deadline is 120s so
# the helper never holds a working order across more than two minutes —
# longer than that and the underlying is plausibly a different price.
DEFAULT_MAX_WALK_SECONDS = 30
DEFAULT_WALK_STEP_PCT = 0.10
DEFAULT_MAX_WALKS = 3
DEFAULT_DEADLINE_SECONDS = 120


# ---------------------------------------------------------------------------
# Result + broker-hook contracts
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class FillQuality:
    """Per-fill execution-quality record persisted on the trade row."""

    target_price: float       # original combo mid at submit time, per share
    actual_fill_price: float  # broker-reported fill, per share
    slippage_pct: float       # (actual - target) / target; positive = paid more


@dataclass
class OrderResult:
    """Outcome of a patient combo submit.

    ``status`` is one of:
        ``filled``    : broker reported a terminal fill at ``actual_fill_price``.
        ``unfilled``  : deadline reached without a fill; cancelled cleanly.
        ``cancelled`` : caller cancelled (rare — placeholder for future use).
        ``rejected``  : broker rejected the order during a walk; treated as
                        terminal and surfaces the broker's reason.
    """

    status: str
    target_price: float | None = None
    actual_fill_price: float | None = None
    slippage_pct: float | None = None
    broker_order_id: str | None = None
    walks_performed: int = 0
    final_limit_price: float | None = None
    reason: str | None = None
    # Per-walk audit log so a debugger can replay what happened.
    walk_history: list[dict[str, Any]] = field(default_factory=list)

    @property
    def fill_quality(self) -> FillQuality | None:
        """Return a ``FillQuality`` when the order filled, else ``None``."""
        if (
            self.status == "filled"
            and self.target_price is not None
            and self.actual_fill_price is not None
            and self.slippage_pct is not None
        ):
            return FillQuality(
                target_price=self.target_price,
                actual_fill_price=self.actual_fill_price,
                slippage_pct=self.slippage_pct,
            )
        return None


# ``submit_fn(legs, limit_price)`` -> str (broker_order_id)
SubmitFn = Callable[[list[Any], float], Awaitable[str]]
# ``cancel_fn(broker_order_id)`` -> None
CancelFn = Callable[[str], Awaitable[None]]
# ``poll_fn(broker_order_id)`` -> dict with ``status`` + ``filled_avg_price``
PollFn = Callable[[str], Awaitable[dict[str, Any]]]


# ---------------------------------------------------------------------------
# Pure helpers (deterministic, no I/O, easy to test)
# ---------------------------------------------------------------------------


def _per_leg_spread(leg: Any, chain: Any | None) -> float | None:
    """Return ``ask - bid`` for ``leg`` from the chain, or ``None`` when
    the chain has no quote. Falls back to leg-stored bid/ask if available.
    """
    bid: float | None = None
    ask: float | None = None
    occ = (
        getattr(leg, "occ_symbol", None)
        or (leg.get("occ_symbol") if isinstance(leg, dict) else None)
    )
    if chain is not None and occ:
        for c in getattr(chain, "contracts", []) or []:
            sym = getattr(c, "symbol", None) or (
                c.get("symbol") if isinstance(c, dict) else None
            )
            if sym and sym.upper() == str(occ).upper():
                try:
                    bid = float(getattr(c, "bid", 0) or 0)
                    ask = float(getattr(c, "ask", 0) or 0)
                except (TypeError, ValueError):
                    bid = None
                    ask = None
                break
    if bid is None or ask is None:
        # Fall back to whatever the leg may have stored.
        for source in (leg, leg if isinstance(leg, dict) else None):
            if source is None:
                continue
            try:
                if isinstance(source, dict):
                    b = source.get("bid")
                    a = source.get("ask")
                else:
                    b = getattr(source, "bid", None)
                    a = getattr(source, "ask", None)
                if b is not None and a is not None:
                    bid = float(b)
                    ask = float(a)
                    break
            except (TypeError, ValueError):
                continue
    if bid is None or ask is None:
        return None
    if ask < bid:
        return None  # crossed quote — refuse to compute
    return ask - bid


def compute_combo_spread(
    legs: Iterable[Any], chain: Any | None
) -> float | None:
    """Sum the per-leg spreads weighted by absolute quantity.

    For an iron condor with four legs each spanning $0.10 ask-bid the
    combo spread is $0.40 per share. We use absolute quantity (sign is
    irrelevant for spread width) — a 1x1 vertical with a $0.05 spread
    on each side yields a $0.10 combo spread.
    """
    legs_list = list(legs)
    if not legs_list:
        return None
    total = 0.0
    counted = 0
    for leg in legs_list:
        spread = _per_leg_spread(leg, chain)
        if spread is None:
            continue
        try:
            qty = (
                getattr(leg, "quantity", None)
                or getattr(leg, "qty", None)
                or (
                    leg.get("quantity") or leg.get("qty")
                    if isinstance(leg, dict)
                    else None
                )
                or 1
            )
            qty_abs = abs(int(qty))
        except (TypeError, ValueError):
            qty_abs = 1
        total += spread * qty_abs
        counted += 1
    if counted == 0:
        return None
    return total


def compute_combo_mid_per_share(
    legs: Iterable[Any], chain: Any | None
) -> float | None:
    """Return the SIGNED combo mid PER SHARE in BROKER NET-PRICE convention.

    ``compute_combo_mark`` returns the per-leg signed mid sum:
        long (buy)  -> +mid
        short (sell) -> -mid

    For an iron condor with two short legs (4.00 + 4.12 collected) and
    two long legs (0.50 + 1.00 paid) the sum is +0.50 - 4.00 - 4.12 +
    1.00 = -6.62. That is ALSO the seller's NET OPENING PRICE in the
    broker convention (negative = trader receives a credit; positive =
    trader pays a debit). So for order submission we use the mark
    directly with NO sign flip.

    The broker convention for net-priced multi-leg limit orders matches
    Alpaca's ``limit_price`` shape on MLeg orders: positive when the
    user pays out (debit spread, long calls/puts, etc.), negative when
    the user collects (short condor / vertical credit spread / cash-
    secured put, etc.).
    """
    mark = compute_combo_mark(legs, chain, contract_multiplier=1)
    if mark is None:
        return None
    return mark


def walk_price(
    *,
    original_mid: float,
    walk_index: int,
    walk_step_pct: float,
    combo_spread: float,
    is_buyer: bool,
) -> float:
    """Compute the limit for the ``walk_index``-th walk (0 = initial submit).

    The "worse" direction for the trader in broker NET-PRICE convention:

    * Buyer (positive net): wants to pay LESS. Walking toward worse =
      paying MORE = limit moves UP (more positive).
    * Seller (negative net): wants to collect MORE credit (more negative).
      Walking toward worse = collecting LESS = limit moves UP toward zero
      (LESS negative).

    Both directions are "increase the limit price", which matches the
    intuition that the broker's net-price axis has buyers above zero and
    sellers below zero — "walking up" toward the buyer's worst side or
    "walking up" toward the seller's worst side both increase the value.

    The step is ``walk_step_pct * combo_spread`` per walk so 3 walks at
    10% cover 30% of the spread.
    """
    # Both buyer and seller "worse" direction is UP (more positive) in
    # broker net-price convention. ``is_buyer`` is kept in the signature
    # so call sites that are sign-aware (logging, slippage) can branch
    # on it without re-deriving the role from the mid.
    del is_buyer  # noqa: F841 — intentional parameter for symmetry / API stability
    delta = walk_step_pct * combo_spread * walk_index
    return original_mid + delta


def compute_slippage_pct(
    *, target_price: float, actual_fill_price: float, is_buyer: bool
) -> float:
    """Slippage as a signed fraction of the target.

    In broker NET-PRICE convention the worse direction for both buyer
    and seller is "limit moves up toward more positive". So ``actual >
    target`` always means the trader did WORSE than mid:

        * Buyer (target +1.05): actual +1.06 > +1.05 -> paid more ->
          positive slippage.
        * Seller (target -6.62): actual -6.50 > -6.62 -> collected less
          credit -> positive slippage.

    Negative value means BETTER than mid (price improvement). The
    ``is_buyer`` parameter is accepted for API symmetry with the
    walk-direction helpers but is not load-bearing in the math — both
    sides share the same sign convention.

    A target of zero (extremely unusual; only happens for a synthetic
    mid that nets to exactly zero across a perfectly balanced spread)
    returns 0.0 to avoid division by zero.
    """
    del is_buyer  # noqa: F841 — kept for API symmetry with walk_price
    if target_price == 0:
        return 0.0
    return (actual_fill_price - target_price) / abs(target_price)


# ---------------------------------------------------------------------------
# Patient working-order driver
# ---------------------------------------------------------------------------


async def submit_combo_at_mid(
    legs: list[Any],
    *,
    chain: Any | None = None,
    submit_fn: SubmitFn,
    cancel_fn: CancelFn,
    poll_fn: PollFn,
    max_walk_seconds: int = DEFAULT_MAX_WALK_SECONDS,
    walk_step_pct: float = DEFAULT_WALK_STEP_PCT,
    max_walks: int = DEFAULT_MAX_WALKS,
    deadline_seconds: int = DEFAULT_DEADLINE_SECONDS,
    is_buyer: bool | None = None,
    poll_interval_seconds: float = 1.0,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    now: Callable[[], float] = time.monotonic,
) -> OrderResult:
    """Submit a multi-leg combo at MID and walk toward the worse side.

    Args:
        legs: list of leg objects/dicts accepted by ``compute_combo_mark``
            (Pydantic OptionLeg, dataclass, or dict with occ_symbol/side/qty).
        chain: optional ``OptionChain``-shaped object exposing ``.contracts``.
            When ``None`` the helper falls back to leg-stored mid/bid/ask.
        submit_fn: async callable that POSTs the limit order to the broker
            and returns the broker order id.
        cancel_fn: async callable that DELETEs the broker order by id.
        poll_fn: async callable that GETs the broker order status; must
            return ``{"status": str, "filled_avg_price": float | None}``.
            Statuses: ``filled`` / ``partial_fill`` / ``cancelled`` /
            ``rejected`` / anything else (treated as still working).
        max_walk_seconds: seconds to wait between walks (default 30).
        walk_step_pct: fraction of combo spread to add per walk (default 0.10).
        max_walks: cap on total walks beyond the initial submit (default 3).
        deadline_seconds: hard upper bound on the whole exercise (default 120).
        is_buyer: explicit override for combo direction. When ``None`` the
            helper infers it from the sign of the per-share combo mid.
        poll_interval_seconds: how often to ping the broker for fills.
        sleep / now: indirection so unit tests can drive virtual time.

    Returns:
        ``OrderResult`` describing the terminal state. The caller is
        responsible for persisting fill-quality fields onto the local
        Trade row (``order_management.persist_fill_quality`` helper).
    """
    if not legs:
        raise ValueError("submit_combo_at_mid: legs must not be empty")

    target_mid = compute_combo_mid_per_share(legs, chain)
    if target_mid is None:
        raise ValueError(
            "submit_combo_at_mid: cannot compute combo mid (legs are "
            "unquoted and have no fallback mid)"
        )

    # If the caller didn't pin direction, infer it from the sign.
    if is_buyer is None:
        is_buyer = target_mid > 0

    spread = compute_combo_spread(legs, chain)
    if spread is None or spread <= 0:
        # When we can't measure the spread we still want to send at mid
        # but we cannot meaningfully walk — degenerate to a single
        # submit at mid with no walks. The helper returns ``unfilled``
        # if the broker doesn't fill within the deadline.
        spread = 0.0

    # Initial submit at exactly the combo mid.
    deadline = now() + deadline_seconds
    walks_done = 0
    last_limit = target_mid
    walk_history: list[dict[str, Any]] = []

    broker_order_id: str | None = None
    try:
        broker_order_id = await submit_fn(legs, last_limit)
        walk_history.append({
            "walk": 0,
            "limit": last_limit,
            "broker_order_id": broker_order_id,
            "ts": now(),
        })
    except Exception as exc:
        logger.exception("submit_combo_at_mid: initial submit failed")
        return OrderResult(
            status="rejected",
            target_price=target_mid,
            walks_performed=0,
            final_limit_price=last_limit,
            reason=f"initial submit failed: {exc}",
            walk_history=walk_history,
        )

    while True:
        # Poll until the per-walk window expires or we hit the deadline.
        walk_window_end = min(now() + max_walk_seconds, deadline)
        while now() < walk_window_end:
            try:
                snapshot = await poll_fn(broker_order_id)
            except Exception:
                logger.warning(
                    "submit_combo_at_mid: poll failed; retrying", exc_info=True,
                )
                await sleep(poll_interval_seconds)
                continue
            status = str(snapshot.get("status") or "").lower()
            if status in {"filled", "done_for_day"}:
                fill = snapshot.get("filled_avg_price")
                try:
                    actual = float(fill) if fill is not None else last_limit
                except (TypeError, ValueError):
                    actual = last_limit
                slip = compute_slippage_pct(
                    target_price=target_mid,
                    actual_fill_price=actual,
                    is_buyer=is_buyer,
                )
                return OrderResult(
                    status="filled",
                    target_price=target_mid,
                    actual_fill_price=actual,
                    slippage_pct=slip,
                    broker_order_id=broker_order_id,
                    walks_performed=walks_done,
                    final_limit_price=last_limit,
                    walk_history=walk_history,
                )
            if status in {"rejected", "canceled", "cancelled", "expired"}:
                return OrderResult(
                    status="rejected" if status == "rejected" else "cancelled",
                    target_price=target_mid,
                    broker_order_id=broker_order_id,
                    walks_performed=walks_done,
                    final_limit_price=last_limit,
                    reason=f"broker reported terminal status {status!r}",
                    walk_history=walk_history,
                )
            # Still working — wait a tick and re-poll.
            await sleep(poll_interval_seconds)

        # Window expired without fill.
        if walks_done >= max_walks or now() >= deadline:
            # Out of walks or out of time — cancel and return unfilled.
            try:
                await cancel_fn(broker_order_id)
            except Exception:
                logger.warning(
                    "submit_combo_at_mid: cancel after deadline failed",
                    exc_info=True,
                )
            return OrderResult(
                status="unfilled",
                target_price=target_mid,
                broker_order_id=broker_order_id,
                walks_performed=walks_done,
                final_limit_price=last_limit,
                reason=(
                    "deadline reached"
                    if now() >= deadline
                    else "max walks exhausted"
                ),
                walk_history=walk_history,
            )

        # Walk: cancel current order and resubmit at a worse price.
        try:
            await cancel_fn(broker_order_id)
        except Exception:
            logger.warning(
                "submit_combo_at_mid: cancel before walk failed; "
                "the broker may already be terminal",
                exc_info=True,
            )
        walks_done += 1
        last_limit = walk_price(
            original_mid=target_mid,
            walk_index=walks_done,
            walk_step_pct=walk_step_pct,
            combo_spread=spread,
            is_buyer=is_buyer,
        )
        try:
            broker_order_id = await submit_fn(legs, last_limit)
            walk_history.append({
                "walk": walks_done,
                "limit": last_limit,
                "broker_order_id": broker_order_id,
                "ts": now(),
            })
        except Exception as exc:
            logger.exception(
                "submit_combo_at_mid: walk-resubmit failed at walk=%d",
                walks_done,
            )
            return OrderResult(
                status="rejected",
                target_price=target_mid,
                walks_performed=walks_done,
                final_limit_price=last_limit,
                reason=f"walk resubmit failed: {exc}",
                walk_history=walk_history,
            )


# ---------------------------------------------------------------------------
# Persistence helper (F-3)
# ---------------------------------------------------------------------------


async def persist_fill_quality(
    *,
    trade_id: int | None = None,
    broker_order_id: str | None = None,
    fill_quality: FillQuality,
) -> bool:
    """Stamp the fill-quality fields onto the matching ``Trade`` row.

    Looks up the row by ``trade_id`` first (preferred — direct PK), then
    by ``broker_order_id`` (the manual-order path stamps that on insert).
    Returns True when a row was updated, False otherwise (no match,
    SKIP_DB_INIT, DB error). Best-effort — the helper logs and swallows
    DB exceptions because the broker fill is already authoritative.
    """
    try:
        from core.config import settings as _s
        if _s.SKIP_DB_INIT:
            return False
        from sqlalchemy import update
        from core.database import _get_session_factory
        from data.storage.models import Trade

        factory = _get_session_factory()
        async with factory() as db:
            stmt = update(Trade).values(
                target_price=float(fill_quality.target_price),
                actual_fill_price=float(fill_quality.actual_fill_price),
                slippage_pct=float(fill_quality.slippage_pct),
            )
            if trade_id is not None:
                stmt = stmt.where(Trade.id == trade_id)
            elif broker_order_id is not None:
                stmt = stmt.where(Trade.broker_order_id == broker_order_id)
            else:
                return False
            result = await db.execute(stmt)
            await db.commit()
            return bool(getattr(result, "rowcount", 0) or 0) > 0
    except Exception:
        logger.warning(
            "persist_fill_quality failed for trade_id=%s broker_order_id=%s",
            trade_id, broker_order_id, exc_info=True,
        )
        return False
