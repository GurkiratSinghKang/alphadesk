from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from datetime import datetime
from typing import Any


class BaseStrategy(ABC):
    """Abstract base class for all AlphaDesk trading strategies.

    Every strategy implements the full lifecycle:
    screen -> analyse -> generate_signal -> map_to_trade -> manage
    """

    name: str = "base"
    description: str = ""
    default_timeframe: str = "swing"  # scalp, day, swing, position
    default_universe: str = "us_liquid"
    min_iv_rank: float | None = None
    max_iv_rank: float | None = None

    def __init__(self) -> None:
        self.logger = logging.getLogger(f"strategy.{self.name}")

    @abstractmethod
    async def screen(self, universe: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Filter the universe to candidates that match this strategy's criteria.

        Args:
            universe: List of ticker dicts with fundamental + technical data.

        Returns:
            Filtered and ranked list of candidates.
        """
        ...

    @abstractmethod
    async def analyze(self, symbol: str, data: dict[str, Any]) -> dict[str, Any]:
        """Deep-dive analysis on a specific candidate.

        Args:
            symbol: Ticker symbol.
            data: Market data, fundamentals, options data for the symbol.

        Returns:
            Analysis result with score, conviction, and details.
        """
        ...

    @abstractmethod
    async def generate_signal(self, analysis: dict[str, Any]) -> dict[str, Any] | None:
        """Convert analysis into a discrete trading signal.

        Returns:
            Signal dict with direction, strength, timing, or None if no signal.
        """
        ...

    @abstractmethod
    async def map_to_trade(self, signal: dict[str, Any], portfolio: dict[str, Any]) -> dict[str, Any]:
        """Map a signal to a concrete trade with structure, sizing, and risk parameters.

        Args:
            signal: The trading signal from generate_signal.
            portfolio: Current portfolio state (equity, positions, etc.).

        Returns:
            Trade specification with legs, sizing, stops, and targets.
        """
        ...

    @abstractmethod
    async def manage(self, position: dict[str, Any], market_data: dict[str, Any]) -> dict[str, Any]:
        """Manage an existing position (adjustments, stops, exits).

        Args:
            position: Current position details.
            market_data: Latest market data.

        Returns:
            Management action (hold, adjust, close) with details.
        """
        ...

    async def run_full_pipeline(self, universe: list[dict[str, Any]], portfolio: dict[str, Any]) -> list[dict[str, Any]]:
        """Execute the full strategy pipeline: screen -> analyse -> signal -> trade."""
        candidates = await self.screen(universe)
        self.logger.info("Screened %d candidates from %d universe", len(candidates), len(universe))

        trades = []
        for candidate in candidates[:10]:  # limit to top 10
            symbol = candidate.get("ticker", candidate.get("symbol", ""))
            analysis = await self.analyze(symbol, candidate)
            signal = await self.generate_signal(analysis)
            if signal:
                trade = await self.map_to_trade(signal, portfolio)
                trades.append(trade)

        self.logger.info("Generated %d trade ideas", len(trades))
        return trades
