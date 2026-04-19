"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import DashboardPageLayout from "@/components/layouts/DashboardPageLayout";
import Display from "@/components/typography/Display";
import Mono from "@/components/typography/Mono";
import RegimePill from "@/components/primitives/RegimePill";
import StatusDot from "@/components/primitives/StatusDot";
import type {
  Regime,
  RegimeVol,
} from "@/components/primitives/RegimePill";
import {
  getStrategies,
  getStrategyPerformance,
  type StrategyPerformance,
} from "@/lib/api";
import {
  STRATEGY_META,
  STRATEGY_ORDER,
  metaStage,
  type StrategyStage,
} from "@/lib/strategies";
import { cn } from "@/lib/utils";

/**
 * /strategies — listing / catalogue page.
 *
 * Wave 27 ghost-strategy remediation: typing `/strategies` in the URL bar
 * previously hit Next's generic 404 because only the deep-link
 * `/strategies/[id]` existed. Researchers arriving from a URL or a nav
 * expecting a catalogue got nothing.
 *
 * This page groups strategies by implementation stage:
 *   · Active — live, decorator-registered backends actually running
 *   · Paused — live backends the trader has toggled off
 *   · Coming soon — planned / advertised but not yet built (ghosts)
 *
 * Ghost cards are visually muted (dashed border, reduced opacity) and
 * non-clickable. The goal is transparency: researchers see the roadmap
 * without the rail pretending these strategies trade.
 */

// ─── Types ───────────────────────────────────────────────────

interface ListingStrategy {
  id: string;
  displayName: string; // from STRATEGY_META.name (italic-serif)
  subtitle: string;
  stage: StrategyStage;
  apiStatus: "active" | "paused" | "backtest" | "unknown";
  investedAmount: number;
  totalReturnPct: number;
  activePositions: number;
  sharpe: number | null;
  cagr: number | null; // fraction (0.362 → 36.2%)
  maxDD: number | null; // fraction; sign varies per backend
}

type Bucket = "active" | "paused" | "coming_soon";

// ─── Formatters ──────────────────────────────────────────────

function signedNumber(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "\u2014";
  const sign = n >= 0 ? "+" : "\u2212";
  return `${sign}${Math.abs(n).toFixed(2)}`;
}

function fractionToPct(n: number | null, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "\u2014";
  const pct = n * 100;
  const sign = pct >= 0 ? "+" : "\u2212";
  return `${sign}${Math.abs(pct).toFixed(digits)}%`;
}

function drawdownToPct(n: number | null): string {
  // MaxDD is rendered as a signed loss number. Backends emit either a
  // negative or positive fraction; use absolute value then prepend minus.
  if (n == null || !Number.isFinite(n)) return "\u2014";
  const pct = Math.abs(n) * 100;
  return `\u2212${pct.toFixed(1)}%`;
}

// ─── Status regime mapping (mirror of detail page) ───────────

function statusRegime(bucket: Bucket): {
  regime: Regime;
  vol?: RegimeVol;
  label: string;
} {
  if (bucket === "active")
    return { regime: "bull", vol: "low", label: "active" };
  if (bucket === "paused")
    return { regime: "neutral", vol: "elevated", label: "paused" };
  return { regime: "neutral", label: "coming soon" };
}

// ─── Bucket assignment ───────────────────────────────────────

function bucketFor(s: ListingStrategy): Bucket {
  if (s.stage === "planned") return "coming_soon";
  // Live or "other" (manual): fall through to API status. Anything the API
  // returns as "active" is bucketed active; "paused"/"backtest"/"unknown"
  // are paused (keeps the listing honest).
  if (s.apiStatus === "active") return "active";
  return "paused";
}

// ─── Strategy card ───────────────────────────────────────────

function StrategyCatalogCard({
  s,
  bucket,
}: {
  s: ListingStrategy;
  bucket: Bucket;
}) {
  const comingSoon = bucket === "coming_soon";
  const regime = statusRegime(bucket);

  const labelParts: string[] = [s.displayName, regime.label];
  if (s.sharpe != null) labelParts.push(`OOS Sharpe ${signedNumber(s.sharpe)}`);
  if (s.cagr != null) labelParts.push(`CAGR ${fractionToPct(s.cagr, 1)}`);

  const bodyContent = (
    <>
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div
            className="font-display italic text-[19px] leading-[1.1] text-fg"
            style={{ letterSpacing: "-0.01em" }}
          >
            {s.displayName}
          </div>
          <div className="font-sans text-[11.5px] leading-[1.4] text-fg-muted">
            {s.subtitle}
          </div>
        </div>
        <RegimePill
          regime={regime.regime}
          vol={regime.vol}
          label={regime.label.toUpperCase()}
        />
      </header>

      <div className="grid grid-cols-3 gap-3 border-t border-border-hair pt-3">
        <MetricCell label="OOS SHARPE" value={signedNumber(s.sharpe)} />
        <MetricCell label="CAGR" value={fractionToPct(s.cagr, 1)} />
        <MetricCell label="MAX DD" value={drawdownToPct(s.maxDD)} />
      </div>

      {!comingSoon && (
        <div className="flex items-center justify-between font-mono text-[10.5px] text-fg-muted">
          <span className="flex items-center gap-1.5">
            <StatusDot
              tone={bucket === "active" ? "profit" : "muted"}
              size={5}
            />
            <span>{s.activePositions} positions</span>
          </span>
          <span>
            Invested{" "}
            <b className="font-medium text-fg">
              {formatUsd(s.investedAmount)}
            </b>
          </span>
        </div>
      )}

      {comingSoon && (
        <p className="font-sans text-[11px] leading-relaxed text-fg-hint">
          Advertised in the catalogue. No backend implementation ships yet —
          the strategy will become tradable once the Python package lands
          under <Mono className="text-[10.5px]">backend/strategies/</Mono>.
        </p>
      )}
    </>
  );

  const sharedClasses = cn(
    "flex flex-col gap-3 rounded-md p-4",
    "bg-bg-elev-1 transition-colors",
    comingSoon
      ? "border border-dashed border-border-hair opacity-75 cursor-default"
      : "border border-border-hair hover:border-border hover:bg-bg-card"
  );

  if (comingSoon) {
    return (
      <div
        data-testid="strategy-card"
        data-stage="planned"
        aria-label={`${labelParts.join(" — ")}. Not yet implemented.`}
        className={sharedClasses}
      >
        {bodyContent}
      </div>
    );
  }

  return (
    <Link
      data-testid="strategy-card"
      data-stage={s.stage}
      href={`/strategies/${s.id}`}
      aria-label={labelParts.join(" — ")}
      className={cn(sharedClasses, "group/strat focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand")}
    >
      {bodyContent}
      <span
        aria-hidden
        className={cn(
          "mt-0.5 inline-flex items-center gap-1 font-display italic text-[13px] text-brand",
          "opacity-0 transition-opacity duration-150",
          "group-hover/strat:opacity-100 group-focus/strat:opacity-100"
        )}
        style={{ letterSpacing: "-0.01em" }}
      >
        open <ArrowRight className="h-3 w-3" />
      </span>
    </Link>
  );
}

function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span
        className="font-sans text-[9.5px] uppercase text-fg-muted"
        style={{ letterSpacing: "0.12em" }}
      >
        {label}
      </span>
      <Mono className="text-[13.5px] tabular-nums text-fg">{value}</Mono>
    </div>
  );
}

function formatUsd(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "$0";
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

// ─── Section block ───────────────────────────────────────────

function Section({
  title,
  count,
  strategies,
  bucket,
  empty,
}: {
  title: string;
  count: number;
  strategies: ListingStrategy[];
  bucket: Bucket;
  empty: string;
}) {
  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-3">
          <Display size="md" as="h2" className="text-[22px]">
            {title}
          </Display>
          <Mono size="micro" className="text-fg-hint">
            {String(count).padStart(2, "0")}
          </Mono>
        </div>
      </header>
      {strategies.length === 0 ? (
        <div className="rounded-md border border-dashed border-border-hair bg-bg-elev-1 px-4 py-8 text-center font-display italic text-[14px] text-fg-muted">
          {empty}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {strategies.map((s) => (
            <StrategyCatalogCard key={s.id} s={s} bucket={bucket} />
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Page ────────────────────────────────────────────────────

export default function StrategiesListingPage() {
  const [summaries, setSummaries] = useState<
    Awaited<ReturnType<typeof getStrategies>> | null
  >(null);
  const [perf, setPerf] = useState<Record<string, StrategyPerformance>>({});
  const [loadError, setLoadError] = useState<string | null>(null);

  // Initial summaries — fills investedAmount / status / positions for every
  // strategy in one call.
  useEffect(() => {
    let cancelled = false;
    getStrategies()
      .then((rows) => {
        if (!cancelled) setSummaries(rows);
      })
      .catch((err) => {
        if (!cancelled)
          setLoadError(err?.message ?? "Failed to load strategies");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Fan out per-strategy performance calls so OOS metrics (Sharpe, CAGR,
  // MaxDD) render on each card. Fetched only for live strategies — ghosts
  // don't have backend data and "other" (manual) doesn't run a backtest.
  useEffect(() => {
    if (!summaries) return;
    let cancelled = false;
    const ids = summaries
      .map((r) => r.id)
      .filter((id) => metaStage(id) === "live");
    (async () => {
      const entries = await Promise.all(
        ids.map(async (id) => {
          try {
            const p = await getStrategyPerformance(id);
            return [id, p] as const;
          } catch {
            return null;
          }
        })
      );
      if (cancelled) return;
      const next: Record<string, StrategyPerformance> = {};
      for (const e of entries) if (e) next[e[0]] = e[1];
      setPerf(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [summaries]);

  const strategies = useMemo<ListingStrategy[]>(() => {
    const apiById = new Map(
      (summaries ?? []).map((s) => [s.id, s] as const)
    );
    // Every id in STRATEGY_META is a candidate. We prefer STRATEGY_ORDER for
    // stable sequencing; any id not listed there falls back to alphabetical.
    const orderedIds = [
      ...STRATEGY_ORDER.filter((id) => STRATEGY_META[id]),
      ...Object.keys(STRATEGY_META)
        .filter((id) => !STRATEGY_ORDER.includes(id))
        .sort(),
    ];
    return orderedIds.map((id) => {
      const meta = STRATEGY_META[id];
      const api = apiById.get(id);
      const p = perf[id];
      const stage = metaStage(id);
      const rawStatus = (api?.status ?? "").toLowerCase();
      const apiStatus: ListingStrategy["apiStatus"] =
        rawStatus === "active"
          ? "active"
          : rawStatus === "paused"
            ? "paused"
            : rawStatus === "backtest"
              ? "backtest"
              : "unknown";
      return {
        id,
        displayName: meta.name,
        subtitle: meta.regimeNote,
        stage,
        apiStatus,
        investedAmount: api?.invested_amount ?? 0,
        totalReturnPct: api?.total_return_pct ?? 0,
        activePositions: api?.active_positions_count ?? 0,
        sharpe: p?.sharpe_ratio ?? null,
        cagr: p?.cagr ?? null,
        maxDD: p?.max_drawdown ?? null,
      } satisfies ListingStrategy;
    });
  }, [summaries, perf]);

  const grouped = useMemo(() => {
    const g: Record<Bucket, ListingStrategy[]> = {
      active: [],
      paused: [],
      coming_soon: [],
    };
    for (const s of strategies) g[bucketFor(s)].push(s);
    return g;
  }, [strategies]);

  const counts = {
    active: grouped.active.length,
    paused: grouped.paused.length,
    coming_soon: grouped.coming_soon.length,
    total: strategies.length,
  };

  const loading = summaries == null && !loadError;

  const summaryLine = loading ? (
    "Loading catalogue\u2026"
  ) : (
    <>
      {counts.active} active · {counts.paused} paused · {counts.coming_soon}{" "}
      coming soon
      <span className="text-fg-hint"> · {counts.total} total</span>
    </>
  );

  const actions = (
    <span className="font-sans text-[11px] text-fg-muted tabular-nums">
      {summaryLine}
    </span>
  );

  return (
    <DashboardPageLayout
      eyebrow="§ STRATEGIES"
      title="Strategies"
      actions={actions}
    >
      <main aria-label="Strategies catalogue" className="flex flex-col gap-8">
        {loadError && (
          <div
            role="alert"
            className="rounded-md border border-border-hair bg-bg-elev-1 px-4 py-3 font-sans text-[12px] text-fg-muted"
          >
            Couldn't load catalogue: {loadError}
          </div>
        )}

        {loading && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="h-[180px] animate-pulse rounded-md border border-border-hair bg-bg-elev-1"
              />
            ))}
          </div>
        )}

        {!loading && (
          <>
            <Section
              title="Active"
              count={counts.active}
              bucket="active"
              strategies={grouped.active}
              empty="No strategies currently active."
            />
            {grouped.paused.length > 0 && (
              <Section
                title="Paused"
                count={counts.paused}
                bucket="paused"
                strategies={grouped.paused}
                empty="No paused strategies."
              />
            )}
            {grouped.coming_soon.length > 0 && (
              <Section
                title="Coming soon"
                count={counts.coming_soon}
                bucket="coming_soon"
                strategies={grouped.coming_soon}
                empty="No planned strategies."
              />
            )}
          </>
        )}
      </main>
    </DashboardPageLayout>
  );
}
