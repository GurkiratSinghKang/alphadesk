import * as React from "react";

import { cn } from "@/lib/utils";
import PnLNumber from "@/components/primitives/PnLNumber";
import type { PositionRow, PositionTab } from "./types";

// Tab-aware empty-state copy. Kept in one place so future tabs stay
// consistent with the editorial voice used on the Strategy hero.
const EMPTY_COPY: Record<PositionTab, { title: string; hint: string }> = {
  positions: {
    title: "No open positions.",
    hint: "Stage an order below to open one.",
  },
  orders: {
    title: "No working orders.",
    hint: "Place an order from the ticket to see it here.",
  },
  journal: {
    title: "No journal entries yet.",
    hint: "Closed trades will appear here with rationale.",
  },
};

/**
 * PositionsList (composite)
 * ─────────────────────────
 * Right-rail "Book" pane: italic-serif title + Positions/Orders/Journal
 * tabs + count. Each row:
 *   · symbol + quantity@entry (micro mono)
 *   · italic-serif strategy name
 *   · horizontal progress bar (profit tone or loss tone)
 *   · mono P&L dollar + mono percent below
 *
 * Only the collapsed view — drilldown ships in a later phase.
 */
export interface PositionsListProps {
  positions: PositionRow[];
  activeTab: PositionTab;
  onTabChange?: (t: PositionTab) => void;
  onRowClick?: (id: string) => void;
  className?: string;
}

const TABS: PositionTab[] = ["positions", "orders", "journal"];

export default function PositionsList({
  positions,
  activeTab,
  onTabChange,
  onRowClick,
  className,
}: PositionsListProps) {
  const isEmpty = positions.length === 0;
  const empty = EMPTY_COPY[activeTab];

  return (
    <div
      data-slot="positions-list"
      className={cn("flex flex-col", className)}
    >
      <header className="flex justify-between items-baseline px-[18px] pt-3.5 pb-2.5 border-b border-border-hair">
        <span
          className="font-display italic text-[15px] text-ink-1000"
          style={{ letterSpacing: "-0.01em" }}
        >
          Book
        </span>
        <div
          role="tablist"
          aria-label="Book view"
          className="flex gap-0.5 ml-auto mr-2.5"
        >
          {TABS.map((t) => {
            const active = t === activeTab;
            return (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onTabChange?.(t)}
                className={cn(
                  "font-sans font-semibold text-[10px] uppercase px-2 py-[3px] rounded-xs transition-colors",
                  active
                    ? "text-ink-1000 bg-bg-elev-1"
                    : "text-fg-muted hover:text-fg"
                )}
                style={{ letterSpacing: "0.14em" }}
              >
                {t}
              </button>
            );
          })}
        </div>
        {isEmpty ? null : (
          <span className="font-mono text-[10px] text-fg-muted">
            {positions.length}
          </span>
        )}
      </header>

      {isEmpty ? (
        <div
          role="status"
          className="flex flex-col items-center justify-center gap-1.5 px-6 py-10 text-center"
        >
          <svg
            aria-hidden="true"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-fg-hint mb-1 opacity-60"
          >
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="M7 10h10M7 14h6" />
          </svg>
          <p
            className="font-display italic text-[14px] text-fg"
            style={{ letterSpacing: "-0.005em" }}
          >
            {empty.title}
          </p>
          <p className="font-sans text-[11px] text-fg-muted max-w-[220px]">
            {empty.hint}
          </p>
        </div>
      ) : (
      <ul role="list" className="flex flex-col">
        {positions.map((p) => {
          const isLoss = p.pnl < 0;
          const pct = Math.min(100, Math.max(0, Math.abs(p.progress) * 100));
          return (
            <li
              key={p.id}
              className="grid grid-cols-[60px_1fr_auto] gap-2.5 items-center px-[18px] py-2.5 border-b border-border-hair"
            >
              <button
                type="button"
                onClick={() => onRowClick?.(p.id)}
                className="text-left font-sans font-medium text-[12.5px] text-ink-1000 hover:text-brand"
                style={{ letterSpacing: "0.02em" }}
              >
                {p.symbol}
                <span className="block font-mono text-[9.5px] text-fg-hint mt-[1px]" style={{ letterSpacing: "0.02em" }}>
                  {p.quantity} @ {p.entryPrice.toFixed(2)}
                </span>
              </button>

              <div className="flex flex-col gap-[2px]">
                <span className="font-display italic text-[11.5px] text-fg-dim">
                  {p.strategyName}
                </span>
                <div
                  className={cn(
                    "h-[3px] bg-border rounded-xs overflow-hidden mt-1"
                  )}
                  aria-hidden
                >
                  <span
                    className={cn(
                      "block h-full",
                      isLoss ? "bg-down-500" : "bg-up-500"
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>

              <div className="text-right flex flex-col">
                <PnLNumber
                  value={p.pnl}
                  format="currency"
                  className="text-[13px] font-medium"
                />
                <PnLNumber
                  value={p.pnlPct}
                  format="percent"
                  className="text-[10px] font-normal mt-[1px]"
                  tone={isLoss ? "loss" : undefined}
                />
              </div>
            </li>
          );
        })}
      </ul>
      )}
    </div>
  );
}
