"use client";

import { useMemo } from "react";
import { Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SectorData } from "@/components/dashboard/MarketContext";

// ─── Market Breadth Indicator ───────────────────────────────

interface MarketBreadthProps {
  sectors: SectorData[];
}

type MarketHealth = "Strong" | "Neutral" | "Weak";

function getMarketHealth(advancing: number, total: number): MarketHealth {
  if (total === 0) return "Neutral";
  const ratio = advancing / total;
  if (ratio >= 0.7) return "Strong";
  if (ratio <= 0.3) return "Weak";
  return "Neutral";
}

function getHealthColor(health: MarketHealth): string {
  switch (health) {
    case "Strong":
      return "var(--profit)";
    case "Weak":
      return "var(--loss)";
    default:
      return "var(--chart-4)";
  }
}

function getHealthBgClass(health: MarketHealth): string {
  switch (health) {
    case "Strong":
      return "bg-[var(--profit)]/15 text-[var(--profit)] border-[var(--profit)]/30";
    case "Weak":
      return "bg-[var(--loss)]/15 text-[var(--loss)] border-[var(--loss)]/30";
    default:
      return "bg-[var(--chart-4)]/15 text-[var(--chart-4)] border-[var(--chart-4)]/30";
  }
}

export function MarketBreadth({ sectors }: MarketBreadthProps) {
  const { advancing, declining, unchanged, health, advDecRatio } = useMemo(() => {
    let adv = 0;
    let dec = 0;
    let unch = 0;

    for (const s of sectors) {
      if (s.change_pct > 0) adv++;
      else if (s.change_pct < 0) dec++;
      else unch++;
    }

    const total = sectors.length;
    const h = getMarketHealth(adv, total);
    const ratio = dec > 0 ? (adv / dec) : adv > 0 ? adv : 0;

    return {
      advancing: adv,
      declining: dec,
      unchanged: unch,
      health: h,
      advDecRatio: ratio,
    };
  }, [sectors]);

  const total = sectors.length;
  const healthColor = getHealthColor(health);

  // Gauge percentage: 0 = all declining, 100 = all advancing
  const gaugePercent = total > 0 ? (advancing / total) * 100 : 50;

  if (total === 0) {
    return (
      <div className="rounded-xl border border-border bg-[var(--panel)]">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">
            Market Breadth
          </h2>
        </div>
        <div className="p-4">
          <p className="text-[11px] text-muted-foreground">Loading sector data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-[var(--panel)]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">
            Market Breadth
          </h2>
        </div>
        <span
          className={cn(
            "text-[10px] font-bold uppercase px-2 py-0.5 rounded border",
            getHealthBgClass(health)
          )}
        >
          {health}
        </span>
      </div>

      {/* Gauge bar */}
      <div className="px-4 pt-3 mb-3">
        <div className="h-2 rounded-full bg-[var(--loss)]/20 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700 ease-out"
            style={{
              width: `${gaugePercent}%`,
              backgroundColor: healthColor,
            }}
          />
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-[9px] text-[var(--loss)]">Bearish</span>
          <span className="text-[9px] text-muted-foreground">Neutral</span>
          <span className="text-[9px] text-[var(--profit)]">Bullish</span>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3 px-4">
        {/* Advancing */}
        <div className="text-center">
          <div className="text-lg font-bold tabular-nums text-[var(--profit)]">
            {advancing}
          </div>
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
            Advancing
          </div>
        </div>

        {/* A/D Ratio */}
        <div className="text-center">
          <div className="text-lg font-bold tabular-nums text-foreground">
            {advDecRatio.toFixed(2)}
          </div>
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
            A/D Ratio
          </div>
        </div>

        {/* Declining */}
        <div className="text-center">
          <div className="text-lg font-bold tabular-nums text-[var(--loss)]">
            {declining}
          </div>
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
            Declining
          </div>
        </div>
      </div>

      {/* Sector breakdown */}
      {sectors.length > 0 && (
        <div className="mx-4 mt-3 pt-3 pb-4 border-t border-border">
          <div className="flex flex-wrap gap-1">
            {sectors
              .sort((a, b) => b.change_pct - a.change_pct)
              .map((s) => {
                const positive = s.change_pct >= 0;
                return (
                  <span
                    key={s.sector}
                    className={cn(
                      "text-[9px] px-1.5 py-0.5 rounded border",
                      positive
                        ? "bg-[var(--profit)]/10 text-[var(--profit)] border-[var(--profit)]/20"
                        : "bg-[var(--loss)]/10 text-[var(--loss)] border-[var(--loss)]/20"
                    )}
                  >
                    {s.sector} {positive ? "+" : ""}
                    {s.change_pct.toFixed(1)}%
                  </span>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
