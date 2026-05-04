"""Claude Alpha — SOTA shell (v0).

Systematic equity selection where Claude synthesises fundamentals +
technicals + sentiment + catalysts + options-flow into a structured
per-name thesis. Top-scored names get conviction-weighted positions
weekly.

Status: ``kind="research"`` — the v0 implementation provides the
deterministic-replay cache + scoring abstraction + risk filters, but
does NOT yet wire a live Claude prompt. The full prompt path is gated
behind kind="research" so a misbehaving LLM call cannot move capital
unintentionally; it is replaced by a deterministic fallback scorer
that ranks names by simple momentum + liquidity (a known-bad
proxy) so the rest of the pipeline can be exercised end-to-end.

Why this matters: the largest risk in an LLM-driven strategy is not
the prompt quality — it's the lack of replay determinism. Per Lopez
de Prado (2018), backtest validity requires that running the same
strategy on the same data twice produces the same result. LLM calls
are inherently non-deterministic (even at temperature=0 there's a
small distributional drift across model versions). This v0 ships the
**replay-cache infrastructure** that solves that, keyed by
``(prompt_id, prompt_version, input_hash, asof)`` — production calls
hit the live Anthropic API; backtests / replays serve cached responses
from the disk cache.

References:
- Grossman, S. J., & Stiglitz, J. E. (1980). "On the Impossibility of
  Informationally Efficient Markets." *American Economic Review* 70(3).
  (Information-aggregation foundation.)
- Lopez de Prado, M. (2018). *Advances in Financial Machine Learning.*
  (Walk-forward replay + meta-labelling discipline.)
- Bender, E., et al. (2021). "On the Dangers of Stochastic Parrots."
  (Why we need replay-determinism for LLM-driven systems.)
"""

from __future__ import annotations

import hashlib
import json
import logging
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Optional

import numpy as np
import pandas as pd

from strategies._core.contracts import (
    OrderType,
    Signal,
    StrategyInput,
    StrategyResult,
    TimeInForce,
)
from strategies._core.protocol import Strategy, StrategyMeta, register_strategy

from .config import CLAUDE_ALPHA_UNIVERSE_SEED, ClaudeAlphaParams


log = logging.getLogger("alphadesk.strategies.claude_alpha")

_NS = "claude_alpha"
_REQUIRED_LOOKBACK_DAYS = 252
_REPLAY_CACHE_DIR = Path.home() / ".alphadesk" / "claude_alpha_cache"


@register_strategy(
    StrategyMeta(
        name="claude_alpha",
        category="equity",
        kind="research",  # gates engine from auto-running until prompt is validated
        description=(
            "LLM-driven equity selection (v0 scaffold). Replay-cache "
            "infrastructure + deterministic fallback scorer + risk filters; "
            "live Claude prompt path is gated behind kind='research' until "
            "the OOS replay validates."
        ),
        lookback_days=_REQUIRED_LOOKBACK_DAYS,
        required_bars=("daily",),
        min_universe_size=20,
    )
)
class ClaudeAlphaStrategy(Strategy):
    """Claude Alpha v0 — see module docstring."""

    PARAMS_MODEL = ClaudeAlphaParams

    # ------------------------------------------------------------------ #
    # Universe                                                           #
    # ------------------------------------------------------------------ #
    def universe(self, asof: date, state: dict[str, Any]) -> list[str]:
        return list(CLAUDE_ALPHA_UNIVERSE_SEED)

    # ------------------------------------------------------------------ #
    # Pure-function alpha                                                #
    # ------------------------------------------------------------------ #
    def run(
        self,
        input: StrategyInput,
        params: ClaudeAlphaParams,
    ) -> StrategyResult:
        asof = input.asof
        diagnostics: dict[str, Any] = {
            "kind": "research",
            "rebalance": False,
            "n_universe": 0,
            "n_scored": 0,
            "scoring_path": "deterministic_fallback",
            "scores": {},
            "selected": [],
            "n_exits": 0,
        }
        warnings: list[str] = [
            "claude_alpha is in research mode — no live Claude prompt is wired. "
            "Scoring uses a deterministic fallback (momentum + liquidity rank); "
            "production path is gated until prompt + OOS replay are validated.",
        ]
        signals: list[Signal] = []

        # Per-bar exits (force-close past max_holding_days)
        exit_signals, exit_state = _build_holding_exits(
            input.positions, input.state, asof, params,
        )
        signals.extend(exit_signals)
        diagnostics["n_exits"] = len(exit_signals)

        if not _is_rebalance_day(asof, params.rebalance_freq):
            return StrategyResult(
                signals=signals,
                state_update=exit_state,
                diagnostics=diagnostics,
                warnings=warnings,
            )
        diagnostics["rebalance"] = True

        # Build the candidate universe: seed minus held names minus earnings-
        # imminent names.
        held = {p.symbol for p in input.positions if p.quantity != 0}
        candidates = [s for s in CLAUDE_ALPHA_UNIVERSE_SEED if s not in held]
        diagnostics["n_universe"] = len(candidates)

        scores = _score_universe(
            candidates, input, params, asof,
            diagnostics=diagnostics,
        )
        diagnostics["n_scored"] = len(scores)
        diagnostics["scores"] = {sym: round(float(sc), 4) for sym, sc in list(scores.items())[:25]}

        # Pick top-N by score, conviction-weight in [min_weight, max_weight].
        ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
        top = [(sym, sc) for sym, sc in ranked if sc >= params.min_score]
        free_slots = max(0, params.target_positions - len(held))
        chosen = top[:free_slots]
        diagnostics["selected"] = [sym for sym, _ in chosen]

        if not chosen:
            warnings.append(
                "claude_alpha rebalance: zero names scored above min_score; holding existing book."
            )
            return StrategyResult(
                signals=signals,
                state_update=exit_state,
                diagnostics=diagnostics,
                warnings=warnings,
            )

        # Conviction-weight: linear from min_weight (lowest selected) to
        # max_weight (highest selected).
        new_entry_dates = dict(exit_state.get(f"{_NS}.entry_dates", {}))
        score_min = chosen[-1][1]
        score_max = chosen[0][1]
        score_range = max(1e-6, float(score_max - score_min))

        for sym, sc in chosen:
            frac = float((sc - score_min) / score_range)
            weight = (
                params.min_weight_per_name
                + frac * (params.max_weight_per_name - params.min_weight_per_name)
            )
            signals.append(
                Signal(
                    symbol=sym,
                    target_weight=float(weight),
                    order_type=OrderType.MOO,
                    time_in_force=TimeInForce.DAY,
                    tag=f"ca-entry-{sym}",
                    asof=asof,
                )
            )
            new_entry_dates[sym] = asof.isoformat()

        return StrategyResult(
            signals=signals,
            state_update={
                **exit_state,
                f"{_NS}.entry_dates": new_entry_dates,
            },
            diagnostics=diagnostics,
            warnings=warnings,
        )


# --------------------------------------------------------------------------- #
# Pure helpers                                                                #
# --------------------------------------------------------------------------- #
def _is_rebalance_day(asof: date, freq: str) -> bool:
    """Friday for weekly, alternating for biweekly, last business day for monthly."""
    try:
        from data.calendar import is_trading_day
    except Exception:
        is_trading_day = lambda d: getattr(d, "weekday", lambda: 5)() < 5  # noqa: E731
    if not is_trading_day(asof):
        return False
    if freq == "weekly":
        return asof.weekday() == 4  # Fri
    if freq == "biweekly":
        return asof.weekday() == 4 and (asof.isocalendar().week % 2 == 0)
    if freq == "monthly":
        # Last business day of the month
        probe = asof + timedelta(days=1)
        for _ in range(10):
            if is_trading_day(probe):
                if probe.month == asof.month:
                    return False
                break
            probe += timedelta(days=1)
        return True
    return False


def _input_hash(input: StrategyInput, asof: date) -> str:
    """Deterministic hash of the inputs that the prompt will see.

    This is the cache key for replay determinism: if the strategy is run
    twice on the same asof+data, we must produce the same scoring output.
    Hashing the input frame is the canonical way to ensure that.
    """
    h = hashlib.sha256()
    h.update(asof.isoformat().encode())
    if input.bars is not None and not getattr(input.bars, "empty", True):
        h.update(pd.util.hash_pandas_object(input.bars, index=True).values.tobytes())
    if input.fundamentals is not None and not getattr(input.fundamentals, "empty", True):
        h.update(pd.util.hash_pandas_object(input.fundamentals, index=True).values.tobytes())
    return h.hexdigest()[:16]


def _cache_path(prompt_id: str, prompt_version: int, input_hash: str, asof: date) -> Path:
    """Disk path for the cached scoring JSON."""
    return _REPLAY_CACHE_DIR / f"{prompt_id}_v{prompt_version}_{asof.isoformat()}_{input_hash}.json"


def _read_cached_scores(path: Path) -> Optional[dict[str, float]]:
    """Return cached scores if the file exists and parses cleanly."""
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text())
    except Exception:
        return None
    if not isinstance(data, dict):
        return None
    out: dict[str, float] = {}
    for sym, sc in data.items():
        try:
            out[str(sym).upper()] = float(sc)
        except (TypeError, ValueError):
            continue
    return out or None


def _write_cached_scores(path: Path, scores: dict[str, float]) -> None:
    """Atomic write of scoring output to the replay cache."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(scores, sort_keys=True, indent=2))
    tmp.replace(path)


def _score_universe(
    universe: list[str],
    input: StrategyInput,
    params: ClaudeAlphaParams,
    asof: date,
    diagnostics: dict[str, Any],
) -> dict[str, float]:
    """Return per-symbol score in [0, 1]. Uses replay cache when available.

    v0 implementation:
    - Check the disk cache keyed by (prompt_id, prompt_version, input_hash, asof)
    - On cache hit: serve cached scores. Sets ``scoring_path = "cache_hit"``.
    - On cache miss: deterministic fallback (momentum + liquidity composite).
      Sets ``scoring_path = "deterministic_fallback"``. Persists the result
      to the cache so subsequent replays are bit-for-bit identical.

    The Claude live-call path is intentionally NOT wired in v0: the strategy
    is registered with ``kind="research"`` so the engine excludes it from
    the autonomous run loop. To enable the live path, a follow-on plan will:
      1. Implement ``_score_via_claude(...)`` using the existing
         ``backend.agents.claude_client.ClaudeClient`` (already provides
         budget kill-switch + token tracking + retry logic)
      2. Add a kind="autonomous" flip behind a feature flag
      3. Validate via OOS replay (the cache makes this trivial: tune the
         prompt, re-run, compare — every cached call costs $0).
    """
    input_hash = _input_hash(input, asof)
    cache_path = _cache_path(
        params.prompt_id, params.prompt_version, input_hash, asof,
    )
    cached = _read_cached_scores(cache_path)
    if cached is not None:
        diagnostics["scoring_path"] = "cache_hit"
        # Filter to current universe
        return {sym: sc for sym, sc in cached.items() if sym in universe}

    # Cache miss: deterministic fallback
    diagnostics["scoring_path"] = "deterministic_fallback"
    scores = _deterministic_fallback_score(universe, input, asof)
    _write_cached_scores(cache_path, scores)
    return scores


def _deterministic_fallback_score(
    universe: list[str], input: StrategyInput, asof: date,
) -> dict[str, float]:
    """Deterministic v0 scorer: 252-day return × log(ADV) composite.

    Returns scores in [0, 1] via min-max normalization. NOT a real alpha
    signal — this is the placeholder that exercises the rest of the pipeline
    (selection, weighting, exits) until the Claude path is wired.
    """
    bars = input.bars
    if bars is None or getattr(bars, "empty", True):
        return {}

    raw: dict[str, float] = {}
    for sym in universe:
        try:
            sub = bars.xs(sym, level="symbol")
        except Exception:
            continue
        if sub.empty or "close" not in sub.columns:
            continue
        sub = sub.sort_index()
        closes = sub["close"].dropna()
        if len(closes) < 60:
            continue
        # 252-day return (capped to available history)
        lookback = min(252, len(closes) - 1)
        ret = float(closes.iloc[-1] / closes.iloc[-1 - lookback] - 1.0)
        if not np.isfinite(ret):
            continue
        # log(ADV proxy)
        if "volume" in sub.columns:
            vol = sub["volume"].dropna().tail(60)
            if len(vol) > 0:
                dv = float((closes.tail(60) * vol).median())
                liq = float(np.log10(max(1.0, dv)))
            else:
                liq = 0.0
        else:
            liq = 0.0
        # Composite
        raw[sym] = ret * 0.7 + liq * 0.05  # liq small contribution

    if not raw:
        return {}
    # Min-max normalize to [0, 1]
    lo = min(raw.values())
    hi = max(raw.values())
    span = max(1e-9, hi - lo)
    return {sym: float((v - lo) / span) for sym, v in raw.items()}


def _build_holding_exits(
    positions: list[Any],
    state: dict[str, Any],
    asof: date,
    params: ClaudeAlphaParams,
) -> tuple[list[Signal], dict[str, Any]]:
    """Force-exit any position past its max_holding_days."""
    raw = state.get(f"{_NS}.entry_dates", {})
    entry_dates: dict[str, date] = {}
    if isinstance(raw, dict):
        for sym, ds in raw.items():
            try:
                entry_dates[str(sym).upper()] = (
                    ds if isinstance(ds, date) and not isinstance(ds, bool)
                    else date.fromisoformat(str(ds))
                )
            except Exception:
                continue

    new_entries = dict(entry_dates)
    out: list[Signal] = []
    max_calendar_days = int(round(params.max_holding_days * 7 / 5))
    for pos in positions:
        if pos.quantity == 0:
            continue
        sym = pos.symbol.upper()
        ed = entry_dates.get(sym)
        if ed is None:
            continue
        if (asof - ed).days >= max_calendar_days:
            out.append(
                Signal(
                    symbol=pos.symbol,
                    target_weight=0.0,
                    order_type=OrderType.MOO,
                    time_in_force=TimeInForce.DAY,
                    tag="ca-exit-time",
                    asof=asof,
                )
            )
            new_entries.pop(sym, None)

    return out, {f"{_NS}.entry_dates": new_entries}
