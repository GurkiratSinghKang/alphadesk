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
        // Wave 29 persona-5 #2: the bar packs 4 pills + Build + ⌘K + Commands
        // into a single 22px row. At 390px viewport the right cluster clipped
        // under `md:overflow-hidden` on the parent. Allow horizontal scroll
        // on mobile (shrink-0 on children so nothing squishes illegibly),
        // then revert to the natural desk layout at md+.
        "flex items-center h-[22px] px-5 gap-[18px]",
        "overflow-x-auto md:overflow-visible whitespace-nowrap",
        "border-t border-border bg-ink-050",
        "font-mono text-[10px] text-fg-muted",
        className
      )}
      style={{ letterSpacing: "0.02em" }}
    >
      {pills.map((p, i) => (
        <span
          key={p.label + i}
          className={cn("inline-flex items-center gap-1.5 shrink-0", pillToneClass[p.tone])}
        >
          <StatusDot tone={pillDotTone[p.tone]} size={5} />
          <span>{p.label}</span>
        </span>
      ))}

      <div className="ml-auto flex gap-[18px] items-center shrink-0">
        <span className="text-fg-hint">Build {buildVersion}</span>
        {/* ⌘K hint is keyboard-only affordance — hide on touch. */}
        <kbd
          className={cn(
            "hidden md:inline-block font-mono text-[10px] text-fg bg-bg-elev-1 border border-border",
            "px-1.5 py-[1px] rounded-xs"
          )}
          style={{ letterSpacing: "0.04em" }}
        >
          ⌘K
        </kbd>
        <span className="hidden md:inline">{commandsLabel}</span>
      </div>
    </div>
  );
}
