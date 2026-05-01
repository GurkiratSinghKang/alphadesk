#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable


UPSTREAM_REPO = "https://github.com/TauricResearch/TradingAgents.git"
UPSTREAM_REF = "v0.2.3"
DEFAULT_ANALYSTS = ["market", "social", "news", "fundamentals"]
SUPPORTED_PROVIDERS = [
    "openai",
    "google",
    "anthropic",
    "xai",
    "openrouter",
    "ollama",
    "deepseek",
    "qwen",
    "glm",
    "azure",
]


def default_skill_home() -> Path:
    value = os.environ.get("TRADINGAGENTS_SKILL_HOME")
    if value:
        return Path(value).expanduser()
    return Path.home() / ".cache" / "tradingagents-skill"


def default_results_root(skill_home: Path) -> Path:
    return skill_home / "results"


def resolve_run_directory(results_root: Path, ticker: str, trade_date: str) -> Path:
    return results_root / ticker.strip() / trade_date.strip()


def make_json_safe(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value

    if isinstance(value, Path):
        return str(value)

    if isinstance(value, dict):
        return {str(key): make_json_safe(item) for key, item in value.items()}

    if isinstance(value, (list, tuple)):
        return [make_json_safe(item) for item in value]

    if isinstance(value, set):
        return sorted(make_json_safe(item) for item in value)

    if hasattr(value, "model_dump"):
        return make_json_safe(value.model_dump())

    if hasattr(value, "__dict__"):
        return make_json_safe(vars(value))

    return str(value)


def parse_trade_date(value: str) -> str:
    datetime.strptime(value, "%Y-%m-%d")
    return value


def parse_analysts(value: str) -> list[str]:
    analysts = [item.strip().lower() for item in value.split(",") if item.strip()]
    if not analysts:
        return DEFAULT_ANALYSTS.copy()

    unknown = sorted(set(analysts) - set(DEFAULT_ANALYSTS))
    if unknown:
        raise argparse.ArgumentTypeError(
            f"Unsupported analysts: {', '.join(unknown)}. "
            f"Use a comma-separated subset of: {', '.join(DEFAULT_ANALYSTS)}"
        )
    return analysts


def build_config(args: argparse.Namespace, results_root: Path) -> dict[str, Any]:
    skill_home = default_skill_home()
    risk_depth = args.risk_depth or args.research_depth

    return {
        "results_dir": str(results_root),
        "data_cache_dir": str(skill_home / "cache"),
        "llm_provider": args.provider,
        "deep_think_llm": args.deep_model,
        "quick_think_llm": args.quick_model,
        "backend_url": args.backend_url,
        "output_language": args.output_language,
        "max_debate_rounds": args.research_depth,
        "max_risk_discuss_rounds": risk_depth,
        "openai_reasoning_effort": args.openai_reasoning_effort,
        "google_thinking_level": args.google_thinking_level,
        "anthropic_effort": args.anthropic_effort,
        "data_vendors": {
            "core_stock_apis": "yfinance",
            "technical_indicators": "yfinance",
            "fundamental_data": "yfinance",
            "news_data": "yfinance",
        },
        "tool_vendors": {},
    }


def summarize_decision(decision_text: str, max_lines: int) -> list[str]:
    lines = []
    for raw in decision_text.splitlines():
        line = raw.strip().strip("-").strip()
        if not line:
            continue
        lines.append(line)
        if len(lines) >= max_lines:
            break
    return lines


def text_value(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def compact_markdown_line(value: str) -> str:
    line = value.strip().strip("-").strip()
    line = line.replace("**", "").replace("__", "").replace("`", "")
    line = line.lstrip("#").strip()
    while "  " in line:
        line = line.replace("  ", " ")
    return line


def truncate_text(value: Any, max_chars: int) -> str:
    text = text_value(value)
    if len(text) <= max_chars:
        return text
    return text[:max_chars].rstrip() + "\n\n[truncated - full text is available in final_state.json]"


def nested_text(mapping: dict[str, Any], *keys: str) -> str:
    current: Any = mapping
    for key in keys:
        if not isinstance(current, dict):
            return ""
        current = current.get(key)
    return text_value(current)


def extract_rating(final_decision: str, processed_signal: str) -> str:
    patterns = (
        r"RATING:\s*\**([A-Za-z][A-Za-z\s/_-]{1,40})\**",
        r"Rating:\s*\**([A-Za-z][A-Za-z\s/_-]{1,40})\**",
        r"\b(Overweight|Underweight|Neutral|Hold|Buy|Sell|Reduce|Accumulate)\b",
    )
    for pattern in patterns:
        match = re.search(pattern, final_decision, flags=re.IGNORECASE)
        if match:
            return compact_markdown_line(match.group(1)).upper()
    return compact_markdown_line(processed_signal).upper()


def summarize_research_state(
    final_state: dict[str, Any],
    processed_signal: str,
    max_lines: int,
) -> list[str]:
    final_decision = text_value(final_state.get("final_trade_decision"))
    trader_plan = text_value(final_state.get("trader_investment_plan"))
    source = final_decision or trader_plan or processed_signal
    rating = extract_rating(source, processed_signal)

    candidates: list[str] = []
    if rating:
        candidates.append(f"Rating: {rating}")

    useful_markers = (
        "current price",
        "time horizon",
        "action plan",
        "currently long",
        "currently flat",
        "preferred entry",
        "position sizing",
        "support",
        "resistance",
        "stop",
        "target",
        "trim",
        "do not initiate",
    )
    for raw in source.splitlines():
        line = compact_markdown_line(raw)
        if not line or len(line) < 12:
            continue
        lowered = line.lower()
        if any(marker in lowered for marker in useful_markers):
            candidates.append(line)
        if len(candidates) >= max_lines * 2:
            break

    if len(candidates) < 3:
        for raw in trader_plan.splitlines():
            line = compact_markdown_line(raw)
            if not line or len(line) < 24:
                continue
            lowered = line.lower()
            if "bull case" in lowered or "bear case" in lowered or "recommend" in lowered:
                candidates.append(line)
            if len(candidates) >= max_lines * 2:
                break

    deduped: list[str] = []
    seen: set[str] = set()
    for item in candidates:
        clean = item[:220].rstrip()
        key = clean.lower()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(clean)
        if len(deduped) >= max_lines:
            break
    return deduped or summarize_decision(processed_signal, max_lines)


def add_section(parts: list[str], heading: str, body: Any, *, max_chars: int) -> None:
    text = truncate_text(body, max_chars)
    if not text:
        return
    parts.append(f"## {heading}\n\n{text}")


def add_subsection(parts: list[str], heading: str, body: Any, *, max_chars: int) -> None:
    text = truncate_text(body, max_chars)
    if not text:
        return
    parts.append(f"### {heading}\n\n{text}")


def build_research_memo(
    *,
    ticker: str,
    trade_date: str,
    final_state: dict[str, Any],
    processed_signal: str,
) -> str:
    rating = extract_rating(text_value(final_state.get("final_trade_decision")), processed_signal)
    parts = [
        f"# {ticker} TradingAgents Research Brief",
        f"- Trade date: `{trade_date}`",
        f"- Processed signal: `{rating or processed_signal}`",
        "- Source: TradingAgents multi-agent graph",
    ]

    add_section(
        parts,
        "Portfolio Manager Decision",
        final_state.get("final_trade_decision") or processed_signal,
        max_chars=8_000,
    )
    add_section(parts, "Trader Plan", final_state.get("trader_investment_plan"), max_chars=3_500)
    add_section(parts, "Investment Committee Decision", final_state.get("investment_plan"), max_chars=3_500)

    analyst_parts: list[str] = []
    add_subsection(analyst_parts, "Market Analyst", final_state.get("market_report"), max_chars=2_400)
    add_subsection(analyst_parts, "Social Analyst", final_state.get("sentiment_report"), max_chars=1_800)
    add_subsection(analyst_parts, "News Analyst", final_state.get("news_report"), max_chars=2_400)
    add_subsection(analyst_parts, "Fundamentals Analyst", final_state.get("fundamentals_report"), max_chars=2_400)
    if analyst_parts:
        parts.append("## Analyst Evidence\n\n" + "\n\n".join(analyst_parts))

    debate_parts: list[str] = []
    add_subsection(
        debate_parts,
        "Bull Case",
        nested_text(final_state, "investment_debate_state", "bull_history"),
        max_chars=2_400,
    )
    add_subsection(
        debate_parts,
        "Bear Case",
        nested_text(final_state, "investment_debate_state", "bear_history"),
        max_chars=2_400,
    )
    add_subsection(
        debate_parts,
        "Research Manager Decision",
        nested_text(final_state, "investment_debate_state", "judge_decision"),
        max_chars=2_800,
    )
    if debate_parts:
        parts.append("## Investment Debate\n\n" + "\n\n".join(debate_parts))

    risk_parts: list[str] = []
    add_subsection(
        risk_parts,
        "Aggressive Risk View",
        nested_text(final_state, "risk_debate_state", "aggressive_history"),
        max_chars=2_000,
    )
    add_subsection(
        risk_parts,
        "Conservative Risk View",
        nested_text(final_state, "risk_debate_state", "conservative_history"),
        max_chars=2_000,
    )
    add_subsection(
        risk_parts,
        "Neutral Risk View",
        nested_text(final_state, "risk_debate_state", "neutral_history"),
        max_chars=2_000,
    )
    add_subsection(
        risk_parts,
        "Risk Committee Decision",
        nested_text(final_state, "risk_debate_state", "judge_decision"),
        max_chars=3_000,
    )
    if risk_parts:
        parts.append("## Risk Debate\n\n" + "\n\n".join(risk_parts))

    return "\n\n".join(part for part in parts if part).strip()


def ensure_runtime_imports():
    try:
        from tradingagents.default_config import DEFAULT_CONFIG  # type: ignore
        from tradingagents.graph.trading_graph import TradingAgentsGraph  # type: ignore
    except Exception as exc:  # pragma: no cover
        raise RuntimeError(
            "TradingAgents is not installed in the active Python environment. "
            "Run scripts/run_tradingagents.sh or scripts/bootstrap_tradingagents.sh first."
        ) from exc

    return DEFAULT_CONFIG, TradingAgentsGraph


def write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content.rstrip() + "\n", encoding="utf-8")


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(make_json_safe(payload), indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def build_summary_markdown(
    *,
    ticker: str,
    trade_date: str,
    provider: str,
    deep_model: str,
    quick_model: str,
    output_language: str,
    summary_lines: Iterable[str],
) -> str:
    bullets = "\n".join(f"- {line}" for line in summary_lines) or "- No summary lines extracted."
    return (
        f"# TradingAgents Summary\n\n"
        f"- Ticker: `{ticker}`\n"
        f"- Trade date: `{trade_date}`\n"
        f"- Provider: `{provider}`\n"
        f"- Deep model: `{deep_model}`\n"
        f"- Quick model: `{quick_model}`\n"
        f"- Output language: `{output_language}`\n"
        f"- Upstream repo: `{UPSTREAM_REPO}`\n"
        f"- Upstream ref: `{UPSTREAM_REF}`\n\n"
        f"## Key Points\n\n"
        f"{bullets}\n"
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run TradingAgents through the skill wrapper.",
    )
    parser.add_argument("ticker", help="Ticker or exchange-qualified instrument symbol.")
    parser.add_argument(
        "trade_date",
        type=parse_trade_date,
        help="Trade date in YYYY-MM-DD format.",
    )
    parser.add_argument(
        "--provider",
        choices=SUPPORTED_PROVIDERS,
        default="openai",
        help="LLM provider.",
    )
    parser.add_argument(
        "--deep-model",
        default="gpt-5.4",
        help="Model used for complex reasoning.",
    )
    parser.add_argument(
        "--quick-model",
        default="gpt-5.4-mini",
        help="Model used for fast steps.",
    )
    parser.add_argument(
        "--output-language",
        default="Chinese",
        help="Language used for user-facing reports.",
    )
    parser.add_argument(
        "--analysts",
        type=parse_analysts,
        default=DEFAULT_ANALYSTS.copy(),
        help="Comma-separated subset of market,social,news,fundamentals.",
    )
    parser.add_argument(
        "--research-depth",
        type=int,
        default=1,
        help="Debate depth for research and risk rounds.",
    )
    parser.add_argument(
        "--risk-depth",
        type=int,
        default=None,
        help="Optional explicit risk round depth. Defaults to research depth.",
    )
    parser.add_argument(
        "--backend-url",
        default=None,
        help="Optional custom base URL for provider-compatible endpoints.",
    )
    parser.add_argument(
        "--openai-reasoning-effort",
        choices=["low", "medium", "high"],
        default=None,
        help="OpenAI reasoning effort.",
    )
    parser.add_argument(
        "--google-thinking-level",
        choices=["minimal", "high"],
        default=None,
        help="Gemini thinking mode.",
    )
    parser.add_argument(
        "--anthropic-effort",
        choices=["low", "medium", "high"],
        default=None,
        help="Claude effort level.",
    )
    parser.add_argument(
        "--results-root",
        type=Path,
        default=None,
        help="Override the results root directory.",
    )
    parser.add_argument(
        "--summary-lines",
        type=int,
        default=8,
        help="Number of lines to keep in summary output.",
    )
    parser.add_argument(
        "--debug",
        action="store_true",
        help="Enable upstream debug mode.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print a JSON response to stdout instead of a human summary.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    skill_home = default_skill_home()
    results_root = args.results_root.expanduser() if args.results_root else default_results_root(skill_home)
    run_dir = resolve_run_directory(results_root, args.ticker, args.trade_date)
    run_dir.mkdir(parents=True, exist_ok=True)

    DEFAULT_CONFIG, TradingAgentsGraph = ensure_runtime_imports()

    config = DEFAULT_CONFIG.copy()
    config.update(build_config(args, results_root))

    graph = TradingAgentsGraph(
        selected_analysts=args.analysts,
        debug=args.debug,
        config=config,
    )

    final_state, decision = graph.propagate(args.ticker, args.trade_date)
    safe_final_state = make_json_safe(final_state)
    if not isinstance(safe_final_state, dict):
        safe_final_state = {}
    processed_signal = str(decision).strip()
    decision_text = build_research_memo(
        ticker=args.ticker,
        trade_date=args.trade_date,
        final_state=safe_final_state,
        processed_signal=processed_signal,
    )
    summary_lines = summarize_research_state(safe_final_state, processed_signal, args.summary_lines)

    summary_path = run_dir / "summary.md"
    decision_path = run_dir / "decision.txt"
    config_path = run_dir / "run_config.json"
    final_state_path = run_dir / "final_state.json"

    write_text(decision_path, decision_text)
    write_text(
        summary_path,
        build_summary_markdown(
            ticker=args.ticker,
            trade_date=args.trade_date,
            provider=args.provider,
            deep_model=args.deep_model,
            quick_model=args.quick_model,
            output_language=args.output_language,
            summary_lines=summary_lines,
        ),
    )
    write_json(
        config_path,
        {
            "ticker": args.ticker,
            "trade_date": args.trade_date,
            "provider": args.provider,
            "deep_model": args.deep_model,
            "quick_model": args.quick_model,
            "output_language": args.output_language,
            "analysts": args.analysts,
            "research_depth": args.research_depth,
            "risk_depth": args.risk_depth or args.research_depth,
            "backend_url": args.backend_url,
            "results_root": results_root,
            "skill_home": skill_home,
            "upstream_repo": UPSTREAM_REPO,
            "upstream_ref": UPSTREAM_REF,
            "effective_config": config,
        },
    )
    write_json(final_state_path, safe_final_state)

    payload = {
        "ticker": args.ticker,
        "trade_date": args.trade_date,
        "processed_signal": processed_signal,
        "run_dir": str(run_dir),
        "summary_path": str(summary_path),
        "decision_path": str(decision_path),
        "run_config_path": str(config_path),
        "final_state_path": str(final_state_path),
        "summary_lines": summary_lines,
    }

    if args.json:
        print(json.dumps(payload, indent=2, ensure_ascii=False))
        return 0

    print(f"TradingAgents run complete for {args.ticker} on {args.trade_date}")
    print(f"Run directory: {run_dir}")
    print("Summary:")
    for line in summary_lines:
        print(f"- {line}")
    print("Artifacts:")
    print(f"- {summary_path}")
    print(f"- {decision_path}")
    print(f"- {config_path}")
    print(f"- {final_state_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
