import * as React from "react";

import { cn } from "@/lib/utils";
import StatusDot, { type StatusDotTone } from "./StatusDot";

/**
 * AgentChip
 * ──────────
 * v2 redesign — small archetype pill identifying which agent is acting
 * on a given surface. The agent system is the protagonist of Phase 2;
 * AgentChip is its smallest visible atom. Used by AgentRow,
 * AgentActivityFeed, Dashboard hero, Symbol "Agents on this name" tab,
 * Strategy playbook stages, Position rows, Trade pre-execution stamps,
 * Marketing /agents card.
 *
 * Archetypes are a frozen taxonomy (per v2-plan locked decision #4):
 * Research / Signal / Risk / Exec. Each gets a stable color + label.
 *
 * Status maps to StatusDot tone:
 *   idle    → muted
 *   running → brand (pulses)
 *   queued  → ice
 *   failed  → loss
 *
 * Voice: ALL CAPS tracked label, sentence-case archetype.
 */
export type AgentArchetype = "research" | "signal" | "risk" | "exec";
export type AgentStatus = "idle" | "running" | "queued" | "failed";
export type AgentChipSize = "sm" | "lg";

export interface AgentChipProps extends React.HTMLAttributes<HTMLSpanElement> {
  archetype: AgentArchetype;
  status?: AgentStatus;
  size?: AgentChipSize;
  /** Hide the status dot entirely. Useful in static archetype-only contexts. */
  hideStatus?: boolean;
  /** Optional override label; defaults to the archetype's display name. */
  label?: string;
  className?: string;
}

const archetypeMeta: Record<
  AgentArchetype,
  { label: string; tone: string; ringClass: string; bgClass: string }
> = {
  research: {
    label: "Research",
    tone: "ice",
    ringClass: "ring-ice/40",
    bgClass: "bg-tint-info-1",
  },
  signal: {
    label: "Signal",
    tone: "brand",
    ringClass: "ring-brand/40",
    bgClass: "bg-tint-brand-1",
  },
  risk: {
    label: "Risk",
    tone: "loss",
    ringClass: "ring-loss/40",
    bgClass: "bg-tint-down-1",
  },
  exec: {
    label: "Exec",
    tone: "profit",
    ringClass: "ring-profit/40",
    bgClass: "bg-tint-up-1",
  },
};

const statusToneMap: Record<AgentStatus, StatusDotTone> = {
  idle: "muted",
  running: "brand",
  queued: "ice",
  failed: "loss",
};

const sizeChipClass: Record<AgentChipSize, string> = {
  sm: "h-5 px-1.5 gap-1 text-eyebrow",
  lg: "h-7 px-2 gap-1.5 text-label",
};

export default function AgentChip({
  archetype,
  status = "idle",
  size = "sm",
  hideStatus = false,
  label,
  className,
  ...rest
}: AgentChipProps) {
  const meta = archetypeMeta[archetype];
  const text = label ?? meta.label;
  const dotTone = statusToneMap[status];

  return (
    <span
      data-slot="agent-chip"
      data-archetype={archetype}
      data-status={status}
      role="img"
      aria-label={`${text} agent ${status}`}
      className={cn(
        "inline-flex items-center rounded-pill ring-1 font-semibold tracking-[0.08em] uppercase",
        meta.bgClass,
        meta.ringClass,
        sizeChipClass[size],
        className,
      )}
      {...rest}
    >
      {!hideStatus && (
        <StatusDot
          tone={dotTone}
          size={size === "sm" ? 5 : 7}
          pulse={status === "running"}
        />
      )}
      <span className="truncate" data-slot="agent-chip-label">
        {text}
      </span>
    </span>
  );
}
