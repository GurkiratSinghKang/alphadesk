"""Analytics routes — execution-quality + future cohort metrics (M-O S).

Currently exposes a single endpoint:

    GET /api/v1/analytics/slippage

…that returns a :class:`services.slippage_analytics.SlippageSummary`
aggregating every fill captured by the patient mid-pricing walker.
Auth-gated by the global ``Depends(require_auth)`` on the router
include in ``main.py`` (see the ``analytics.router`` registration).

This file is deliberately a SEPARATE router from ``portfolio.py`` so
the slippage / execution-quality endpoints don't mix with the equity-
and-positions analytics that page already serves. As more
execution-quality cohorts come online (venue routing, NBBO
improvement, retail-router internalisation rates) they all land here.
"""
from __future__ import annotations

import logging
from datetime import date

from fastapi import APIRouter, Query

from services.slippage_analytics import SlippageSummary, slippage_summary

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/slippage", response_model=SlippageSummary)
async def get_slippage_summary(
    start_date: date | None = Query(
        None,
        description=(
            "Inclusive lower bound on Trade.entry_time (UTC date). "
            "Omit for no lower bound."
        ),
    ),
    end_date: date | None = Query(
        None,
        description=(
            "Inclusive upper bound on Trade.entry_time (UTC date). "
            "Omit for no upper bound."
        ),
    ),
    strategy: str | None = Query(
        None,
        description=(
            "Restrict to a single strategy id (matches Trade.strategy "
            "exactly). Omit for all strategies."
        ),
    ),
) -> SlippageSummary:
    """Return aggregate slippage metrics for the trade window.

    The response separates rows that participated in the metrics
    (``total_trades``) from rows in the window with no ``target_price``
    captured (``trades_without_target``). The frontend uses the latter
    count to render the empty state — "you have N trades but none of
    them used the patient walker yet" — without conflating "no trades
    in window" with "no telemetry on the trades you have".
    """
    return await slippage_summary(
        start_date=start_date,
        end_date=end_date,
        strategy=strategy,
    )
