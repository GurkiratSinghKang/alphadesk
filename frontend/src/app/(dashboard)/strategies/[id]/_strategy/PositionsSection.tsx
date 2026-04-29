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
  // BUG-018 — when the API emits a full ISO timestamp (with `T`), surface
  // the HH:MM and short TZ abbreviation alongside the date so two positions
  // opened seconds apart don't render as a single homogenised "Apr 18, 2026"
  // row. Date-only strings keep the old compact format.
  const hasTime = iso.includes("T");
  if (!hasTime) {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
  }
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
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
    // 2026-04-21 polish: secondary copy lifted from 12px to 13px (the
    // fs-hint floor) so the empty-state hint is legible without looking
    // like a test-double placeholder.
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
        <p className="mt-2 font-sans text-[13px] text-fg-hint">
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
          {/* 2026-04-21 polish: column headers were 10.5px — below the
              post-redesign 12px fs-label floor. Normalised to the shared
              `.t-label` utility so every table header on the page reads
              with the same weight as the rest of the dashboard. */}
          <tr className="border-b border-border-hair text-left">
            <th scope="col" className="px-4 py-3 t-label text-left">
              Symbol
            </th>
            <th scope="col" className="px-4 py-3 t-label text-left">
              Side
            </th>
            <th scope="col" className="px-4 py-3 t-label text-right">
              Qty
            </th>
            <th scope="col" className="px-4 py-3 t-label text-right">
              Entry
            </th>
            <th scope="col" className="px-4 py-3 t-label text-right">
              P&amp;L
            </th>
            <th scope="col" className="px-4 py-3 t-label text-right">
              Exit Triggers
            </th>
            <th scope="col" className="px-4 py-3 t-label text-left">
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
                  {/* 2026-04-21 polish: symbol link now carries a
                      focus-visible ring — previously tab focus was invisible
                      and researchers couldn't tell where keyboard focus
                      landed. The date caption was also below the 11px floor
                      (10.5px); lifted to 12px via `t-meta`. */}
                  <Link
                    href={`/trade?symbol=${p.symbol}`}
                    className={cn(
                      "rounded-sm font-sans text-[14px] font-semibold text-fg transition-colors hover:text-brand",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                    )}
                  >
                    {p.symbol}
                  </Link>
                  <div className="mt-1 font-mono text-[12px] uppercase text-fg-hint tracking-normal">
                    {formatEntryDate(p.entry_date)}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={cn(
                      "inline-flex items-center rounded-sm border px-2 py-0.5 font-sans text-[12px] font-semibold uppercase",
                      side === "Long"
                        ? "border-profit/40 bg-profit/5 text-profit"
                        : "border-loss/40 bg-loss/5 text-loss"
                    )}
                    style={{ letterSpacing: 0 }}
                  >
                    {side}
                  </span>
                </td>
                {/* 2026-04-21 polish: qty / entry / P&L / exit rendered
                    ~12.5–13px; tightened to the `t-num-md` token (16px
                    mono tabular medium) recommended for row numbers so
                    digits column-align at the decimal point. Secondary
                    lines (P&L %, stop/take) use 12px for hierarchy. */}
                <td className="px-4 py-3 text-right">
                  <Mono className="text-[14px] text-fg tabular-nums">{Math.abs(p.shares)}</Mono>
                </td>
                <td className="px-4 py-3 text-right">
                  <Mono className="text-[14px] text-fg tabular-nums">
                    {p.entry_price.toFixed(2)}
                  </Mono>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex flex-col items-end gap-0.5">
                    <PnLNumber
                      value={p.unrealized_pnl}
                      format="currency"
                      className="text-[14px]"
                    />
                    <PnLNumber
                      value={p.unrealized_pnl_pct}
                      format="percent"
                      className="text-[12px]"
                    />
                  </div>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex flex-col items-end gap-0.5 font-mono text-[12px] tabular-nums">
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
