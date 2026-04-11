"use client";

import { Newspaper, ExternalLink } from "lucide-react";
import { formatCurrency, cn } from "@/lib/utils";
import { Sparkline } from "@/components/dashboard/Sparkline";
import { AllocationDonut } from "./AllocationDonut";
import type { PortfolioSummary } from "@/types";

// ─── Types ───────────────────────────────────────────────────

export interface MarketIndex {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePct: number;
}

export interface SectorData {
  sector: string;
  change_pct: number;
}

export interface NewsItem {
  title: string;
  source: string;
  published_at: string;
  url: string;
}

// ─── Helpers ─────────────────────────────────────────────────

function formatTimeShort(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

// ─── Sector Heatmap ──────────────────────────────────────────

function SectorHeatmap({ sectors }: { sectors: SectorData[] }) {
  if (sectors.length === 0) return null;

  const abbrev: Record<string, string> = {
    Technology: "Technology",
    Healthcare: "Healthcare",
    Financials: "Financials",
    "Consumer Discretionary": "Cons. Discr.",
    "Communication Services": "Comm. Svcs",
    Industrials: "Industrials",
    "Consumer Staples": "Cons. Staples",
    Energy: "Energy",
    Utilities: "Utilities",
    "Real Estate": "Real Estate",
    Materials: "Materials",
  };

  return (
    <div className="flex flex-wrap gap-1.5">
      {sectors.map((s) => {
        const val = s.change_pct;
        const bg =
          val > 1
            ? "bg-emerald-600/70"
            : val > 0.3
              ? "bg-emerald-600/40"
              : val > 0
                ? "bg-emerald-600/20"
                : val > -0.3
                  ? "bg-red-600/20"
                  : val > -1
                    ? "bg-red-600/40"
                    : "bg-red-600/70";
        const text = val >= 0 ? "text-emerald-300" : "text-red-300";

        return (
          <div
            key={s.sector}
            className={cn(
              "rounded px-2 py-1 text-center",
              bg
            )}
          >
            <p className="text-xs font-medium text-foreground/80">
              {abbrev[s.sector] ?? s.sector}
            </p>
            <p className={cn("text-xs tabular-nums font-semibold", text)}>
              {val >= 0 ? "+" : ""}
              {val.toFixed(1)}%
            </p>
          </div>
        );
      })}
    </div>
  );
}

// ─── Market Context Panel ────────────────────────────────────

interface MarketContextProps {
  indices: MarketIndex[];
  sectors: SectorData[];
  news: NewsItem[];
  summary: PortfolioSummary;
  sparkData: Record<string, number[]>;
}

export function MarketContext({ indices, sectors, news, summary, sparkData }: MarketContextProps) {
  // Non-VIX indices for display
  const displayIndices = indices.filter((i) => i.symbol !== "VIX");

  return (
    <div className="rounded-xl border border-border bg-[var(--surface)] p-4">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Indices */}
        <div>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Market Indices
          </h3>
          <div className="space-y-2.5">
            {(displayIndices.length > 0 ? displayIndices : indices).map((idx) => {
              const positive = idx.changePct >= 0;
              const color = positive ? "#22c55e" : "#ef4444";
              return (
                <div
                  key={idx.symbol}
                  className="flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {idx.symbol}
                    </p>
                    <p className="text-xs text-muted-foreground">{idx.name}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <Sparkline
                      data={sparkData[idx.symbol] ?? []}
                      color={color}
                      width={64}
                      height={20}
                    />
                    <div className="text-right min-w-[90px]">
                      <p className="text-sm font-medium tabular-nums text-foreground">
                        {idx.price > 0
                          ? idx.symbol === "VIX"
                            ? idx.price.toFixed(2)
                            : formatCurrency(idx.price)
                          : "\u2014"}
                      </p>
                      <p
                        className={cn(
                          "text-xs tabular-nums",
                          positive
                            ? "text-[var(--profit)]"
                            : "text-[var(--loss)]"
                        )}
                      >
                        {positive ? "+" : ""}
                        {idx.changePct.toFixed(2)}%
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Sector Heatmap */}
        <div>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Sector Performance
          </h3>
          {sectors.length > 0 ? (
            <SectorHeatmap sectors={sectors} />
          ) : (
            <p className="text-xs text-muted-foreground">No sector data</p>
          )}
        </div>

        {/* Headlines or Account Overview */}
        <div>
          {news.length > 0 ? (
            <>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Headlines
              </h3>
              <div className="space-y-2.5">
                {news.slice(0, 3).map((article, i) => (
                  <a
                    key={i}
                    href={article.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-start gap-2 rounded-md p-1.5 -mx-1.5 transition-colors hover:bg-[var(--panel)]"
                  >
                    <Newspaper className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] leading-snug text-foreground group-hover:text-blue-400 transition-colors line-clamp-2">
                        {article.title}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {article.source}
                        {article.published_at && ` \u2022 ${formatTimeShort(article.published_at)}`}
                      </p>
                    </div>
                    <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </a>
                ))}
              </div>
            </>
          ) : (
            <AllocationDonut
              cash={summary.cash}
              invested={summary.totalMarketValue}
              equity={summary.equity}
              buyingPower={summary.buyingPower}
              unrealizedPnl={summary.unrealizedPnl}
              realizedPnlToday={summary.realizedPnlToday}
            />
          )}
        </div>
      </div>
    </div>
  );
}
