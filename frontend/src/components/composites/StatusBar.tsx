import * as React from "react";
import Link from "next/link";

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
      aria-label="System status"
      className={cn(
        // Wave 29 persona-5 #2: the bar packs 4 pills + Build + ⌘K + Commands
        // into a single 22px row. At 390px viewport the right cluster clipped
        // under `md:overflow-hidden` on the parent. Allow horizontal scroll
        // on mobile (shrink-0 on children so nothing squishes illegibly),
        // then revert to the natural desk layout at md+.
        // BUG-035: status-bar text was 10-11px which falls below a
        // comfortable readable floor on high-DPI screens (iOS Safari
        // anti-aliases strokes at 11px and lower so digits blur into
        // the ink-050 rail). Floor at 12px — same height still fits the
        // 22px row because font-mono line-height is 1.0 here.
        "flex items-center h-[22px] px-5 gap-[18px]",
        "overflow-x-auto md:overflow-visible whitespace-nowrap",
        "border-t border-border bg-ink-050",
        "font-mono text-[12px] text-fg-muted",
        className
      )}
      style={{ letterSpacing: 0, lineHeight: 1 }}
    >
      {pills.map((p, i) => {
        // Phase-1 / SB-1: the LIVE-mode pill pulses to draw the eye —
        // it's the most-consequential single surface in the chrome
        // (user is in real-money trading mode). PAPER stays static.
        const isLivePill = p.label === "Mode · LIVE";
        return (
          <span
            key={p.label + i}
            className={cn("inline-flex items-center gap-1.5 shrink-0", pillToneClass[p.tone])}
            title={p.title}
          >
            <StatusDot tone={pillDotTone[p.tone]} size={5} pulse={isLivePill} />
            <span className={cn(isLivePill && "tracking-wider")}>{p.label}</span>
          {/* Wave 3N persona-94 #1: broker-offline (and any other
              remediable) pill surfaces a tiny inline link to the
              relevant settings page so a fresh user has somewhere to
              go instead of staring at a dead "offline" state. */}
          {p.href ? (
            <Link
              href={p.href}
              className="font-mono text-[12px] text-brand underline decoration-brand-dim underline-offset-2 hover:text-gold-300"
            >
              {p.hrefLabel ?? "Fix"}
            </Link>
          ) : null}
          </span>
        );
      })}

      <div className="ml-auto flex gap-[18px] items-center shrink-0">
        <span className="text-fg-hint">Build {buildVersion}</span>
        {/* ⌘K hint is keyboard-only affordance — hide on touch. */}
        <kbd
          className={cn(
            "hidden md:inline-block font-mono text-[12px] text-fg bg-bg-elev-1 border border-border",
            "px-1.5 py-[1px] rounded-xs"
          )}
          style={{ letterSpacing: 0 }}
        >
          ⌘K
        </kbd>
        <span className="hidden md:inline">{commandsLabel}</span>
      </div>
    </div>
  );
}
