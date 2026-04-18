"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Pause, Play, ArrowRight } from "lucide-react";

import Display from "@/components/typography/Display";
import Eyebrow from "@/components/typography/Eyebrow";
import Mono from "@/components/typography/Mono";
import SectionRule from "@/components/typography/SectionRule";
import RegimePill from "@/components/primitives/RegimePill";
import type { Regime, RegimeVol } from "@/components/primitives/RegimePill";
import {
  getStrategyPerformance,
  getStrategyTrades,
  getStrategyPositions,
  toggleStrategy,
  getBars,
  type StrategyPerformance,
  type StrategyTrade,
  type StrategyPositionDetail,
} from "@/lib/api";
import { STRATEGY_CONTENT, type StrategyContent } from "@/lib/strategy-content";
import { STRATEGY_META } from "@/lib/strategies";
import { cn } from "@/lib/utils";

import StrategyHero from "./_strategy/StrategyHero";
import EquityPanel, {
  type EquityPoint,
  type EquityRange,
} from "./_strategy/EquityPanel";
import SignalSection from "./_strategy/SignalSection";
import PositionsSection from "./_strategy/PositionsSection";
import LimitationsSection from "./_strategy/LimitationsSection";

// ─── Slug alias (canonical strategy ids) ────────────────────────

const SLUG_TO_ID: Record<string, string> = {
  "earnings-vol": "earnings-vol-premium",
};
function resolveStrategyId(slug: string): string {
  return SLUG_TO_ID[slug] ?? slug;
}

// ─── Category label from STRATEGY_META.group ───────────────────

const GROUP_LABEL: Record<string, string> = {
  fundamental: "Fundamental / event-driven",
  technical: "Technical / signal-driven",
  other: "Discretionary",
};

// ─── Academic sources per strategy (locally known — derived from Phase 2 content) ──

const ACADEMIC_SOURCES: Record<string, string[]> = {
  "momentum-quality": [
    "Jegadeesh & Titman (1993). Returns to Buying Winners and Selling Losers.",
    "Piotroski (2000). Value Investing: Using Historical Financial Statement Information.",
    "Daniel & Moskowitz (2016). Momentum Crashes.",
    "Asness, Frazzini & Pedersen (2019). Quality Minus Junk.",
  ],
  pead: [
    "Bernard & Thomas (1989, 1990). Post-Earnings-Announcement Drift.",
    "Livnat & Mendenhall (2006). Comparing the Post-Earnings Announcement Drift.",
    "Chu, Hirshleifer & Ma (2020). The Causal Effect of Limits to Arbitrage on Asset Pricing Anomalies.",
  ],
  "vrp-harvesting": [
    "Bakshi & Madan (2006). A Theory of Volatility Spreads.",
    "Carr & Wu (2009). Variance Risk Premiums.",
    "Dubinsky & Johannes (2023). Tail Hedging and the Variance Risk Premium.",
  ],
};

// ─── Period filter for equity curve ────────────────────────────

function filterCurve(curve: EquityPoint[], range: EquityRange): EquityPoint[] {
  if (range === "ALL" || curve.length === 0) return curve;
  const now = new Date();
  const cutoff = new Date();
  switch (range) {
    case "1M":
      cutoff.setMonth(now.getMonth() - 1);
      break;
    case "3M":
      cutoff.setMonth(now.getMonth() - 3);
      break;
    case "YTD":
      cutoff.setMonth(0);
      cutoff.setDate(1);
      break;
    case "1Y":
      cutoff.setFullYear(now.getFullYear() - 1);
      break;
  }
  return curve.filter((p) => new Date(p.date) >= cutoff);
}

// ─── Metric cell formatters ────────────────────────────────────

function formatOrDash(value: number | null | undefined, format: (n: number) => string): string {
  if (value == null || Number.isNaN(value) || value === 0) return "\u2014";
  return format(value);
}
function signedPct(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}
function signedNumber(v: number): string {
  return v.toFixed(2);
}
function negPct(v: number): string {
  return `${v < 0 ? v.toFixed(1) : `-${Math.abs(v).toFixed(1)}`}%`;
}

// ─── Hit rate derivation from closed trades ────────────────────

function deriveHitRate(trades: StrategyTrade[]): number | null {
  const closed = trades.filter(
    (t) => t.pnl != null && (t.status === "closed" || t.status === "filled" || t.exit_price != null)
  );
  if (closed.length === 0) return null;
  const wins = closed.filter((t) => (t.pnl ?? 0) > 0).length;
  return (wins / closed.length) * 100;
}

// ─── Last trade-date ───────────────────────────────────────────

function formatLastTrade(dateStr: string | undefined | null): string {
  if (!dateStr) return "\u2014";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ─── Regime signal from status ────────────────────────────────

function statusRegime(status: string | undefined): { regime: Regime; vol?: RegimeVol; label: string } {
  if (status === "active") return { regime: "bull", vol: "low", label: "active" };
  if (status === "paused") return { regime: "neutral", vol: "elevated", label: "paused" };
  if (status === "halted") return { regime: "crisis", vol: "high", label: "halted" };
  return { regime: "neutral", vol: "elevated", label: status ?? "idle" };
}

// ─── Main page component ──────────────────────────────────────

export default function StrategyDetailPage() {
  const params = useParams();
  const router = useRouter();
  const rawSlug = params.id as string;
  const strategyId = resolveStrategyId(rawSlug);

  const [perf, setPerf] = useState<StrategyPerformance | null>(null);
  const [trades, setTrades] = useState<StrategyTrade[]>([]);
  const [positions, setPositions] = useState<StrategyPositionDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<EquityRange>("3M");
  const [toggling, setToggling] = useState(false);
  const [benchmark, setBenchmark] = useState<EquityPoint[]>([]);

  const meta = STRATEGY_META[strategyId] || {
    name: strategyId,
    shortName: strategyId,
    group: "other" as const,
  };
  const content: StrategyContent | null = STRATEGY_CONTENT[strategyId] ?? null;
  const categoryLabel = GROUP_LABEL[meta.group] ?? "Strategy";

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [p, t, pos] = await Promise.allSettled([
      getStrategyPerformance(strategyId),
      getStrategyTrades(strategyId),
      getStrategyPositions(strategyId),
    ]);
    if (p.status === "fulfilled") setPerf(p.value);
    if (t.status === "fulfilled") setTrades(t.value);
    if (pos.status === "fulfilled") setPositions(pos.value);
    setLoading(false);
  }, [strategyId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // SPY benchmark pull once we know equity-curve length
  useEffect(() => {
    if (!perf?.equity_curve || perf.equity_curve.length < 2) return;
    let cancelled = false;
    getBars("SPY", "D", perf.equity_curve.length + 5)
      .then((bars) => {
        if (cancelled || bars.length === 0) return;
        const first = bars[0].close;
        setBenchmark(
          bars.map((b) => ({
            date: new Date(b.time * 1000).toISOString().slice(0, 10),
            value: (b.close / first - 1) * 100,
          }))
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [perf?.equity_curve]);

  async function handleToggle() {
    if (!perf) return;
    setToggling(true);
    try {
      const res = await toggleStrategy(strategyId);
      setPerf((prev) => (prev ? { ...prev, status: res.new_status } : prev));
    } catch {
      // swallow — the toggle endpoint may not be available
    }
    setToggling(false);
  }

  // ─── Derived metrics ─────────────────────────────────────────
  const hitRate = useMemo(() => deriveHitRate(trades), [trades]);
  const equityData = useMemo(
    () => (perf ? filterCurve(perf.equity_curve, range) : []),
    [perf, range]
  );
  const benchmarkData = useMemo(() => {
    if (equityData.length < 2) return [];
    const start = equityData[0].date;
    return benchmark.filter((b) => b.date >= start);
  }, [benchmark, equityData]);

  const status = statusRegime(perf?.status);

  const cells = [
    {
      label: "OOS SHARPE",
      value: formatOrDash(perf?.sharpe_ratio ?? null, signedNumber),
    },
    {
      label: "MAX DD",
      value: formatOrDash(perf?.max_drawdown ?? null, negPct),
      tone: (perf?.max_drawdown ?? 0) !== 0 ? ("loss" as const) : undefined,
    },
    {
      label: "CAGR",
      value: formatOrDash(perf?.annualized_return_pct ?? null, signedPct),
      tone: (perf?.annualized_return_pct ?? 0) > 0
        ? ("profit" as const)
        : (perf?.annualized_return_pct ?? 0) < 0
          ? ("loss" as const)
          : undefined,
    },
    {
      label: "HIT RATE",
      value: hitRate != null ? `${hitRate.toFixed(0)}%` : "\u2014",
    },
  ];

  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 px-6 py-8">
        <div className="h-6 w-48 animate-pulse rounded bg-bg-elev-1" />
        <div className="h-14 w-80 animate-pulse rounded bg-bg-elev-1" />
        <div className="h-[320px] animate-pulse rounded-lg bg-bg-elev-1" />
      </div>
    );
  }

  const totalReturnPct = perf?.total_return_pct ?? 0;
  const returnSummary: { label: string; value: string; tone?: "profit" | "loss" | "neutral" }[] = perf
    ? [
        {
          label: "TOTAL RETURN",
          value: signedPct(totalReturnPct),
          tone: totalReturnPct >= 0 ? "profit" : "loss",
        },
        {
          label: "CURRENT VALUE",
          value: new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: "USD",
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
          }).format(perf.current_value ?? 0),
        },
        {
          label: "INVESTED",
          value: new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: "USD",
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
          }).format(perf.invested_amount ?? 0),
        },
        {
          label: "ACTIVE POSITIONS",
          value: String(perf.active_positions_count ?? 0),
        },
      ]
    : [];

  const academicSources = ACADEMIC_SOURCES[strategyId] ?? [];
  const knownLimitations = content?.risks ?? [];

  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-10 px-6 py-8">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 font-sans text-[12px] text-fg-muted" aria-label="Breadcrumb">
        <Link href="/" className="transition-colors hover:text-fg">
          Dashboard
        </Link>
        <span aria-hidden>/</span>
        <span className="text-fg">{meta.name}</span>
      </nav>

      {/* Hero */}
      <StrategyHero
        categoryLabel={categoryLabel.toUpperCase()}
        name={meta.name}
        description={perf?.description ?? null}
        cells={cells}
      />

      {/* Status + actions row */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <RegimePill
            regime={status.regime}
            vol={status.vol}
            label={status.label.toUpperCase()}
          />
          <div className="flex flex-col">
            <Eyebrow as="span">Last trade</Eyebrow>
            <Mono className="text-[12.5px] text-fg">
              {formatLastTrade(perf?.last_trade_date)}
            </Mono>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleToggle}
            disabled={toggling || !perf}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-sm border border-border bg-bg-elev-1 px-3 py-1.5 font-sans text-[12px] font-semibold text-fg transition-colors",
              "hover:bg-bg-elev-2 disabled:opacity-50"
            )}
          >
            {perf?.status === "active" ? (
              <>
                <Pause className="h-3 w-3" aria-hidden />
                Pause
              </>
            ) : (
              <>
                <Play className="h-3 w-3" aria-hidden />
                Resume
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => router.push(`/?strategy=${strategyId}`)}
            className="inline-flex items-center gap-1.5 rounded-sm bg-brand px-3 py-1.5 font-sans text-[12px] font-semibold text-primary-foreground transition-colors hover:bg-gold-300"
          >
            View trades
            <ArrowRight className="h-3 w-3" aria-hidden />
          </button>
        </div>
      </div>

      {/* § 01 Signal */}
      {content ? (
        <section className="flex flex-col gap-6">
          <SectionRule tag="§ 01 · Signal" />
          <SignalSection
            thesis={content.thesis}
            edge={content.edge}
            howItWorks={content.howItWorks}
          />
        </section>
      ) : null}

      {/* § 02 Performance */}
      {perf ? (
        <section className="flex flex-col gap-6">
          <SectionRule tag="§ 02 · Performance" />
          <EquityPanel
            data={equityData}
            benchmark={benchmarkData.length > 1 ? benchmarkData : undefined}
            activeRange={range}
            onRangeChange={setRange}
            summary={returnSummary}
          />
        </section>
      ) : null}

      {/* § 03 Positions */}
      <section className="flex flex-col gap-6">
        <SectionRule tag="§ 03 · Positions" />
        <PositionsSection
          positions={positions}
          strategyLabel={meta.shortName}
        />
      </section>

      {/* § 04 References */}
      {academicSources.length > 0 ? (
        <section className="flex flex-col gap-4">
          <SectionRule tag="§ 04 · References" />
          <ul className="flex flex-col gap-2">
            {academicSources.map((src, i) => (
              <li
                key={i}
                className="font-display italic text-[13.5px] leading-relaxed text-fg-muted"
              >
                {src}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* § 05 Known limitations */}
      {knownLimitations.length > 0 ? (
        <section className="flex flex-col gap-4">
          <SectionRule tag="§ 05 · Known limitations" />
          <LimitationsSection items={knownLimitations} />
        </section>
      ) : null}

      {/* When-to-use epilogue (optional, renders in italic serif) */}
      {content?.whenToUse ? (
        <section className="flex flex-col gap-3 border-t border-border-hair pt-6">
          <Display size="md" as="h2">
            When to deploy
          </Display>
          <p className="max-w-[640px] font-display italic text-[15.5px] leading-relaxed text-fg">
            {content.whenToUse}
          </p>
        </section>
      ) : null}
    </div>
  );
}
