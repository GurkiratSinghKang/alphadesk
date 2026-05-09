/**
 * Strategy → archetype mapping for the v2 Phase 2 agent reframe.
 *
 * Maps strategy slugs to the agent archetype most responsible for
 * generating their entries. Used by PositionsList + StrategyCard to
 * decorate rows with AgentChip. The mapping is conservative — only
 * the well-known live strategies are mapped; unknown strategies fall
 * back to `null` so the chip renders absent rather than incorrect.
 *
 * v2-plan locked decision #4: archetypes are frozen
 * (research / signal / risk / exec). The mapping below uses those
 * exact slugs.
 */

import type { AgentArchetype } from "@/components/primitives/AgentChip";

const STRATEGY_TO_ARCHETYPE: Record<string, AgentArchetype> = {
  // Research-led: long-form fundamental + macro screening.
  "momentum-quality": "research",
  "momentum_quality": "research",
  "mq": "research",
  "value-tilt": "research",

  // Signal-led: technical / statistical signal triggers.
  "pead": "signal",
  "post-earnings-drift": "signal",
  "mean-reversion": "signal",
  "trend-follow": "signal",

  // Risk-led: vol / hedging / regime-aware structures.
  "vol-hedge": "risk",
  "regime-aware-hedge": "risk",

  // Exec-led: defined-risk options structures + execution-heavy strategies.
  "earnings-options-play": "exec",
  "earnings_options_play": "exec",
  "iron-condor": "exec",
  "covered-call": "exec",
};

/**
 * Resolve a strategy id to its responsible archetype, or null when
 * the strategy isn't mapped. Case-insensitive; falls back to a heuristic
 * keyword scan when the exact id isn't in the map (so "Momentum + Quality"
 * still resolves to research).
 */
export function archetypeForStrategy(
  strategyId: string | null | undefined,
): AgentArchetype | null {
  if (!strategyId) return null;
  const normalized = strategyId.trim().toLowerCase().replace(/\s+/g, "-");
  if (normalized in STRATEGY_TO_ARCHETYPE) {
    return STRATEGY_TO_ARCHETYPE[normalized];
  }
  // Fuzzy fallback — keyword scan so display-name strings also resolve.
  if (/momentum|quality|fundamental|earnings.*research/i.test(strategyId)) return "research";
  if (/signal|trend|drift|mean.*reversion|pead/i.test(strategyId)) return "signal";
  if (/hedge|risk|regime|vol.*hedge/i.test(strategyId)) return "risk";
  if (/options|condor|spread|covered/i.test(strategyId)) return "exec";
  return null;
}
