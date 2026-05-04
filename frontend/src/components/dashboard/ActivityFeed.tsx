"use client";

import React, { useState, useEffect } from "react";
import {
  TrendingUp,
  Activity,
  BarChart3,
  AlertTriangle,
  Info,
  Radio,
  RefreshCw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { PipelineStatus } from "@/lib/api";

// ─── Types ───────────────────────────────────────────────────

export interface FeedItem {
  id: string;
  time: Date;
  type: "pipeline" | "trade" | "position" | "regime" | "alert";
  severity: "success" | "danger" | "info" | "warning";
  title: string;
  detail?: string;
}

export interface RegimeData {
  regime: string;
  label: string;
  confidence: number;
  vix_level: number;
  description: string;
}

export interface NewsItem {
  title: string;
  source: string;
  published_at: string;
  url: string;
}

const MAX_FEED_ITEMS = 10;

// Use canonical strategy metadata for name lookups
import { STRATEGY_META } from "@/lib/strategies";

function humanizeStrategyId(id: string): string {
  // Try canonical metadata first (handles both hyphenated and underscored IDs)
  if (STRATEGY_META[id]) return STRATEGY_META[id].shortName;
  const hyphenated = id.replace(/_/g, "-");
  if (STRATEGY_META[hyphenated]) return STRATEGY_META[hyphenated].shortName;
  // Fallback: capitalize and replace separators
  return id.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Constants ───────────────────────────────────────────────

const FEED_ICONS: Record<FeedItem["type"], typeof Activity> = {
  pipeline: RefreshCw,
  trade: TrendingUp,
  position: BarChart3,
  regime: Radio,
  alert: AlertTriangle,
};

const SEVERITY_COLORS: Record<FeedItem["severity"], string> = {
  success: "text-[var(--profit)]",
  danger: "text-[var(--loss)]",
  info: "text-ice",
  warning: "text-amber",
};

const SEVERITY_BORDER: Record<FeedItem["severity"], string> = {
  success: "border-l-[var(--profit)]/40",
  danger: "border-l-[var(--loss)]/60",
  info: "border-l-ice/35",
  warning: "border-l-amber/50",
};

// ─── Helpers ─────────────────────────────────────────────────

function formatTime(date: Date): string {
  const now = new Date();
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  const time = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  if (isToday) return time;

  const dateStr = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  return `${dateStr} ${time}`;
}

// ─── Feed Builder ────────────────────────────────────────────

export function buildFeedItems(
  pipelineStatus: PipelineStatus | null,
  pipelineLog: Record<string, any> | null,
  regime: RegimeData | null,
): FeedItem[] {
  const items: FeedItem[] = [];
  const now = new Date();

  // Pipeline run summary
  if (pipelineLog) {
    const ordersPlaced = Array.isArray(pipelineLog.orders_placed) ? pipelineLog.orders_placed : [];
    const ordersClosed = Array.isArray(pipelineLog.orders_closed) ? pipelineLog.orders_closed : [];
    const errors = Array.isArray(pipelineLog.errors) ? pipelineLog.errors : [];
    const ts = pipelineLog.timestamp ? new Date(pipelineLog.timestamp) : now;

    // Aggregate strategy stats from the log (key is strategies_run or strategies)
    const strats = pipelineLog.strategies_run ?? pipelineLog.strategies ?? {};
    let totalScreened = 0;
    let totalAnalyzed = 0;
    let totalRequested = 0;
    let totalApproved = 0;
    for (const s of Object.values(strats) as any[]) {
      totalScreened += s.screened ?? 0;
      totalAnalyzed += s.analyzed ?? 0;
      totalRequested += s.trades_requested ?? 0;
      totalApproved += s.trades_approved ?? 0;
    }

    // Main pipeline summary
    items.push({
      id: "pipeline-run",
      time: ts,
      type: "pipeline",
      severity: errors.length > 0 ? "warning" : "success",
      title: `Pipeline completed: ${totalScreened} screened, ${totalAnalyzed} analyzed, ${totalApproved} trades approved`,
      detail: totalRequested > totalApproved
        ? `${totalRequested - totalApproved} candidate(s) rejected by risk manager`
        : undefined,
    });

    // Master agent rejections
    const master = pipelineLog.master_agent ?? {};
    const rejections = master.rejections ?? [];
    if (rejections.length > 0) {
      // Show each rejection with its remediation advice
      for (const r of rejections.slice(0, 5) as any[]) {
        items.push({
          id: `rejection-${r.symbol}-${r.strategy}`,
          time: ts,
          type: "pipeline",
          severity: "warning",
          title: `Rejected: ${r.symbol} (${humanizeStrategyId(r.strategy)})`,
          detail: `${r.reason}${r.remediation ? ` → ${r.remediation}` : ""}`,
        });
      }
      if (rejections.length > 5) {
        items.push({
          id: "pipeline-rejections-overflow",
          time: ts,
          type: "pipeline",
          severity: "info",
          title: `+${rejections.length - 5} more rejected trade(s)`,
          detail: "Check pipeline logs for full details.",
        });
      }
    }

    // Individual trade executions
    for (const order of ordersPlaced) {
      const orderTs = order.timestamp ? new Date(order.timestamp) : ts;
      items.push({
        id: `trade-open-${order.symbol}-${order.order_id ?? order.orderId ?? ""}`,
        time: orderTs,
        type: "trade",
        severity: "info",
        title: `${order.side === "buy" ? "Bought" : "Sold"} ${order.qty} ${order.symbol} @ $${(Number(order.price) ?? 0).toFixed(2)}`,
        detail: order.strategy ? `via ${humanizeStrategyId(order.strategy)}` : undefined,
      });
    }

    // Closed positions
    for (const order of ordersClosed) {
      const orderTs = order.timestamp ? new Date(order.timestamp) : ts;
      const pnl = order.pnl ?? null;
      const qty = Number(order.qty) || 0;
      const price = Number(order.price) || 0;
      const qtyStr = qty > 0 ? ` ${qty} shares` : '';
      const priceStr = price > 0 ? ` @ $${price.toFixed(2)}` : '';
      const closeTitle = qty > 0 || price > 0
        ? `Closed ${order.symbol}:${qtyStr}${priceStr}`
        : `Closed ${order.symbol}`;
      items.push({
        id: `trade-close-${order.symbol}-${order.order_id ?? order.orderId ?? ""}`,
        time: orderTs,
        type: "trade",
        severity: pnl !== null ? (pnl >= 0 ? "success" : "danger") : "info",
        title: closeTitle,
        detail: pnl !== null ? `P&L: ${pnl >= 0 ? "+" : ""}$${(Number(pnl) ?? 0).toFixed(2)}` : undefined,
      });
    }

    // Errors
    for (let i = 0; i < errors.length; i++) {
      items.push({
        id: `error-${i}`,
        time: ts,
        type: "alert",
        severity: "danger",
        title: `Pipeline error: ${typeof errors[i] === "string" ? errors[i] : JSON.stringify(errors[i])}`,
      });
    }
  }

  // Pipeline status info
  if (pipelineStatus) {
    if (pipelineStatus.running) {
      items.push({
        id: "pipeline-running",
        time: now,
        type: "pipeline",
        severity: "info",
        title: "Pipeline is currently running...",
      });
    }
  }

  // Regime info
  if (regime) {
    items.push({
      id: "regime-current",
      time: now,
      type: "regime",
      severity: regime.label === "bear" ? "danger" : regime.label === "bull" ? "success" : "warning",
      title: `Market regime: ${regime.regime}`,
      detail: regime.description,
    });
  }

  // Downgrade "trading window" messages from warning to info
  for (const item of items) {
    if (
      item.severity === "warning" &&
      (item.title.toLowerCase().includes("trading window") ||
       (item.detail && item.detail.toLowerCase().includes("trading window")))
    ) {
      item.severity = "info";
    }
  }

  // Sort by time descending and limit to most recent items
  items.sort((a, b) => b.time.getTime() - a.time.getTime());
  return items.slice(0, MAX_FEED_ITEMS);
}

// ─── Feed Item Component ─────────────────────────────────────

const FeedItemRow = React.memo(function FeedItemRow({ item }: { item: FeedItem }) {
  const Icon = FEED_ICONS[item.type];
  const isHighlight = item.severity === "danger" || item.severity === "warning";
  const isTradingWindow = item.title.toLowerCase().includes("trading window") ||
    (item.detail && item.detail.toLowerCase().includes("trading window"));

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border-l-2 px-3 py-2.5 transition-colors",
        SEVERITY_BORDER[item.severity],
        isHighlight ? "bg-[var(--surface)]" : "hover:bg-[var(--surface)]/50"
      )}
    >
      <div className={cn("mt-0.5 shrink-0", SEVERITY_COLORS[item.severity])}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className={cn("text-body-sm leading-snug", isTradingWindow ? "text-muted-foreground" : "text-foreground")}>{item.title}</p>
        {item.detail && (
          <span className="mt-0.5 block text-xs text-muted-foreground" title={item.detail}>
            {item.detail.length > 120 ? item.detail.slice(0, 120) + '...' : item.detail}
          </span>
        )}
      </div>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {formatTime(item.time)}
      </span>
    </div>
  );
});

// ─── Activity Feed Panel ─────────────────────────────────────

interface ActivityFeedProps {
  feedItems: FeedItem[];
  onNavigate: (path: string) => void;
  isLoading?: boolean;
}

export function ActivityFeed({ feedItems, onNavigate, isLoading }: ActivityFeedProps) {
  const [justMounted, setJustMounted] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setJustMounted(false), 800);
    return () => clearTimeout(timer);
  }, []);

  const showLoading = isLoading || (justMounted && feedItems.length === 0);

  // Compute badge label: "Today" if the latest feed item is from today, otherwise show the date
  const badgeLabel = (() => {
    if (feedItems.length === 0) return "Today";
    const latest = feedItems[0].time;
    const now = new Date();
    const isToday =
      latest.getFullYear() === now.getFullYear() &&
      latest.getMonth() === now.getMonth() &&
      latest.getDate() === now.getDate();
    if (isToday) return "Today";
    return latest.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  })();

  return (
    <div className="rounded-xl border border-border bg-[var(--panel)]">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">
            Activity Feed
          </h2>
          <Badge variant="outline" className="text-xs text-muted-foreground">
            {badgeLabel}
          </Badge>
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">
          {showLoading ? "\u2014" : `${feedItems.length} event${feedItems.length !== 1 ? "s" : ""}`}
        </span>
      </div>
      <ScrollArea className={feedItems.length <= 3 ? "max-h-[200px]" : "h-[320px]"}>
        <div className="space-y-1 p-3">
          {showLoading ? (
            <div className="space-y-2 py-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-start gap-3 rounded-lg px-3 py-2.5 animate-pulse">
                  <div className="h-4 w-4 rounded bg-muted-foreground/20 shrink-0 mt-0.5" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 w-3/4 rounded bg-muted-foreground/20" />
                    <div className="h-2.5 w-1/2 rounded bg-muted-foreground/10" />
                  </div>
                </div>
              ))}
            </div>
          ) : feedItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8">
              <Info className="h-6 w-6 mb-2 opacity-30 text-muted-foreground" />
              <p className="text-body">No activity yet today</p>
              <p className="text-hint mt-1">Events appear when the pipeline runs</p>
              <button
                onClick={() => onNavigate("/pipeline")}
                className="mt-2 text-label text-[var(--primary)] hover:underline"
              >
                Run Pipeline &rarr;
              </button>
            </div>
          ) : (
            feedItems.map((item) => (
              <FeedItemRow key={item.id} item={item} />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
