"""Strategy metadata gains a `kind` flag distinguishing autonomous
strategies (run by the engine) from research tools (decision-support UI only).
"""
from strategies.base import StrategyMeta
from strategies.registry import get_meta, list_strategies, load_all


def test_strategy_meta_defaults_to_autonomous():
    """Existing strategies that don't set `kind` must default to autonomous
    so the engine keeps picking them up unchanged."""
    meta = StrategyMeta(name="test_default")
    assert meta.kind == "autonomous"


def test_strategy_meta_accepts_research_kind():
    """New research-only entries declare kind='research' and must round-trip."""
    meta = StrategyMeta(name="test_research", kind="research")
    assert meta.kind == "research"


def test_earnings_options_play_registered_as_research():
    """The earnings-options-play screener is registered as research-kind so
    the /strategies list groups it under the Research section."""
    load_all()
    meta = get_meta("earnings-options-play")
    assert meta is not None, "earnings-options-play must be registered"
    assert meta.kind == "research"


def test_existing_autonomous_strategies_unchanged():
    """Registered autonomous strategies keep kind='autonomous'."""
    load_all()
    pead = get_meta("pead")
    assert pead is not None
    assert pead.kind == "autonomous"
