from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType


def _load_wrapper() -> ModuleType:
    path = (
        Path(__file__).resolve().parents[1]
        / "tools"
        / "tradingagents"
        / "scripts"
        / "run_tradingagents.py"
    )
    spec = importlib.util.spec_from_file_location("run_tradingagents_wrapper", path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_research_memo_uses_final_state_not_processed_signal_only() -> None:
    wrapper = _load_wrapper()
    state = {
        "final_trade_decision": (
            "# AAPL Final Decision\n\n"
            "## 1. RATING: **Underweight**\n\n"
            "**Current Price Reference:** ~$271.35\n"
            "**Time Horizon:** 30-60 days\n"
            "- Currently long AAPL: trim 20-25% near $274-$276 resistance\n"
            "- Currently flat: wait for $255-$262 support\n"
        ),
        "market_report": "Technical trend is firm, but momentum has cooled.",
        "fundamentals_report": "Valuation is elevated versus normalized growth.",
        "investment_debate_state": {
            "bull_history": "Bull Analyst: cash flow and services support the stock.",
            "bear_history": "Bear Analyst: valuation and seasonal distortion dominate.",
            "judge_decision": "Research manager prefers underweight.",
        },
        "risk_debate_state": {
            "judge_decision": "Risk committee keeps sizing conservative.",
        },
    }

    memo = wrapper.build_research_memo(
        ticker="AAPL",
        trade_date="2026-05-01",
        final_state=state,
        processed_signal="UNDERWEIGHT",
    )
    summary = wrapper.summarize_research_state(state, "UNDERWEIGHT", 6)

    assert "Portfolio Manager Decision" in memo
    assert "Analyst Evidence" in memo
    assert "Investment Debate" in memo
    assert "UNDERWEIGHT" != memo.strip()
    assert summary[0] == "Rating: UNDERWEIGHT"
    assert any("$274-$276" in line for line in summary)
