"""Opening Range Breakout (ORB) — SOTA shell (research stub).

1-minute intraday strategy. Currently registered as ``kind="research"``
pending 1-min intraday integration in ``StrategyInput``. Full simulator
and signal logic preserved in git history.

Canonical references: Crabel (1990), Fisher (2002), Zarattini-Aziz (2023).
"""

from __future__ import annotations

import logging
from datetime import date
from typing import Any

from strategies._core.contracts import (
    StrategyInput,
    StrategyResult,
)
from strategies._core.protocol import Strategy, StrategyMeta, register_strategy

from .config import ORBParams, UNIVERSE_PROFILES


log = logging.getLogger("alphadesk.strategies.orb")

_NS = "orb"
_REQUIRED_LOOKBACK_DAYS = 30


@register_strategy(
    StrategyMeta(
        name="orb",
        category="intraday",
        kind="research",  # 1-min intraday path not yet in StrategyInput
        description=(
            "Opening Range Breakout (Zarattini-Aziz 2023) on SPY/QQQ. "
            "1-min OR window then intraday breakout; EOD MOC flat. "
            "Research shell pending 1-min intraday integration in "
            "StrategyInput."
        ),
        lookback_days=_REQUIRED_LOOKBACK_DAYS,
        required_bars=("1min",),
        min_universe_size=1,
    )
)
class ORBStrategy(Strategy):
    """Opening Range Breakout (research shell)."""

    PARAMS_MODEL = ORBParams

    def universe(self, asof: date, state: dict[str, Any]) -> list[str]:
        profile = state.get(f"{_NS}.profile", "qqq_tqqq")
        return list(UNIVERSE_PROFILES.get(profile, UNIVERSE_PROFILES["qqq_tqqq"]))

    def run(
        self,
        input: StrategyInput,
        params: ORBParams,
    ) -> StrategyResult:
        return StrategyResult(
            signals=[],
            diagnostics={
                "research_shell": True,
                "reason": "1min intraday integration deferred",
            },
            warnings=[],
        )


__all__ = ["ORBStrategy"]
