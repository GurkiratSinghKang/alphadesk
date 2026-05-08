/**
 * Shared types for the v2 agent system.
 *
 * Keeps the archetype enum + Agent shape in one place so AgentChip,
 * AgentRow, AgentActivityFeed, the /agents page, and the eventual
 * `/api/v1/agents/list` endpoint all reference the same contract.
 *
 * Archetypes per v2-plan locked decision #4 (Research / Signal /
 * Risk / Exec). Status follows v2 spec (idle / running / queued /
 * failed). Health is a coarse rollup separate from per-run status.
 */

import type { AgentArchetype, AgentStatus } from "@/components/primitives/AgentChip";

export type { AgentArchetype, AgentStatus };

export type AgentHealth = "ok" | "degraded" | "failed";

export interface Agent {
  /** Stable identifier — used as React key + URL param. */
  id: string;
  /** Frozen archetype taxonomy. */
  archetype: AgentArchetype;
  /** Human-readable display name. e.g. "Atlas" — distinct from archetype. */
  name: string;
  /** Current run status. `running` triggers AgentChip pulse. */
  status: AgentStatus;
  /**
   * Last output snippet. Rendered as italic Newsreader in AgentRow.
   * Long outputs are truncated; full output lives on /agents/[id].
   */
  lastOutput: string;
  /** Strategy slug this agent is currently working for, if any. */
  ownerStrategy?: string;
  /** Today's spend in USD (provider cost tracking — see B.2). */
  costToday: number;
  /** Last 24h run count. */
  runs24h: number;
  /** Active model identifier (e.g. "claude-opus-4-7-1m"). */
  model: string;
  /** ISO timestamp of last successful run. */
  lastRun: string;
  /** Coarse health rollup, used for the right-side dot in AgentRow. */
  health: AgentHealth;
}
