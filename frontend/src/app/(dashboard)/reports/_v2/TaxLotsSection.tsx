"use client";

import * as React from "react";

import Section from "@/components/composites/Section";
import StatusBanner from "@/components/composites/StatusBanner";
import Stat from "@/components/primitives/Stat";
import { cn } from "@/lib/utils";

/**
 * v2 Reports · Tax/Lots section per v2-plan §1.9.
 *
 * Phase 1.9 demo. Backend B.13 (Lot model + WashSaleAdjustment
 * + 8949 export) wires the live data. v2 is equity-only, cash
 * account, exact-symbol-match for substantially-identical (per
 * D9-A locked decision); legal disclaimer banner is mandatory.
 */
interface LotRow {
  symbol: string;
  acquired: string;
  qty: number;
  costBasis: number;
  marketValue: number;
  unrealizedPnl: number;
  holdingPeriod: "short" | "long";
}

const OPEN_LOTS: LotRow[] = [
  { symbol: "NVDA", acquired: "2025-08-12", qty: 80,  costBasis: 11_240, marketValue: 11_616, unrealizedPnl:   376, holdingPeriod: "short" },
  { symbol: "MSFT", acquired: "2024-11-04", qty: 60,  costBasis: 24_840, marketValue: 25_950, unrealizedPnl: 1_110, holdingPeriod: "long"  },
  { symbol: "AAPL", acquired: "2025-02-18", qty: 100, costBasis: 21_280, marketValue: 22_418, unrealizedPnl: 1_138, holdingPeriod: "short" },
  { symbol: "MELI", acquired: "2024-05-22", qty:  6,  costBasis: 10_320, marketValue: 11_040, unrealizedPnl:   720, holdingPeriod: "long"  },
];

interface WashSaleRow {
  symbol: string;
  date: string;
  lossDisallowed: number;
  replacement: string;
  note: string;
}

const WASH_SALES: WashSaleRow[] = [
  {
    symbol: "TSLA",
    date: "2026-04-09",
    lossDisallowed: 412,
    replacement: "Re-bought 50sh on 2026-04-12 (3d window)",
    note: "Disallowed loss added to replacement lot's cost basis.",
  },
];

export default function TaxLotsSection() {
  const totalUnrealized = OPEN_LOTS.reduce((s, l) => s + l.unrealizedPnl, 0);
  const shortTermUnrealized = OPEN_LOTS.filter((l) => l.holdingPeriod === "short").reduce((s, l) => s + l.unrealizedPnl, 0);
  const longTermUnrealized = OPEN_LOTS.filter((l) => l.holdingPeriod === "long").reduce((s, l) => s + l.unrealizedPnl, 0);

  return (
    <Section
      eyebrow="REPORTS · TAX & LOTS"
      title="Tax / Lots"
      description="Lot-level cost-basis tracking with IRS Pub 550 30-day wash-sale rule (exact-symbol-match v2 scope)."
      right={
        <button
          type="button"
          disabled
          className="rounded-sm border border-brand/40 bg-tint-brand-1 text-brand px-2.5 py-1 text-eyebrow font-semibold uppercase tracking-[0.08em] opacity-60 cursor-not-allowed"
          title="Phase 1.9 follow-up + backend B.13 wires 8949 / TurboTax export"
        >
          Export 8949 →
        </button>
      }
    >
      <StatusBanner
        tone="warn"
        message="Reports are informational. AlphaDesk is NOT your CPA — confirm wash-sale + holding-period classification with your tax professional before filing."
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4">
        <Stat label="Open lots" value={OPEN_LOTS.length} size="md" />
        <Stat label="Total unrealized" value={`+$${totalUnrealized.toLocaleString()}`} tone="profit" size="md" />
        <Stat label="ST unrealized" value={`+$${shortTermUnrealized.toLocaleString()}`} sub="< 1 year" size="md" />
        <Stat label="LT unrealized" value={`+$${longTermUnrealized.toLocaleString()}`} sub="≥ 1 year" tone="brand" size="md" />
      </div>

      <h3 className="text-h3 font-medium text-fg mt-6 mb-3">Open lots</h3>
      <div className="rounded-md border border-border-hair bg-bg-elev-1 overflow-x-auto">
        <table className="w-full text-body-sm">
          <thead className="bg-bg-elev-2 text-eyebrow uppercase tracking-[0.08em] text-fg-muted">
            <tr>
              <th className="text-left px-3 py-2">Symbol</th>
              <th className="text-left px-3 py-2">Acquired</th>
              <th className="text-right px-3 py-2">Qty</th>
              <th className="text-right px-3 py-2">Cost basis</th>
              <th className="text-right px-3 py-2 hidden sm:table-cell">Market value</th>
              <th className="text-right px-3 py-2">Unrealized</th>
              <th className="text-left px-3 py-2 hidden md:table-cell">Holding</th>
            </tr>
          </thead>
          <tbody>
            {OPEN_LOTS.map((l, i) => (
              <tr key={`${l.symbol}-${i}`} className="border-t border-border-hair">
                <td className="px-3 py-2 text-fg font-medium">{l.symbol}</td>
                <td className="px-3 py-2 text-fg-muted t-mono">{l.acquired}</td>
                <td className="px-3 py-2 text-right t-mono text-fg-muted">{l.qty}</td>
                <td className="px-3 py-2 text-right t-mono text-fg">${l.costBasis.toLocaleString()}</td>
                <td className="px-3 py-2 text-right t-mono text-fg hidden sm:table-cell">${l.marketValue.toLocaleString()}</td>
                <td className={cn("px-3 py-2 text-right t-mono", l.unrealizedPnl > 0 ? "text-profit" : "text-loss")}>
                  {l.unrealizedPnl > 0 ? "+" : ""}${l.unrealizedPnl.toLocaleString()}
                </td>
                <td className="px-3 py-2 hidden md:table-cell">
                  <span className={cn(
                    "px-1.5 py-0.5 rounded-pill text-eyebrow uppercase tracking-[0.08em] font-semibold",
                    l.holdingPeriod === "long" ? "bg-tint-up-1 text-profit" : "bg-tint-info-1 text-ice",
                  )}>
                    {l.holdingPeriod === "long" ? "Long-term" : "Short-term"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="text-h3 font-medium text-fg mt-6 mb-3">Wash sales (last 365d)</h3>
      {WASH_SALES.length === 0 ? (
        <p className="text-body-sm text-fg-muted italic px-3 py-4 rounded-md border border-border-hair bg-bg-elev-1">
          No wash sales detected. Clean.
        </p>
      ) : (
        <div className="rounded-md border border-border-hair bg-bg-elev-1 overflow-x-auto">
          <table className="w-full text-body-sm">
            <thead className="bg-bg-elev-2 text-eyebrow uppercase tracking-[0.08em] text-fg-muted">
              <tr>
                <th className="text-left px-3 py-2">Symbol</th>
                <th className="text-left px-3 py-2">Date</th>
                <th className="text-right px-3 py-2">Disallowed loss</th>
                <th className="text-left px-3 py-2 hidden sm:table-cell">Replacement</th>
                <th className="text-left px-3 py-2 hidden md:table-cell">Note</th>
              </tr>
            </thead>
            <tbody>
              {WASH_SALES.map((w, i) => (
                <tr key={`${w.symbol}-${i}`} className="border-t border-border-hair">
                  <td className="px-3 py-2 text-fg font-medium">{w.symbol}</td>
                  <td className="px-3 py-2 text-fg-muted t-mono">{w.date}</td>
                  <td className="px-3 py-2 text-right t-mono text-loss">−${w.lossDisallowed.toLocaleString()}</td>
                  <td className="px-3 py-2 text-fg-muted hidden sm:table-cell">{w.replacement}</td>
                  <td className="px-3 py-2 text-fg-muted italic hidden md:table-cell">{w.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
