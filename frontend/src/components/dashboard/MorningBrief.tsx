"use client";

import { useState, useEffect } from "react";
import type { ReactNode } from "react";
import { Sun, Moon, Sunrise, X, TrendingUp, TrendingDown, Zap, BarChart3, Sparkles } from "lucide-react";
import { formatCurrency, cn } from "@/lib/utils";
import { useMorningBrief } from "@/hooks/useQueries";
import type { MorningBriefData } from "@/lib/api";
import { getMarketSession } from "@/lib/marketHours";
import { safeSetItem, safeGetItem } from "@/lib/storage";

// ─── Helpers ───────────────────────────────────────────────────

function getGreeting(): { text: string; icon: typeof Sun } {
  const hour = new Date().getHours();
  if (hour < 12) return { text: "Good morning", icon: Sunrise };
  if (hour < 17) return { text: "Good afternoon", icon: Sun };
  return { text: "Good evening", icon: Moon };
}

/**
 * Status pill data for the Morning Brief header. Uses the shared
 * `getMarketSession` helper (DST-correct, `Intl.DateTimeFormat`-based)
 * so this component no longer owns broken `new Date(toLocaleString(...))`
 * date arithmetic that could report the wrong day in non-US locales
 * around midnight ET. After-hours window 16:00–20:00 ET is not
 * distinguished from generic "post" here because the extended window
 * runs 16:00–20:00 ET; we render it as "After Hours" for any `post`
 * session between 16:00 and 20:00, falling back to "Closed" later.
 */
function getMarketStatus(): { label: string; color: string } {
  const session = getMarketSession();
  if (session === "open") return { label: "Market Open", color: "text-profit" };
  if (session === "pre") return { label: "Pre-Market", color: "text-ice" };
  if (session === "post") {
    // After-hours extended session is 16:00–20:00 ET; past 20:00 we're
    // effectively closed for retail. Read ET hour via formatToParts —
    // the same primitive `getMarketSession` uses, no date round-trip.
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      hour12: false,
    }).formatToParts(new Date());
    const hourStr = parts.find((p) => p.type === "hour")?.value ?? "0";
    const hour = parseInt(hourStr, 10) % 24;
    if (hour < 20) return { label: "After Hours", color: "text-amber" };
    return { label: "Closed", color: "text-muted-foreground" };
  }
  return { label: "Closed", color: "text-muted-foreground" };
}

function getDismissKey(): string {
  const d = new Date();
  return `alphadesk-brief-dismissed-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ─── Component ─────────────────────────────────────────────────

interface MorningBriefProps {
  rail?: boolean;
  className?: string;
}

export function MorningBrief({ rail = false, className }: MorningBriefProps = {}) {
  const { data, isLoading, error } = useMorningBrief();

  // Always start as false during SSR to avoid hydration mismatch,
  // then check localStorage after mount
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    // Round-11 / BB-22: safeGetItem swallows Safari Private Mode throws.
    if (safeGetItem(getDismissKey()) === "1") {
      const timeout = window.setTimeout(() => setDismissed(true), 0);
      return () => window.clearTimeout(timeout);
    }
    return undefined;
  }, []);

  // Clean up old dismiss keys on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    // Round-11 / BB-22: same protection — iterating localStorage.length
    // and key(i) both throw on Safari Private Mode.
    try {
      const currentKey = getDismissKey();
      const keysToRemove: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key && key.startsWith("alphadesk-brief-dismissed-") && key !== currentKey) {
          keysToRemove.push(key);
        }
      }
      for (const key of keysToRemove) {
        window.localStorage.removeItem(key);
      }
    } catch { /* ignore — cleanup is best-effort */ }
  }, []);

  const handleDismiss = () => {
    safeSetItem(getDismissKey(), "1");
    setDismissed(true);
  };

  if (dismissed) return null;

  const wrap = (node: ReactNode) => (
    <div className={className}>{node}</div>
  );

  // If query failed or no data after loading, don't leave the dashboard rail
  // with an empty bordered slot. Render a compact, honest fallback instead.
  if (error || (!isLoading && !data)) {
    return wrap(<MorningBriefUnavailable onDismiss={handleDismiss} />);
  }

  // Loading skeleton
  if (isLoading) {
    return wrap(
      <div className="relative overflow-hidden rounded-xl border border-border bg-[var(--panel)] p-5 animate-pulse">
        <div className="h-5 w-48 rounded bg-muted/40 mb-3" />
        <div className={cn("grid gap-4", rail ? "grid-cols-1" : "grid-cols-1 md:grid-cols-3")}>
          <div className="h-20 rounded-lg bg-muted/30" />
          <div className="h-20 rounded-lg bg-muted/30" />
          <div className="h-20 rounded-lg bg-muted/30" />
        </div>
        <div className="h-12 rounded bg-muted/20 mt-4" />
      </div>
    );
  }

  return wrap(<MorningBriefContent data={data!} onDismiss={handleDismiss} rail={rail} />);
}

// ─── Content (separated to avoid hook ordering issues) ─────────

function MorningBriefContent({
  data,
  onDismiss,
  rail,
}: {
  data: MorningBriefData;
  onDismiss: () => void;
  rail: boolean;
}) {
  const greeting = getGreeting();
  const market = getMarketStatus();
  const GreetingIcon = greeting.icon;

  const isUp = data.portfolio.overnight_change >= 0;

  return (
    <div className="group relative overflow-hidden rounded-xl border border-border bg-[var(--panel)]">
      {/* Subtle gradient accent along the top. Reads the design-system
          P&L tokens so it stays on-brand (chartreuse → ice for profit,
          coral → gold for loss). */}
      <div
        className="absolute inset-x-0 top-0 h-0.5"
        style={{
          background: isUp
            ? "linear-gradient(90deg, var(--profit) 0%, var(--ice-500) 100%)"
            : "linear-gradient(90deg, var(--loss) 0%, var(--gold-500) 100%)",
          opacity: 0.6,
        }}
      />

      <div className="p-5">
        {/* Header row */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <GreetingIcon className="h-3.5 w-3.5 text-amber" />
                <h3 className="text-h3 font-medium text-foreground">
                  {greeting.text}
                </h3>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-body-sm text-muted-foreground">{data.date}</span>
                <span className="text-body-sm text-muted-foreground/60">|</span>
                <span className={cn("text-body-sm font-medium", market.color)}>
                  {market.label}
                </span>
              </div>
            </div>
          </div>

          <button
            onClick={onDismiss}
            className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            aria-label="Dismiss morning brief"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Main grid: Portfolio | Movers | Market */}
        <div className={cn("grid gap-4 mb-4", rail ? "grid-cols-1" : "grid-cols-1 md:grid-cols-3")}>
          {/* Portfolio Overnight Change */}
          <div className="rounded-lg border border-border/50 bg-[var(--surface)] p-3">
            <div className="flex items-center gap-1.5 mb-2">
              {isUp ? (
                <TrendingUp className="h-3.5 w-3.5 text-profit" />
              ) : (
                <TrendingDown className="h-3.5 w-3.5 text-loss" />
              )}
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-[0.12em]">
                Overnight
              </span>
            </div>
            <div className="flex items-baseline gap-2">
              <span
                className={cn(
                  "text-h1 font-mono tabular-nums font-normal tracking-[-0.015em]",
                  isUp ? "text-profit" : "text-loss"
                )}
              >
                {isUp ? "+" : ""}
                {formatCurrency(data.portfolio.overnight_change)}
              </span>
              <span
                className={cn(
                  "text-base font-mono font-medium tabular-nums",
                  isUp ? "text-profit/70" : "text-loss/70"
                )}
              >
                ({isUp ? "+" : ""}
                {(data.portfolio.overnight_change_pct ?? 0).toFixed(2)}%)
              </span>
            </div>
            <div className="text-body-sm font-mono tabular-nums text-muted-foreground mt-1">
              Equity {formatCurrency(data.portfolio.equity)}
            </div>
          </div>

          {/* Top Movers */}
          <div className="rounded-lg border border-border/50 bg-[var(--surface)] p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <BarChart3 className="h-3.5 w-3.5 text-ice" />
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-[0.12em]">
                Top Movers
              </span>
            </div>
            <div className="space-y-1.5">
              {data.top_movers.length === 0 && (
                <span className="text-body-sm text-muted-foreground">No positions</span>
              )}
              {data.top_movers.slice(0, 3).map((m) => {
                const mUp = m.change_pct >= 0;
                return (
                  <div key={m.symbol} className="flex items-center justify-between">
                    <span className="text-body-sm font-mono font-medium text-foreground">
                      {m.symbol}
                    </span>
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "text-base font-mono font-medium tabular-nums",
                          mUp ? "text-profit" : "text-loss"
                        )}
                      >
                        {mUp ? "+" : ""}
                        {(m.change_pct ?? 0).toFixed(1)}%
                      </span>
                      <span
                        className={cn(
                          "text-base font-mono tabular-nums",
                          m.impact >= 0
                            ? "text-profit/70"
                            : "text-loss/70"
                        )}
                      >
                        {m.impact >= 0 ? "+" : ""}${Math.abs(m.impact).toFixed(0)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Market Snapshot */}
          <div className="rounded-lg border border-border/50 bg-[var(--surface)] p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <Zap className="h-3.5 w-3.5 text-amber" />
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-[0.12em]">
                Market
              </span>
            </div>
            <div className="space-y-1.5">
              {/* Regime badge */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Regime
                </span>
                <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold tracking-[0.12em] uppercase text-primary">
                  {data.market.regime}
                </span>
              </div>
              {/* VIX */}
              <div className="flex items-center justify-between">
                <span className="text-body-sm text-muted-foreground">VIX</span>
                <span className="text-base font-mono font-medium tabular-nums text-foreground">
                  {(data.market.vix ?? 0).toFixed(1)}
                  <span
                    className={cn(
                      "ml-1 text-body-sm font-mono tabular-nums",
                      (data.market.vix_change ?? 0) >= 0
                        ? "text-loss/70"
                        : "text-profit/70"
                    )}
                  >
                    ({(data.market.vix_change ?? 0) >= 0 ? "+" : ""}
                    {(data.market.vix_change ?? 0).toFixed(1)})
                  </span>
                </span>
              </div>
              {/* SPY */}
              <div className="flex items-center justify-between">
                <span className="text-body-sm text-muted-foreground">S&P 500</span>
                <span
                  className={cn(
                    "text-base font-mono font-medium tabular-nums",
                    data.market.spy_change_pct >= 0
                      ? "text-profit"
                      : "text-loss"
                  )}
                >
                  {(data.market.spy_change_pct ?? 0) >= 0 ? "+" : ""}
                  {(data.market.spy_change_pct ?? 0).toFixed(2)}%
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* AI Summary */}
        <div className="rounded-lg bg-muted/30 border border-border/30 px-4 py-3 mb-3">
          <div className="flex items-start gap-2">
            <Sparkles className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
            <p className="text-body-sm leading-relaxed text-foreground/80">
              {data.ai_summary}
            </p>
          </div>
        </div>

        {/* Catalysts */}
        {data.catalysts.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Upcoming
            </span>
            {data.catalysts.map((c) => (
              <span
                key={c}
                className="inline-flex items-center rounded-full border border-border/50 bg-[var(--surface)] px-2 py-0.5 text-body-sm text-muted-foreground"
              >
                {c}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MorningBriefUnavailable({ onDismiss }: { onDismiss: () => void }) {
  const greeting = getGreeting();
  const market = getMarketStatus();
  const GreetingIcon = greeting.icon;

  return (
    <div className="rounded-md border border-border bg-[var(--panel)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <GreetingIcon className="h-3.5 w-3.5 text-amber" aria-hidden />
            <h3 className="truncate text-body font-medium text-foreground">
              {greeting.text}
            </h3>
          </div>
          <p className="mt-1 text-label text-muted-foreground">
            {market.label} · morning brief unavailable
          </p>
        </div>
        <button
          onClick={onDismiss}
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          aria-label="Dismiss morning brief"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      <p className="mt-3 text-body-sm leading-relaxed text-muted-foreground">
        Briefing data did not load. Watchlist, positions, and strategy status are still available below.
      </p>
    </div>
  );
}
