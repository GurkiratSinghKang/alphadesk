"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import type { SymbolGroupId } from "@/stores/market";

/**
 * SymbolGroupDot — TWS Mosaic-style color-group picker chip.
 *
 * Slice-11 / SLG-1 (2026 design brief): tiny circular control that
 * lets a panel pin itself to a numbered/colored symbol group. Groups
 * 1-4 are colour-coded (red / amber / chartreuse / ice). Clicking
 * cycles through 0 → 1 → 2 → 3 → 4 → 0; clicking with Shift opens a
 * radio popover for direct picking.
 *
 * Group 0 = "no group" — the panel uses its independent selectedSymbol
 * and is unaffected by other panels' symbol changes. Groups 1-4 mean
 * "this panel and every other panel in this group share a symbol; if
 * one panel updates, all update."
 *
 * The actual cross-panel sync logic lives in the consumer panels:
 * each panel reads ``groupSymbols[group]`` from the market store
 * when ``group !== 0``, and falls back to ``selectedSymbol`` otherwise.
 */

const GROUP_COLORS: Record<Exclude<SymbolGroupId, 0>, string> = {
  1: "var(--loss)", // red — primary research / "main" panel
  2: "var(--state-warning, #d97706)", // amber — watching (semantic warn)
  3: "var(--profit)", // chartreuse — paired symbol
  4: "var(--ice-500, #5b8def)", // ice — comparison
};

export interface SymbolGroupDotProps {
  group: SymbolGroupId;
  onChange: (next: SymbolGroupId) => void;
  className?: string;
  size?: 7 | 8 | 10;
  /** Optional aria-label override; defaults to "Symbol group N". */
  label?: string;
}

export default function SymbolGroupDot({
  group,
  onChange,
  className,
  size = 8,
  label,
}: SymbolGroupDotProps) {
  const next: SymbolGroupId = ((group + 1) % 5) as SymbolGroupId;
  const color =
    group === 0 ? "var(--border)" : GROUP_COLORS[group as 1 | 2 | 3 | 4];
  const ariaLabel =
    label ??
    (group === 0
      ? "Symbol group: none — click to join group 1"
      : `Symbol group ${group} — click to advance to group ${next === 0 ? "none" : next}`);
  const sizeStyle: Record<7 | 8 | 10, string> = {
    7: "h-[7px] w-[7px]",
    8: "h-2 w-2",
    10: "h-2.5 w-2.5",
  };
  // The visible dot stays small (7-10px) by design — it's a chip, not
  // a control. Round-15 / persona-9 P1: the previous markup was ALSO
  // the click target, giving an 8×8 hit area (way under WCAG 2.5.5
  // 24×24). Wrap in a 24×24 transparent button so motor-impaired
  // users can hit it; visual stays identical.
  return (
    <button
      type="button"
      data-slot="symbol-group-dot"
      data-group={group}
      onClick={(e) => {
        e.stopPropagation();
        onChange(next);
      }}
      aria-label={ariaLabel}
      title={ariaLabel}
      className={cn(
        "inline-flex items-center justify-center min-h-6 min-w-6 p-1 transition-colors",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "inline-block rounded-full border transition-colors",
          "border-[color:var(--border)] hover:border-[color:var(--brand)]",
          sizeStyle[size],
        )}
        style={{
          backgroundColor: color,
          opacity: group === 0 ? 0.3 : 0.85,
        }}
      />
    </button>
  );
}
