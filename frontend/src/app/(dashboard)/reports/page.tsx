"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import {
  Download,
  FileText,
  BarChart3,
  Calculator,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ChevronsUpDown,
  Activity,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { DashboardPageLayout } from "@/components/layouts";
import SavedViewsBar from "@/components/primitives/SavedViewsBar";
import { SlippagePanel } from "@/components/dashboard/SlippagePanel";
// v2 phase 1.9 — additive Tax/Lots section. Sits above existing
// SlippagePanel + Tax Report so the v2 lot-level surface is the
// first thing operators see when they expand tax content.
import TaxLotsSection from "./_v2/TaxLotsSection";
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
import { handleRadioGroupKeyDown } from "@/lib/radioGroupKeyboard";

// 2026-04-21 polish — reports page lifted onto the editorial token ladder
// matching /analytics + the dashboard hero:
//   .t-section-display  italic (13px from --fs-section-cap) — section headers
//   .t-label            12 sans caps 0.12em   — table/field eyebrows
//   .t-num-md           16 mono tabular-med   — row numbers + %
//   .t-num-lg           20 mono tabular-med   — summary-tile scalars
// Plus: sortable closed-trades table, explicit disabled state on every
// CSV-export button when there's nothing to export, editorial empty
// state with `/trade` CTA.

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
  // P2-09: wrap click in try/finally so a synchronous handler throw
  // (e.g. browser blocks the download in headless / CSP contexts) still
  // unmounts the temp <a> and revokes the object URL. Otherwise the
  // blob URL would leak and accumulate across exports in long-lived
  // sessions.
  try {
    link.click();
  } finally {
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
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
  eyebrow,
  icon: Icon,
  children,
  defaultOpen = true,
}: {
  title: string;
  /** Tracked-caps tag above the serif title, e.g. "§ STATEMENT". */
  eyebrow?: string;
  icon: React.ElementType;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  // 2026-04-21 polish — serif-italic section titles bring the reports
  // cards onto the same voice as the dashboard hero + analytics cards.
  // Chevron stays on the far right of the button so the whole header is
  // a clickable collapse/expand target.
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-border bg-[var(--panel)] overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className={cn(
          "flex w-full items-center gap-3 border-b border-border px-4 py-3",
          "text-left hover:bg-bg-elev-1/40 transition-colors",
          "focus-visible:outline-none focus-visible:bg-bg-elev-1/50",
        )}
      >
        <Icon className="h-4 w-4 text-fg-muted shrink-0" aria-hidden />
        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
          {eyebrow ? <span className="t-label">{eyebrow}</span> : null}
          <h2 className="t-section-display text-ink-1000 truncate">{title}</h2>
        </div>
        {open ? (
          <ChevronDown className="h-4 w-4 text-fg-muted shrink-0" aria-hidden />
        ) : (
          <ChevronRight className="h-4 w-4 text-fg-muted shrink-0" aria-hidden />
        )}
      </button>
      {open && <div className="p-4">{children}</div>}
    </div>
  );
}

// ─── KPI Tile ──────────────────────────────────────────────
// 2026-04-21 polish — the summary tiles on Portfolio Statement and the
// Tax Report are the marquee numeric elements on the page. Lifting them
// onto `.t-num-lg` (20px mono tabular medium) + `.t-label` eyebrows gives
// them hero-level presence without needing a full re-layout.
function KpiTile({
  label,
  value,
  tone = "neutral",
  hint,
  align = "left",
}: {
  label: string;
  value: string;
  tone?: "profit" | "loss" | "neutral";
  /** Optional sub-line (e.g. "7 trades"). Rendered in .t-meta. */
  hint?: string;
  align?: "left" | "center";
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-[var(--panel)] px-3 py-2.5",
        align === "center" && "text-center",
      )}
    >
      <p className="t-label mb-1">{label}</p>
      <p
        className={cn(
          "t-num-lg tabular-nums",
          tone === "profit" && "text-[var(--profit)]",
          tone === "loss" && "text-[var(--loss)]",
          tone === "neutral" && "text-ink-1000",
        )}
      >
        {value}
      </p>
      {hint ? <p className="t-meta mt-0.5">{hint}</p> : null}
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
      ["Symbol", "Quantity", "Avg Cost", "Current Price", "Market Value", "Unrealized P&L", "P&L %", "Strategy"],
      positions.map(p => [
        p.symbol,
        p.quantity,
        (p.avgCost ?? 0).toFixed(2),
        (p.currentPrice ?? 0).toFixed(2),
        (p.marketValue ?? 0).toFixed(2),
        (p.unrealizedPnl ?? 0).toFixed(2),
        p.avgCost > 0 ? ((p.currentPrice - p.avgCost) / p.avgCost * 100).toFixed(2) + "%" : "0%",
        // Round-5 F-6 — strategy attribution joins closed-trade and
        // open-position perspectives in the export.
        p.strategy ?? "",
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

  // P&L tones driven by sign; keep neutral when exactly zero so a fresh
  // account doesn't paint all three tiles green from just the formatting.
  const pnlTone = (v: number): "profit" | "loss" | "neutral" =>
    v > 0 ? "profit" : v < 0 ? "loss" : "neutral";
  const fmtSigned = (v: number): string =>
    v > 0 ? `+${formatCurrency(v)}` : formatCurrency(v);

  return (
    <div className="space-y-4">
      {/* Account Summary — KpiTile gives every dashboard-like tile the
          same 20px mono-tabular headline + tracked-caps eyebrow. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiTile label="Equity" value={formatCurrency(summary.equity)} />
        <KpiTile label="Cash" value={formatCurrency(summary.cash)} />
        <KpiTile label="Buying power" value={formatCurrency(summary.buyingPower)} />
        <KpiTile label="Positions" value={String(summary.positionsCount)} />
      </div>

      {/* P&L Summary — signed values so negative P&L reads as "-$…",
          positive as "+$…", and a zero-P&L tile doesn't misleadingly
          paint green. */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <KpiTile
          label="Unrealized P&L"
          value={fmtSigned(totalUnrealizedPnl)}
          tone={pnlTone(totalUnrealizedPnl)}
          align="center"
        />
        <KpiTile
          label="Realized P&L"
          value={fmtSigned(totalRealizedPnl)}
          tone={pnlTone(totalRealizedPnl)}
          align="center"
        />
        <KpiTile
          label="Total P&L"
          value={fmtSigned(totalPnl)}
          tone={pnlTone(totalPnl)}
          align="center"
        />
      </div>

      {/* Current Positions Table */}
      <div>
        <p className="t-label mb-2">Current positions</p>
        {positions.length === 0 ? (
          <p className="rounded-lg border border-border bg-[var(--panel)] px-4 py-5 text-center font-display italic text-body-sm text-fg-muted">
            No positions in this period.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full">
              <thead>
                <tr className="bg-[var(--panel)] border-b border-border">
                  <th className="px-3 py-2 text-left"><span className="t-label">Symbol</span></th>
                  <th className="px-3 py-2 text-right"><span className="t-label">Qty</span></th>
                  <th className="px-3 py-2 text-right"><span className="t-label">Avg cost</span></th>
                  <th className="px-3 py-2 text-right"><span className="t-label">Price</span></th>
                  <th className="px-3 py-2 text-right"><span className="t-label">Mkt value</span></th>
                  <th className="px-3 py-2 text-right"><span className="t-label">P&amp;L</span></th>
                  {/* Round-5 F-6 — Strategy attribution column. Maps to
                      `position.strategy` (added via the backend's
                      Trade-ledger join). Em-dash when null. */}
                  <th className="px-3 py-2 text-left"><span className="t-label">Strategy</span></th>
                </tr>
              </thead>
              <tbody>
                {positions.map(p => (
                  <tr key={p.symbol} className="border-b border-border-hair last:border-0">
                    <td className="px-3 py-2 font-mono text-body-sm text-ink-900">{p.symbol}</td>
                    <td className="px-3 py-2 text-right t-num-md text-fg">{p.quantity}</td>
                    <td className="px-3 py-2 text-right t-num-md text-fg-muted">{formatCurrency(p.avgCost)}</td>
                    <td className="px-3 py-2 text-right t-num-md text-fg">{formatCurrency(p.currentPrice)}</td>
                    <td className="px-3 py-2 text-right t-num-md text-fg">{formatCurrency(p.marketValue)}</td>
                    <td className={cn(
                      "px-3 py-2 text-right t-num-md tabular-nums",
                      p.unrealizedPnl > 0 ? "text-[var(--profit)]" :
                      p.unrealizedPnl < 0 ? "text-[var(--loss)]" : "text-fg",
                    )}>
                      {p.unrealizedPnl > 0 ? "+" : ""}{formatCurrency(p.unrealizedPnl)}
                    </td>
                    <td className="px-3 py-2 font-mono text-label text-fg-muted">
                      {p.strategy ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Closed Trades (sortable + paginated) */}
      <ClosedTradesTable trades={closedTrades} />

      <Button
        onClick={handleDownload}
        size="sm"
        className="gap-1.5"
        // 2026-04-21 polish — export buttons disable when there's nothing
        // to export. Previously clicking "Download" on an empty account
        // generated a two-line CSV with just a header, which is noise.
        // Keeping the button mounted (vs hiding it) preserves discovery.
        disabled={closedTrades.length === 0 && positions.length === 0}
        title={
          closedTrades.length === 0 && positions.length === 0
            ? "Nothing to export yet"
            : undefined
        }
      >
        <Download className="h-3 w-3" />
        Download Portfolio Statement (CSV)
      </Button>
    </div>
  );
}

// ─── Sortable Closed-Trades Table ─────────────────────────
// 2026-04-21 polish — new composite local to the reports page. Users can
// sort by entry/exit/symbol/strategy/P&L$/P&L%/hold-time columns, and
// paginate 25-rows-at-a-time instead of the previous hardcoded first-50
// cutoff that silently truncated the table.
type SortKey =
  | "entry_time"
  | "exit_time"
  | "symbol"
  | "strategy"
  | "pnl"
  | "pnl_pct"
  | "hold_ms";
type SortDir = "asc" | "desc";

function ClosedTradesTable({ trades }: { trades: TradeHistoryEntry[] }) {
  // Default to most-recent first (exit_time desc) — that's what a trader
  // glances at when they open Reports: "what did I just close?"
  const [sortKey, setSortKey] = useState<SortKey>("exit_time");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 25;

  function toggleSort(k: SortKey) {
    if (k === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      // Textual columns sort asc by default, numeric desc — mirrors
      // how TradingView/ToS/Webull present their trade blotters.
      setSortDir(k === "symbol" || k === "strategy" ? "asc" : "desc");
    }
    // Reset to first page when sort changes — otherwise the current
    // page-window could point past the end of a re-sorted list.
    setPage(0);
  }

  const sorted = useMemo(() => {
    const copy = [...trades];
    copy.sort((a, b) => {
      let av: string | number;
      let bv: string | number;
      switch (sortKey) {
        case "entry_time":
          av = new Date(a.entry_time).getTime() || 0;
          bv = new Date(b.entry_time).getTime() || 0;
          break;
        case "exit_time":
          av = a.exit_time ? new Date(a.exit_time).getTime() || 0 : 0;
          bv = b.exit_time ? new Date(b.exit_time).getTime() || 0 : 0;
          break;
        case "symbol":
          av = a.symbol || "";
          bv = b.symbol || "";
          break;
        case "strategy":
          av = a.strategy ?? "";
          bv = b.strategy ?? "";
          break;
        case "pnl":
          av = a.pnl ?? 0;
          bv = b.pnl ?? 0;
          break;
        case "pnl_pct":
          av = a.pnl_pct ?? 0;
          bv = b.pnl_pct ?? 0;
          break;
        case "hold_ms": {
          // Synthesize hold-time from entry/exit. Open positions have
          // no exit; fall back to 0 so they always sort at the bottom
          // regardless of direction.
          const ah = a.entry_time && a.exit_time
            ? new Date(a.exit_time).getTime() - new Date(a.entry_time).getTime()
            : 0;
          const bh = b.entry_time && b.exit_time
            ? new Date(b.exit_time).getTime() - new Date(b.entry_time).getTime()
            : 0;
          av = ah;
          bv = bh;
          break;
        }
      }
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      const an = typeof av === "number" ? av : 0;
      const bn = typeof bv === "number" ? bv : 0;
      return sortDir === "asc" ? an - bn : bn - an;
    });
    return copy;
  }, [trades, sortKey, sortDir]);

  // Clamp page if the trade list shrinks (e.g. range selector narrows
  // the dataset) so the user doesn't land on an empty window.
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const view = sorted.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  // Header cell: click-to-sort with chevron indicator. Aligns right for
  // numeric columns, left for textual ones. Keyboard: button element is
  // naturally focusable and activates on Enter/Space.
  const renderHeaderCell = ({
    k,
    label,
    align = "left",
    widthClass,
  }: {
    k: SortKey;
    label: string;
    align?: "left" | "right";
    widthClass?: string;
  }) => {
    const active = sortKey === k;
    const Chevron = active
      ? sortDir === "asc"
        ? ChevronUp
        : ChevronDown
      : ChevronsUpDown;
    return (
      <th
        className={cn(
          "px-3 py-2",
          align === "right" ? "text-right" : "text-left",
          widthClass,
        )}
        aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
      >
        <button
          type="button"
          onClick={() => toggleSort(k)}
          data-testid={`sort-${k}`}
          className={cn(
            "inline-flex items-center gap-1 t-label",
            "hover:text-fg transition-colors",
            "focus-visible:outline-none focus-visible:text-fg",
            align === "right" && "flex-row-reverse",
            active && "text-ink-1000",
          )}
        >
          {label}
          <Chevron
            className={cn(
              "h-3 w-3 shrink-0",
              active ? "text-ink-1000" : "text-fg-muted/60",
            )}
            aria-hidden
          />
        </button>
      </th>
    );
  };

  function formatHold(ms: number): string {
    if (!Number.isFinite(ms) || ms <= 0) return "—";
    const hours = ms / (1000 * 60 * 60);
    if (hours < 24) return `${hours.toFixed(1)}h`;
    return `${(hours / 24).toFixed(1)}d`;
  }

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <p className="t-label">
          Closed Trades{sorted.length > 0 ? ` · ${sorted.length}` : ""}
        </p>
        {sorted.length > 0 && (
          <p className="t-meta">
            Showing {safePage * PAGE_SIZE + 1}
            &ndash;
            {Math.min((safePage + 1) * PAGE_SIZE, sorted.length)} of {sorted.length}
          </p>
        )}
      </div>

      {sorted.length === 0 ? (
        // BUG-040 — empty-state voice aligned with analytics / alerts:
        // italic-serif full-sentence headline, always ending with a
        // period. Points at the range selector so the user has a
        // concrete next action.
        <p className="rounded-lg border border-border bg-[var(--panel)] px-4 py-5 text-center font-display italic text-body-sm text-fg-muted">
          No trades closed in this period &mdash; adjust the range above to broaden the search.
        </p>
      ) : (
        <>
          {/* Slice-7 / TBL-1 (Brex Smart Tables / Airtable convention):
              saved-views bar above the trade ledger. Captures the
              current sort key + direction as a named preset; click a
              preset to recall. Persists to localStorage so a trader's
              "Q3 winners" view survives a refresh. */}
          <SavedViewsBar
            scope="reports-trade-history"
            current={{ sortKey, sortDir }}
            onApply={(view) => {
              setSortKey(view.sortKey);
              setSortDir(view.sortDir);
              setPage(0);
            }}
          />
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full">
              <thead>
                <tr className="bg-[var(--panel)] border-b border-border">
                  {renderHeaderCell({ k: "symbol", label: "Symbol" })}
                  {renderHeaderCell({ k: "strategy", label: "Strategy" })}
                  {renderHeaderCell({ k: "entry_time", label: "Entry" })}
                  {renderHeaderCell({ k: "exit_time", label: "Exit" })}
                  {renderHeaderCell({ k: "pnl", label: "P&L $", align: "right" })}
                  {renderHeaderCell({ k: "pnl_pct", label: "P&L %", align: "right" })}
                  {renderHeaderCell({ k: "hold_ms", label: "Hold", align: "right" })}
                </tr>
              </thead>
              <tbody>
                {view.map((t) => {
                  const holdMs =
                    t.entry_time && t.exit_time
                      ? new Date(t.exit_time).getTime() - new Date(t.entry_time).getTime()
                      : 0;
                  const pnl = t.pnl ?? 0;
                  const pnlPct = t.pnl_pct;
                  return (
                    <tr key={t.id} className="border-b border-border-hair last:border-0">
                      <td className="px-3 py-2 font-mono text-body-sm text-ink-900">
                        {t.symbol}
                      </td>
                      <td className="px-3 py-2 font-sans text-body-sm text-fg truncate max-w-[140px]">
                        {t.strategy ?? <span className="text-fg-muted">&mdash;</span>}
                      </td>
                      <td className="px-3 py-2 t-meta">
                        {t.entry_time ? new Date(t.entry_time).toLocaleDateString() : "—"}
                      </td>
                      <td className="px-3 py-2 t-meta">
                        {t.exit_time ? new Date(t.exit_time).toLocaleDateString() : "—"}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2 text-right t-num-md tabular-nums",
                          pnl > 0 ? "text-[var(--profit)]" :
                          pnl < 0 ? "text-[var(--loss)]" : "text-fg",
                        )}
                      >
                        {pnl > 0 ? "+" : ""}{formatCurrency(pnl)}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2 text-right t-num-md tabular-nums",
                          (pnlPct ?? 0) > 0 ? "text-[var(--profit)]" :
                          (pnlPct ?? 0) < 0 ? "text-[var(--loss)]" : "text-fg-muted",
                        )}
                      >
                        {pnlPct == null
                          ? <span className="text-fg-muted">&mdash;</span>
                          : <>{pnlPct > 0 ? "+" : ""}{pnlPct.toFixed(2)}%</>}
                      </td>
                      <td className="px-3 py-2 text-right t-meta">
                        {formatHold(holdMs)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination controls — accessible, keyboard-operable. Hidden
              when there's only one page so single-page views don't get a
              dangling "Page 1/1" chrome. */}
          {totalPages > 1 && (
            <nav
              aria-label="Closed trades pagination"
              className="flex items-center justify-between mt-3"
            >
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={safePage === 0}
                data-testid="closed-trades-prev"
                className={cn(
                  "inline-flex items-center gap-1 rounded-sm border border-border px-3 py-1.5",
                  "font-sans text-label text-fg-muted hover:text-fg hover:border-primary transition-colors",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand",
                  "disabled:opacity-40 disabled:pointer-events-none",
                )}
              >
                <ChevronLeftIcon /> Prev
              </button>
              <span className="t-meta">
                Page {safePage + 1} / {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={safePage >= totalPages - 1}
                data-testid="closed-trades-next"
                className={cn(
                  "inline-flex items-center gap-1 rounded-sm border border-border px-3 py-1.5",
                  "font-sans text-label text-fg-muted hover:text-fg hover:border-primary transition-colors",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand",
                  "disabled:opacity-40 disabled:pointer-events-none",
                )}
              >
                Next <ChevronRightIcon />
              </button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}

// Tiny inline chevrons for the pagination buttons — avoids importing
// another lucide icon just for two usages.
function ChevronLeftIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}
function ChevronRightIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
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
      ["Strategy", "Status", "Return %", "Sharpe", "Max drawdown %", "Trades", "Win rate %", "Invested"],
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
        <table className="w-full">
          <thead>
            <tr className="bg-[var(--panel)] border-b border-border">
              <th className="px-3 py-2 text-left"><span className="t-label">Strategy</span></th>
              <th className="px-3 py-2 text-center"><span className="t-label">Status</span></th>
              <th className="px-3 py-2 text-right"><span className="t-label">Return</span></th>
              <th className="px-3 py-2 text-right"><span className="t-label">Sharpe</span></th>
              <th className="px-3 py-2 text-right"><span className="t-label">Max DD</span></th>
              <th className="px-3 py-2 text-right"><span className="t-label">Trades</span></th>
              <th className="px-3 py-2 text-right"><span className="t-label">Win rate</span></th>
            </tr>
          </thead>
          <tbody>
            {strategyRows.map(s => (
              <tr key={s.id} className="border-b border-border-hair last:border-0">
                <td className="px-3 py-2 font-sans text-body-sm font-medium text-ink-900">{s.name}</td>
                <td className="px-3 py-2 text-center">
                  {/* Status chip — active reads chartreuse-tinted; anything
                      else (paused, draft) reads muted so the eye lands on
                      running strategies first. */}
                  <span className={cn(
                    "inline-block rounded-sm px-2 py-0.5 font-sans text-label font-semibold uppercase",
                    s.status === "active"
                      ? "bg-[var(--profit-tint)] text-[var(--profit)]"
                      : "bg-bg-elev-1 text-fg-muted",
                  )}
                  style={{ letterSpacing: "0.08em" }}>
                    {s.status}
                  </span>
                </td>
                <td className={cn(
                  "px-3 py-2 text-right t-num-md tabular-nums",
                  s.total_return_pct > 0 ? "text-[var(--profit)]" :
                  s.total_return_pct < 0 ? "text-[var(--loss)]" : "text-fg",
                )}>
                  {s.total_return_pct > 0 ? "+" : ""}{(s.total_return_pct ?? 0).toFixed(1)}%
                </td>
                <td className="px-3 py-2 text-right t-num-md text-fg">{(s.sharpe ?? 0).toFixed(2)}</td>
                <td className={cn(
                  "px-3 py-2 text-right t-num-md tabular-nums",
                  s.maxDd > 0 ? "text-[var(--loss)]" : "text-fg-muted",
                )}>
                  {s.maxDd > 0 ? `-${s.maxDd.toFixed(1)}%` : "0.0%"}
                </td>
                <td className="px-3 py-2 text-right t-num-md text-fg">{s.tradeCount}</td>
                <td className="px-3 py-2 text-right t-num-md text-fg">
                  {s.winRate == null ? (
                    <span className="text-fg-muted">&mdash;</span>
                  ) : (
                    `${s.winRate.toFixed(0)}%`
                  )}
                </td>
              </tr>
            ))}
            {strategyRows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center">
                  <p className="font-display italic text-body-sm text-fg-muted">
                    No strategies configured yet.
                  </p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Button
        onClick={handleDownload}
        size="sm"
        className="gap-1.5"
        // 2026-04-21 — disable when there are no strategies to export.
        disabled={strategyRows.length === 0}
        title={strategyRows.length === 0 ? "No strategies to export" : undefined}
      >
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
    // Round-5 F-9 / J-12 (round-6) — wash-sale detection. Walk all
    // closed losses and mark the loss disallowed when the SAME symbol
    // re-opened within the IRS §1091 wash-sale window of
    // [exit_date - 30 days, exit_date + 30 days]. The loss is
    // disallowed if the substantially-identical security was bought
    // EITHER before OR after the loss-realising sale — the previous
    // implementation only checked forward 30 days, missing the common
    // "buy → buy more → sell loss" pattern.
    //
    // We use ALL trades (across all tax years) for the lookup because
    // a December close + January re-buy spans tax years; restricting
    // to taxTrades would miss it.
    //
    // This is best-effort: it does not yet handle "substantially
    // identical" securities (a related call/put or ETF substitution),
    // and it doesn't adjust the cost basis of the replacement lot.
    // The disclaimer already calls out "best-effort"; the column gives
    // the user a hint to consult a professional rather than a final
    // legal answer.
    const allOpens = trades
      .map(t => ({ symbol: t.symbol, entry_time: t.entry_time }))
      .filter(t => !!t.entry_time);

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
      // IRS §1222: "held more than one year" = long-term. The
      // acquisition day is EXCLUDED from the count. So a position
      // bought Mar 1 and sold Mar 2 of the next year qualifies as
      // long-term (> 1 year by the rule), even though our day-count
      // gives 366 days for non-leap. Round-10 / W-3 (P0): previously
      // ``> 365`` excluded the boundary case where a non-leap-year
      // hold landed on day 366 (which IS long-term under the rule).
      // The correct test for long-term using our acquisition-day-
      // included integer count is ``>= 366`` so the day-after-
      // anniversary sale qualifies.
      const isLongTerm = holdingDays >= 366;

      // Round-5 F-9 / J-12 (round-6) — wash-sale flag. Only losses
      // qualify. The IRS window is symmetric: ±30 calendar days around
      // the loss-realising exit. The loop now iterates all opens — both
      // before and after the exit — and flips the flag on the first hit.
      let washSaleLossDisallowed = false;
      if ((t.pnl ?? 0) < 0 && t.exit_time) {
        const exitTs = exitMid;
        const windowStart = exitTs - 30 * 86_400_000;
        const windowEnd = exitTs + 30 * 86_400_000;
        for (const o of allOpens) {
          if (o.symbol !== t.symbol) continue;
          if (!o.entry_time) continue;
          // Skip the trade's OWN entry (which always precedes its exit).
          if (o.entry_time === t.entry_time) continue;
          const op = etDateParts(o.entry_time);
          const opMid = Date.UTC(op.y, op.m - 1, op.d);
          if (opMid >= windowStart && opMid <= windowEnd) {
            washSaleLossDisallowed = true;
            break;
          }
        }
      }

      return {
        ...t,
        holdingDays,
        isLongTerm,
        classification: isLongTerm ? "Long-Term" : "Short-Term",
        washSaleLossDisallowed,
      };
    });
  }, [taxTrades, trades]);

  const shortTermTrades = classified.filter(t => !t.isLongTerm);
  const longTermTrades = classified.filter(t => t.isLongTerm);

  const shortTermGains = shortTermTrades.filter(t => (t.pnl ?? 0) > 0).reduce((s, t) => s + (t.pnl ?? 0), 0);
  const shortTermLosses = shortTermTrades.filter(t => (t.pnl ?? 0) <= 0).reduce((s, t) => s + (t.pnl ?? 0), 0);
  const longTermGains = longTermTrades.filter(t => (t.pnl ?? 0) > 0).reduce((s, t) => s + (t.pnl ?? 0), 0);
  const longTermLosses = longTermTrades.filter(t => (t.pnl ?? 0) <= 0).reduce((s, t) => s + (t.pnl ?? 0), 0);
  const totalRealized = classified.reduce((s, t) => s + (t.pnl ?? 0), 0);

  // Round-5 F-9 — wash-sale-adjusted realized. The IRS disallows
  // recognising losses on trades that are flagged as wash sales, so
  // the "adjusted" total adds those disallowed losses BACK to the
  // total realized figure. Only meaningful when at least one row is
  // flagged.
  const washSaleDisallowed = classified
    .filter(t => t.washSaleLossDisallowed)
    .reduce((s, t) => s + (t.pnl ?? 0), 0);
  const washSaleCount = classified.filter(t => t.washSaleLossDisallowed).length;
  const adjustedRealized = totalRealized - washSaleDisallowed;

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
    // Round-5 F-9 — surface the wash-sale adjustment in the CSV summary
    // so an accountant downstream can see the disallowed-loss line.
    if (washSaleCount > 0) {
      csv += csvRow("Wash-Sale Loss Disallowed", washSaleDisallowed.toFixed(2));
      csv += csvRow("Adjusted Total Realized", adjustedRealized.toFixed(2));
      csv += csvRow("Wash-Sale Trade Count", String(washSaleCount));
      csv += "\n";
    }
    csv += "ALL REALIZED TRADES\n";
    csv += arrayToCsv(
      [
        "Symbol", "Side", "Quantity", "Entry Price", "Exit Price", "P&L",
        "Entry Date", "Exit Date", "Holding Days", "Classification", "Strategy",
        // Round-5 F-9 — flag column. Boolean as "TRUE"/"" so the CSV is
        // immediately filterable in Excel.
        "Wash Sale Loss Disallowed",
      ],
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
        t.washSaleLossDisallowed ? "TRUE" : "",
      ])
    );
    downloadCsv(`tax-report-${taxYear}.csv`, csv);
  };

  // Tone helpers shared with the short/long-term breakdown
  const netTone = (v: number): "profit" | "loss" | "neutral" =>
    v > 0 ? "profit" : v < 0 ? "loss" : "neutral";
  const fmtSigned = (v: number): string =>
    v > 0 ? `+${formatCurrency(v)}` : formatCurrency(v);

  return (
    <div className="space-y-4">
      {/* Summary — KpiTile gives the same 20px mono-tabular hero scalar
          as the Portfolio Statement tiles. Hint line carries the trade
          count so the net dollar figure reads first. */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <KpiTile
          label="Short-term net"
          value={fmtSigned(shortTermGains + shortTermLosses)}
          tone={netTone(shortTermGains + shortTermLosses)}
          hint={`${shortTermTrades.length} trades`}
        />
        <KpiTile
          label="Long-term net"
          value={fmtSigned(longTermGains + longTermLosses)}
          tone={netTone(longTermGains + longTermLosses)}
          hint={`${longTermTrades.length} trades`}
        />
        <KpiTile
          label="Total realized"
          value={fmtSigned(totalRealized)}
          tone={netTone(totalRealized)}
          hint={
            washSaleCount > 0
              ? `${classified.length} trades · ${fmtSigned(adjustedRealized)} (wash-sale-adjusted)`
              : `${classified.length} trades in ${taxYear}`
          }
        />
      </div>

      {/* Breakdown tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Short-term */}
        <div>
          <p className="t-label mb-2">Short-Term (held &le; 365 days)</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-md border border-border bg-[var(--panel)] p-2.5 text-center">
              <p className="t-label mb-1">Gains</p>
              <p className={cn(
                "t-num-md tabular-nums",
                shortTermGains > 0 ? "text-[var(--profit)]" : "text-fg-muted",
              )}>
                {shortTermGains > 0 ? "+" : ""}{formatCurrency(shortTermGains)}
              </p>
            </div>
            <div className="rounded-md border border-border bg-[var(--panel)] p-2.5 text-center">
              <p className="t-label mb-1">Losses</p>
              <p className={cn(
                "t-num-md tabular-nums",
                shortTermLosses < 0 ? "text-[var(--loss)]" : "text-fg-muted",
              )}>
                {formatCurrency(shortTermLosses)}
              </p>
            </div>
          </div>
        </div>

        {/* Long-term */}
        <div>
          <p className="t-label mb-2">Long-Term (held &gt; 365 days)</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-md border border-border bg-[var(--panel)] p-2.5 text-center">
              <p className="t-label mb-1">Gains</p>
              <p className={cn(
                "t-num-md tabular-nums",
                longTermGains > 0 ? "text-[var(--profit)]" : "text-fg-muted",
              )}>
                {longTermGains > 0 ? "+" : ""}{formatCurrency(longTermGains)}
              </p>
            </div>
            <div className="rounded-md border border-border bg-[var(--panel)] p-2.5 text-center">
              <p className="t-label mb-1">Losses</p>
              <p className={cn(
                "t-num-md tabular-nums",
                longTermLosses < 0 ? "text-[var(--loss)]" : "text-fg-muted",
              )}>
                {formatCurrency(longTermLosses)}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Trade list preview */}
      {classified.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full">
            <thead>
              <tr className="bg-[var(--panel)] border-b border-border">
                <th className="px-3 py-2 text-left"><span className="t-label">Symbol</span></th>
                <th className="px-3 py-2 text-left"><span className="t-label">Type</span></th>
                <th className="px-3 py-2 text-right"><span className="t-label">P&amp;L</span></th>
                <th className="px-3 py-2 text-right"><span className="t-label">Days held</span></th>
                <th className="px-3 py-2 text-left"><span className="t-label">Exit date</span></th>
              </tr>
            </thead>
            <tbody>
              {classified.slice(0, 30).map(t => (
                <tr key={t.id} className="border-b border-border-hair last:border-0">
                  <td className="px-3 py-2 font-mono text-body-sm text-ink-900">
                    {t.symbol}
                    {/* Round-5 F-9 — WS tag rendered next to the symbol so
                        a glance at the table flags disallowed losses
                        without scrolling sideways. */}
                    {t.washSaleLossDisallowed && (
                      <span
                        data-testid="wash-sale-tag"
                        title="Wash-sale: this loss may be disallowed because the same symbol re-opened within 30 days. Best-effort detection — consult a professional."
                        className="ml-2 inline-block rounded-sm bg-amber/20 px-1.5 py-0.5 text-label font-bold uppercase tracking-wider text-state-warning-fg"
                        style={{ letterSpacing: "0.1em" }}
                      >
                        WS
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className={cn(
                      "inline-block rounded-sm px-2 py-0.5 font-sans text-label font-semibold uppercase",
                      t.isLongTerm
                        ? "bg-primary/15 text-primary"
                        : "bg-bg-elev-1 text-fg-muted",
                    )}
                    style={{ letterSpacing: "0.08em" }}>
                      {t.classification}
                    </span>
                  </td>
                  <td className={cn(
                    "px-3 py-2 text-right t-num-md tabular-nums",
                    (t.pnl ?? 0) > 0 ? "text-[var(--profit)]" :
                    (t.pnl ?? 0) < 0 ? "text-[var(--loss)]" : "text-fg",
                  )}>
                    {(t.pnl ?? 0) > 0 ? "+" : ""}{formatCurrency(t.pnl ?? 0)}
                  </td>
                  <td className="px-3 py-2 text-right t-num-md text-fg-muted">{t.holdingDays}d</td>
                  <td className="px-3 py-2 t-meta">{t.exit_time ? new Date(t.exit_time).toLocaleDateString() : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {classified.length === 0 && (
        <p className="font-display italic text-body-sm text-fg-muted text-center py-6">No realized trades found for {taxYear} &mdash; this tax year has nothing to report.</p>
      )}

      {/* BUG-029 / Round-5 F-9 compliance disclaimer — the tax report is
          a convenience export built from trade-ledger data; it is not
          filing-ready and is not authored by a tax professional. The
          wash-sale flag is computed from same-symbol re-buys within 30
          days and does NOT account for "substantially identical"
          securities (a related call/put or ETF substitution). Copy
          lives right above the download button so it travels with the
          action. */}
      <p
        role="note"
        data-testid="tax-report-disclaimer"
        className="rounded-md border border-amber/40 bg-amber/5 px-3 py-2 font-sans text-label leading-snug text-state-warning-fg"
      >
        Not tax advice — consult a professional. Wash-sale flags are
        computational best-effort: same-symbol re-buys within 30 days are
        flagged, but &ldquo;substantially identical&rdquo; securities (related
        options, ETF substitutions, etc.) are not detected.
      </p>

      <Button
        onClick={handleDownload}
        size="sm"
        className="gap-1.5"
        // 2026-04-21 — disable when the selected tax year has no realized
        // trades; the CSV would otherwise export just headers + disclaimer.
        disabled={classified.length === 0}
        title={
          classified.length === 0
            ? `No realized trades to export for ${taxYear}`
            : undefined
        }
      >
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
      onKeyDown={handleRadioGroupKeyDown}
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
              "font-mono text-label px-2.5 py-1 rounded transition-colors",
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

  // 2026-04-21 — editorial "no data yet" card mirrors the analytics page.
  // Triggered when we have zero closed trades across the whole dataset
  // AND no current positions, so every report section would be empty.
  // Range selector is intentionally suppressed here since narrowing the
  // window would still yield empty sections.
  const allEmpty =
    trades.length === 0 &&
    positions.length === 0 &&
    strategies.length === 0;

  if (allEmpty) {
    return (
      <ScrollArea className="h-full">
        <DashboardPageLayout eyebrow="§ REPORTS" title="Reports">
          <div className="rounded-xl border border-border bg-[var(--panel)] px-8 py-12">
            <div className="flex flex-col gap-4 max-w-[640px]">
              <span className="t-label">§ AWAITING DATA</span>
              <p className="t-section-display">
                Reports become available after your first closed trades.
              </p>
              <p className="font-sans text-body-sm leading-relaxed text-fg-muted">
                Portfolio statement, strategy performance, and the tax-year
                breakdown will appear here once trades accumulate. Nothing
                is exportable yet.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {[
                  ["Daily blotter", "Needs at least one order or closed trade in the selected range."],
                  ["Strategy performance", "Needs strategy-attributed trades or active strategy positions."],
                  ["Risk summary", "Needs broker equity, positions, and market value snapshots."],
                  ["Tax/export", "Needs realized P/L from closed trades before CSV export enables."],
                ].map(([label, detail]) => (
                  <div key={label} className="rounded-md border border-border-hair bg-bg px-3 py-3">
                    <p className="t-label text-fg-hint">{label}</p>
                    <p className="mt-1 text-label leading-snug text-fg-muted">{detail}</p>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  href="/trade"
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-sm border border-border-strong",
                    "bg-transparent px-4 py-2 font-sans text-body-sm font-medium",
                    "text-fg hover:bg-bg-elev-1 hover:border-primary transition-colors",
                    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand",
                  )}
                >
                  Place your first trade
                  <span aria-hidden>&rarr;</span>
                </Link>
                <Link
                  href="/strategies"
                  className={cn(
                    "inline-flex min-h-10 items-center gap-1.5 rounded-sm border border-border-hair",
                    "bg-bg px-4 font-sans text-body-sm font-medium text-fg-muted",
                    "text-fg hover:bg-bg-elev-1 hover:border-primary transition-colors",
                    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand",
                  )}
                >
                  Review strategies
                </Link>
                <Link
                  href="/analytics"
                  className={cn(
                    "inline-flex min-h-10 items-center gap-1.5 rounded-sm border border-border-hair",
                    "bg-bg px-4 font-sans text-body-sm font-medium text-fg-muted",
                    "text-fg hover:bg-bg-elev-1 hover:border-primary transition-colors",
                    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand",
                  )}
                >
                  Open analytics
                </Link>
              </div>
            </div>
          </div>
        </DashboardPageLayout>
      </ScrollArea>
    );
  }

  return (
    <ScrollArea className="h-full">
      <DashboardPageLayout eyebrow="§ REPORTS" title="Reports" actions={rangeSelector}>
        {/* Portfolio Statement */}
        <SectionCard title="Portfolio statement" eyebrow="§ STATEMENT" icon={FileText}>
          {summary ? (
            <PortfolioStatement summary={summary} positions={positions} trades={filteredTrades} />
          ) : (
            <p className="font-display italic text-body-sm text-fg-muted text-center py-6">
              Unable to load portfolio data.
            </p>
          )}
        </SectionCard>

        {/* Strategy Performance */}
        <SectionCard title="Strategy performance" eyebrow="§ STRATEGIES" icon={BarChart3}>
          <StrategyPerformanceReport strategies={strategies} trades={filteredTrades} />
        </SectionCard>

        {/* M-O S — Execution-quality / slippage telemetry. Panel renders
            its own header + empty state, so no SectionCard wrapper. */}
        <SlippagePanel />

        {/* v2 phase 1.9 — Tax/Lots section using ControlModule + Stat
         * + StatusBanner primitives. Demo data; backend B.13 wires
         * live lot tracking + IRS Pub 550 wash-sale engine + 8949
         * export. Renders above the legacy "Tax report (simplified)"
         * card so operators see the v2 lot-level surface first. */}
        <TaxLotsSection />


        {/* Tax Report */}
        <SectionCard title="Tax report (simplified)" eyebrow="§ TAX YEAR" icon={Calculator} defaultOpen={false}>
          <div className="mb-4 flex items-center gap-3">
            <label htmlFor="tax-year" className="t-label">
              Tax Year
            </label>
            <select
              id="tax-year"
              value={taxYear}
              onChange={(e) => setTaxYear(parseInt(e.target.value))}
              className={cn(
                "h-7 rounded-sm border border-border bg-bg px-2",
                "font-mono text-label tabular-nums text-ink-900",
                "focus-visible:outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-brand",
              )}
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
