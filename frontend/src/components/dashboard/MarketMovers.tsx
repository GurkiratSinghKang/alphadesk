"use client";

import { useState, useMemo } from "react";
import { TrendingUp, TrendingDown, BarChart3 } from "lucide-react";
import { useQuotes } from "@/stores/market";
import { formatCurrency, formatNumber, cn } from "@/lib/utils";
import type { Quote } from "@/types";

// ─── Types ──────────────────────────────────────────────────

type Tab = "gainers" | "losers" | "active";

interface MoverRow {
  symbol: string;
  name: string;
  price: number;
  changePct: number;
  volume: number;
}

// ─── Symbol Names ───────────────────────────────────────────

const SYMBOL_NAMES: Record<string, string> = {
  AAPL: "Apple Inc.",
  MSFT: "Microsoft Corp.",
  GOOGL: "Alphabet Inc.",
  AMZN: "Amazon.com Inc.",
  NVDA: "NVIDIA Corp.",
  TSLA: "Tesla Inc.",
  META: "Meta Platforms",
  AMD: "Advanced Micro",
  SPY: "S&P 500 ETF",
  QQQ: "Invesco QQQ",
  NFLX: "Netflix Inc.",
  ORCL: "Oracle Corp.",
  CRM: "Salesforce Inc.",
  ADBE: "Adobe Inc.",
  INTC: "Intel Corp.",
  CSCO: "Cisco Systems",
  AVGO: "Broadcom Inc.",
  TXN: "Texas Instruments",
  QCOM: "Qualcomm Inc.",
  AMAT: "Applied Materials",
  MU: "Micron Technology",
  SNPS: "Synopsys Inc.",
  KLAC: "KLA Corp.",
  LRCX: "Lam Research",
  MRVL: "Marvell Tech",
  BA: "Boeing Co.",
  JPM: "JPMorgan Chase",
  V: "Visa Inc.",
  JNJ: "Johnson & Johnson",
  UNH: "UnitedHealth Grp.",
};

const TOP_SYMBOLS = Object.keys(SYMBOL_NAMES);

// ─── Market Movers Widget ───────────────────────────────────

interface MarketMoversProps {
  onSelectSymbol?: (symbol: string) => void;
}

export function MarketMovers({ onSelectSymbol }: MarketMoversProps) {
  const [activeTab, setActiveTab] = useState<Tab>("gainers");
  // Wave 14 perf-audit-r3 P0 #3: was `useMarketStore((s) => s.quotes)`; scope
  // to just the curated TOP_SYMBOLS list so unrelated ticks don't rerender.
  const quotes = useQuotes(TOP_SYMBOLS);

  // Build mover rows from available quotes
  const movers: MoverRow[] = useMemo(() => {
    const rows: MoverRow[] = [];
    for (const sym of TOP_SYMBOLS) {
      const q: Quote | undefined = quotes[sym];
      if (!q || !q.last) continue;
      rows.push({
        symbol: q.symbol,
        name: SYMBOL_NAMES[q.symbol] ?? q.symbol,
        price: q.last,
        changePct: q.changePct ?? 0,
        volume: q.volume ?? 0,
      });
    }
    return rows;
  }, [quotes]);

  // Sort by category
  const sorted = useMemo(() => {
    const copy = [...movers];
    switch (activeTab) {
      case "gainers":
        return copy.sort((a, b) => b.changePct - a.changePct).slice(0, 10);
      case "losers":
        return copy.sort((a, b) => a.changePct - b.changePct).slice(0, 10);
      case "active":
        return copy.sort((a, b) => b.volume - a.volume).slice(0, 10);
    }
  }, [movers, activeTab]);

  const tabs: { id: Tab; label: string; icon: typeof TrendingUp }[] = [
    { id: "gainers", label: "Gainers", icon: TrendingUp },
    { id: "losers", label: "Losers", icon: TrendingDown },
    { id: "active", label: "Most Active", icon: BarChart3 },
  ];

  return (
    <div className="rounded-xl border border-border bg-[var(--panel)]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">
            Market Movers
          </h2>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-4 pt-3 mb-3">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-1 rounded-md px-2.5 py-1 text-label font-medium transition-colors",
                activeTab === tab.id
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/30"
              )}
            >
              <Icon className="h-3 w-3" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Table */}
      {sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-6 px-4">
          <BarChart3 className="h-5 w-5 mb-2 text-muted-foreground opacity-30" />
          <p className="text-label text-muted-foreground">
            Market data loading...
          </p>
        </div>
      ) : (
        <div className="space-y-0.5 px-4 pb-3">
          {/* Column headers */}
          <div className="flex items-center text-label uppercase tracking-wider text-muted-foreground px-2 py-1">
            <span className="flex-1">Symbol</span>
            <span className="w-20 text-right">Price</span>
            <span className="w-16 text-right">Change</span>
            <span className="w-16 text-right">Volume</span>
          </div>

          {sorted.map((row) => {
            const positive = row.changePct >= 0;
            return (
              <div
                key={row.symbol}
                role="button"
                tabIndex={0}
                onClick={() => onSelectSymbol?.(row.symbol)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectSymbol?.(row.symbol);
                  }
                }}
                className="flex items-center text-label px-2 py-1.5 rounded-md hover:bg-accent/30 transition-colors cursor-pointer group"
              >
                {/* Symbol + name */}
                <div className="flex-1 min-w-0">
                  <span className="font-semibold text-foreground group-hover:text-primary transition-colors">
                    {row.symbol}
                  </span>
                  <span className="ml-1.5 text-label text-muted-foreground truncate">
                    {row.name}
                  </span>
                </div>

                {/* Price */}
                <span className="w-20 text-right tabular-nums text-foreground">
                  {formatCurrency(row.price)}
                </span>

                {/* Change % */}
                <span
                  className={cn(
                    "w-16 text-right tabular-nums font-medium text-label",
                    positive ? "text-[var(--profit)]" : "text-[var(--loss)]"
                  )}
                >
                  {positive ? "+" : ""}
                  {(row.changePct ?? 0).toFixed(2)}%
                </span>

                {/* Volume */}
                <span className="w-16 text-right tabular-nums text-muted-foreground text-label">
                  {formatNumber(row.volume, true)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
