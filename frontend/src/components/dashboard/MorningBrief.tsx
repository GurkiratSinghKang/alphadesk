"use client";

import { useState, useEffect } from "react";
import { Sun, Moon, Sunrise, X, TrendingUp, TrendingDown, Zap, BarChart3, Sparkles } from "lucide-react";
import { formatCurrency, cn } from "@/lib/utils";
import { useMorningBrief } from "@/hooks/useQueries";
import type { MorningBriefData } from "@/lib/api";

// ─── Helpers ───────────────────────────────────────────────────

function getGreeting(): { text: string; icon: typeof Sun } {
  const hour = new Date().getHours();
  if (hour < 12) return { text: "Good morning", icon: Sunrise };
  if (hour < 17) return { text: "Good afternoon", icon: Sun };
  return { text: "Good evening", icon: Moon };
}

function getMarketStatus(): { label: string; color: string } {
  const now = new Date();
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const h = et.getHours();
  const m = et.getMinutes();
  const mins = h * 60 + m;
  const day = et.getDay();

  if (day === 0 || day === 6) return { label: "Closed", color: "text-muted-foreground" };
  if (mins < 570) return { label: "Pre-Market", color: "text-blue-400" };       // before 9:30
  if (mins < 960) return { label: "Market Open", color: "text-emerald-400" };   // 9:30–16:00
  if (mins < 1200) return { label: "After Hours", color: "text-amber-400" };    // 16:00–20:00
  return { label: "Closed", color: "text-muted-foreground" };
}

function getDismissKey(): string {
  const d = new Date();
  return `alphadesk-brief-dismissed-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ─── Component ─────────────────────────────────────────────────

export function MorningBrief() {
  const { data, isLoading } = useMorningBrief();

  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(getDismissKey()) === "1";
  });

  // Clean up old dismiss keys on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    const currentKey = getDismissKey();
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("alphadesk-brief-dismissed-") && key !== currentKey) {
        localStorage.removeItem(key);
      }
    }
  }, []);

  const handleDismiss = () => {
    localStorage.setItem(getDismissKey(), "1");
    setDismissed(true);
  };

  if (dismissed) return null;

  // Loading skeleton
  if (isLoading || !data) {
    return (
      <div className="relative overflow-hidden rounded-xl border border-border bg-[var(--panel)] p-5 animate-pulse">
        <div className="h-5 w-48 rounded bg-muted/40 mb-3" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="h-20 rounded-lg bg-muted/30" />
          <div className="h-20 rounded-lg bg-muted/30" />
          <div className="h-20 rounded-lg bg-muted/30" />
        </div>
        <div className="h-12 rounded bg-muted/20 mt-4" />
      </div>
    );
  }

  return <MorningBriefContent data={data} onDismiss={handleDismiss} />;
}

// ─── Content (separated to avoid hook ordering issues) ─────────

function MorningBriefContent({
  data,
  onDismiss,
}: {
  data: MorningBriefData;
  onDismiss: () => void;
}) {
  const greeting = getGreeting();
  const market = getMarketStatus();
  const GreetingIcon = greeting.icon;

  const isUp = data.portfolio.overnight_change >= 0;

  return (
    <div className="group relative overflow-hidden rounded-xl border border-border bg-[var(--panel)]">
      {/* Subtle gradient accent along the top */}
      <div
        className="absolute inset-x-0 top-0 h-[2px]"
        style={{
          background: isUp
            ? "linear-gradient(90deg, rgba(16,185,129,0.6) 0%, rgba(59,130,246,0.4) 100%)"
            : "linear-gradient(90deg, rgba(239,68,68,0.6) 0%, rgba(168,85,247,0.4) 100%)",
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
                <GreetingIcon className="h-3.5 w-3.5 text-amber-400" />
                <h3 className="text-sm font-semibold text-foreground">
                  {greeting.text}
                </h3>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs text-muted-foreground">{data.date}</span>
                <span className="text-[10px] text-muted-foreground/60">|</span>
                <span className={cn("text-xs font-medium", market.color)}>
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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          {/* Portfolio Overnight Change */}
          <div className="rounded-lg border border-border/50 bg-[var(--surface)] p-3">
            <div className="flex items-center gap-1.5 mb-2">
              {isUp ? (
                <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
              ) : (
                <TrendingDown className="h-3.5 w-3.5 text-red-500" />
              )}
              <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                Overnight
              </span>
            </div>
            <div className="flex items-baseline gap-2">
              <span
                className={cn(
                  "text-lg font-bold tabular-nums",
                  isUp ? "text-emerald-500" : "text-red-500"
                )}
              >
                {isUp ? "+" : ""}
                {formatCurrency(data.portfolio.overnight_change)}
              </span>
              <span
                className={cn(
                  "text-xs font-medium tabular-nums",
                  isUp ? "text-emerald-500/70" : "text-red-500/70"
                )}
              >
                ({isUp ? "+" : ""}
                {data.portfolio.overnight_change_pct.toFixed(2)}%)
              </span>
            </div>
            <div className="text-[11px] text-muted-foreground mt-1">
              Equity {formatCurrency(data.portfolio.equity)}
            </div>
          </div>

          {/* Top Movers */}
          <div className="rounded-lg border border-border/50 bg-[var(--surface)] p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <BarChart3 className="h-3.5 w-3.5 text-blue-400" />
              <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                Top Movers
              </span>
            </div>
            <div className="space-y-1.5">
              {data.top_movers.length === 0 && (
                <span className="text-xs text-muted-foreground">No positions</span>
              )}
              {data.top_movers.slice(0, 3).map((m) => {
                const mUp = m.change_pct >= 0;
                return (
                  <div key={m.symbol} className="flex items-center justify-between">
                    <span className="text-xs font-mono font-medium text-foreground">
                      {m.symbol}
                    </span>
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "text-[11px] font-medium tabular-nums",
                          mUp ? "text-emerald-500" : "text-red-500"
                        )}
                      >
                        {mUp ? "+" : ""}
                        {m.change_pct.toFixed(1)}%
                      </span>
                      <span
                        className={cn(
                          "text-[11px] tabular-nums",
                          m.impact >= 0
                            ? "text-emerald-500/70"
                            : "text-red-500/70"
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
              <Zap className="h-3.5 w-3.5 text-amber-400" />
              <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                Market
              </span>
            </div>
            <div className="space-y-1.5">
              {/* Regime badge */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Regime
                </span>
                <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                  {data.market.regime}
                </span>
              </div>
              {/* VIX */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">VIX</span>
                <span className="text-xs font-medium tabular-nums text-foreground">
                  {data.market.vix.toFixed(1)}
                  <span
                    className={cn(
                      "ml-1 text-[11px]",
                      data.market.vix_change >= 0
                        ? "text-red-500/70"
                        : "text-emerald-500/70"
                    )}
                  >
                    ({data.market.vix_change >= 0 ? "+" : ""}
                    {data.market.vix_change.toFixed(1)})
                  </span>
                </span>
              </div>
              {/* SPY */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">S&P 500</span>
                <span
                  className={cn(
                    "text-xs font-medium tabular-nums",
                    data.market.spy_change_pct >= 0
                      ? "text-emerald-500"
                      : "text-red-500"
                  )}
                >
                  {data.market.spy_change_pct >= 0 ? "+" : ""}
                  {data.market.spy_change_pct.toFixed(2)}%
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* AI Summary */}
        <div className="rounded-lg bg-muted/30 border border-border/30 px-4 py-3 mb-3">
          <div className="flex items-start gap-2">
            <Sparkles className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
            <p className="text-xs leading-relaxed text-foreground/80">
              {data.ai_summary}
            </p>
          </div>
        </div>

        {/* Catalysts */}
        {data.catalysts.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Upcoming
            </span>
            {data.catalysts.map((c) => (
              <span
                key={c}
                className="inline-flex items-center rounded-full border border-border/50 bg-[var(--surface)] px-2 py-0.5 text-[11px] text-muted-foreground"
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
