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
  getStrategyCatalog,
  getStrategyPerformance,
  type StrategyCatalogEntry,
  type StrategyPerformance,
} from "@/lib/api";
import {
  STRATEGY_META,
  STRATEGY_ORDER,
  metaStage,
  type StrategyStage,
} from "@/lib/strategies";
import { computeStrategyCounts } from "@/lib/strategiesSummary";
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
  // A3#2 (Wave 8) — routing flags driving the card pill. Sourced from the
  // ``/api/v1/strategies/catalog`` endpoint once it resolves; pre-seeded
  // from the static client-side manifest below so the pill appears on
  // first paint for ``orb`` (live-denied) and ``kama-breakout`` (paper-only).
  liveDisabled: boolean;
  paperOnly: boolean;
}

type Bucket = "active" | "paused" | "coming_soon";

// ─── A3#2 — static routing-flag manifest ─────────────────────
// Mirrors ``backend/core/config.py``'s ``STRATEGY_LIVE_DISABLED`` /
// ``STRATEGY_PAPER_ONLY`` sets so the list-page card pills appear
// immediately, before the catalog endpoint round-trips. The backend
// catalog response is still the source of truth — it unions with this
// manifest, so a flag flipped server-side but not yet mirrored here still
// lights the pill. Update whenever the backend sets change.
const LIVE_DISABLED: ReadonlySet<string> = new Set(["orb"]);
const PAPER_ONLY: ReadonlySet<string> = new Set(["kama-breakout"]);

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

function statusRegime(
  bucket: Bucket,
  strategy?: ListingStrategy,
): {
  regime: Regime;
  vol?: RegimeVol;
  label: string;
} {
  if (bucket === "active")
    return { regime: "bull", vol: "low", label: "active" };
  if (bucket === "paused") {
    // BUG-010: if the strategy is demoted to "paused" because live trading
    // is denied, label the pill "paper only" so the card reads coherently
    // next to the "Not ready for live" warning pill, instead of the generic
    // "paused" which hides the real reason.
    if (strategy?.liveDisabled)
      return { regime: "neutral", vol: "elevated", label: "paper only" };
    if (strategy?.paperOnly)
      return { regime: "neutral", vol: "elevated", label: "paper only" };
    return { regime: "neutral", vol: "elevated", label: "paused" };
  }
  return { regime: "neutral", label: "coming soon" };
}

// ─── Bucket assignment ───────────────────────────────────────

function bucketFor(s: ListingStrategy): Bucket {
  if (s.stage === "planned") return "coming_soon";
  // BUG-010: "ACTIVE" and "NOT READY FOR LIVE" must be mutually exclusive.
  // A strategy the backend flags as live-disabled cannot also carry the
  // green ACTIVE pill even if its apiStatus string is "active" — demote
  // it to paused so the RegimePill reads "PAUSED" alongside the warning.
  if (s.liveDisabled) return "paused";
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
  const regime = statusRegime(bucket, s);

  const labelParts: string[] = [s.displayName, regime.label];
  if (s.sharpe != null) labelParts.push(`OOS Sharpe ${signedNumber(s.sharpe)}`);
  if (s.cagr != null) labelParts.push(`CAGR ${fractionToPct(s.cagr, 1)}`);

  // A3#2 (Wave 8) — routing-flag pill. Shows "NOT READY FOR LIVE" for
  // live-denied strategies (e.g. ``orb``) and "PAPER-ONLY" for thin-OOS
  // strategies (e.g. ``kama-breakout``). ``aria-label`` keeps the text
  // screen-reader-friendly; ``text-amber-100`` mirrors the
  // StrategyDisclosure component's WCAG contrast fix (A3#5).
  const pillLabel = s.liveDisabled
    ? "Not ready for live"
    : s.paperOnly
      ? "Paper-only"
      : null;
  // Persona 71-7 — the card ``aria-label`` previously read as
  // "Orb, active, OOS Sharpe +4.78" and omitted the warning pill.
  // A screen-reader user browsing the listing would not hear
  // "NOT READY FOR LIVE" / "PAPER-ONLY" until they opened the card.
  // Append the pill copy (lowercased so the whole label reads as a
  // single natural sentence fragment) so the warning travels with the
  // name.
  if (pillLabel) labelParts.push(pillLabel.toLowerCase());
  const pillAriaLabel = s.liveDisabled
    ? "Live trading disabled"
    : s.paperOnly
      ? "Paper trading only"
      : undefined;

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
          {pillLabel ? (
            <span
              data-testid="strategy-card-pill"
              role="status"
              aria-label={pillAriaLabel}
              className={cn(
                "mt-1 inline-flex w-fit items-center rounded-pill border border-amber/60 px-2 py-0.5",
                "font-sans text-[9.5px] font-semibold uppercase tracking-[0.14em] text-amber-100"
              )}
            >
              {pillLabel}
            </span>
          ) : null}
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
          <span
            title={formatUsdPrecise(s.investedAmount)}
            aria-label={`Invested ${formatUsdPrecise(s.investedAmount)}`}
          >
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

// BUG-055 — precise dollar figure surfaced in the `title` tooltip (and the
// aria-label) alongside the abbreviated "$4.9K" cell. "$4.9K" could represent
// anything from $4,851 to $4,949; the tooltip settles the ambiguity without
// adding visual weight to the card.
function formatUsdPrecise(n: number): string {
  if (!Number.isFinite(n)) return "$0.00";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
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
  // A3#2 (Wave 8) — routing-flag catalog. ``null`` during first paint;
  // replaced by the server payload once ``/api/v1/strategies/catalog``
  // resolves. The per-card pill falls back to ``LIVE_DISABLED`` /
  // ``PAPER_ONLY`` until this lands, so the pill is never absent for the
  // strategies those static sets cover.
  const [catalog, setCatalog] = useState<StrategyCatalogEntry[] | null>(null);

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

  // A3#2 (Wave 8) — catalog fetch (cheap, no DB). Failure is non-fatal:
  // the static manifest still lights the pill for ``orb`` and
  // ``kama-breakout``, which are the cases that actually matter.
  useEffect(() => {
    let cancelled = false;
    getStrategyCatalog()
      .then((rows) => {
        if (!cancelled) setCatalog(rows);
      })
      .catch(() => {
        // Silent — static manifest covers the visible strategies; no need
        // to show a toast or block the page on a catalog miss.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Fan out per-strategy performance calls so OOS metrics (Sharpe, CAGR,
  // MaxDD) render on each card. Fetched only for live strategies — ghosts
  // don't have backend data and "other" (manual) doesn't run a backtest.
  //
  // 2026-04-20 — progressive per-id resolve (was Promise.all). A single slow
  // /performance endpoint used to block every card's metrics until the
  // slowest request returned, which manifested as em-dashes on Active cards
  // during cold-start windows. We now `setPerf(prev => ({...prev, [id]: p}))`
  // as each request settles, so fast cards paint numbers immediately while
  // stragglers fill in.
  useEffect(() => {
    if (!summaries) return;
    let cancelled = false;
    const ids = summaries
      .map((r) => r.id)
      .filter((id) => metaStage(id) === "live");
    for (const id of ids) {
      (async () => {
        try {
          const p = await getStrategyPerformance(id);
          if (cancelled) return;
          setPerf((prev) => ({ ...prev, [id]: p }));
        } catch {
          // Silent — leave the card showing em-dashes instead of toasting
          // per-strategy failures. Overall page stays usable.
        }
      })();
    }
    return () => {
      cancelled = true;
    };
  }, [summaries]);

  const strategies = useMemo<ListingStrategy[]>(() => {
    const apiById = new Map(
      (summaries ?? []).map((s) => [s.id, s] as const)
    );
    // A3#2 (Wave 8) — lookup from the catalog endpoint, keyed by strategy id.
    // The static manifest below acts as a fallback until this arrives (and
    // also hardens us against a catalog miss in the field).
    const catalogById = new Map(
      (catalog ?? []).map((c) => [c.id, c] as const)
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
      const c = catalogById.get(id);
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
      // Union the static manifest with the server catalog: static set lights
      // the pill immediately on first paint, server can only ever widen it.
      const liveDisabled = LIVE_DISABLED.has(id) || (c?.live_disabled ?? false);
      const paperOnly = PAPER_ONLY.has(id) || (c?.paper_only ?? false);
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
        liveDisabled,
        paperOnly,
      } satisfies ListingStrategy;
    });
  }, [summaries, perf, catalog]);

  const grouped = useMemo(() => {
    const g: Record<Bucket, ListingStrategy[]> = {
      active: [],
      paused: [],
      coming_soon: [],
    };
    for (const s of strategies) g[bucketFor(s)].push(s);
    return g;
  }, [strategies]);

  // BUG-009: route all three places that display strategy counts (desk
  // rail, this page, /reports) through one aggregator. The old
  // `grouped.active.length / grouped.paused.length / …` calculation still
  // works for splitting cards across buckets, but the header text reads
  // the single-source numbers so the three displays never drift apart.
  const sharedCounts = computeStrategyCounts(summaries);
  const counts = {
    active: sharedCounts.active,
    paused: sharedCounts.paused,
    coming_soon: sharedCounts.comingSoon,
    total: sharedCounts.catalogueTotal,
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

        {/* Persona 67-10 — blanket past-performance disclosure mirrored
            from the strategy detail page. Researchers arriving at the
            catalogue before drilling into a strategy should see the
            caveat once, up-front. Styled with ``text-fg-hint`` so it
            doesn't compete with the card sections above. */}
        <footer className="border-t border-border-hair pt-6">
          <p className="font-sans text-[11.5px] leading-relaxed text-fg-hint">
            Past performance does not guarantee future results. Backtest
            metrics are derived from historical data; live results may
            differ materially. See the{" "}
            <Link
              href="/risk"
              className="underline underline-offset-2 hover:text-fg-muted"
            >
              Risk Disclosure
            </Link>{" "}
            at /risk.
          </p>
        </footer>
      </main>
    </DashboardPageLayout>
  );
}
