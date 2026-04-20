"use client";

import * as React from "react";
import Link from "next/link";

import Mono from "@/components/typography/Mono";
import PnLNumber from "@/components/primitives/PnLNumber";
import { cn } from "@/lib/utils";
import type { StrategyPositionDetail } from "@/lib/api";

export interface PositionsSectionProps {
  positions: StrategyPositionDetail[];
  strategyLabel: string;
  className?: string;
}

function formatEntryDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
}

/**
 * PositionsSection
 * ────────────────
 * Editorial table of positions open for a given strategy. Matches the
 * column set called out in F4 (Symbol / Side / Qty / Entry / P&L /
 * Exit Triggers / Strategy) with empty-state copy in italic serif.
 */
export default function PositionsSection({
  positions,
  strategyLabel,
  className,
}: PositionsSectionProps) {
  if (!positions || positions.length === 0) {
    return (
      <div
        className={cn(
          "rounded-lg border border-border bg-bg-elev-1 px-5 py-10 text-center",
          className
        )}
      >
        <p className="font-display italic text-[17px] text-fg-muted">
          No positions open.
        </p>
        <p className="mt-2 font-sans text-[12px] text-fg-hint">
          Positions will appear here when the strategy next enters a trade.
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-border bg-bg-elev-1",
        className
      )}
    >
      <table className="w-full table-fixed border-collapse">
        {/* Persona 71-5 — visually-hidden caption gives screen readers a
            recognisable table title so AT navigation ("read tables" / "go
            to next table") announces the section. `sr-only` keeps the
            text out of the sighted layout. */}
        <caption className="sr-only">
          Open positions for {strategyLabel}
        </caption>
        <thead>
          <tr className="border-b border-border-hair text-left">
            <th scope="col" className="px-4 py-2.5 font-sans text-[10.5px] font-semibold uppercase text-fg-muted" style={{ letterSpacing: "0.14em" }}>
              Symbol
            </th>
            <th scope="col" className="px-4 py-2.5 font-sans text-[10.5px] font-semibold uppercase text-fg-muted" style={{ letterSpacing: "0.14em" }}>
              Side
            </th>
            <th scope="col" className="px-4 py-2.5 text-right font-sans text-[10.5px] font-semibold uppercase text-fg-muted" style={{ letterSpacing: "0.14em" }}>
              Qty
            </th>
            <th scope="col" className="px-4 py-2.5 text-right font-sans text-[10.5px] font-semibold uppercase text-fg-muted" style={{ letterSpacing: "0.14em" }}>
              Entry
            </th>
            <th scope="col" className="px-4 py-2.5 text-right font-sans text-[10.5px] font-semibold uppercase text-fg-muted" style={{ letterSpacing: "0.14em" }}>
              P&amp;L
            </th>
            <th scope="col" className="px-4 py-2.5 text-right font-sans text-[10.5px] font-semibold uppercase text-fg-muted" style={{ letterSpacing: "0.14em" }}>
              Exit Triggers
            </th>
            <th scope="col" className="px-4 py-2.5 font-sans text-[10.5px] font-semibold uppercase text-fg-muted" style={{ letterSpacing: "0.14em" }}>
              Strategy
            </th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => {
            const side = p.shares >= 0 ? "Long" : "Short";
            return (
              <tr key={p.symbol} className="border-b border-border-hair last:border-0">
                <td className="px-4 py-3">
                  <Link
                    href={`/trade?symbol=${p.symbol}`}
                    className="font-sans text-[13px] font-semibold text-fg transition-colors hover:text-brand"
                  >
                    {p.symbol}
                  </Link>
                  <div className="mt-0.5 font-sans text-[10.5px] uppercase text-fg-hint" style={{ letterSpacing: "0.1em" }}>
                    {formatEntryDate(p.entry_date)}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={cn(
                      "inline-flex items-center rounded-sm border px-2 py-0.5 font-sans text-[11px] font-semibold uppercase",
                      side === "Long"
                        ? "border-profit/40 bg-profit/5 text-profit"
                        : "border-loss/40 bg-loss/5 text-loss"
                    )}
                    style={{ letterSpacing: "0.06em" }}
                  >
                    {side}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <Mono className="text-[12.5px] text-fg">{Math.abs(p.shares)}</Mono>
                </td>
                <td className="px-4 py-3 text-right">
                  <Mono className="text-[12.5px] text-fg">
                    {p.entry_price.toFixed(2)}
                  </Mono>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex flex-col items-end gap-0.5">
                    <PnLNumber
                      value={p.unrealized_pnl}
                      format="currency"
                      className="text-[13px]"
                    />
                    <PnLNumber
                      value={p.unrealized_pnl_pct}
                      format="percent"
                      className="text-[11px]"
                    />
                  </div>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex flex-col items-end gap-0.5 font-mono text-[11px]">
                    <span className="text-loss">
                      Stop {p.stop_loss != null ? p.stop_loss.toFixed(2) : "\u2014"}
                    </span>
                    <span className="text-profit">
                      Take {p.take_profit != null ? p.take_profit.toFixed(2) : "\u2014"}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className="font-display italic text-[13px] text-fg-muted">
                    {strategyLabel}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
