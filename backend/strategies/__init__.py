from __future__ import annotations

from strategies.base import BaseStrategy
from strategies.momentum_quality import MomentumQualityStrategy
from strategies.pead import PEADStrategy
from strategies.vrp_harvest import VRPHarvestStrategy
from strategies.earnings_vol import EarningsVolStrategy
from strategies.regime_adaptive import RegimeAdaptiveStrategy
from strategies.ts_momentum import TSMomentumStrategy
from strategies.rsi2_reversal import RSI2ReversalStrategy
from strategies.dual_momentum import DualMomentumStrategy
from strategies.pairs_trading import PairsTradingStrategy
from strategies.kama_breakout import KAMABreakoutStrategy
from strategies.orb import ORBStrategy
from strategies.vwap_strategy import VWAPStrategy

STRATEGIES: dict[str, type[BaseStrategy]] = {
    "momentum_quality": MomentumQualityStrategy,
    "pead": PEADStrategy,
    "vrp_harvest": VRPHarvestStrategy,
    "earnings_vol": EarningsVolStrategy,
    "regime_adaptive": RegimeAdaptiveStrategy,
    "ts_momentum": TSMomentumStrategy,
    "rsi2_reversal": RSI2ReversalStrategy,
    "dual_momentum": DualMomentumStrategy,
    "pairs_trading": PairsTradingStrategy,
    "kama_breakout": KAMABreakoutStrategy,
    "orb": ORBStrategy,
    "vwap_strategy": VWAPStrategy,
}


def get_strategy(name: str) -> BaseStrategy | None:
    cls = STRATEGIES.get(name)
    return cls() if cls else None
