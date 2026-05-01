import * as React from "react";

import { cn } from "@/lib/utils";
import StatusDot from "@/components/primitives/StatusDot";
import PnLNumber from "@/components/primitives/PnLNumber";
import { usePreferencesStore } from "@/stores/preferences";
import type { StrategyRailItem } from "./types";

/**
 * StrategyRail (composite)
 * ────────────────────────
 * Left-rail strategy list with selection state. The selected row gets
 * a 2px gold left-border and elev-1 background.
 *
 * Two display modes (driven by `usePreferencesStore.display.compactStrategyView`):
 *
 *  - Roomy (default): name + index on row 1, italic-serif subtitle on row 2,
 *    StatusDot + status text + return% on row 3. py-3 vertical breathing.
 *
 *  - Compact (persona-8 #1): subtitle hidden, status dot + name + return%
 *    collapsed into a single line, py-1.5 padding. Trades scannability for
 *    density when a user is watching many strategies at once.
 */
export interface StrategyRailProps {
  items: StrategyRailItem[];
  selectedId?: string;
  onSelect?: (id: string) => void;
  /** Header count override. Defaults to "N / M" with active over total. */
  countLabel?: string;
  className?: string;
}

function defaultCount(items: StrategyRailItem[]): string {
  const active = items.filter((s) => s.status === "active").length;
  const total = items.length;
  const fmt = (n: number) => n.toString().padStart(2, "0");
  return `${fmt(active)} / ${fmt(total)}`;
}

export default function StrategyRail({
  items,
  selectedId,
  onSelect,
  countLabel,
  className,
}: StrategyRailProps) {
  const compact = usePreferencesStore((s) => s.display.compactStrategyView);

  return (
    <aside
      data-slot="strategy-rail"
      data-compact={compact || undefined}
      className={cn("flex flex-col py-3.5", className)}
    >
      <header className="flex justify-between items-baseline px-4 pt-1 pb-2.5">
        <span
          className="font-display italic text-[15px] text-ink-1000"
          style={{ letterSpacing: 0 }}
        >
          Strategies
        </span>
        <span className="font-mono text-[12px] text-fg-muted" style={{ letterSpacing: 0 }}>
          {countLabel ?? defaultCount(items)}
        </span>
      </header>

      <ul role="list" className="flex flex-col">
        {items.map((it) => {
          const selected = it.id === selectedId;
          const paused = it.status === "paused";
          return (
            <li key={it.id}>
              <button
                type="button"
                onClick={() => onSelect?.(it.id)}
                data-selected={selected || undefined}
                className={cn(
                  "w-full text-left px-4 border-l-2 border-l-transparent",
                  compact
                    ? "py-1.5 min-h-0"
                    : "py-3 md:py-3 min-h-[56px] md:min-h-0",
                  "transition-colors duration-100",
                  "hover:bg-bg-elev-1 active:bg-bg-elev-1",
                  selected && "bg-bg-elev-1 border-l-brand"
                )}
              >
                {compact ? (
                  // Single line: dot · name · return%
                  <div className="flex items-center justify-between gap-2 font-mono text-[12px] md:text-[12px] tabular-nums">
                    <span className="flex items-center gap-1.5 min-w-0">
                      <StatusDot
                        tone={paused ? "muted" : "profit"}
                        size={5}
                      />
                      <span
                        className={cn(
                          "font-sans font-medium text-[13px] truncate",
                          paused ? "text-fg-muted" : "text-fg"
                        )}
                        style={{ letterSpacing: 0 }}
                      >
                        {it.name}
                      </span>
                    </span>
                    {it.returnPct === null || paused ? (
                      <span className="text-fg-muted">—</span>
                    ) : (
                      <PnLNumber value={it.returnPct} format="percent" />
                    )}
                  </div>
                ) : (
                  <>
                    <div className="flex justify-between items-baseline mb-0.5">
                      <span
                        className="font-sans font-medium text-sm md:text-[13px] text-fg"
                        style={{ letterSpacing: 0 }}
                      >
                        {it.name}
                      </span>
                      <span className="font-mono text-[12px] md:text-[12px] text-fg-hint">
                        {it.indexLabel}
                      </span>
                    </div>

                    <div className="font-display italic text-[13px] md:text-[12px] text-fg-muted mb-1.5">
                      {it.subtitle}
                    </div>

                    <div className="flex justify-between items-center font-mono text-[12px] md:text-[12px] tabular-nums">
                      <span className="flex items-center gap-1.5">
                        <StatusDot
                          tone={paused ? "muted" : "profit"}
                          size={5}
                        />
                        <span className={cn(paused ? "text-fg-muted" : "text-fg")}>
                          {paused ? "Paused" : "Active"}
                        </span>
                      </span>
                      {it.returnPct === null || paused ? (
                        <span className="text-fg-muted">—</span>
                      ) : (
                        <PnLNumber value={it.returnPct} format="percent" />
                      )}
                    </div>
                  </>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
