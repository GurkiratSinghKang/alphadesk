"use client";

import { useMemo, useState } from "react";

export type ApiServiceKey =
  | "portfolio"
  | "market"
  | "orders"
  | "strategies"
  | "pipeline"
  | "alerts"
  | "reports"
  | "assistant"
  | "backend";

export interface ApiServiceIssue {
  key: ApiServiceKey;
  label: string;
  status?: number;
  message: string;
  path?: string;
  count: number;
  lastSeen: number;
}

export const API_SERVICE_LABELS: Record<ApiServiceKey, string> = {
  portfolio: "Portfolio",
  market: "Market data",
  orders: "Orders",
  strategies: "Strategies",
  pipeline: "Pipeline",
  alerts: "Alerts",
  reports: "Reports",
  assistant: "AI assistant",
  backend: "Backend",
};

/**
 * EOP-AUDIT 2026-05-06 / B1.22: which UI views go cached/locked/empty
 * when an upstream service is degraded. Surfaced in the expanded
 * banner so a user sees concretely what data they cannot trust.
 *
 * These labels aren't routes — they're the user-visible names of the
 * panels affected. A market-data outage hits "Strike ladder · IV term
 * structure · Quote prices"; a strategies-router outage hits the
 * earnings options play page itself.
 */
export const API_SERVICE_AFFECTED_VIEWS: Record<ApiServiceKey, string[]> = {
  portfolio: ["Positions", "Portfolio summary", "Account balance"],
  market: ["Strike ladder", "IV term structure", "Quote prices", "Options chain"],
  orders: ["Recent orders", "Trade ticket", "Order history"],
  strategies: ["Earnings options play", "Strategy detail", "Setup recommendations"],
  pipeline: ["Pipeline status", "Strategy run log"],
  alerts: ["Alert center", "Notifications"],
  reports: ["Performance reports", "Trade exports"],
  assistant: ["AI thesis", "Full research"],
  backend: ["General API responses"],
};

export function classifyApiService(path?: string): ApiServiceKey {
  const p = (path ?? "").toLowerCase();
  if (p.includes("portfolio") || p.includes("positions")) return "portfolio";
  if (p.includes("quote") || p.includes("bars") || p.includes("market") || p.includes("options")) return "market";
  if (p.includes("orders") || p.includes("trades")) return "orders";
  if (p.includes("strategies") || p.includes("earnings") || p.includes("tradingagents")) return "strategies";
  if (p.includes("pipeline") || p.includes("scheduler")) return "pipeline";
  if (p.includes("alerts")) return "alerts";
  if (p.includes("reports") || p.includes("exports")) return "reports";
  if (p.includes("agents") || p.includes("chat")) return "assistant";
  return "backend";
}

/**
 * EOP-AUDIT 2026-05-06 / B1.21: when the user dismisses the banner
 * we record the timestamp; if the issue is still emitting events past
 * the auto-reappear window we resurrect the banner. localStorage
 * keeps the dismiss decision sticky across full reloads.
 */
export const BANNER_DISMISS_LSK = "alphadesk:api-degraded-banner:dismissed-at";
export const BANNER_REAPPEAR_AFTER_MS = 60_000;

export function readDismissedAt(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(BANNER_DISMISS_LSK);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function writeDismissedAt(at: number | null): void {
  if (typeof window === "undefined") return;
  try {
    if (at === null) window.localStorage.removeItem(BANNER_DISMISS_LSK);
    else window.localStorage.setItem(BANNER_DISMISS_LSK, String(at));
  } catch {
    /* localStorage unavailable (private mode etc) — fall back to in-memory only */
  }
}

export function ApiDegradedBanner({
  issues,
  onDismiss,
  onRetry,
}: {
  issues: ApiServiceIssue[];
  onDismiss: () => void;
  /**
   * EOP-AUDIT 2026-05-06 / B1.22: retry the affected fetches. Triggers
   * a global refetch event the data hooks listen for; banner stays up
   * until the next render confirms the issues array is empty.
   */
  onRetry: () => void;
}) {
  // EOP-AUDIT 2026-05-06 / B1.22: expand-on-click reveals the affected
  // views + last fetch attempt + retry. Default-collapsed so the
  // happy-degraded path doesn't dominate the chrome.
  const [expanded, setExpanded] = useState(false);
  // Aggregate distinct affected-view labels across all degraded
  // services; deduped so two market-data and one strategies error
  // don't double-list "Strike ladder".
  const affectedViews = useMemo(() => {
    const seen = new Set<string>();
    for (const issue of issues) {
      for (const view of API_SERVICE_AFFECTED_VIEWS[issue.key] ?? []) {
        seen.add(view);
      }
    }
    return Array.from(seen);
  }, [issues]);
  if (issues.length === 0) return null;
  const labels = issues.map((issue) => issue.label).join(", ");
  const count = issues.reduce((sum, issue) => sum + issue.count, 0);
  const newest = issues[0];
  const newestSeenAt = newest?.lastSeen
    ? new Date(newest.lastSeen).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      })
    : null;
  // QA r4-2 — token-ized. Raw amber hex literals replaced with the
  // --state-warning-* semantic tokens (dark warning bg, warning border,
  // warning fg, warning fg-muted). The button hover shade is derived
  // via color-mix so we don't need a one-off token for it.
  return (
    <div
      role="status"
      aria-live="polite"
      data-slot="api-degraded-banner"
      data-expanded={expanded || undefined}
      className="w-full border-b border-state-warning-border bg-state-warning-bg px-4 py-2 text-state-warning-fg"
    >
      <div className="mx-auto flex max-w-[1500px] flex-col gap-2 text-label leading-snug sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls="api-degraded-banner-detail"
          onClick={() => setExpanded((v) => !v)}
          className="flex min-w-0 flex-1 items-start gap-2 text-left"
        >
          <span aria-hidden className="select-none font-mono">
            {expanded ? "▾" : "▸"}
          </span>
          <span className="min-w-0 flex-1">
            <span className="font-semibold uppercase tracking-wide">Data unavailable</span>
            <span className="mx-2 text-state-warning-fg-muted">·</span>
            <span className="font-medium">{labels}</span>
            <span className="mx-2 text-state-warning-fg-muted">·</span>
            <span className="text-state-warning-fg-muted">
              grouped {count} backend issue{count === 1 ? "" : "s"}; affected views stay cached, locked, or empty.
            </span>
            {newest?.message ? (
              <span className="ml-2 hidden text-state-warning-fg-muted md:inline">
                Latest: {newest.message}
              </span>
            ) : null}
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            data-slot="api-degraded-banner-retry"
            onClick={onRetry}
            className="inline-flex min-h-8 shrink-0 items-center justify-center self-start rounded-sm border border-state-warning-border px-3 font-sans text-label font-semibold text-state-warning-fg transition-colors hover:bg-[color-mix(in_oklab,var(--state-warning-bg)_55%,var(--state-warning-border))] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-state-warning-fg sm:self-auto"
          >
            Retry
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="inline-flex min-h-8 shrink-0 items-center justify-center self-start rounded-sm border border-state-warning-border px-3 font-sans text-label font-semibold text-state-warning-fg transition-colors hover:bg-[color-mix(in_oklab,var(--state-warning-bg)_55%,var(--state-warning-border))] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-state-warning-fg sm:self-auto"
          >
            Dismiss
          </button>
        </div>
      </div>
      {expanded && (
        <div
          id="api-degraded-banner-detail"
          data-slot="api-degraded-banner-detail"
          className="mx-auto mt-2 max-w-[1500px] border-t border-state-warning-border/60 pt-2 text-label leading-snug"
        >
          {affectedViews.length > 0 && (
            <p className="text-state-warning-fg-muted">
              <span className="font-semibold text-state-warning-fg">Affected:</span>{" "}
              {affectedViews.join(" · ")}
            </p>
          )}
          {newestSeenAt && (
            <p className="text-state-warning-fg-muted">
              Last fetch attempt at {newestSeenAt}
              {newest?.path ? ` (${newest.path})` : ""}.
            </p>
          )}
          {newest?.message && (
            <p className="text-state-warning-fg-muted md:hidden">
              Latest: {newest.message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
