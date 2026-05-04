"use client";

import * as React from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";
import StatusDot from "@/components/primitives/StatusDot";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import type { StatusPill } from "./types";

/**
 * StatusBar (composite, 22px)
 * ───────────────────────────
 * Bottom footer — BUG-02 remediation (PR-5).
 *
 * Previously rendered a flat mono-pill rail that read as a developer console
 * (Alpaca paper · Dashboard · Strategies · …). Now collapsed to a single
 * "System OK · build N.N.N" popover-pill. The per-service detail moves
 * inside the popover so it's available on demand rather than filling the
 * screen at all times.
 *
 * The health dot color signals aggregate status:
 *   profit (green) — all pills healthy
 *   amber          — at least one amber pill
 *   loss (red)     — at least one loss/offline pill
 */
export interface StatusBarProps {
  pills: StatusPill[];
  buildVersion: string;
  /** Defaults to "Commands". */
  commandsLabel?: string;
  className?: string;
}

const pillToneClass: Record<StatusPill["tone"], string> = {
  profit: "text-profit",
  amber: "text-amber",
  muted: "text-fg-muted",
};

const pillDotTone: Record<StatusPill["tone"], "profit" | "amber" | "muted"> = {
  profit: "profit",
  amber: "amber",
  muted: "muted",
};

/** Derive aggregate system health from all pills. */
function aggregateTone(pills: StatusPill[]): "profit" | "amber" | "muted" {
  const tones = pills.map((p) => p.tone);
  // If any pill is amber (non-healthy but non-critical), surface amber.
  // Muted pills are informational; profit pills are explicitly healthy.
  // There is no explicit "loss" tone in StatusPill — amber is the warning floor.
  if (tones.some((t) => t === "amber")) return "amber";
  if (tones.every((t) => t === "muted")) return "muted";
  return "profit";
}

/**
 * SystemDetailGrid — the per-service pills rendered inside the Popover.
 * Extracted from the old flat rail.
 */
function SystemDetailGrid({ pills }: { pills: StatusPill[] }) {
  if (pills.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2" role="list" aria-label="Service status detail">
      {pills.map((p, i) => {
        const isLivePill = p.label === "Mode · LIVE";
        return (
          <li
            key={p.label + i}
            className={cn(
              "inline-flex items-center gap-1.5",
              pillToneClass[p.tone]
            )}
            title={p.title}
          >
            <StatusDot tone={pillDotTone[p.tone]} size={5} pulse={isLivePill} />
            <span className={cn("font-mono text-[12px]", isLivePill && "tracking-wider")}>{p.label}</span>
            {p.href ? (
              <Link
                href={p.href}
                className="font-mono text-[12px] text-brand underline decoration-brand-dim underline-offset-2 hover:text-gold-300"
              >
                {p.hrefLabel ?? "Fix"}
              </Link>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export default function StatusBar({
  pills,
  buildVersion,
  className,
}: StatusBarProps) {
  const health = aggregateTone(pills);
  const dotTone: "profit" | "amber" | "muted" =
    health === "amber" ? "amber" : health === "profit" ? "profit" : "muted";
  const healthLabel =
    health === "amber" ? "Degraded" : health === "profit" ? "System OK" : "System";

  return (
    <div
      data-slot="status-bar"
      aria-label="System status"
      className={cn(
        // BUG-035: floor text at 12px for high-DPI legibility.
        // BUG-02: collapsed from flat mono-pill rail to single popover-pill.
        "flex items-center h-[22px] px-4 gap-4",
        "border-t border-border bg-ink-050",
        "font-mono text-[12px] text-fg-muted",
        className
      )}
      style={{ letterSpacing: 0, lineHeight: 1 }}
    >
      <Popover>
        <PopoverTrigger
          render={
            <button
              type="button"
              className="flex items-center gap-1.5 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-xs px-0.5"
              aria-label="Open system status detail"
            >
              <StatusDot tone={dotTone} size={5} />
              <span>{healthLabel} · build {buildVersion}</span>
            </button>
          }
        />
        <PopoverContent
          side="top"
          align="start"
          sideOffset={6}
          className="w-[280px]"
        >
          <div className="flex flex-col gap-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-fg-muted">
              Service status
            </p>
            <SystemDetailGrid pills={pills} />
          </div>
        </PopoverContent>
      </Popover>

      <div className="ml-auto flex gap-4 items-center shrink-0">
        {/* ⌘K hint — keyboard-only affordance, hide on touch. */}
        <kbd
          className={cn(
            "hidden md:inline-block font-mono text-[12px] text-fg bg-bg-elev-1 border border-border",
            "px-1.5 py-[1px] rounded-xs"
          )}
          style={{ letterSpacing: 0 }}
        >
          ⌘K
        </kbd>
        <span className="hidden md:inline text-fg-muted">Commands</span>
      </div>
    </div>
  );
}
