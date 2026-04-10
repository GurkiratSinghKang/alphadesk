from __future__ import annotations

from strategies.base import BaseStrategy
from strategies.momentum_quality import MomentumQualityStrategy
from strategies.pead import PEADStrategy
from strategies.vrp_harvest import VRPHarvestStrategy
from strategies.earnings_vol import EarningsVolStrategy
from strategies.regime_adaptive import RegimeAdaptiveStrategy

STRATEGIES: dict[str, type[BaseStrategy]] = {
    "momentum_quality": MomentumQualityStrategy,
    "pead": PEADStrategy,
    "vrp_harvest": VRPHarvestStrategy,
    "earnings_vol": EarningsVolStrategy,
    "regime_adaptive": RegimeAdaptiveStrategy,
}


def get_strategy(name: str) -> BaseStrategy | None:
    cls = STRATEGIES.get(name)
    return cls() if cls else None
