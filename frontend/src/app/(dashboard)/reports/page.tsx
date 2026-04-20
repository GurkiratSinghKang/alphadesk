"use client";

import { useState, useEffect, useMemo } from "react";
import { Download, FileText, BarChart3, Calculator, ChevronDown, ChevronRight } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { DashboardPageLayout } from "@/components/layouts";
import {
  getPortfolioSummary,
  getPositions,
  getTradeHistory,
  getStrategies,
  type TradeHistoryEntry,
} from "@/lib/api";
import { usePortfolioStore } from "@/stores/portfolio";
import type { Position, PortfolioSummary } from "@/types";
import { cn, formatCurrency } from "@/lib/utils";

// ─── Range types ────────────────────────────────────────────
// Matches the Analytics page radiogroup so the two pages share a
// consistent vocabulary. Cutoff is computed client-side against the
// trade exit/entry timestamps — `ALL` short-circuits to "no filter".
type ReportsRange = "1W" | "1M" | "3M" | "YTD" | "1Y" | "ALL";
const REPORTS_RANGES: ReportsRange[] = ["1W", "1M", "3M", "YTD", "1Y", "ALL"];

function rangeCutoff(range: ReportsRange): Date | null {
  if (range === "ALL") return null;
  const now = new Date();
  if (range === "YTD") return new Date(now.getFullYear(), 0, 1);
  const days = range === "1W" ? 7
    : range === "1M" ? 30
    : range === "3M" ? 90
    : /* 1Y */ 365;
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - days);
  return cutoff;
}

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

// CSV-injection hardening: Excel/Sheets/Numbers interpret any cell whose
// first character is `=`, `+`, `-`, `@`, TAB (0x09) or CR (0x0D) as a
// formula. A strategy name or symbol originating from user/ticker data
// (e.g. `=cmd|'/c calc'!A1`) would then execute on open. Prefix such
// values with a single-quote sentinel per OWASP guidance so the cell is
// rendered verbatim. Do this before the quote-wrapping step so the
// sentinel lives inside the quoted payload when wrapping is needed.
const CSV_INJECTION_PREFIXES = ["=", "+", "-", "@", "\t", "\r"];

function escapeCsv(val: unknown): string {
  let str = String(val ?? "");
  if (str.length > 0 && CSV_INJECTION_PREFIXES.includes(str[0])) {
    str = `'${str}`;
  }
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

/**
 * Format a two-scalar "label,value" CSV row. Runs both sides through
 * `escapeCsv` so negative numbers (`-5.23`), user-supplied strategy
 * names, and any other field that could be parsed as a formula are
 * neutralised. Replaces ad-hoc `csv += "Label,${x}\n"` lines which
 * previously bypassed escaping entirely.
 */
function csvRow(label: string, value: unknown): string {
  return `${escapeCsv(label)},${escapeCsv(value)}\n`;
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
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
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
    // Account summary section — all scalar emissions routed through
    // csvRow() so negative numbers can't trigger Excel formula parsing.
    let csv = "PORTFOLIO STATEMENT\n";
    csv += csvRow("Generated", new Date().toISOString());
    csv += "\n";
    csv += "ACCOUNT SUMMARY\n";
    csv += csvRow("Equity", (summary.equity ?? 0).toFixed(2));
    csv += csvRow("Cash", (summary.cash ?? 0).toFixed(2));
    csv += csvRow("Buying Power", (summary.buyingPower ?? 0).toFixed(2));
    csv += csvRow("Positions Count", summary.positionsCount);
    csv += csvRow("Total Unrealized P&L", (totalUnrealizedPnl ?? 0).toFixed(2));
    csv += csvRow("Total Realized P&L", (totalRealizedPnl ?? 0).toFixed(2));
    csv += csvRow("Total P&L", (totalPnl ?? 0).toFixed(2));
    csv += "\n";

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
      <div>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Current Positions</p>
        {positions.length === 0 ? (
          <p className="rounded-lg border border-border bg-[var(--panel)] px-4 py-5 text-center font-display italic text-[13.5px] text-fg-muted">
            No positions in this period.
          </p>
        ) : (
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
        )}
      </div>

      {/* Recent Closed Trades */}
      <div>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
          Closed Trades{closedTrades.length > 0 ? ` (${closedTrades.length} total)` : ""}
        </p>
        {closedTrades.length === 0 ? (
          // BUG-040 — empty-state voice aligned with analytics / alerts:
          // italic-serif full-sentence headline, always ending with a
          // period. Points at the range selector so the user has a
          // concrete next action.
          <p className="rounded-lg border border-border bg-[var(--panel)] px-4 py-5 text-center font-display italic text-[13.5px] text-fg-muted">
            No trades closed in this period &mdash; adjust the range above to broaden the search.
          </p>
        ) : (
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
        )}
      </div>

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

  // Try to anchor drawdown on the real starting equity. Falls back to the
  // invested amount when we have no portfolio curve (trade-sequence-only
  // computation is still useful as a signal of cumulative drag, just needs
  // a sensible denominator).
  const strategyRows = strategies.map(s => {
    const stratTrades = tradesByStrategy.get(s.id) ?? [];
    const closed = stratTrades.filter(t => t.exit_price !== null);
    const winningTrades = closed.filter(t => (t.pnl ?? 0) > 0);
    const tradeCount = closed.length;
    // Backend `s.win_rate` is expressed as a percentage (0-100) when
    // positive, or -1 as a "no data" sentinel. The fallback only applies
    // when we have no trades to compute the rate from.
    const rawWinRate = tradeCount > 0
      ? (winningTrades.length / tradeCount) * 100
      : s.win_rate;
    // Guard against -1/null/NaN/Infinity so the displayed value never
    // shows up as "-100%" or "-1%".
    const winRate: number | null =
      rawWinRate == null || !Number.isFinite(rawWinRate) || rawWinRate < 0
        ? null
        : rawWinRate;

    // ── Max drawdown (equity-based) ──────────────────────────
    // Previous implementation divided by peak cumulative P&L, which
    // exaggerates drawdown dramatically (e.g. a $100 loss after a $100
    // gain reads as 100% DD). Correct formula anchors on equity: seed
    // with the strategy's `invested_amount` (or 1 as a fallback so the
    // math never divides by zero), then track running equity = start +
    // cum P&L and compare against the rolling peak equity.
    const startEquity = s.invested_amount && s.invested_amount > 0
      ? s.invested_amount
      : 1;
    let cumPnl = 0;
    let peakEquity = startEquity;
    let maxDdFrac = 0; // negative fraction, e.g. -0.12 = -12%
    for (const t of closed) {
      cumPnl += t.pnl ?? 0;
      const equity = startEquity + cumPnl;
      if (equity > peakEquity) peakEquity = equity;
      const dd = peakEquity > 0 ? (equity - peakEquity) / peakEquity : 0;
      if (dd < maxDdFrac) maxDdFrac = dd;
    }
    // Emit as a positive percentage magnitude so the UI can prefix "-".
    const maxDd = Math.abs(maxDdFrac * 100);

    // ── Sharpe (standard annualization) ──────────────────────
    // Prior implementation scaled by `sqrt(252 / N)` which is inverted:
    // fewer samples blew the ratio up. Standard daily-return Sharpe is
    // `mean/std * sqrt(252)` — the sample count only affects the
    // mean/std estimates, not the annualization factor.
    const returns = closed.map(t => t.pnl_pct ?? 0);
    const meanRet = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
    const stdRet = returns.length > 1 ? Math.sqrt(returns.reduce((s, r) => s + (r - meanRet) ** 2, 0) / (returns.length - 1)) : 0;
    const sharpe = stdRet > 0 ? (meanRet / stdRet) * Math.sqrt(252) : 0;

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
        // Preserve the same "no data" semantics in CSV — empty cell is
        // unambiguous (downstream spreadsheets won't misinterpret -1 as
        // a real value).
        s.winRate == null ? "" : s.winRate.toFixed(1),
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
                <td className="px-3 py-2 text-right tabular-nums text-foreground">
                  {s.winRate == null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    `${s.winRate.toFixed(0)}%`
                  )}
                </td>
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

// Extract the civil Y/M/D components of an ISO timestamp *in ET*.
// Tax-year bucketing and holding-period classification must use the
// market's calendar — a sell ticket that prints at 23:30 ET on Dec 31
// is a December trade even though it's already January 1 in UTC, and
// the browser's local `getFullYear()` would mis-bucket it for any user
// outside America/New_York.
function etDateParts(iso: string): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  let y = 0, m = 0, d = 0;
  for (const p of parts) {
    if (p.type === "year") y = parseInt(p.value, 10);
    else if (p.type === "month") m = parseInt(p.value, 10);
    else if (p.type === "day") d = parseInt(p.value, 10);
  }
  return { y, m, d };
}

function TaxReport({ trades, taxYear }: { trades: TradeHistoryEntry[]; taxYear: number }) {
  const taxTrades = useMemo(() => {
    return trades.filter(t => {
      if (!t.exit_time || t.pnl === null) return false;
      return etDateParts(t.exit_time).y === taxYear;
    });
  }, [trades, taxYear]);

  const classified = useMemo(() => {
    return taxTrades.map(t => {
      // Holding days must be counted in CIVIL days, not elapsed hours
      // divided by 24. The old `(exit - entry) / 86_400_000` math can
      // return 364 for a position held exactly 365 calendar days when a
      // spring-forward DST transition falls inside the window (one of
      // the 24-hour windows is actually 23 hours), silently flipping a
      // long-term trade to short-term — and with it the tax rate.
      // Compare ET-anchored date parts via UTC epoch of midnight.
      const e = etDateParts(t.entry_time);
      const x = etDateParts(t.exit_time!);
      const entryMid = Date.UTC(e.y, e.m - 1, e.d);
      const exitMid = Date.UTC(x.y, x.m - 1, x.d);
      const holdingDays = Math.round((exitMid - entryMid) / 86_400_000);
      // IRS: "held more than one year" = long-term. Leap-year safe: a
      // position entered Feb 29 2024 and sold Feb 28 2025 is 365 days
      // and still short-term; > 365 covers the common 366+ case without
      // a leap-year lookup.
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
    // BUG-029: the CSV must carry the same compliance disclaimer the UI
    // shows next to the download button. Anyone handing this file to an
    // accountant needs to see "not tax advice" in the file itself.
    let csv = `"Informational only — not tax advice. Consult a qualified professional."\n`;
    csv += `TAX REPORT - ${taxYear}\n`;
    csv += csvRow("Generated", new Date().toISOString());
    csv += "\n";
    csv += "SUMMARY\n";
    // Losses are negative so the prior direct template-literal emit made
    // them a CSV-injection vector (Excel happily parses `=-523.45` as a
    // formula). csvRow() runs every scalar through escapeCsv which
    // prefixes the sentinel `'` when needed.
    csv += csvRow("Short-Term Gains", (shortTermGains ?? 0).toFixed(2));
    csv += csvRow("Short-Term Losses", (shortTermLosses ?? 0).toFixed(2));
    csv += csvRow("Short-Term Net", (shortTermGains + shortTermLosses).toFixed(2));
    csv += csvRow("Long-Term Gains", (longTermGains ?? 0).toFixed(2));
    csv += csvRow("Long-Term Losses", (longTermLosses ?? 0).toFixed(2));
    csv += csvRow("Long-Term Net", (longTermGains + longTermLosses).toFixed(2));
    csv += csvRow("Total Realized", (totalRealized ?? 0).toFixed(2));
    csv += "\n";
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
        <p className="font-display italic text-[13.5px] text-fg-muted text-center py-6">No realized trades found for {taxYear} &mdash; this tax year has nothing to report.</p>
      )}

      {/* BUG-029 compliance disclaimer — the tax report is a convenience
          export built from trade-ledger data; it is not filing-ready and
          is not authored by a tax professional. Copy lives right above
          the download button so it travels with the action. */}
      <p
        role="note"
        data-testid="tax-report-disclaimer"
        className="rounded-md border border-amber/40 bg-amber/5 px-3 py-2 font-sans text-[11px] leading-snug text-amber-100"
      >
        Informational only — not tax advice. Consult a qualified professional.
      </p>

      <Button onClick={handleDownload} size="sm" className="gap-1.5">
        <Download className="h-3 w-3" />
        Download Tax Report (CSV)
      </Button>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────

export default function ReportsPage() {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [trades, setTrades] = useState<TradeHistoryEntry[]>([]);
  const [strategies, setStrategies] = useState<StrategyInfo[]>([]);
  const [taxYear, setTaxYear] = useState(new Date().getFullYear());
  // Default 1M to mirror Analytics, so "No closed trades in this period"
  // now literally means "in the selected period" rather than "ever".
  const [range, setRange] = useState<ReportsRange>("1M");

  // BUG-001 / BUG-015: subscribe to the shared portfolio store so Reports
  // shows exactly the same positions + summary numbers as Desk / Pipeline.
  // `useDataPipeline` (mounted in the dashboard layout) keeps the store
  // fresh. We still kick off a one-time fetch below so the page works
  // even if the user lands on /reports first.
  const storeSummary = usePortfolioStore((s) => s.summary);
  const storePositions = usePortfolioStore((s) => s.positions);

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
        if (summaryRes.status === "fulfilled") {
          setSummary(summaryRes.value);
          // Fan into the shared store so Desk/Pipeline see the same snapshot.
          usePortfolioStore.getState().setSummary(summaryRes.value);
        }
        if (positionsRes.status === "fulfilled") {
          setPositions(positionsRes.value);
          usePortfolioStore.getState().setPositions(positionsRes.value);
        }
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

  // Mirror store updates into local state so WS ticks / sibling-page
  // refreshes keep the report numbers in sync without a round-trip.
  useEffect(() => {
    if (storePositions.length > 0) setPositions(storePositions);
  }, [storePositions]);
  useEffect(() => {
    if (storeSummary && storeSummary.equity > 0) setSummary(storeSummary);
  }, [storeSummary]);

  // Filter trades by selected period. We bucket by exit_time for closed
  // trades (the audit-relevant "closed in this period" semantics); open
  // trades carry no exit so they drop out of period-scoped reports but
  // remain visible in the position table which isn't historical.
  const filteredTrades = useMemo(() => {
    const cutoff = rangeCutoff(range);
    if (!cutoff) return trades;
    const cutoffMs = cutoff.getTime();
    return trades.filter((t) => {
      // Keep still-open trades out of period-filtered reports so the
      // "N closed" count reflects only trades that actually closed in
      // the window.
      const exit = t.exit_time ? new Date(t.exit_time).getTime() : NaN;
      return Number.isFinite(exit) && exit >= cutoffMs;
    });
  }, [trades, range]);

  const rangeSelector = (
    <div
      role="radiogroup"
      aria-label="Reports range"
      className="flex items-center gap-1 rounded-md border border-border bg-bg p-0.5"
    >
      {REPORTS_RANGES.map((r) => {
        const active = r === range;
        return (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={active}
            data-range={r}
            data-testid={`reports-range-${r}`}
            onClick={() => setRange(r)}
            className={cn(
              "font-mono text-[11px] px-2.5 py-1 rounded transition-colors",
              active
                ? "bg-bg-elev-2 text-fg"
                : "text-fg-muted hover:text-fg"
            )}
            style={{ letterSpacing: "0.04em" }}
          >
            {r}
          </button>
        );
      })}
    </div>
  );

  if (loading) {
    return (
      <ScrollArea className="h-full">
        <DashboardPageLayout eyebrow="§ REPORTS" title="Reports" actions={rangeSelector}>
          <div className="h-[260px] animate-pulse rounded-lg bg-bg-elev-1" />
          <div className="h-[260px] animate-pulse rounded-lg bg-bg-elev-1" />
          <div className="h-[200px] animate-pulse rounded-lg bg-bg-elev-1" />
        </DashboardPageLayout>
      </ScrollArea>
    );
  }

  return (
    <ScrollArea className="h-full">
      <DashboardPageLayout eyebrow="§ REPORTS" title="Reports" actions={rangeSelector}>
        {/* Portfolio Statement */}
        <SectionCard title="Portfolio Statement" icon={FileText}>
          {summary ? (
            <PortfolioStatement summary={summary} positions={positions} trades={filteredTrades} />
          ) : (
            <p className="text-xs text-muted-foreground text-center py-6">Unable to load portfolio data.</p>
          )}
        </SectionCard>

        {/* Strategy Performance */}
        <SectionCard title="Strategy Performance Report" icon={BarChart3}>
          <StrategyPerformanceReport strategies={strategies} trades={filteredTrades} />
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
              {/* BUG-038: dropdown reported as "only 2026 visible" —
                  guard explicitly so the current year AND the prior year
                  are always emitted (the prior year is the one people
                  actually file against in Q1–Q2). Using a deduped Set
                  makes the list deterministic even on year-boundary
                  renders where `getFullYear()` could race a state
                  re-read. */}
              {Array.from(
                new Set<number>([
                  new Date().getFullYear(),
                  new Date().getFullYear() - 1,
                  ...Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i),
                ]),
              )
                .sort((a, b) => b - a)
                .map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
            </select>
          </div>
          <TaxReport trades={trades} taxYear={taxYear} />
        </SectionCard>
      </DashboardPageLayout>
    </ScrollArea>
  );
}
