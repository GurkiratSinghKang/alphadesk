from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from agents.base import BaseAgent

_AGENT_REGISTRY: dict[str, type[BaseAgent]] = {}
_initialized: bool = False


def _register_all() -> None:
    """Lazily import and register all agent classes."""
    global _initialized
    if _initialized:
        return

    from agents.supervisor import SupervisorAgent
    from agents.screener import ScreenerAgent
    from agents.technical import TechnicalAnalysisAgent
    from agents.fundamental import FundamentalAnalysisAgent
    from agents.strategy import StrategyAgent
    from agents.sentiment import SentimentAgent
    from agents.earnings import EarningsAgent
    from agents.execution import ExecutionAgent
    from agents.risk import RiskManagerAgent
    from agents.options_agent import OptionsAgent
    from agents.portfolio import PortfolioAgent
    from agents.research import StrategyResearchAgent

    for cls in [
        SupervisorAgent, ScreenerAgent, TechnicalAnalysisAgent,
        FundamentalAnalysisAgent, StrategyAgent, SentimentAgent,
        EarningsAgent, ExecutionAgent, RiskManagerAgent,
        OptionsAgent, PortfolioAgent, StrategyResearchAgent,
    ]:
        _AGENT_REGISTRY[cls.name] = cls

    _initialized = True


def get_agent(name: str) -> BaseAgent | None:
    """Instantiate and return an agent by name, or None if not found."""
    _register_all()
    cls = _AGENT_REGISTRY.get(name)
    if cls is None:
        return None
    return cls()


def list_agents() -> list[str]:
    _register_all()
    return list(_AGENT_REGISTRY.keys())
