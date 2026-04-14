"use client";

import { useState, useEffect, useMemo } from "react";
import { ArrowLeft, Download, FileText, BarChart3, Calculator, Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import {
  getPortfolioSummary,
  getPositions,
  getTradeHistory,
  getStrategies,
  type TradeHistoryEntry,
} from "@/lib/api";
import type { Position, PortfolioSummary } from "@/types";
import { cn, formatCurrency } from "@/lib/utils";

// ─── CSV Helpers ───────────────────────────────────────────

function downloadCsv(filename: string, csvContent: string) {
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function escapeCsv(val: unknown): string {
  const str = String(val ?? "");
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function arrayToCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [headers.map(escapeCsv).join(",")];
  for (const row of rows) {
    lines.push(row.map(escapeCsv).join(","));
  }
  return lines.join("\n");
}

// ─── Section Card ──────────────────────────────────────────

function SectionCard({
  title,
  icon: Icon,
  children,
  defaultOpen = true,
}: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-border bg-[var(--panel)] overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 border-b border-border px-4 py-3 hover:bg-accent/30 transition-colors"
      >
        <Icon className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-foreground flex-1 text-left">{title}</h2>
        {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
      </button>
      {open && <div className="p-4">{children}</div>}
    </div>
  );
}

// ─── Portfolio Statement ───────────────────────────────────

function PortfolioStatement({
  summary,
  positions,
  trades,
}: {
  summary: PortfolioSummary;
  positions: Position[];
  trades: TradeHistoryEntry[];
}) {
  const closedTrades = trades.filter(t => t.exit_price !== null && t.pnl !== null);
  const totalRealizedPnl = closedTrades.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const totalUnrealizedPnl = positions.reduce((s, p) => s + p.unrealizedPnl, 0);
  const totalPnl = totalRealizedPnl + totalUnrealizedPnl;

  const handleDownload = () => {
    // Account summary section
    let csv = "PORTFOLIO STATEMENT\n";
    csv += `Generated,${new Date().toISOString()}\n\n`;
    csv += "ACCOUNT SUMMARY\n";
    csv += `Equity,${(summary.equity ?? 0).toFixed(2)}\n`;
    csv += `Cash,${(summary.cash ?? 0).toFixed(2)}\n`;
    csv += `Buying Power,${(summary.buyingPower ?? 0).toFixed(2)}\n`;
    csv += `Positions Count,${summary.positionsCount}\n`;
    csv += `Total Unrealized P&L,${(totalUnrealizedPnl ?? 0).toFixed(2)}\n`;
    csv += `Total Realized P&L,${(totalRealizedPnl ?? 0).toFixed(2)}\n`;
    csv += `Total P&L,${(totalPnl ?? 0).toFixed(2)}\n\n`;

    // Current positions
    csv += "CURRENT POSITIONS\n";
    csv += arrayToCsv(
      ["Symbol", "Quantity", "Avg Cost", "Current Price", "Market Value", "Unrealized P&L", "P&L %"],
      positions.map(p => [
        p.symbol,
        p.quantity,
        (p.avgCost ?? 0).toFixed(2),
        (p.currentPrice ?? 0).toFixed(2),
        (p.marketValue ?? 0).toFixed(2),
        (p.unrealizedPnl ?? 0).toFixed(2),
        p.avgCost > 0 ? ((p.currentPrice - p.avgCost) / p.avgCost * 100).toFixed(2) + "%" : "0%",
      ])
    );
    csv += "\n\n";

    // Closed trades
    csv += "CLOSED TRADES\n";
    csv += arrayToCsv(
      ["Symbol", "Side", "Quantity", "Entry Price", "Exit Price", "P&L", "P&L %", "Entry Time", "Exit Time", "Strategy"],
      closedTrades.map(t => [
        t.symbol,
        t.side,
        t.quantity,
        (t.entry_price ?? 0).toFixed(2),
        (t.exit_price ?? 0).toFixed(2),
        (t.pnl ?? 0).toFixed(2),
        t.pnl_pct ? `${(t.pnl_pct ?? 0).toFixed(2)}%` : "N/A",
        t.entry_time,
        t.exit_time ?? "",
        t.strategy ?? "",
      ])
    );

    downloadCsv(`portfolio-statement-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  };

  return (
    <div className="space-y-4">
      {/* Account Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-lg border border-border bg-[var(--panel)] p-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Equity</p>
          <p className="text-sm font-bold tabular-nums text-foreground">{formatCurrency(summary.equity)}</p>
        </div>
        <div className="rounded-lg border border-border bg-[var(--panel)] p-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Cash</p>
          <p className="text-sm font-bold tabular-nums text-foreground">{formatCurrency(summary.cash)}</p>
        </div>
        <div className="rounded-lg border border-border bg-[var(--panel)] p-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Buying Power</p>
          <p className="text-sm font-bold tabular-nums text-foreground">{formatCurrency(summary.buyingPower)}</p>
        </div>
        <div className="rounded-lg border border-border bg-[var(--panel)] p-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Positions</p>
          <p className="text-sm font-bold tabular-nums text-foreground">{summary.positionsCount}</p>
        </div>
      </div>

      {/* P&L Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-border bg-[var(--panel)] p-3 text-center">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Unrealized P&L</p>
          <p className={cn("text-sm font-bold tabular-nums", totalUnrealizedPnl >= 0 ? "text-[var(--profit)]" : "text-[var(--loss)]")}>
            {totalUnrealizedPnl >= 0 ? "+" : ""}{formatCurrency(totalUnrealizedPnl)}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-[var(--panel)] p-3 text-center">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Realized P&L</p>
          <p className={cn("text-sm font-bold tabular-nums", totalRealizedPnl >= 0 ? "text-[var(--profit)]" : "text-[var(--loss)]")}>
            {totalRealizedPnl >= 0 ? "+" : ""}{formatCurrency(totalRealizedPnl)}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-[var(--panel)] p-3 text-center">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Total P&L</p>
          <p className={cn("text-sm font-bold tabular-nums", totalPnl >= 0 ? "text-[var(--profit)]" : "text-[var(--loss)]")}>
            {totalPnl >= 0 ? "+" : ""}{formatCurrency(totalPnl)}
          </p>
        </div>
      </div>

      {/* Current Positions Table */}
      {positions.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Current Positions</p>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-[var(--panel)] border-b border-border">
                  <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Symbol</th>
                  <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Qty</th>
                  <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Avg Cost</th>
                  <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Price</th>
                  <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Mkt Value</th>
                  <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">P&L</th>
                </tr>
              </thead>
              <tbody>
                {positions.map(p => (
                  <tr key={p.symbol} className="border-b border-border/50 last:border-0">
                    <td className="px-3 py-2 font-medium text-foreground">{p.symbol}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground">{p.quantity}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{formatCurrency(p.avgCost)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground">{formatCurrency(p.currentPrice)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground">{formatCurrency(p.marketValue)}</td>
                    <td className={cn("px-3 py-2 text-right tabular-nums font-medium", p.unrealizedPnl >= 0 ? "text-[var(--profit)]" : "text-[var(--loss)]")}>
                      {p.unrealizedPnl >= 0 ? "+" : ""}{formatCurrency(p.unrealizedPnl)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recent Closed Trades */}
      {closedTrades.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
            Closed Trades ({closedTrades.length} total)
          </p>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-[var(--panel)] border-b border-border">
                  <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Symbol</th>
                  <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Side</th>
                  <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Qty</th>
                  <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Entry</th>
                  <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Exit</th>
                  <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">P&L</th>
                </tr>
              </thead>
              <tbody>
                {closedTrades.slice(0, 50).map(t => (
                  <tr key={t.id} className="border-b border-border/50 last:border-0">
                    <td className="px-3 py-2 font-medium text-foreground">{t.symbol}</td>
                    <td className="px-3 py-2 text-foreground capitalize">{t.side}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground">{t.quantity}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{formatCurrency(t.entry_price)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground">{formatCurrency(t.exit_price ?? 0)}</td>
                    <td className={cn("px-3 py-2 text-right tabular-nums font-medium", (t.pnl ?? 0) >= 0 ? "text-[var(--profit)]" : "text-[var(--loss)]")}>
                      {(t.pnl ?? 0) >= 0 ? "+" : ""}{formatCurrency(t.pnl ?? 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Button onClick={handleDownload} size="sm" className="gap-1.5">
        <Download className="h-3 w-3" />
        Download Portfolio Statement (CSV)
      </Button>
    </div>
  );
}

// ─── Strategy Performance Report ──────────────────────────

interface StrategyInfo {
  id: string;
  name: string;
  status: string;
  total_return_pct: number;
  win_rate: number;
  active_positions_count: number;
  invested_amount: number;
}

function StrategyPerformanceReport({
  strategies,
  trades,
}: {
  strategies: StrategyInfo[];
  trades: TradeHistoryEntry[];
}) {
  // Group trades by strategy
  const tradesByStrategy = useMemo(() => {
    const map = new Map<string, TradeHistoryEntry[]>();
    for (const t of trades) {
      const key = t.strategy ?? "unknown";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return map;
  }, [trades]);

  const strategyRows = strategies.map(s => {
    const stratTrades = tradesByStrategy.get(s.id) ?? [];
    const closed = stratTrades.filter(t => t.exit_price !== null);
    const winningTrades = closed.filter(t => (t.pnl ?? 0) > 0);
    const tradeCount = closed.length;
    const winRate = tradeCount > 0 ? (winningTrades.length / tradeCount) * 100 : s.win_rate;

    // Compute simple max drawdown from trade P&L sequence
    let cumPnl = 0, peak = 0, maxDd = 0;
    for (const t of closed) {
      cumPnl += t.pnl ?? 0;
      if (cumPnl > peak) peak = cumPnl;
      const dd = peak > 0 ? (peak - cumPnl) / peak * 100 : 0;
      if (dd > maxDd) maxDd = dd;
    }

    // Compute simple Sharpe
    const returns = closed.map(t => t.pnl_pct ?? 0);
    const meanRet = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
    const stdRet = returns.length > 1 ? Math.sqrt(returns.reduce((s, r) => s + (r - meanRet) ** 2, 0) / (returns.length - 1)) : 1;
    const sharpe = stdRet > 0 ? (meanRet / stdRet) * Math.sqrt(252 / Math.max(returns.length, 1)) : 0;

    return { ...s, tradeCount, winRate, maxDd, sharpe };
  });

  const handleDownload = () => {
    const csv = arrayToCsv(
      ["Strategy", "Status", "Return %", "Sharpe", "Max Drawdown %", "Trades", "Win Rate %", "Invested"],
      strategyRows.map(s => [
        s.name,
        s.status,
        (s.total_return_pct ?? 0).toFixed(2),
        (s.sharpe ?? 0).toFixed(2),
        (s.maxDd ?? 0).toFixed(2),
        s.tradeCount,
        (s.winRate ?? 0).toFixed(1),
        (s.invested_amount ?? 0).toFixed(2),
      ])
    );
    downloadCsv(`strategy-performance-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  };

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-[var(--panel)] border-b border-border">
              <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Strategy</th>
              <th className="px-3 py-2 text-center text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Status</th>
              <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Return</th>
              <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Sharpe</th>
              <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Max DD</th>
              <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Trades</th>
              <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Win Rate</th>
            </tr>
          </thead>
          <tbody>
            {strategyRows.map(s => (
              <tr key={s.id} className="border-b border-border/50 last:border-0">
                <td className="px-3 py-2 font-medium text-foreground">{s.name}</td>
                <td className="px-3 py-2 text-center">
                  <span className={cn(
                    "inline-block rounded px-1.5 py-0.5 text-[10px] font-medium",
                    s.status === "active" ? "bg-[var(--profit)]/15 text-[var(--profit)]" : "bg-muted text-muted-foreground"
                  )}>
                    {s.status}
                  </span>
                </td>
                <td className={cn("px-3 py-2 text-right tabular-nums font-medium", s.total_return_pct >= 0 ? "text-[var(--profit)]" : "text-[var(--loss)]")}>
                  {(s.total_return_pct ?? 0) >= 0 ? "+" : ""}{(s.total_return_pct ?? 0).toFixed(1)}%
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-foreground">{(s.sharpe ?? 0).toFixed(2)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-[var(--loss)]">-{(s.maxDd ?? 0).toFixed(1)}%</td>
                <td className="px-3 py-2 text-right tabular-nums text-foreground">{s.tradeCount}</td>
                <td className="px-3 py-2 text-right tabular-nums text-foreground">{(s.winRate ?? 0).toFixed(0)}%</td>
              </tr>
            ))}
            {strategyRows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                  No strategies found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Button onClick={handleDownload} size="sm" className="gap-1.5">
        <Download className="h-3 w-3" />
        Download Strategy Report (CSV)
      </Button>
    </div>
  );
}

// ─── Tax Report ────────────────────────────────────────────

function TaxReport({ trades, taxYear }: { trades: TradeHistoryEntry[]; taxYear: number }) {
  const taxTrades = useMemo(() => {
    return trades.filter(t => {
      if (!t.exit_time || t.pnl === null) return false;
      const exitYear = new Date(t.exit_time).getFullYear();
      return exitYear === taxYear;
    });
  }, [trades, taxYear]);

  const classified = useMemo(() => {
    return taxTrades.map(t => {
      const entryDate = new Date(t.entry_time);
      const exitDate = new Date(t.exit_time!);
      const holdingDays = Math.floor((exitDate.getTime() - entryDate.getTime()) / (1000 * 60 * 60 * 24));
      const isLongTerm = holdingDays > 365;
      return { ...t, holdingDays, isLongTerm, classification: isLongTerm ? "Long-Term" : "Short-Term" };
    });
  }, [taxTrades]);

  const shortTermTrades = classified.filter(t => !t.isLongTerm);
  const longTermTrades = classified.filter(t => t.isLongTerm);

  const shortTermGains = shortTermTrades.filter(t => (t.pnl ?? 0) > 0).reduce((s, t) => s + (t.pnl ?? 0), 0);
  const shortTermLosses = shortTermTrades.filter(t => (t.pnl ?? 0) <= 0).reduce((s, t) => s + (t.pnl ?? 0), 0);
  const longTermGains = longTermTrades.filter(t => (t.pnl ?? 0) > 0).reduce((s, t) => s + (t.pnl ?? 0), 0);
  const longTermLosses = longTermTrades.filter(t => (t.pnl ?? 0) <= 0).reduce((s, t) => s + (t.pnl ?? 0), 0);
  const totalRealized = classified.reduce((s, t) => s + (t.pnl ?? 0), 0);

  const handleDownload = () => {
    let csv = `TAX REPORT - ${taxYear}\n`;
    csv += `Generated,${new Date().toISOString()}\n\n`;
    csv += "SUMMARY\n";
    csv += `Short-Term Gains,${(shortTermGains ?? 0).toFixed(2)}\n`;
    csv += `Short-Term Losses,${(shortTermLosses ?? 0).toFixed(2)}\n`;
    csv += `Short-Term Net,${(shortTermGains + shortTermLosses).toFixed(2)}\n`;
    csv += `Long-Term Gains,${(longTermGains ?? 0).toFixed(2)}\n`;
    csv += `Long-Term Losses,${(longTermLosses ?? 0).toFixed(2)}\n`;
    csv += `Long-Term Net,${(longTermGains + longTermLosses).toFixed(2)}\n`;
    csv += `Total Realized,${(totalRealized ?? 0).toFixed(2)}\n\n`;
    csv += "ALL REALIZED TRADES\n";
    csv += arrayToCsv(
      ["Symbol", "Side", "Quantity", "Entry Price", "Exit Price", "P&L", "Entry Date", "Exit Date", "Holding Days", "Classification", "Strategy"],
      classified.map(t => [
        t.symbol,
        t.side,
        t.quantity,
        (t.entry_price ?? 0).toFixed(2),
        (t.exit_price ?? 0).toFixed(2),
        (t.pnl ?? 0).toFixed(2),
        t.entry_time,
        t.exit_time ?? "",
        t.holdingDays,
        t.classification,
        t.strategy ?? "",
      ])
    );
    downloadCsv(`tax-report-${taxYear}.csv`, csv);
  };

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="rounded-lg border border-border bg-[var(--panel)] p-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Short-Term Net</p>
          <p className={cn("text-sm font-bold tabular-nums", (shortTermGains + shortTermLosses) >= 0 ? "text-[var(--profit)]" : "text-[var(--loss)]")}>
            {formatCurrency(shortTermGains + shortTermLosses)}
          </p>
          <p className="text-[10px] text-muted-foreground">{shortTermTrades.length} trades</p>
        </div>
        <div className="rounded-lg border border-border bg-[var(--panel)] p-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Long-Term Net</p>
          <p className={cn("text-sm font-bold tabular-nums", (longTermGains + longTermLosses) >= 0 ? "text-[var(--profit)]" : "text-[var(--loss)]")}>
            {formatCurrency(longTermGains + longTermLosses)}
          </p>
          <p className="text-[10px] text-muted-foreground">{longTermTrades.length} trades</p>
        </div>
        <div className="rounded-lg border border-border bg-[var(--panel)] p-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Total Realized</p>
          <p className={cn("text-sm font-bold tabular-nums", totalRealized >= 0 ? "text-[var(--profit)]" : "text-[var(--loss)]")}>
            {formatCurrency(totalRealized)}
          </p>
          <p className="text-[10px] text-muted-foreground">{classified.length} trades in {taxYear}</p>
        </div>
      </div>

      {/* Breakdown tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Short-term */}
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
            Short-Term (held &le; 365 days)
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded border border-border bg-[var(--panel)] p-2 text-center">
              <p className="text-[9px] text-muted-foreground uppercase">Gains</p>
              <p className="text-xs font-bold tabular-nums text-[var(--profit)]">+{formatCurrency(shortTermGains)}</p>
            </div>
            <div className="rounded border border-border bg-[var(--panel)] p-2 text-center">
              <p className="text-[9px] text-muted-foreground uppercase">Losses</p>
              <p className="text-xs font-bold tabular-nums text-[var(--loss)]">{formatCurrency(shortTermLosses)}</p>
            </div>
          </div>
        </div>

        {/* Long-term */}
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
            Long-Term (held &gt; 365 days)
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded border border-border bg-[var(--panel)] p-2 text-center">
              <p className="text-[9px] text-muted-foreground uppercase">Gains</p>
              <p className="text-xs font-bold tabular-nums text-[var(--profit)]">+{formatCurrency(longTermGains)}</p>
            </div>
            <div className="rounded border border-border bg-[var(--panel)] p-2 text-center">
              <p className="text-[9px] text-muted-foreground uppercase">Losses</p>
              <p className="text-xs font-bold tabular-nums text-[var(--loss)]">{formatCurrency(longTermLosses)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Trade list preview */}
      {classified.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[var(--panel)] border-b border-border">
                <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Symbol</th>
                <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Type</th>
                <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">P&L</th>
                <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Days Held</th>
                <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Exit Date</th>
              </tr>
            </thead>
            <tbody>
              {classified.slice(0, 30).map(t => (
                <tr key={t.id} className="border-b border-border/50 last:border-0">
                  <td className="px-3 py-2 font-medium text-foreground">{t.symbol}</td>
                  <td className="px-3 py-2">
                    <span className={cn(
                      "inline-block rounded px-1.5 py-0.5 text-[10px] font-medium",
                      t.isLongTerm ? "bg-primary/15 text-primary" : "bg-muted text-foreground"
                    )}>
                      {t.classification}
                    </span>
                  </td>
                  <td className={cn("px-3 py-2 text-right tabular-nums font-medium", (t.pnl ?? 0) >= 0 ? "text-[var(--profit)]" : "text-[var(--loss)]")}>
                    {(t.pnl ?? 0) >= 0 ? "+" : ""}{formatCurrency(t.pnl ?? 0)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{t.holdingDays}d</td>
                  <td className="px-3 py-2 text-muted-foreground">{t.exit_time ? new Date(t.exit_time).toLocaleDateString() : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {classified.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-6">No realized trades found for {taxYear}.</p>
      )}

      <Button onClick={handleDownload} size="sm" className="gap-1.5">
        <Download className="h-3 w-3" />
        Download Tax Report (CSV)
      </Button>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────

export default function ReportsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [trades, setTrades] = useState<TradeHistoryEntry[]>([]);
  const [strategies, setStrategies] = useState<StrategyInfo[]>([]);
  const [taxYear, setTaxYear] = useState(new Date().getFullYear());

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [summaryRes, positionsRes, tradesRes, strategiesRes] = await Promise.allSettled([
          getPortfolioSummary(),
          getPositions(),
          getTradeHistory(5000),
          getStrategies(),
        ]);
        if (cancelled) return;
        if (summaryRes.status === "fulfilled") setSummary(summaryRes.value);
        if (positionsRes.status === "fulfilled") setPositions(positionsRes.value);
        if (tradesRes.status === "fulfilled") setTrades(tradesRes.value);
        if (strategiesRes.status === "fulfilled") setStrategies(strategiesRes.value as StrategyInfo[]);
      } catch {
        // silently handle
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="mx-auto max-w-[1400px] space-y-4 p-4 md:p-6">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg animate-pulse bg-[var(--panel)]" />
          <div className="space-y-1">
            <div className="h-5 w-40 rounded animate-pulse bg-[var(--panel)]" />
            <div className="h-3 w-64 rounded animate-pulse bg-[var(--panel)]" />
          </div>
        </div>
        <div className="h-[300px] rounded-xl animate-pulse bg-[var(--panel)]" />
        <div className="h-[300px] rounded-xl animate-pulse bg-[var(--panel)]" />
        <div className="h-[200px] rounded-xl animate-pulse bg-[var(--panel)]" />
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto max-w-[1400px] space-y-4 p-4 md:p-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/")}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-[var(--surface)] text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Back to Dashboard"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="text-lg font-bold text-foreground">Reports & Export</h1>
            <p className="text-xs text-muted-foreground">
              Portfolio statements, strategy performance, and tax reporting with CSV export
            </p>
          </div>
        </div>

        {/* Portfolio Statement */}
        <SectionCard title="Portfolio Statement" icon={FileText}>
          {summary ? (
            <PortfolioStatement summary={summary} positions={positions} trades={trades} />
          ) : (
            <p className="text-xs text-muted-foreground text-center py-6">Unable to load portfolio data.</p>
          )}
        </SectionCard>

        {/* Strategy Performance */}
        <SectionCard title="Strategy Performance Report" icon={BarChart3}>
          <StrategyPerformanceReport strategies={strategies} trades={trades} />
        </SectionCard>

        {/* Tax Report */}
        <SectionCard title="Tax Report (Simplified)" icon={Calculator} defaultOpen={false}>
          <div className="mb-4">
            <label htmlFor="tax-year" className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Tax Year</label>
            <select
              id="tax-year"
              value={taxYear}
              onChange={(e) => setTaxYear(parseInt(e.target.value))}
              className="ml-2 h-7 rounded border border-border bg-background px-2 text-xs text-foreground"
            >
              {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <TaxReport trades={trades} taxYear={taxYear} />
        </SectionCard>
      </div>
    </ScrollArea>
  );
}
