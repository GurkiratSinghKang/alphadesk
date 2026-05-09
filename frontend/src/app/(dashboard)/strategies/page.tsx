"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import DashboardPageLayout from "@/components/layouts/DashboardPageLayout";
import Mono from "@/components/typography/Mono";
import { handleRadioGroupKeyDown } from "@/lib/radioGroupKeyboard";
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
  LIVE_DISABLED,
  PAPER_ONLY,
  STRATEGY_META,
  STRATEGY_ORDER,
  metaStage,
  metaKind,
  type StrategyStage,
  type StrategyGroup,
} from "@/lib/strategies";
import ResearchStrategyCard from "@/components/strategies/ResearchStrategyCard";
import type { ResearchCardMetric } from "@/components/strategies/ResearchStrategyCard";
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
  // from the shared client-side manifest so the pill appears on first paint.
  liveDisabled: boolean;
  paperOnly: boolean;
  // v2 polish — group eyebrow ("FUNDAMENTAL" / "TECHNICAL") above the
  // readiness chip in the catalogue card, mirroring strategies-dark.png.
  group: StrategyGroup;
}

type Bucket = "active" | "paused" | "coming_soon";
type ReadinessKey = "ready" | "needs_data" | "needs_review" | "paper_only" | "blocked";
type ReadinessFilter = "all" | ReadinessKey;

// ─── Formatters ──────────────────────────────────────────────

function signedNumber(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "Needs OOS";
  const sign = n >= 0 ? "+" : "\u2212";
  return `${sign}${Math.abs(n).toFixed(2)}`;
}

function fractionToPct(n: number | null, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "Backtest pending";
  const pct = n * 100;
  const sign = pct >= 0 ? "+" : "\u2212";
  return `${sign}${Math.abs(pct).toFixed(digits)}%`;
}

function drawdownToPct(n: number | null): string {
  // MaxDD is rendered as a signed loss number. Backends emit either a
  // negative or positive fraction; use absolute value then prepend minus.
  if (n == null || !Number.isFinite(n)) return "No drawdown yet";
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
  return { regime: "neutral", label: "in development" };
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

function readinessFor(
  s: ListingStrategy,
  bucket: Bucket,
): { key: ReadinessKey; label: string; reason: string; tone: "profit" | "amber" | "loss" | "muted" } {
  if (bucket === "coming_soon") {
    return {
      key: "blocked",
      label: "Blocked",
      reason: "Backend package has not shipped yet.",
      tone: "muted",
    };
  }
  if (s.liveDisabled) {
    return {
      key: "blocked",
      label: "Not live-ready",
      reason: "Risk policy blocks live routing; use paper/research only.",
      tone: "loss",
    };
  }
  if (s.paperOnly) {
    return {
      key: "paper_only",
      label: "Paper-only",
      reason: "Implementation exists, but evidence is too thin for live.",
      tone: "amber",
    };
  }
  if (s.apiStatus === "unknown") {
    return {
      key: "needs_data",
      label: "Needs data",
      reason: "Strategy API has not supplied live status yet.",
      tone: "amber",
    };
  }
  if (bucket === "active") {
    return {
      key: "ready",
      label: "Ready",
      // v2 polish — match strategies-dark.png caption voice:
      // "Live, autonomous, unblocked." instead of generic "Enabled system".
      reason: "Live, autonomous, unblocked.",
      tone: "profit",
    };
  }
  return {
    key: "needs_review",
    label: "Needs review",
    reason: "Paused or backtest-only until a trader re-enables it.",
    tone: "amber",
  };
}

function readinessChipClass(tone: ReturnType<typeof readinessFor>["tone"]) {
  if (tone === "profit") return "border-profit/30 bg-profit/10 text-profit";
  if (tone === "loss") return "border-loss/30 bg-loss/10 text-loss";
  if (tone === "amber") return "border-amber/30 bg-amber/10 text-amber";
  return "border-border-hair bg-bg-elev-2 text-fg-muted";
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
  const readiness = readinessFor(s, bucket);

  const labelParts: string[] = [s.displayName, regime.label];
  if (s.sharpe != null) labelParts.push(`OOS Sharpe ${signedNumber(s.sharpe)}`);
  if (s.cagr != null) labelParts.push(`CAGR ${fractionToPct(s.cagr, 1)}`);

  // A3#2 (Wave 8) — routing-flag pill. Shows "NOT READY FOR LIVE" for
  // live-denied strategies (e.g. ``orb``) and "PAPER-ONLY" for thin-OOS
  // strategies (e.g. ``kama-breakout``). ``aria-label`` keeps the text
  // screen-reader-friendly; ``text-state-warning-fg`` mirrors the
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
          {/* v2 polish — group eyebrow ("FUNDAMENTAL" / "TECHNICAL")
           * matching strategies-dark.png. Sits above the italic title
           * so the card classifies the strategy at a glance. */}
          <p
            className="font-mono text-eyebrow uppercase tracking-[0.16em] text-fg-muted"
            style={{ margin: 0 }}
          >
            {s.group}
          </p>
          <div
            className="font-display italic text-h3 leading-tight text-fg"
            style={{ letterSpacing: 0 }}
          >
            {s.displayName}
          </div>
          <div className="font-sans text-label leading-snug text-fg-muted">
            {s.subtitle}
          </div>
          {pillLabel ? (
            // 2026-04-21 polish: bumped pill text from 9.5px to 11px — the
            // lower value was below the post-redesign 11px readable floor
            // (design-tokens.css sets --fs-label=12). Keep normal tracking
            // so the chip remains legible in dense card grids.
            <span
              data-testid="strategy-card-pill"
              role="status"
              aria-label={pillAriaLabel}
              className={cn(
                "mt-1 inline-flex w-fit items-center rounded-pill border border-amber/60 px-2 py-0.5",
                "font-sans text-label font-semibold uppercase tracking-normal text-state-warning-fg"
              )}
            >
              {pillLabel}
            </span>
          ) : null}
        </div>
        {/* v2 catalog polish — pair regime + readiness as a single
         * chip stack in the top-right corner so the two indicators
         * read as one unit at a glance. The verbose readiness reason
         * drops below as a quieter caption (no sub-bar chrome). */}
        <div className="flex flex-col items-end gap-1">
          <RegimePill
            regime={regime.regime}
            vol={regime.vol}
            label={regime.label.toUpperCase()}
          />
          <span
            className={cn(
              "inline-flex items-center rounded-pill border px-2 py-0.5 font-mono text-label uppercase tracking-wider",
              readinessChipClass(readiness.tone),
            )}
            title={readiness.reason}
          >
            {readiness.label}
          </span>
        </div>
      </header>

      <p className="text-label leading-snug text-fg-muted">
        {readiness.reason}
      </p>

      <div className="grid grid-cols-3 gap-3 border-t border-border-hair pt-3">
        <MetricCell label="OOS SHARPE" value={signedNumber(s.sharpe)} />
        <MetricCell label="CAGR" value={fractionToPct(s.cagr, 1)} />
        <MetricCell label="MAX DD" value={drawdownToPct(s.maxDD)} />
      </div>

      {!comingSoon && (
        // 2026-04-21 polish: the position / invested footer previously rendered
        // at 10.5px, below the post-redesign readable floor. Bumped to
        // .t-meta (13px, mono, tabular) so dollar figures keep their column
        // alignment with the card's other numeric cells.
        <div className="flex items-center justify-between t-meta text-fg-muted">
          <span className="flex items-center gap-1.5">
            <StatusDot
              tone={bucket === "active" ? "profit" : "muted"}
              size={7}
            />
            <span className="tabular-nums">{s.activePositions} positions</span>
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
        // 2026-04-21 polish: inline Mono raised from 10.5px to 12px so the
        // path token sits on the --fs-label floor and is legible at desk
        // viewing distance. Body copy raised to 12px (fs-label) to match.
        <p className="font-sans text-label leading-relaxed text-fg-hint">
          Advertised in the catalogue. No backend implementation ships yet —
          the strategy will become tradable once the Python package lands
          under <Mono className="text-label">backend/strategies/</Mono>.
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
          "mt-0.5 inline-flex items-center gap-1 font-display italic text-body-sm text-primary",
          "opacity-0 transition-opacity duration-150",
          "group-hover/strat:opacity-100 group-focus/strat:opacity-100"
        )}
        style={{ letterSpacing: 0 }}
      >
        open <ArrowRight className="h-3 w-3" />
      </span>
    </Link>
  );
}

function MetricCell({ label, value }: { label: string; value: string }) {
  // 2026-04-21 polish: card metric labels were 9.5px (well below the 11px
  // readable floor; all-caps + tracking made the problem worse at low
  // stroke weights on macOS subpixel AA). Use the repo's canonical
  // `.t-label` utility (12px fs-label, 0.12em tracking, 600 weight) so the
  // eyebrows here match every other card on the dashboard. The numeric
  // value uses tabular-nums so Sharpe / CAGR / MaxDD stay column-aligned
  // as cards re-render during the progressive per-id resolve.
  return (
    <div className="flex flex-col gap-1">
      <span className="t-label">{label}</span>
      <Mono className="text-body-sm tabular-nums text-fg">{value}</Mono>
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

function researchMetricsFor(id: string): ResearchCardMetric[] {
  if (id === "trading-agents-research") {
    return [
      { label: "MODE", value: "Read-only", hint: "no orders" },
      { label: "AGENTS", value: "6+", hint: "debate stack" },
      { label: "OUTPUT", value: "Memo", hint: "saved run" },
    ];
  }
  return [
    { label: "THIS WEEK", value: 0, hint: "earnings" },
    { label: "AVG IV RANK", value: "Needs scan", hint: "across set" },
    { label: "TOP SETUP", value: "Awaiting data", hint: "recommended" },
  ];
}

const READINESS_FILTERS: Array<{ value: ReadinessFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "ready", label: "Ready" },
  { value: "needs_data", label: "Needs data" },
  { value: "needs_review", label: "Needs review" },
  { value: "paper_only", label: "Paper-only" },
  { value: "blocked", label: "Blocked" },
];

function StrategyReadinessWorkbench({
  counts,
  activeFilter,
  onFilterChange,
}: {
  counts: Record<ReadinessKey, number>;
  activeFilter: ReadinessFilter;
  onFilterChange: (filter: ReadinessFilter) => void;
}) {
  return (
    <section className="rounded-lg border border-border-hair bg-bg-elev-1/95 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="t-label text-fg-hint">Strategy readiness workbench</p>
          <h2 className="mt-2 t-h2 text-ink-1000">Scan what can trade, what needs data, and why live is blocked.</h2>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <ReadinessDatum label="Ready" value={counts.ready} tone="profit" />
          <ReadinessDatum label="Needs data" value={counts.needs_data} tone="amber" />
          <ReadinessDatum label="Review" value={counts.needs_review} tone="amber" />
          <ReadinessDatum label="Paper" value={counts.paper_only} tone="muted" />
          <ReadinessDatum label="Blocked" value={counts.blocked} tone="loss" />
        </div>
      </div>
      <div
        className="mt-4 flex gap-2 overflow-x-auto pb-1"
        role="radiogroup"
        aria-label="Filter strategies by readiness"
        onKeyDown={handleRadioGroupKeyDown}
      >
        {READINESS_FILTERS.map((filter) => (
          <button
            key={filter.value}
            type="button"
            role="radio"
            tabIndex={activeFilter === filter.value ? 0 : -1}
            aria-checked={activeFilter === filter.value}
            onClick={() => onFilterChange(filter.value)}
            className={cn(
              "inline-flex min-h-10 shrink-0 items-center rounded-sm border px-3 font-sans text-body-sm font-semibold transition-colors",
              activeFilter === filter.value
                ? "border-primary/40 bg-primary/15 text-primary"
                : "border-border-hair bg-bg text-fg-muted hover:border-primary/30 hover:text-fg",
            )}
          >
            {filter.label}
          </button>
        ))}
      </div>
    </section>
  );
}

function ReadinessDatum({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "profit" | "amber" | "loss" | "muted";
}) {
  return (
    <div className="rounded-md border border-border-hair bg-bg px-3 py-2">
      <p className="t-label text-fg-hint">{label}</p>
      <p className={cn("mt-1 font-mono text-h3 leading-tight", readinessChipClass(tone).split(" ").find((part) => part.startsWith("text-")) ?? "text-fg")}>
        {value}
      </p>
    </div>
  );
}

// ─── Section block ───────────────────────────────────────────

function Section({
  title,
  count,
  strategies,
  bucket,
  empty,
  "data-section": dataSection,
}: {
  title: string;
  count: number;
  strategies: ListingStrategy[];
  bucket: Bucket;
  empty: string;
  "data-section"?: string;
}) {
  return (
    <section className="flex flex-col gap-3" data-section={dataSection}>
      <header className="flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-3">
          <h2 className="t-h2">
            {title}
          </h2>
          <Mono size="micro">
            {String(count).padStart(2, "0")}
          </Mono>
        </div>
      </header>
      {strategies.length === 0 ? (
        <div className="rounded-md border border-dashed border-border-hair bg-bg-elev-1 px-4 py-8 text-center font-display italic text-body text-fg-muted">
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
  const [readinessFilter, setReadinessFilter] = useState<ReadinessFilter>("all");
  // A3#2 (Wave 8) — routing-flag catalog. ``null`` during first paint;
  // replaced by the server payload once ``/api/v1/strategies/catalog``
  // resolves. The per-card pill falls back to the shared ``LIVE_DISABLED`` /
  // ``PAPER_ONLY`` manifests until this lands.
  const [catalog, setCatalog] = useState<StrategyCatalogEntry[] | null>(null);

  // Initial summaries — fills investedAmount / status / positions for every
  // strategy in one call.
  //
  // 2026-04-21 polish: extracted into a useCallback so the retry CTA below
  // can re-run the fetch without a page reload. Previously the error panel
  // had no affordance and users had to refresh the whole route to recover
  // from a transient /api/v1/strategies failure.
  const loadSummaries = useCallback(() => {
    let cancelled = false;
    setLoadError(null);
    setSummaries(null);
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
  // the shared manifest still lights first-paint routing pills.
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
        group: meta.group,
      } satisfies ListingStrategy;
    });
  }, [summaries, perf, catalog]);

  // Split research-kind strategies out BEFORE stage bucketing — they never
  // enter the active/paused/coming_soon buckets since they are not autonomous.
  const researchEntries = useMemo(
    () => strategies.filter((s) => metaKind(s.id) === "research"),
    [strategies],
  );

  const grouped = useMemo(() => {
    const g: Record<Bucket, ListingStrategy[]> = {
      active: [],
      paused: [],
      coming_soon: [],
    };
    for (const s of strategies) {
      if (metaKind(s.id) === "research") continue;
      g[bucketFor(s)].push(s);
    }
    return g;
  }, [strategies]);
  const readinessCounts = useMemo(() => {
    const counts: Record<ReadinessKey, number> = {
      ready: 0,
      needs_data: 0,
      needs_review: 0,
      paper_only: 0,
      blocked: 0,
    };
    for (const strategy of strategies) {
      if (metaKind(strategy.id) === "research") continue;
      counts[readinessFor(strategy, bucketFor(strategy)).key] += 1;
    }
    return counts;
  }, [strategies]);
  const readinessMatches = useCallback(
    (strategy: ListingStrategy) =>
      readinessFilter === "all" ||
      readinessFor(strategy, bucketFor(strategy)).key === readinessFilter,
    [readinessFilter],
  );
  const filteredGrouped = useMemo<Record<Bucket, ListingStrategy[]>>(
    () => ({
      active: grouped.active.filter(readinessMatches),
      paused: grouped.paused.filter(readinessMatches),
      coming_soon: grouped.coming_soon.filter(readinessMatches),
    }),
    [grouped, readinessMatches],
  );

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

  // Round-8 killer-move 2: aggregate Sharpe / CAGR / DD across active
  // strategies for the page hero strip. Computed over the mapped
  // ``strategies`` (ListingStrategy[]) so the field names match
  // (``investedAmount``, ``sharpe``, ``maxDD``). Only ``active``
  // bucket entries — paused / coming-soon don't dilute the signal.
  // ``Math.abs`` on maxDD because backend sign convention varies.
  // No fabricated numbers when no active strategies exist.
  const heroStats = useMemo(() => {
    const active = strategies.filter((s) => bucketFor(s) === "active");
    if (active.length === 0) {
      return { invested: 0, bestSharpe: null as number | null, worstDD: null as number | null };
    }
    const invested = active.reduce((sum, s) => sum + (s.investedAmount ?? 0), 0);
    const sharpes = active
      .map((s) => s.sharpe)
      .filter((n): n is number => n != null && Number.isFinite(n) && n !== 0);
    const bestSharpe = sharpes.length ? Math.max(...sharpes) : null;
    const dds = active
      .map((s) => s.maxDD)
      .filter((n): n is number => n != null && Number.isFinite(n));
    const worstDD = dds.length ? Math.max(...dds.map((d) => Math.abs(d))) : null;
    return { invested, bestSharpe, worstDD };
  }, [strategies]);

  const loading = summaries == null && !loadError;

  const summaryLine = loading ? (
    "Loading catalogue\u2026"
  ) : (
    <>
      {counts.active} active · {counts.paused} paused · {counts.coming_soon}{" "}
      in development
      <span className="text-fg-hint"> · {counts.total} total</span>
    </>
  );

  const actions = (
    // 2026-04-21 polish: header summary was 11px — on the floor but still
    // hard to scan next to the 28px italic title. Bumped to fs-label (12px)
    // via `.t-meta` so the live count reads with the same weight as every
    // other meta label on the page.
    <span className="t-meta tabular-nums">
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
        {/* v2 follow-up — editorial italic-Newsreader hero card matching
         * strategies.jsx voice. Sits above the catalogue hero strip. */}
        <header
          className="rounded-md border border-border-hair p-5 md:p-6"
          style={{
            background: "var(--bg-elev-1)",
            borderLeft: "2px solid var(--brand)",
          }}
        >
          <p
            className="t-eyebrow-italic"
            style={{ color: "var(--brand)", letterSpacing: "0.2em", margin: 0 }}
          >
            STRATEGIES · LIBRARY
          </p>
          <h2
            className="m-0 mt-3 italic"
            style={{
              fontFamily: "var(--font-display)",
              color: "var(--ink-1000)",
              fontSize: 38,
              fontWeight: 400,
              letterSpacing: "-0.025em",
              lineHeight: 1.05,
            }}
          >
            Strategies the desk hunts with.
          </h2>
          <p
            className="italic"
            style={{
              marginTop: 12,
              fontFamily: "var(--font-display)",
              fontSize: 15,
              color: "var(--fg-muted)",
              lineHeight: 1.55,
              maxWidth: 680,
            }}
          >
            Explicit, auditable rules — momentum, mean-reversion, earnings
            drift, options income, pairs. Click any card to read the
            playbook, run a backtest, or queue a paper trade.
          </p>
        </header>

        {/* Round-8 killer-move 2: catalogue hero strip. Three KpiTile-style
            cards anchor the page in 3 seconds — a portfolio view of all
            active strategies. Hidden when no active strategies exist (cold
            catalogue) so we don't render em-dashes as if they were data. */}
        {!loading && counts.active > 0 && (
          <div
            data-slot="strategies-hero"
            className="grid grid-cols-1 gap-3 sm:grid-cols-3"
            aria-label="Active catalogue summary"
          >
            <div className="rounded-lg border border-border bg-bg-card px-4 py-3">
              <p className="t-label mb-1">Invested</p>
              <p className="t-num-lg tabular-nums u-brand">
                {heroStats.invested > 0
                  ? new Intl.NumberFormat("en-US", {
                      style: "currency",
                      currency: "USD",
                      maximumFractionDigits: 0,
                    }).format(heroStats.invested)
                  : "—"}
              </p>
              <p className="t-meta u-muted">
                across {counts.active} active strateg{counts.active === 1 ? "y" : "ies"}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-bg-card px-4 py-3">
              <p className="t-label mb-1">Best OOS Sharpe</p>
              <p className="t-num-lg tabular-nums u-profit">
                {heroStats.bestSharpe != null
                  ? heroStats.bestSharpe.toFixed(2)
                  : "—"}
              </p>
              <p className="t-meta u-muted">
                highest risk-adjusted return in catalogue
              </p>
            </div>
            <div className="rounded-lg border border-border bg-bg-card px-4 py-3">
              <p className="t-label mb-1">Worst DD</p>
              <p className="t-num-lg tabular-nums u-loss">
                {heroStats.worstDD != null
                  ? `−${(heroStats.worstDD * 100).toFixed(1)}%`
                  : "—"}
              </p>
              <p className="t-meta u-muted">
                deepest drawdown across active backtests
              </p>
            </div>
          </div>
        )}
        {loadError && (
          // 2026-04-21 polish: error surface now offers a retry affordance
          // (previously was a dead string — the only recovery path was a
          // full page refresh). The button is sized to the 36px hit-target
          // floor and carries a visible focus-ring so keyboard users can
          // reach it after tabbing past the page title.
          <div
            role="alert"
            className="flex flex-col gap-3 rounded-md border border-border-hair bg-bg-elev-1 px-4 py-4 font-sans text-body-sm text-fg-muted sm:flex-row sm:items-center sm:justify-between"
          >
            <span>Couldn&apos;t load catalogue: {loadError}</span>
            <button
              type="button"
              onClick={loadSummaries}
              className={cn(
                "inline-flex h-9 items-center justify-center rounded-sm border border-border bg-bg-elev-2 px-4 font-sans text-label font-semibold text-fg transition-colors",
                "hover:bg-bg-card",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              )}
            >
              Retry
            </button>
          </div>
        )}

        {!loading && (
          <StrategyReadinessWorkbench
            counts={readinessCounts}
            activeFilter={readinessFilter}
            onFilterChange={setReadinessFilter}
          />
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

        {!loading && !loadError && (
          <>
            <Section
              data-section="active"
              title="Active"
              count={counts.active}
              bucket="active"
              strategies={filteredGrouped.active}
              empty="No strategies currently active."
            />
            {filteredGrouped.paused.length > 0 && (
              <Section
                data-section="paused"
                title="Paused"
                count={counts.paused}
                bucket="paused"
                strategies={filteredGrouped.paused}
                empty="No paused strategies."
              />
            )}
            {researchEntries.length > 0 && (
              <section
                data-section="research"
                className="flex flex-col gap-3"
              >
                <header className="flex items-baseline justify-between gap-2">
                  <div className="flex items-baseline gap-3">
                    <h2 className="t-h2">
                      Research
                    </h2>
                    <Mono size="micro">
                      {String(researchEntries.length).padStart(2, "0")}
                    </Mono>
                  </div>
                </header>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {researchEntries.map((s) => (
                    <ResearchStrategyCard
                      key={s.id}
                      id={s.id}
                      name={s.displayName}
                      subtitle={STRATEGY_META[s.id]?.regimeNote ?? ""}
                      metrics={researchMetricsFor(s.id)}
                    />
                  ))}
                </div>
              </section>
            )}
            {filteredGrouped.coming_soon.length > 0 && (
              <Section
                data-section="coming-soon"
                title="Coming soon"
                count={counts.coming_soon}
                bucket="coming_soon"
                strategies={filteredGrouped.coming_soon}
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
          {/* 2026-04-21 polish: raised to 13px (the fs-hint floor) so the
              disclosure copy is legible without sitting flush on the
              typographic floor. Still visually subordinate to the sections
              above thanks to `text-fg-hint`. */}
          <p className="font-sans text-body-sm leading-relaxed text-fg-hint">
            Past performance does not guarantee future results. Backtest
            metrics are derived from historical data; live results may
            differ materially. See the{" "}
            <Link
              href="/legal/risk"
              className="underline underline-offset-2 hover:text-fg-muted"
            >
              Risk Disclosure
            </Link>{" "}
            at /legal/risk.
          </p>
        </footer>
      </main>
    </DashboardPageLayout>
  );
}
