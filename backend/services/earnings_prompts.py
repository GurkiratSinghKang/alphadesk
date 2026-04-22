"""Claude prompt assembly for earnings-options-play.

Two tiers:
  • `build_structured_prompt` + `parse_structured_response` — eager,
    cached for 4h, ~200 words out. Runs for every upcoming earning.
  • `build_full_prompt` + `parse_full_response` — on-demand, cached for
    24h, ~500 words out. Fires when the user clicks 'Run full research'.

Model defaults to claude-opus-4-7 per spec; structured can be demoted to
Sonnet by flipping MODEL_STRUCTURED here.
"""
from __future__ import annotations

import json
from typing import Sequence

MODEL_STRUCTURED = "claude-opus-4-7"
MODEL_FULL = "claude-opus-4-7"

_VALID_VERDICTS = {"bullish", "neutral-bull", "neutral", "neutral-bear", "bearish"}
_VALID_SETUPS = {"short call", "cash-secured put", "short strangle", "iron condor"}


def build_structured_prompt(
    *,
    symbol: str,
    company: str,
    sector: str,
    report_date: str,
    report_time: str,
    price: float,
    iv_rank: float,
    iv_percentile: float,
    hv_20: float,
    expected_move_pct: float,
    hist_avg_abs_move_pct: float,
    recent_beats_misses: Sequence[tuple[str, str]],
    headlines: Sequence[str],
    market_regime: str,
) -> dict:
    """Return a {'system': str, 'user': str} prompt dict."""
    beats_block = "\n".join(f"  · {d}: {s}" for d, s in recent_beats_misses[:4])
    news_block = "\n".join(f"  · {h}" for h in headlines[:5])
    system = (
        "You are an editorial options-research assistant specializing in "
        "earnings premium-selling. Output a single JSON object matching "
        "this schema exactly and nothing else:\n"
        '{"verdict": "bullish|neutral-bull|neutral|neutral-bear|bearish",\n'
        ' "direction_magnitude": {"bull_case_pct": float, "bear_case_pct": float},\n'
        ' "thesis": "3 sentences",\n'
        ' "catalysts": ["..."], "risks": ["..."],\n'
        ' "suggested_play": "short call|cash-secured put|short strangle|iron condor",\n'
        ' "suggested_play_reason": "one sentence",\n'
        ' "confidence": float 0-1}\n'
        "No markdown. No prose outside the JSON."
    )
    user = (
        f"Earnings setup — {company} ({symbol}), {sector}.\n"
        f"Reports: {report_date} {report_time}.\n"
        f"Price: {price:.2f}. IV rank: {iv_rank:.0f} · IV pctl: {iv_percentile:.0f}.\n"
        f"HV 20d: {hv_20:.2%}. IV-implied expected move (straddle): ±{expected_move_pct:.2%}. "
        f"Historical avg |move| last 8q: ±{hist_avg_abs_move_pct:.2%}.\n"
        f"Recent earnings:\n{beats_block}\n"
        f"Top news:\n{news_block}\n"
        f"Market regime: {market_regime}.\n\n"
        "Based on this, return the JSON described in the system prompt. "
        "Favor premium-selling setups when IV rank is elevated relative to "
        "historical realized; favor directional plays when there's a clear "
        "catalyst + low IV. Suggested play must come from the fixed vocab."
    )
    return {"system": system, "user": user}


def parse_structured_response(raw: str) -> dict:
    """Parse Claude's structured JSON. Validates verdict + suggested_play vs
    vocab and raises ValueError on any deviation so the route can retry once."""
    try:
        obj = json.loads(raw)
    except json.JSONDecodeError as e:
        raise ValueError(f"invalid JSON from Claude: {e}") from e

    verdict = obj.get("verdict")
    if verdict not in _VALID_VERDICTS:
        raise ValueError(f"invalid verdict {verdict!r}, expected one of {_VALID_VERDICTS}")
    setup = obj.get("suggested_play")
    if setup not in _VALID_SETUPS:
        raise ValueError(f"invalid suggested_play {setup!r}")
    for required in ("direction_magnitude", "thesis", "catalysts", "risks", "confidence", "suggested_play_reason"):
        if required not in obj:
            raise ValueError(f"missing key {required!r}")
    conf = float(obj["confidence"])
    if not 0 <= conf <= 1:
        raise ValueError(f"confidence {conf} not in 0..1")
    return obj


def build_full_prompt(
    *,
    symbol: str,
    company: str,
    sector: str,
    report_date: str,
    report_time: str,
    price: float,
    iv_rank: float,
    iv_percentile: float,
    expected_move_pct: float,
    historical_quarters: Sequence[dict],
    headlines: Sequence[str],
    market_regime: str,
    sector_peers_pct_change_5d: dict[str, float],
) -> dict:
    """Richer prompt for on-demand full research (~500 words out)."""
    quarters_block = "\n".join(
        f"  · {q['report_date']}: surprise {q.get('surprise_pct', 0):+.1%}, "
        f"next-day {q['next_day_move_pct']:+.1%}, 5-day {q['five_day_move_pct']:+.1%}"
        for q in historical_quarters[:8]
    )
    peers_block = ", ".join(f"{s} {p:+.1%}" for s, p in sector_peers_pct_change_5d.items())
    system = (
        "You are a senior options-research analyst. Produce a full research "
        "note as a SINGLE JSON object with these keys:\n"
        '{"thesis_paragraph": str,\n'
        ' "comparable_setups": [{"report_date": "YYYY-MM-DD", "iv_rank": float, '
        '"setup": str, "outcome": str, "similarity_score": float}],\n'
        ' "post_earnings_drift_playbook": str,\n'
        ' "sector_backdrop": str,\n'
        ' "analyst_consensus_delta": str,\n'
        ' "what_would_change_my_mind": str,\n'
        ' "confidence": float}\n'
        "No markdown. No prose outside the JSON."
    )
    user = (
        f"{company} ({symbol}) · {sector} · reports {report_date} {report_time}.\n"
        f"Price {price:.2f}. IV rank {iv_rank:.0f}, IV pctl {iv_percentile:.0f}. "
        f"Implied move ±{expected_move_pct:.2%}.\n"
        f"Last 8 earnings:\n{quarters_block}\n"
        f"Sector peers 5d: {peers_block}\n"
        f"Top news: {'; '.join(headlines[:5])}\n"
        f"Market regime: {market_regime}\n\n"
        "Produce the JSON described. Comparable setups must draw from the "
        "provided history — find 2-3 past quarters with similar IV rank + "
        "setup and describe the outcome."
    )
    return {"system": system, "user": user}


def parse_full_response(raw: str) -> dict:
    try:
        obj = json.loads(raw)
    except json.JSONDecodeError as e:
        raise ValueError(f"invalid JSON from Claude full research: {e}") from e
    for required in (
        "thesis_paragraph", "comparable_setups", "post_earnings_drift_playbook",
        "sector_backdrop", "analyst_consensus_delta", "what_would_change_my_mind",
        "confidence",
    ):
        if required not in obj:
            raise ValueError(f"missing key {required!r}")
    conf = float(obj["confidence"])
    if not 0 <= conf <= 1:
        raise ValueError(f"confidence {conf} not in 0..1")
    return obj
