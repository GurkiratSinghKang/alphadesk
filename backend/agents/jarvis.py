"""B.7 — Jarvis intent parser (rule-based v1).

Parses natural-language operator commands ("halt trades on NVDA",
"rotate Anthropic key", "pause research agent") into a strict typed
``IntentSpec`` validated against a frozen module/action registry.

v1 ships a deterministic rule-based parser so the dispatch path is
mature + audited before Anthropic-backed inference lands. Phase 2
swaps the parser internals for an Anthropic structured-output call
with the same registry as the typed schema; the dispatch + dry-run
+ audit + typed-confirm gates remain unchanged.

Risk register (per the redesign plan):
- LLM correctness — frozen module/action registry. The parser
  CANNOT invent actions; we validate ``intent.module in REGISTRY``
  before any dispatch. Mandatory dry-run on the parse endpoint
  (never mutates). Audit row written at parse time even if the
  user never confirms — investigators can see what users tried.

Public API:
  - REGISTRY: frozen dict of module → list of supported actions
  - IntentSpec: typed parsed intent shape
  - parse_intent(prompt) → IntentSpec | None
  - dry_run_diff(spec) → dict (preview, no mutation)
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Final


# ─── Frozen registry ────────────────────────────────────────────
# Keys are module slugs that map to the canonical ControlModule
# id from frontend/src/lib/mocks/controls.ts. Values are the
# actions Jarvis is allowed to invoke. The registry is intentionally
# narrow — every action is auditable + reversible.
REGISTRY: Final[dict[str, tuple[str, ...]]] = {
    "trade_halt": ("halt", "resume"),
    "pipeline_stage": ("pause", "resume"),
    "agent": ("pause", "resume", "set_spend_cap"),
    "strategy": ("enable", "disable", "set_capital_cap"),
    "risk_gate": ("set_threshold",),
    "feature_flag": ("enable", "disable"),
    "key": ("rotate",),
    "deploy": ("trigger",),
}


@dataclass(frozen=True)
class IntentSpec:
    """Typed parsed intent. Frozen so dispatchers cannot mutate."""

    module: str
    action: str
    scope: dict[str, Any]
    params: dict[str, Any]

    def __post_init__(self) -> None:
        if self.module not in REGISTRY:
            raise ValueError(f"Unknown module {self.module!r}")
        if self.action not in REGISTRY[self.module]:
            raise ValueError(
                f"Unknown action {self.action!r} for module {self.module!r}"
            )


# ─── Parser primitives ──────────────────────────────────────────
_SYMBOL_RE = re.compile(r"\b([A-Z][A-Z0-9]{0,4})\b")
_PIPELINE_STAGE_RE = re.compile(
    r"\b(ingest|enrich|score|risk(?: gate)?|execute|execution)\b", re.IGNORECASE
)
_ARCHETYPE_RE = re.compile(r"\b(research|signal|risk|exec|execution)\b", re.IGNORECASE)
_KEY_RE = re.compile(
    r"\b(anthropic|fmp|alpaca(?:\s*secret)?|openai|polygon)\b", re.IGNORECASE
)
_NUMBER_RE = re.compile(r"\b(\d+(?:\.\d+)?)\b")


def _normalize_archetype(raw: str) -> str:
    """Map textual archetype tokens to canonical slugs."""
    norm = raw.lower().strip()
    if norm == "execution":
        return "exec"
    return norm


def _extract_symbols(prompt: str) -> list[str]:
    """Pull plausible symbol tokens. Filters common English words."""
    out: list[str] = []
    blocklist = {
        "I", "A", "AN", "THE", "TO", "ON", "OFF", "UP", "DOWN", "FOR",
        "AT", "OR", "AND", "BUT", "NO", "YES", "ALL",
    }
    for match in _SYMBOL_RE.finditer(prompt):
        sym = match.group(1).upper()
        if sym in blocklist:
            continue
        out.append(sym)
    return out


def parse_intent(prompt: str) -> IntentSpec | None:
    """Rule-based parser. Returns None when intent can't be classified.

    Recognized verb forms:
      halt / pause / stop  → pause action
      resume / unhalt / start → resume action
      rotate (key)
      enable / disable
      trigger / deploy
      set ... cap / threshold (params via _NUMBER_RE)
    """
    text = (prompt or "").strip()
    if not text:
        return None
    lower = text.lower()

    # ── trade halt ────────────────────────────────────────────
    if re.search(r"\b(halt|stop)\b.*\btrad", lower) or re.search(
        r"\bhalt\b.*\bon\b", lower
    ):
        symbols = _extract_symbols(text)
        scope = {"symbol": symbols[0]} if symbols else {"all": True}
        return IntentSpec("trade_halt", "halt", scope, {})
    if re.search(r"\b(resume|unhalt)\b.*\btrad", lower):
        return IntentSpec("trade_halt", "resume", {"all": True}, {})

    # ── pipeline stage ────────────────────────────────────────
    pipe_match = _PIPELINE_STAGE_RE.search(lower)
    if pipe_match and re.search(
        r"\b(pause|stop|disable|halt)\b", lower
    ):
        stage = pipe_match.group(1).lower().replace(" gate", "")
        if stage == "execution":
            stage = "execute"
        return IntentSpec("pipeline_stage", "pause", {"stage": stage}, {})
    if pipe_match and re.search(r"\b(resume|enable|start)\b", lower):
        stage = pipe_match.group(1).lower().replace(" gate", "")
        if stage == "execution":
            stage = "execute"
        return IntentSpec("pipeline_stage", "resume", {"stage": stage}, {})

    # ── agent control ─────────────────────────────────────────
    agent_match = _ARCHETYPE_RE.search(lower)
    if agent_match and "agent" in lower:
        archetype = _normalize_archetype(agent_match.group(1))
        if re.search(r"\b(pause|stop|disable|halt)\b", lower):
            return IntentSpec("agent", "pause", {"archetype": archetype}, {})
        if re.search(r"\b(resume|enable|start)\b", lower):
            return IntentSpec("agent", "resume", {"archetype": archetype}, {})
        if re.search(r"\b(set|cap|spend|budget)\b", lower):
            num = _NUMBER_RE.search(lower)
            if num:
                return IntentSpec(
                    "agent",
                    "set_spend_cap",
                    {"archetype": archetype},
                    {"daily_spend_cap_usd": float(num.group(1))},
                )

    # ── key rotation ──────────────────────────────────────────
    if re.search(r"\brotate\b", lower) and "key" in lower:
        key_match = _KEY_RE.search(lower)
        if key_match:
            provider = key_match.group(1).lower().replace(" secret", "_secret").replace(" ", "")
            return IntentSpec("key", "rotate", {"provider": provider}, {})

    # ── feature flag ──────────────────────────────────────────
    if re.search(r"\bfeature\s+flag\b|\bflag\b", lower):
        if re.search(r"\b(enable|on|turn on)\b", lower):
            sym = _extract_symbols(text)
            return IntentSpec(
                "feature_flag",
                "enable",
                {"key": sym[0].lower() if sym else ""},
                {},
            )
        if re.search(r"\b(disable|off|turn off)\b", lower):
            sym = _extract_symbols(text)
            return IntentSpec(
                "feature_flag",
                "disable",
                {"key": sym[0].lower() if sym else ""},
                {},
            )

    # ── deploy dispatch ───────────────────────────────────────
    if re.search(r"\b(deploy|trigger)\b", lower):
        env_match = re.search(r"\b(prod|staging|production)\b", lower)
        env = env_match.group(1).lower() if env_match else "staging"
        if env == "production":
            env = "prod"
        return IntentSpec("deploy", "trigger", {"env": env}, {})

    return None


def dry_run_diff(spec: IntentSpec) -> dict[str, Any]:
    """Generate a preview of what the action WOULD do, no mutation.

    The diff shape mirrors the IntentSpec but with two extra keys:
      - ``would``     : human-readable single-line action description
      - ``audit_event`` : the canonical audit event slug that will fire
                          on confirm.

    Frontend Jarvis bar renders this directly in the confirm pane.
    """
    audit_map = {
        ("trade_halt", "halt"): "halt_toggled",
        ("trade_halt", "resume"): "halt_toggled",
        ("pipeline_stage", "pause"): "pipeline_stage_paused",
        ("pipeline_stage", "resume"): "pipeline_stage_resumed",
        ("agent", "pause"): "agent_paused",
        ("agent", "resume"): "agent_resumed",
        ("agent", "set_spend_cap"): "agent_control_changed",
        ("strategy", "enable"): "strategy_toggled",
        ("strategy", "disable"): "strategy_toggled",
        ("strategy", "set_capital_cap"): "strategy_capital_cap_changed",
        ("risk_gate", "set_threshold"): "control_changed",
        ("feature_flag", "enable"): "feature_flag_default_changed",
        ("feature_flag", "disable"): "feature_flag_default_changed",
        ("key", "rotate"): "key_rotated",
        ("deploy", "trigger"): "deploy_triggered",
    }
    audit_event = audit_map.get((spec.module, spec.action), "control_changed")

    descriptions = {
        "trade_halt": {
            "halt": lambda: f"Halt trading on {spec.scope.get('symbol') or 'ALL symbols'}",
            "resume": lambda: "Resume trading globally",
        },
        "pipeline_stage": {
            "pause": lambda: f"Pause pipeline stage '{spec.scope.get('stage')}'",
            "resume": lambda: f"Resume pipeline stage '{spec.scope.get('stage')}'",
        },
        "agent": {
            "pause": lambda: f"Pause {spec.scope.get('archetype')} agents",
            "resume": lambda: f"Resume {spec.scope.get('archetype')} agents",
            "set_spend_cap": lambda: (
                f"Set {spec.scope.get('archetype')} daily spend cap to "
                f"${spec.params.get('daily_spend_cap_usd')}"
            ),
        },
        "key": {
            "rotate": lambda: f"Rotate {spec.scope.get('provider')} API key",
        },
        "deploy": {
            "trigger": lambda: f"Trigger deploy to {spec.scope.get('env')}",
        },
        "feature_flag": {
            "enable": lambda: f"Enable feature flag '{spec.scope.get('key')}'",
            "disable": lambda: f"Disable feature flag '{spec.scope.get('key')}'",
        },
    }
    would_fn = descriptions.get(spec.module, {}).get(spec.action)
    would = would_fn() if would_fn else f"{spec.module}.{spec.action}"

    return {
        "module": spec.module,
        "action": spec.action,
        "scope": spec.scope,
        "params": spec.params,
        "would": would,
        "audit_event": audit_event,
        "destructive": spec.action in {
            "halt", "rotate", "disable", "pause", "trigger",
        },
    }


__all__ = ["REGISTRY", "IntentSpec", "parse_intent", "dry_run_diff"]
