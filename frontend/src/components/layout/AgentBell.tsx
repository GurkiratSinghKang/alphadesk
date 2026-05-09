"use client";

import * as React from "react";
import { Robot } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import AgentDrawer from "@/components/composites/AgentDrawer";
import { useAgents } from "@/hooks/useAgents";
import { cn } from "@/lib/utils";

/**
 * AgentBell
 * ──────────
 * v2-plan §2.1 — TopBar trigger that opens the global AgentDrawer.
 * Sibling to NotificationBell, same shape: icon button with a badge
 * surfacing the count that matters.
 *
 * Badge precedence:
 *   - failures > 0 → coral failing count (loudest signal — agent down,
 *     operator must act)
 *   - else running > 0 → brand running count (informational pulse)
 *   - else no badge (quiet roster)
 */
export default function AgentBell() {
  const [open, setOpen] = React.useState(false);
  const { data: agents = [] } = useAgents();

  const counts = React.useMemo(() => {
    let running = 0;
    let failing = 0;
    for (const a of agents) {
      if (a.status === "running") running += 1;
      if (a.status === "failed" || a.health === "failed") failing += 1;
    }
    return { running, failing };
  }, [agents]);

  const ariaLabel = counts.failing > 0
    ? `Agents, ${counts.failing} failing`
    : counts.running > 0
    ? `Agents, ${counts.running} running`
    : "Agents";

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="relative h-11 w-11 sm:h-8 sm:w-8"
        aria-label={ariaLabel}
        onClick={() => setOpen(true)}
      >
        <Robot className="h-4 w-4 text-muted-foreground" weight="regular" />
        {counts.failing > 0 ? (
          <span
            className={cn(
              "absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full",
              "bg-loss text-eyebrow font-bold text-down-on",
            )}
          >
            {counts.failing > 9 ? "9+" : counts.failing}
          </span>
        ) : counts.running > 0 ? (
          <span
            className={cn(
              "absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full",
              "bg-brand text-eyebrow font-bold text-brand-on",
            )}
          >
            {counts.running > 9 ? "9+" : counts.running}
          </span>
        ) : null}
      </Button>
      <AgentDrawer open={open} onOpenChange={setOpen} />
    </>
  );
}
