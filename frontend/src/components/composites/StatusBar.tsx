import * as React from "react";

import { cn } from "@/lib/utils";
import StatusDot from "@/components/primitives/StatusDot";
import type { StatusPill } from "./types";

/**
 * StatusBar (composite, 22px)
 * ───────────────────────────
 * Bottom footer with connection pills (Alpaca / Market / Claude / Tick)
 * and a right-side build version + ⌘K commands hint.
 *
 * A `<kbd>` element carries the keystroke; the outer container is the
 * status rail at 22px. Each pill is a tiny StatusDot + mono label.
 */
export interface StatusBarProps {
  pills: StatusPill[];
  buildVersion: string;
  /** Defaults to "Commands". */
  commandsLabel?: string;
  className?: string;
}

const pillToneClass: Record<StatusPill["tone"], string> = {
  profit: "text-up-500",
  amber: "text-amber",
  muted: "text-fg-muted",
};

const pillDotTone: Record<StatusPill["tone"], "profit" | "amber" | "muted"> = {
  profit: "profit",
  amber: "amber",
  muted: "muted",
};

export default function StatusBar({
  pills,
  buildVersion,
  commandsLabel = "Commands",
  className,
}: StatusBarProps) {
  return (
    <div
      data-slot="status-bar"
      role="status"
      className={cn(
        "flex items-center h-[22px] px-5 gap-[18px]",
        "border-t border-border bg-ink-050",
        "font-mono text-[10px] text-fg-muted",
        className
      )}
      style={{ letterSpacing: "0.02em" }}
    >
      {pills.map((p, i) => (
        <span
          key={p.label + i}
          className={cn("inline-flex items-center gap-1.5", pillToneClass[p.tone])}
        >
          <StatusDot tone={pillDotTone[p.tone]} size={5} />
          <span>{p.label}</span>
        </span>
      ))}

      <div className="ml-auto flex gap-[18px] items-center">
        <span className="text-fg-hint">Build {buildVersion}</span>
        <kbd
          className={cn(
            "font-mono text-[10px] text-fg bg-bg-elev-1 border border-border",
            "px-1.5 py-[1px] rounded-xs"
          )}
          style={{ letterSpacing: "0.04em" }}
        >
          ⌘K
        </kbd>
        <span>{commandsLabel}</span>
      </div>
    </div>
  );
}
