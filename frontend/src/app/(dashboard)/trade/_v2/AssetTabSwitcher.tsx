"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * AssetTabSwitcher — v2 Phase 1.2 Trade chrome per v2-plan §1.2.
 *
 * Three asset tabs (Stocks · Options · Builder) that switch the v2
 * trade context. The state is purely presentational in Phase 1.2 —
 * the existing trade page surfaces (option chain, payoff diagram,
 * options builder) remain mounted; the tab acts as a quick scroll
 * anchor + visual category indicator.
 *
 * Phase 1.2 follow-up wires the asset tab to actually swap the
 * left rail content (L2 ladder vs option chain) atomically per the
 * v2 design. For now the tab provides the v2 voice and a route to
 * the existing relevant page sections.
 */
export type AssetTab = "stocks" | "options" | "builder";

export interface AssetTabSwitcherProps {
  active: AssetTab;
  onChange: (next: AssetTab) => void;
  className?: string;
}

const TABS: { id: AssetTab; label: string; caption: string; anchor?: string }[] = [
  { id: "stocks", label: "Stocks", caption: "L2 ladder · time & sales", anchor: "trade-quote" },
  { id: "options", label: "Options", caption: "Chain · greeks · payoff", anchor: "options-section" },
  { id: "builder", label: "Builder", caption: "Strategy templates · presets", anchor: "options-builder" },
];

export default function AssetTabSwitcher({ active, onChange, className }: AssetTabSwitcherProps) {
  return (
    <nav
      aria-label="Asset class"
      role="tablist"
      className={cn(
        "inline-flex rounded-md border border-border-hair bg-bg-elev-1 p-0.5 gap-0.5",
        className,
      )}
    >
      {TABS.map((t) => {
        const isActive = t.id === active;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => {
              onChange(t.id);
              if (typeof window !== "undefined" && t.anchor) {
                const el = document.getElementById(t.anchor);
                if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
              }
            }}
            className={cn(
              "inline-flex flex-col items-start gap-0 px-3 py-1.5 rounded-sm transition-colors min-w-[110px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
              isActive
                ? "bg-bg-elev-2 text-fg shadow-hair"
                : "text-fg-muted hover:text-fg",
            )}
          >
            <span className="text-body-sm font-semibold">{t.label}</span>
            <span className="text-eyebrow uppercase tracking-[0.08em] text-fg-hint truncate">
              {t.caption}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
