"""Slippage analytics — execution-quality measurement (M-O S).

Aggregates per-trade slippage data captured by the patient mid-pricing
walker (``services.order_management.submit_combo_at_mid``) and persisted
on the ``trades`` row via the ``target_price`` / ``actual_fill_price`` /
``slippage_pct`` columns (see ``data.storage.models.Trade``).

Without this aggregation we can answer none of the questions an
execution desk needs to ask:

* Are our entries good or bad? (cohort-level slippage distribution)
* Is the patient walker actually helping? (patient vs immediate fills)
* Which strategies bleed the most on entry? (per-strategy breakdown)
* What does an iron condor cost us vs a vertical? (per-structure)

The module is deliberately small — pure aggregation, no telemetry I/O.
The route layer (``api.routes.analytics``) wraps it for HTTP exposure
and the dashboard (``frontend/src/components/dashboard/SlippagePanel.tsx``)
renders the response.

Data shape
----------
Every input row is a ``trades`` row that has BOTH ``target_price`` and
``actual_fill_price`` populated (and therefore a non-NULL
``slippage_pct``). Legacy rows where the patient walker wasn't used —
or pre-Wave-M-O rows that pre-date the columns entirely — have
``target_price IS NULL`` and are EXCLUDED from every aggregate. We
deliberately do NOT fabricate a target from "the chain mid right now"
because the chain has moved since submit time — using current marks
would understate slippage on volatile underlyings.

Dollars-leaked convention
-------------------------
For a multi-leg combo the per-share slippage is the difference between
the actual signed fill and the target signed fill. The dashboard
question is "how much $ did we lose vs filling at mid?" so we always
emit a POSITIVE number when the trader did worse than mid:

    leakage_per_share = abs(actual_fill_price - target_price)
    leakage_dollars   = leakage_per_share * qty * 100

The 100 multiplier is the OPRA contract multiplier — every options
trade in this system is single-listed equity options where 1 contract
controls 100 shares. Equity-only trades (rare on this desk) use
multiplier 1.

Note that ``slippage_pct`` on the row is signed (positive = paid more
than mid for a buyer, collected less than mid for a seller — both
"trader did worse"). We use abs() for the dollar leakage so a fill
better than mid (negative slippage) doesn't subtract from the leakage
total — we want the worst-case bound, not a net.
"""
from __future__ import annotations

import logging
import statistics
from collections import defaultdict
from datetime import date, datetime, timezone, time
from typing import Any, Iterable

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------


class SlippageBreakdown(BaseModel):
    """Per-bucket slippage roll-up (used for strategy + structure tables)."""

    trades: int
    avg_slippage_pct: float | None = None
    median_slippage_pct: float | None = None
    p90_slippage_pct: float | None = None
    total_dollars_leaked: float = 0.0


class SlippageSummary(BaseModel):
    """Top-level execution-quality response shape."""

    total_trades: int = 0
    avg_slippage_pct: float | None = None
    median_slippage_pct: float | None = None
    p90_slippage_pct: float | None = None
    total_dollars_leaked: float = 0.0
    by_strategy: dict[str, SlippageBreakdown] = Field(default_factory=dict)
    by_structure_type: dict[str, SlippageBreakdown] = Field(default_factory=dict)
    fill_mode_comparison: dict[str, SlippageBreakdown] = Field(default_factory=dict)
    # ``trades_without_target`` is the count of ``trades`` rows in the
    # query window where ``target_price IS NULL``. Surfaced so the
    # frontend can explain a tiny ``total_trades`` — most older rows
    # don't yet have execution data.
    trades_without_target: int = 0


# ---------------------------------------------------------------------------
# Multiplier helpers
# ---------------------------------------------------------------------------


_OPTION_MULTIPLIER = 100  # OPRA listed options
_EQUITY_MULTIPLIER = 1


def _trade_multiplier(legs: Any) -> int:
    """Return 100 for options trades, 1 for equity-only trades.

    Detection rule: if any leg has an ``occ_symbol`` that looks OCC
    (length >= 15, first char alphabetic) we treat the whole combo as
    an options trade. The legacy rows that lack ``occ_symbol`` and only
    carry ``symbol`` are equities — multiplier 1.
    """
    if not isinstance(legs, list) or not legs:
        return _EQUITY_MULTIPLIER
    for leg in legs:
        if not isinstance(leg, dict):
            continue
        occ = leg.get("occ_symbol") or ""
        if isinstance(occ, str) and len(occ) >= 15 and occ[:1].isalpha():
            return _OPTION_MULTIPLIER
    return _EQUITY_MULTIPLIER


def _trade_qty(legs: Any) -> float:
    """Quantity used to scale dollars-leaked for a combo.

    For a multi-leg combo we use the FIRST leg's quantity — by
    construction every leg in a combo carries the same ratio-1 contract
    count, so leg[0].qty is the combo qty. Falls back to 1 for legacy
    rows that don't carry qty in the JSON.
    """
    if not isinstance(legs, list) or not legs:
        return 1.0
    first = legs[0]
    if not isinstance(first, dict):
        return 1.0
    raw = first.get("qty") or first.get("quantity") or 1
    try:
        return float(raw)
    except (TypeError, ValueError):
        return 1.0


def _trade_structure(trade_dict: dict[str, Any]) -> str:
    """Pull a structure_type for grouping.

    Order of precedence:

    * ``trade_dict["structure_type"]`` — explicit on the row (post Wave 2).
    * ``trade_dict["legs"][0]["combo_type"]`` — Round-5 / order-submit
      stamps the combo_type onto the leg JSON.
    * ``"single_leg"`` when there's exactly one leg.
    * ``"multi_leg"`` when there's >1 legs and no classification.
    * ``"unknown"`` when we have no leg data at all (rare).
    """
    explicit = trade_dict.get("structure_type")
    if explicit:
        return str(explicit)
    legs = trade_dict.get("legs")
    if isinstance(legs, list) and legs:
        first = legs[0] if isinstance(legs[0], dict) else None
        if first and first.get("combo_type"):
            return str(first["combo_type"])
        return "single_leg" if len(legs) == 1 else "multi_leg"
    return "unknown"


def _fill_mode(trade_dict: dict[str, Any]) -> str:
    """Classify a trade as patient vs immediate vs unknown.

    Heuristic: if the row has BOTH ``target_price`` and
    ``actual_fill_price`` it went through the patient walker (which
    is the only code path that stamps both columns at insert time —
    immediate-limit orders only get ``filled_avg_price`` from the fill
    reconciler). Otherwise treat as immediate.

    The legs JSON may also carry an explicit ``fill_mode`` once Wave-T
    starts persisting it; we honour it when present.
    """
    legs = trade_dict.get("legs")
    if isinstance(legs, list):
        for leg in legs:
            if isinstance(leg, dict) and leg.get("fill_mode"):
                return str(leg["fill_mode"]).lower()
    if trade_dict.get("target_price") is not None and trade_dict.get("actual_fill_price") is not None:
        return "patient"
    return "immediate"


# ---------------------------------------------------------------------------
# Aggregation
# ---------------------------------------------------------------------------


def _percentile(values: list[float], pct: float) -> float | None:
    """Compute an inclusive percentile via linear interpolation.

    statistics.quantiles needs >=2 data points; for tiny samples we
    fall back to the single value or None.
    """
    if not values:
        return None
    if len(values) == 1:
        return float(values[0])
    sorted_vals = sorted(values)
    # Linear-interpolation percentile (numpy default — "linear").
    rank = pct * (len(sorted_vals) - 1)
    lo = int(rank)
    hi = min(lo + 1, len(sorted_vals) - 1)
    frac = rank - lo
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * frac


def _bucket_summary(rows: list[dict[str, Any]]) -> SlippageBreakdown:
    """Reduce a bucket of trade rows to a SlippageBreakdown."""
    pcts = [r["slippage_pct"] for r in rows if r.get("slippage_pct") is not None]
    leakage = sum(r.get("dollars_leaked", 0.0) for r in rows)
    return SlippageBreakdown(
        trades=len(rows),
        avg_slippage_pct=(sum(pcts) / len(pcts)) if pcts else None,
        median_slippage_pct=(statistics.median(pcts)) if pcts else None,
        p90_slippage_pct=_percentile(pcts, 0.90),
        total_dollars_leaked=round(leakage, 4),
    )


def _enrich(trade_dict: dict[str, Any]) -> dict[str, Any] | None:
    """Compute the per-trade fields the aggregator needs.

    Returns ``None`` when the row should be excluded from the analytics
    (no target_price or no actual_fill_price). Otherwise returns a
    shallow dict with ``slippage_pct``, ``dollars_leaked``,
    ``strategy``, ``structure_type`` and ``fill_mode`` ready for
    bucketing.
    """
    target = trade_dict.get("target_price")
    actual = trade_dict.get("actual_fill_price")
    if target is None or actual is None:
        return None

    try:
        target_f = float(target)
        actual_f = float(actual)
    except (TypeError, ValueError):
        return None

    # ``slippage_pct`` is already on the row (signed, positive = worse).
    # We only recompute it as a fallback for rows where the column is
    # NULL but both target + actual are present (defensive: backfill
    # path may stamp target/actual without slippage_pct).
    slippage_pct = trade_dict.get("slippage_pct")
    if slippage_pct is None and target_f != 0:
        slippage_pct = (actual_f - target_f) / abs(target_f)

    qty = _trade_qty(trade_dict.get("legs"))
    multiplier = _trade_multiplier(trade_dict.get("legs"))
    leakage = abs(actual_f - target_f) * qty * multiplier

    return {
        "slippage_pct": float(slippage_pct) if slippage_pct is not None else 0.0,
        "dollars_leaked": float(leakage),
        "strategy": trade_dict.get("strategy") or "unknown",
        "structure_type": _trade_structure(trade_dict),
        "fill_mode": _fill_mode(trade_dict),
    }


def aggregate(rows: Iterable[dict[str, Any]]) -> SlippageSummary:
    """Pure-function aggregator — used by the route AND by tests.

    Splitting the DB query from the aggregation lets tests construct
    in-memory dicts without standing up Postgres.
    """
    enriched: list[dict[str, Any]] = []
    skipped_no_target = 0
    for raw in rows:
        e = _enrich(raw)
        if e is None:
            skipped_no_target += 1
            continue
        enriched.append(e)

    if not enriched:
        return SlippageSummary(
            total_trades=0,
            trades_without_target=skipped_no_target,
        )

    pcts = [e["slippage_pct"] for e in enriched]
    total_leakage = sum(e["dollars_leaked"] for e in enriched)

    by_strategy: dict[str, list[dict[str, Any]]] = defaultdict(list)
    by_structure: dict[str, list[dict[str, Any]]] = defaultdict(list)
    by_fill_mode: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for e in enriched:
        by_strategy[e["strategy"]].append(e)
        by_structure[e["structure_type"]].append(e)
        by_fill_mode[e["fill_mode"]].append(e)

    return SlippageSummary(
        total_trades=len(enriched),
        avg_slippage_pct=sum(pcts) / len(pcts),
        median_slippage_pct=statistics.median(pcts),
        p90_slippage_pct=_percentile(pcts, 0.90),
        total_dollars_leaked=round(total_leakage, 4),
        by_strategy={k: _bucket_summary(v) for k, v in by_strategy.items()},
        by_structure_type={k: _bucket_summary(v) for k, v in by_structure.items()},
        fill_mode_comparison={k: _bucket_summary(v) for k, v in by_fill_mode.items()},
        trades_without_target=skipped_no_target,
    )


# ---------------------------------------------------------------------------
# Public async entry point
# ---------------------------------------------------------------------------


async def slippage_summary(
    start_date: date | None = None,
    end_date: date | None = None,
    strategy: str | None = None,
) -> SlippageSummary:
    """Aggregate per-trade slippage from the ``trades`` table.

    Parameters
    ----------
    start_date, end_date
        Inclusive entry-time filter. Both default to ``None`` (= no
        bound on that side). When the DB layer is skipped (test mode
        / SKIP_DB_INIT) returns an empty SlippageSummary.
    strategy
        Restrict to a single strategy name. ``None`` = all strategies.

    Returns
    -------
    SlippageSummary
        See class docstring for fields.

    Notes
    -----
    Rows where ``target_price IS NULL`` are filtered OUT in SQL — they
    can never contribute to the metrics, and walking them in Python
    would just inflate the payload. The count of such rows is surfaced
    in ``trades_without_target`` for the empty-state messaging.
    """
    from core.config import settings as _s

    if _s.SKIP_DB_INIT:
        logger.info("slippage_summary: SKIP_DB_INIT=true, returning empty summary")
        return SlippageSummary()

    try:
        from sqlalchemy import select
        from data.storage.models import Trade
        from core.database import _get_session_factory
    except Exception:
        logger.warning("slippage_summary: unable to import DB layer", exc_info=True)
        return SlippageSummary()

    factory = _get_session_factory()
    async with factory() as db:
        query = select(Trade)

        # Inclusive entry-time bounds. We anchor the day to UTC noon
        # rather than 00:00 so a trade entered late in the user's
        # session on the boundary day still falls within an
        # ET-derived range — the route layer is responsible for
        # converting ET dates to UTC if it wants tighter precision.
        if start_date is not None:
            cutoff_lo = datetime.combine(start_date, time.min, tzinfo=timezone.utc)
            query = query.where(Trade.entry_time >= cutoff_lo)
        if end_date is not None:
            cutoff_hi = datetime.combine(end_date, time.max, tzinfo=timezone.utc)
            query = query.where(Trade.entry_time <= cutoff_hi)
        if strategy is not None:
            query = query.where(Trade.strategy == strategy)

        # Pre-filter to rows that can participate. Rows missing target
        # price still get COUNTED via a separate cheap query so the
        # response can carry ``trades_without_target`` for the empty
        # state.
        result = await db.execute(query)
        all_trades = result.scalars().all()

        rows: list[dict[str, Any]] = []
        skipped = 0
        for t in all_trades:
            row = {
                "id": t.id,
                "strategy": t.strategy,
                "legs": t.legs,
                "target_price": t.target_price,
                "actual_fill_price": float(t.actual_fill_price)
                    if t.actual_fill_price is not None else None,
                "slippage_pct": t.slippage_pct,
            }
            # ``structure_type`` is intentionally NOT a column on Trade
            # (yet) — derived from legs JSON in _trade_structure().
            if row["target_price"] is None or row["actual_fill_price"] is None:
                skipped += 1
                continue
            rows.append(row)

    summary = aggregate(rows)
    summary.trades_without_target = skipped
    return summary


# ---------------------------------------------------------------------------
# S-1 — backfill helper
# ---------------------------------------------------------------------------


async def backfill_target_prices(dry_run: bool = True) -> dict[str, int]:
    """Best-effort post-hoc target_price for legacy trades.

    Strategy: for any ``trades`` row where ``target_price IS NULL`` and
    ``actual_fill_price IS NOT NULL`` (or ``filled_avg_price IS NOT
    NULL``), if we have an order_submit AUDIT row in the same window
    that captured the chain mid we COULD reconstruct it. In the
    current data model the audit log is the only post-hoc source of
    truth for "what was the mid at submit time?" — without it we
    DELIBERATELY leave target_price NULL rather than fabricating one
    from the current chain (which has moved).

    Returns a {scanned, backfilled, skipped_no_audit} count dict.

    NOTE: the audit-log lookup is opportunistic — if the audit table
    doesn't exist or no row matches the trade's broker_order_id we
    skip. We never invent a target from current marks; doing so would
    understate slippage on every volatile name.
    """
    from core.config import settings as _s

    if _s.SKIP_DB_INIT:
        return {"scanned": 0, "backfilled": 0, "skipped_no_audit": 0}

    try:
        from sqlalchemy import select, update
        from data.storage.models import Trade
        from core.database import _get_session_factory
    except Exception:
        logger.warning("backfill_target_prices: DB layer unavailable", exc_info=True)
        return {"scanned": 0, "backfilled": 0, "skipped_no_audit": 0}

    scanned = 0
    backfilled = 0
    skipped_no_audit = 0

    factory = _get_session_factory()
    async with factory() as db:
        result = await db.execute(
            select(Trade).where(
                Trade.target_price.is_(None),
                Trade.actual_fill_price.isnot(None),
            )
        )
        candidates = result.scalars().all()

        for t in candidates:
            scanned += 1
            audit_target = await _audit_lookup_target(db, t)
            if audit_target is None:
                skipped_no_audit += 1
                continue
            if dry_run:
                backfilled += 1
                continue
            actual_f = float(t.actual_fill_price) if t.actual_fill_price else 0.0
            slip = (
                (actual_f - audit_target) / abs(audit_target)
                if audit_target != 0 else 0.0
            )
            await db.execute(
                update(Trade)
                .where(Trade.id == t.id)
                .values(target_price=audit_target, slippage_pct=slip)
            )
            backfilled += 1

        if not dry_run and backfilled:
            await db.commit()

    return {
        "scanned": scanned,
        "backfilled": backfilled,
        "skipped_no_audit": skipped_no_audit,
    }


async def _audit_lookup_target(db: Any, trade: Any) -> float | None:
    """Look up the chain-mid recorded at order_submit time.

    Returns the per-share target price if found, ``None`` otherwise.
    Best-effort: the audit table may not exist, may not have the
    ``mid_price`` field populated, or the broker_order_id may not
    match. ANY failure mode returns None so the caller skips the row.
    """
    if trade.broker_order_id is None and trade.client_order_id is None:
        return None
    try:
        from sqlalchemy import select, text
        # The audit table is a JSON-payload log of submit/cancel
        # events. Different deployments name it differently
        # (``audit_log``, ``order_audit``, ...) and the column may be
        # JSON or text. We use raw SQL with EXISTS-guarded read so
        # missing tables don't crash.
        check = await db.execute(
            text(
                "SELECT to_regclass('public.audit_log') IS NOT NULL "
                "AS exists_flag"
            )
        )
        has_table = bool(check.scalar())
        if not has_table:
            return None
        rows = await db.execute(
            text(
                "SELECT payload FROM audit_log "
                "WHERE event_type = 'order_submit' "
                "AND (payload->>'broker_order_id' = :boid "
                "OR payload->>'client_order_id' = :coid) "
                "ORDER BY created_at DESC LIMIT 1"
            ),
            {
                "boid": trade.broker_order_id or "",
                "coid": trade.client_order_id or "",
            },
        )
        row = rows.first()
        if not row:
            return None
        payload = row[0] or {}
        if isinstance(payload, str):
            import json as _json
            try:
                payload = _json.loads(payload)
            except Exception:
                return None
        for key in ("mid_price", "target_price", "limit_price"):
            v = payload.get(key) if isinstance(payload, dict) else None
            if v is not None:
                try:
                    return float(v)
                except (TypeError, ValueError):
                    continue
        return None
    except Exception:
        logger.debug("audit lookup failed", exc_info=True)
        return None
