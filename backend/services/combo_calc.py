"""Combo (multi-leg) options spread mark computation.

P0-2 fix (2026-05-05 STRATEGY-HARDENING-AUDIT): combo trades on Alpaca
cannot attach broker-side bracket orders — Alpaca rejects bracket params on
multi-leg option submissions. As a result the only way to enforce a stop on
a combo (iron condor, vertical, butterfly, calendar, …) is client-side, and
the existing ``_check_exits`` loop compared the UNDERLYING'S MARK to a
``stop_loss`` price level. For an underlying that gaps +21% post-earnings
the underlying mark moves the wrong way to fire a stop on a credit spread:
the spread is bleeding because the SHORT leg is being assigned, not because
the underlying touched a price level.

This module computes the COMBINED MARK across all legs of a combo trade so
the exit checker can compare apples to apples.

Sign convention
---------------
For each leg:
    LONG  (``side == "buy"``): contributes  +mid * qty * 100
    SHORT (``side == "sell"``): contributes -mid * qty * 100

The summed value is the dollar cost to FLATTEN the position right now (i.e.
buy back the shorts and sell the longs). For a credit spread this is
NEGATIVE at entry (you collected credit). As the position decays favourably
toward expiry, the mark approaches zero. As it goes against you, the mark
becomes more negative (you'd pay more to flatten).

Stop level interpretation
-------------------------
``Trade.stop_loss_combo_mark`` is the mark threshold at which the trade
should auto-close. A combo with $662 net credit at entry and $338 max-loss
might set ``stop_loss_combo_mark = -200`` (i.e. close when it would cost
$200 to flatten — meaning you've lost $862 of unrealised PnL on a position
that started at +$662 and ends at -$200 mark).

When a leg's bid/ask is unavailable in the chain (illiquid strike, after
hours, halted underlying) the helper falls back to the leg's stored
``mid``/``last_known_mark`` so the caller gets a degraded-but-usable answer
rather than a silent zero. ``compute_combo_mark`` returns ``None`` if more
than half the legs lack a usable mark — caller MUST treat None as "do not
fire an exit on this tick" rather than "0 mark".
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import date
from typing import Any, Iterable

logger = logging.getLogger(__name__)


# OCC option symbol parser. Mirrors services.options._OCC_RE / _parse_alpaca_option_symbol
# but kept local so this module has no FastAPI/HTTPX import-time cost.
_OCC_RE = re.compile(
    r"^(?P<underlying>[A-Z]{1,6})(?P<yy>\d{2})(?P<mm>\d{2})(?P<dd>\d{2})"
    r"(?P<cp>[CP])(?P<strike>\d{8})$"
)


@dataclass(frozen=True)
class _LegRef:
    """Normalised leg view used by ``compute_combo_mark``."""

    occ_symbol: str
    side: str  # "buy" or "sell"
    quantity: int
    underlying: str | None
    expiry: date | None
    strike: float | None
    option_type: str | None  # "call" or "put"
    fallback_mid: float | None  # leg.mid or leg.limit_price if chain lookup fails


def _parse_occ(occ: str) -> dict[str, Any] | None:
    """Decompose an OCC symbol into its component fields, or ``None`` on
    parse failure.

    Mirrors :func:`services.options._parse_alpaca_option_symbol` but is
    inlined here so this module is import-light.
    """
    m = _OCC_RE.match(occ)
    if not m:
        return None
    try:
        return {
            "underlying": m.group("underlying"),
            "expiry": date(
                2000 + int(m.group("yy")), int(m.group("mm")), int(m.group("dd"))
            ),
            "option_type": "call" if m.group("cp") == "C" else "put",
            "strike": int(m.group("strike")) / 1000.0,
        }
    except (ValueError, OverflowError):
        return None


def _normalise_leg(leg: Any) -> _LegRef | None:
    """Convert any of the project's leg shapes (Pydantic OptionLeg, dict
    from ``Trade.legs`` JSON, dataclass) into a single ``_LegRef`` view.

    Accepts:
      * ``backend.strategies._core.contracts.OptionLeg``
        (occ_symbol + side + quantity)
      * Earnings recommender ``OptionLeg``
        (side + contract_type + strike + expiry + qty + mid)
      * Plain dicts following the strategy_runner shape
        (occ_symbol + side + quantity + limit_price)
      * Dicts mixing both shapes (the trade ledger stores the recommender
        leg dict format for earnings_options_play; the strategy_runner
        format for unified-shell strategies).
    """
    # Pydantic / dataclass
    occ = getattr(leg, "occ_symbol", None)
    side = getattr(leg, "side", None)
    qty = getattr(leg, "quantity", None) or getattr(leg, "qty", None)
    contract_type = getattr(leg, "contract_type", None)
    strike = getattr(leg, "strike", None)
    expiry_attr = getattr(leg, "expiry", None)
    mid = getattr(leg, "mid", None)
    limit = getattr(leg, "limit_price", None)

    # Dict
    if isinstance(leg, dict):
        occ = occ or leg.get("occ_symbol")
        side = side or leg.get("side")
        qty = qty if qty is not None else (leg.get("quantity") or leg.get("qty"))
        contract_type = contract_type or leg.get("contract_type")
        strike = strike if strike is not None else leg.get("strike")
        expiry_attr = expiry_attr if expiry_attr is not None else leg.get("expiry")
        mid = mid if mid is not None else leg.get("mid")
        limit = limit if limit is not None else leg.get("limit_price")

    if side not in ("buy", "sell"):
        return None
    try:
        qty_int = int(qty) if qty is not None else 1
        if qty_int <= 0:
            qty_int = 1
    except (TypeError, ValueError):
        qty_int = 1

    underlying: str | None = None
    expiry: date | None = None
    strike_f: float | None = None
    opt_type: str | None = None

    # Prefer OCC parse — it's authoritative.
    if isinstance(occ, str) and occ:
        parsed = _parse_occ(occ.upper())
        if parsed:
            underlying = parsed["underlying"]
            expiry = parsed["expiry"]
            strike_f = parsed["strike"]
            opt_type = parsed["option_type"]

    # Fall back to dict/attribute fields if OCC parse missed.
    if strike_f is None and strike is not None:
        try:
            strike_f = float(strike)
        except (TypeError, ValueError):
            strike_f = None
    if opt_type is None and contract_type is not None:
        ct_norm = str(contract_type).lower()
        if ct_norm in ("call", "put"):
            opt_type = ct_norm
    if expiry is None and expiry_attr is not None:
        if isinstance(expiry_attr, date):
            expiry = expiry_attr
        elif isinstance(expiry_attr, str):
            try:
                expiry = date.fromisoformat(expiry_attr)
            except ValueError:
                expiry = None

    fallback_mid: float | None = None
    for candidate in (mid, limit):
        if candidate is None:
            continue
        try:
            f = float(candidate)
        except (TypeError, ValueError):
            continue
        if f >= 0:
            fallback_mid = f
            break

    return _LegRef(
        occ_symbol=str(occ or "").upper(),
        side=side,
        quantity=qty_int,
        underlying=underlying,
        expiry=expiry,
        strike=strike_f,
        option_type=opt_type,
        fallback_mid=fallback_mid,
    )


def _contract_mid(contract: Any) -> float | None:
    """Best-effort mid for a chain contract.

    Mirrors :func:`services.earnings_recommender._option_mid` but returns
    ``None`` (not 0.0) on no-quote so callers can distinguish "the contract
    is genuinely worth ~0" from "the chain lookup failed".
    """
    if contract is None:
        return None
    try:
        bid = float(getattr(contract, "bid", 0) or 0)
        ask = float(getattr(contract, "ask", 0) or 0)
        last = float(getattr(contract, "last", 0) or 0)
    except (TypeError, ValueError):
        return None
    if bid > 0 and ask > 0:
        return (bid + ask) / 2.0
    if bid > 0:
        return bid
    if ask > 0:
        return ask
    if last > 0:
        return last
    return None


def _find_in_chain(leg: _LegRef, chain: Any) -> Any | None:
    """Locate the contract in ``chain`` matching ``leg``."""
    if chain is None:
        return None
    contracts = list(getattr(chain, "contracts", []) or [])
    for c in contracts:
        # OCC fast-path (most reliable identifier).
        c_sym = getattr(c, "symbol", None) or (
            c.get("symbol") if isinstance(c, dict) else None
        )
        if c_sym and leg.occ_symbol and c_sym.upper() == leg.occ_symbol:
            return c
    # Fall back to (option_type, expiry, strike) tuple match.
    for c in contracts:
        ot_raw = getattr(c, "option_type", None)
        if ot_raw is None and isinstance(c, dict):
            ot_raw = c.get("option_type")
        ot_str = (
            getattr(ot_raw, "value", ot_raw)
            if ot_raw is not None
            else None
        )
        if leg.option_type and ot_str and str(ot_str).lower() != leg.option_type:
            continue
        c_strike_raw = getattr(c, "strike", None)
        if c_strike_raw is None and isinstance(c, dict):
            c_strike_raw = c.get("strike")
        try:
            c_strike = float(c_strike_raw) if c_strike_raw is not None else None
        except (TypeError, ValueError):
            c_strike = None
        if leg.strike is not None and c_strike is not None and abs(c_strike - leg.strike) > 1e-6:
            continue
        c_expiry_raw = getattr(c, "expiry", None)
        if c_expiry_raw is None and isinstance(c, dict):
            c_expiry_raw = c.get("expiry")
        c_expiry: date | None = None
        if isinstance(c_expiry_raw, date):
            c_expiry = c_expiry_raw
        elif isinstance(c_expiry_raw, str):
            try:
                c_expiry = date.fromisoformat(c_expiry_raw)
            except ValueError:
                c_expiry = None
        if leg.expiry is not None and c_expiry is not None and c_expiry != leg.expiry:
            continue
        return c
    return None


def compute_combo_mark(
    legs: Iterable[Any],
    chain: Any | None,
    *,
    contract_multiplier: int = 100,
) -> float | None:
    """Sum the per-leg dollar mark for a multi-leg combo.

    Returns the dollar cost to flatten the position right now:
        + for legs you'd SELL to flatten (longs you currently hold)
        - for legs you'd BUY to flatten (shorts you currently owe)

    Sign convention:
        long (side=buy)  -> +mid * qty * 100
        short (side=sell) -> -mid * qty * 100

    A credit spread at entry has a negative net mark (you collected the
    credit). As time decays favourably the mark approaches 0; if the
    underlying gaps the short side it goes more negative.

    Returns ``None`` when more than half the legs have neither a chain
    quote nor a stored fallback mid — the caller MUST treat ``None`` as
    "do not fire an exit on this tick" rather than coercing to 0.0.

    ``chain`` may be a single :class:`services.options.OptionChain` (when
    all legs share an underlying — typical for a single-name spread) or
    ``None`` (forces fallback to leg.mid). Future calendar-pair callers
    can pass a dict keyed by underlying; for now we accept any object
    that exposes ``.contracts``.
    """
    legs_list = list(legs)
    if not legs_list:
        return None

    refs: list[_LegRef] = []
    for leg in legs_list:
        ref = _normalise_leg(leg)
        if ref is None:
            logger.warning("compute_combo_mark: skipping malformed leg %r", leg)
            continue
        refs.append(ref)
    if not refs:
        return None

    total = 0.0
    quoted = 0
    for ref in refs:
        contract = _find_in_chain(ref, chain) if chain is not None else None
        leg_mid = _contract_mid(contract) if contract is not None else None
        if leg_mid is None:
            leg_mid = ref.fallback_mid
        if leg_mid is None:
            # No quote and no fallback — this leg contributes 0 but
            # we count it as "unquoted" so the caller can decide what
            # to do based on ``unquoted_legs``.
            continue
        quoted += 1
        sign = +1.0 if ref.side == "buy" else -1.0
        total += sign * float(leg_mid) * ref.quantity * contract_multiplier

    # If majority of legs are unquoted, refuse to return a number — the
    # exit checker should defer rather than fire on a stale combination.
    if quoted * 2 < len(refs):
        logger.warning(
            "compute_combo_mark: only %d/%d legs quoted; returning None",
            quoted, len(refs),
        )
        return None

    return total
