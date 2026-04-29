"use client";

import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import { ArrowUpCircle, Bookmark, X } from "lucide-react";
import type { EarningsCandidateDecision, EarningsDetail, EarningsErrorCode } from "@/types";
import type { SelectionSource } from "../page";
import { cn } from "@/lib/utils";

import DetailHeader from "./DetailHeader";
import DecisionStrip from "./DecisionStrip";
import MetricsStrip from "./MetricsStrip";
import ClaudeThesisCard from "./ClaudeThesisCard";
import StrikeLadder from "./StrikeLadder";
// B-63: HistoricalMoves removed — backend loader was stubbed and the
// `historical_earnings` field is gone from EarningsDetail. Restore when
// the FMP surprises join lands.
import IVTermSkew from "./IVTermSkew";
import NewsFeed from "./NewsFeed";
import TradeButtonRow from "./TradeButtonRow";
import PnLZones from "@/components/primitives/PnLZones";

export interface EarningsDetailPanelProps {
  detail: EarningsDetail | null;
  loading: boolean;
  /** Round-4 (CLUSTER D/10): stale data on screen, fetching fresh data —
   *  drives the dim opacity + aria-busy without flipping to the loading
   *  skeleton. */
  refetching?: boolean;
  error: string | null;
  runningFull: boolean;
  /** Round-4 (CLUSTER D/11): error from the full-research mutation
   *  (RateLimitError → live countdown; other errors → inline alert). */
  fullResearchError?: Error | null;
  onRunFullResearch: () => void;
  candidateDecision?: EarningsCandidateDecision | null;
  onCandidateDecision?: (decision: EarningsCandidateDecision | null) => void;
  /** Round-4 (B-NEW-4): why the surrounding selection changed —
   *  passed through to DetailHeader so it autofocuses on keyboard /
   *  URL changes only, never on pointer clicks. */
  selectionSource?: SelectionSource;
}

/**
 * V2 layout — two columns at ≥1200px panel width, collapses to V1 stacked
 * below. Sub-panels slot into consistent vertical rhythm via the editorial
 * tokens.
 *
 * Round-4 fixes:
 *  - Dispatch `alphadesk:earnings-clear-selection` on Esc — the page
 *    listens and resets selection (B-NEW-2).
 *  - Surface `partial` + `errorCodes` as a yellow info banner with
 *    code-specific copy (CLUSTER D/12).
 *  - Pass `selectionSource` to DetailHeader so pointer clicks don't
 *    trigger H2 autofocus (B-NEW-4).
 *
 * Round-5 (NEW-Y6 / G-2): now `forwardRef` so the page can scroll the
 * panel into view on mobile after a sidebar selection. The ref is
 * forwarded to whichever outer `<section>` actually renders (error /
 * loading / empty / success). Passing `null` is a no-op.
 */
const EarningsDetailPanel = forwardRef<HTMLElement, EarningsDetailPanelProps>(
  function EarningsDetailPanel(
    {
      detail,
      loading,
      refetching = false,
      error,
      runningFull,
      fullResearchError = null,
      onRunFullResearch,
      candidateDecision = null,
      onCandidateDecision,
      selectionSource = null,
    },
    ref,
  ) {
  const isWide = useIsWide(1200);
  const swipeHandlers = useCandidateDecisionSwipe(onCandidateDecision);

  // Slice-6 / CH-3F: which defined-risk strategy is the user hovering?
  // Set by ``TradeButtonRow`` via the new ``onHoverStrategy`` callback;
  // consumed by ``_ExpectedMoveStrip`` to render the strategy-specific
  // green profit zone over the brown expected-move band.
  const [hoveredStrategyZone, setHoveredStrategyZone] = useState<
    [number, number] | null
  >(null);

  // Escape clears the selection — dispatches a custom event the parent
  // page listens for. Ignored while focus is inside a text input so
  // users can clear filters without losing the detail view (B-61).
  // Round-4 (B-NEW-2): the page-level listener is now wired.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      const target = e.target as HTMLElement | null;
      const tag = (target?.tagName ?? document.activeElement?.tagName ?? "").toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (target?.isContentEditable) return;
      document.dispatchEvent(new CustomEvent("alphadesk:earnings-clear-selection"));
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  if (error) {
    return (
      <section
        ref={ref}
        data-slot="earnings-detail-panel"
        className="rounded border border-[color:var(--fg-border)] p-4"
      >
        <div role="alert">
          <p className="font-mono text-[13px] text-[color:var(--fg-neg)]">Error · {error}</p>
        </div>
      </section>
    );
  }
  if (loading && !detail) {
    return (
      <section
        ref={ref}
        data-slot="earnings-detail-panel"
        aria-busy="true"
        className="rounded border border-[color:var(--fg-border)] p-4"
      >
        <div role="status" aria-live="polite" aria-atomic="true">
          <p className="font-mono text-[13px] text-[color:var(--fg-muted)]">Loading detail…</p>
        </div>
      </section>
    );
  }
  if (!detail) {
    return (
      <section
        ref={ref}
        data-slot="earnings-detail-panel"
        className="rounded border border-[color:var(--fg-border)] p-4"
      >
        <p className="font-mono text-[13px] text-[color:var(--fg-muted)]">Select a symbol from the sidebar.</p>
      </section>
    );
  }

  // Round-4 (CLUSTER D/12): show the per-code partial banner whenever
  // backend tagged the response as partial AND emitted at least one
  // errorCode. Falls back to the legacy generic banner only when partial
  // is true but no codes are present (older backend).
  const errorCodes = detail.errorCodes ?? [];
  const showCodesBanner = detail.partial && errorCodes.length > 0;
  const showLegacyBanner = detail.partial && errorCodes.length === 0;

  // Missing-field hints may be populated later by the backend (Agent α's
  // B-81 work). Read defensively — fall back to a generic banner.
  const missingFields = extractMissingFields(detail);

  return (
    /* B-90 — aria-labelledby points at DetailHeader's <h2
       id="detail-header-title">. Only set here in the success branch,
       since the empty/loading/error branches don't render DetailHeader
       and the id would dangle. */
    <section
      ref={ref}
      data-slot="earnings-detail-panel"
      data-refetching={refetching || undefined}
      aria-busy={refetching || undefined}
      aria-labelledby="detail-header-title"
      className={cn(
        "rounded border border-[color:var(--fg-border)] bg-[color:var(--bg-card)] p-4 transition-opacity",
        refetching && "opacity-70",
      )}
    >
      {/* Round-13 / RD-9 (P1): reserve a stable slot so a banner that
          flips between true/false on refetch doesn't cause a layout
          shift under the DecisionStrip hero (the most-attended part
          of the page). The slot is empty when no banner is needed. */}
      {showCodesBanner && <PartialDataBanner codes={errorCodes} />}
      {showLegacyBanner && (
        <div
          data-slot="partial-data-banner"
          role="status"
          aria-live="polite"
          className="mb-3 rounded border border-[color:var(--warn,#d97706)] bg-[color:var(--warn-tint,rgba(217,119,6,0.12))] px-3 py-2"
        >
          <p className="font-mono text-[12px] text-[color:var(--warn,#d97706)]">
            ⚠ Partial data — some providers were unavailable.
          </p>
          {missingFields && missingFields.length > 0 ? (
            <p className="mt-1 font-mono text-[11px] u-muted">
              Missing: {missingFields.join(", ")}
            </p>
          ) : (
            <p className="mt-1 font-mono text-[11px] u-muted">
              Some data unavailable — see fields marked —
            </p>
          )}
        </div>
      )}
      <DetailHeader
        symbol={detail.symbol} company={detail.company} sector={detail.sector}
        reportDate={detail.reportDate} reportTime={detail.reportTime}
        quote={detail.quote} generatedAt={detail.generatedAt}
        selectionSource={selectionSource}
      />
      <div
        data-slot="candidate-swipe-card"
        aria-describedby="candidate-swipe-card-hint"
        className="touch-pan-y select-none"
        {...swipeHandlers}
      >
        <span id="candidate-swipe-card-hint" className="sr-only">
          On touch screens, swipe left to discard, right to save, or up to queue an order, then advance.
        </span>
        <CandidateDecisionBar
          decision={candidateDecision}
          onDecision={onCandidateDecision}
        />
        {/* Round-8 single-view B: DECISION STRIP — page hero. Renders
            only when Claude's structured response has loaded; the
            ``claude_unavailable`` partial-data banner above already
            surfaces the missing-data case explicitly so a placeholder
            strip would just add noise. */}
        <DecisionStrip structured={detail.claudeStructured} metrics={detail.metrics} />
      </div>
      <MetricsStrip metrics={detail.metrics} />
      {/* Slice-3 / FZ-1 (2026 design brief, Tastytrade signature):
          page-level expected-move strip. Shows the underlying price
          tick + ±1σ shaded brown band derived from front-month IV,
          giving the user a glanceable "where could it land by next
          report" visual before they pick a strategy. The actual
          profit-zone shading per-strategy is rendered alongside the
          relevant TradeButtonRow button hover (next slice). */}
      {detail.quote && detail.metrics?.expectedMovePct != null && (
        <_ExpectedMoveStrip
          underlying={detail.quote.last}
          expectedMovePct={detail.metrics.expectedMovePct}
          reportDate={detail.reportDate ?? undefined}
          // Slice-6 / CH-3F: dynamic profit-zone overlay. When the
          // user hovers a defined-risk button below, the strip shifts
          // to show *that strategy's* green profit zone over the
          // brown expected-move band. Lets the user instantly see
          // whether the expected move sits inside or outside their
          // chosen strategy's profit range — Tastytrade signature.
          hoveredStrategyZone={hoveredStrategyZone}
        />
      )}

      {isWide ? (
        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          {/* Left column: thesis + news */}
          <div className="min-w-0 space-y-3">
            <ClaudeThesisCard
              structured={detail.claudeStructured} full={detail.claudeFullResearch}
              running={runningFull} error={fullResearchError}
              onRunFull={onRunFullResearch}
              symbol={detail.symbol}
            />
            <NewsFeed news={detail.news} />
          </div>
          {/* Right column: ladder + term/skew */}
          <div className="min-w-0 space-y-3">
            <StrikeLadder ladder={detail.strikeLadder} />
            <IVTermSkew term={detail.ivTermStructure} skew={detail.skew} />
          </div>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <ClaudeThesisCard
            structured={detail.claudeStructured} full={detail.claudeFullResearch}
            running={runningFull} error={fullResearchError}
            onRunFull={onRunFullResearch}
            symbol={detail.symbol}
          />
          <StrikeLadder ladder={detail.strikeLadder} />
          <IVTermSkew term={detail.ivTermStructure} skew={detail.skew} />
          <NewsFeed news={detail.news} />
        </div>
      )}

      <TradeButtonRow
        symbol={detail.symbol}
        ladder={detail.strikeLadder}
        onHoverStrategy={setHoveredStrategyZone}
      />

      <p
        data-slot="data-disclaimer"
        className="mt-3 border-t border-[color:var(--border)] pt-2 font-mono text-[10.5px] u-muted"
      >
        Data from FMP + Alpaca. IV rank may be delayed.{" "}
        <a
          href="/help/earnings-data"
          className="underline decoration-dotted hover:u-brand"
        >
          Learn more
        </a>
        .
      </p>
    </section>
  );
  },
);

export default EarningsDetailPanel;

const SWIPE_MIN_PX = 72;
const SWIPE_AXIS_RATIO = 1.2;

function useCandidateDecisionSwipe(
  onDecision?: (decision: EarningsCandidateDecision | null) => void,
) {
  const startRef = useRef<{ x: number; y: number; pointerId: number } | null>(null);

  function onPointerDown(e: PointerEvent<HTMLElement>) {
    if (!onDecision) return;
    if (e.pointerType === "mouse") return;
    if (isInteractiveSwipeTarget(e.target)) return;
    startRef.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
  }

  function onPointerUp(e: PointerEvent<HTMLElement>) {
    const start = startRef.current;
    startRef.current = null;
    if (!onDecision || !start || start.pointerId !== e.pointerId) return;

    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    if (absX >= SWIPE_MIN_PX && absX >= absY * SWIPE_AXIS_RATIO) {
      commitSwipeDecision(dx > 0 ? "saved" : "discarded");
      return;
    }
    if (dy <= -SWIPE_MIN_PX && absY >= absX * SWIPE_AXIS_RATIO) {
      commitSwipeDecision("order");
    }
  }

  function commitSwipeDecision(decision: EarningsCandidateDecision) {
    onDecision?.(decision);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("alphadesk:earnings-select-next"));
    }
  }

  function onPointerCancel() {
    startRef.current = null;
  }

  return { onPointerDown, onPointerUp, onPointerCancel };
}

function isInteractiveSwipeTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      'a,button,input,select,textarea,[role="button"],[contenteditable="true"]',
    ),
  );
}

function CandidateDecisionBar({
  decision,
  onDecision,
}: {
  decision: EarningsCandidateDecision | null;
  onDecision?: (decision: EarningsCandidateDecision | null) => void;
}) {
  if (!onDecision) return null;
  return (
    <div
      data-slot="candidate-decision-bar"
      role="toolbar"
      aria-label="Candidate actions"
      className="mt-3 flex flex-wrap items-center gap-2 border-t border-[color:var(--border)] pt-3"
    >
      <CandidateDecisionButton
        active={decision === "discarded"}
        label="Discard"
        icon={<X className="h-3.5 w-3.5" aria-hidden />}
        onClick={() => onDecision(decision === "discarded" ? null : "discarded")}
      />
      <CandidateDecisionButton
        active={decision === "saved"}
        label="Save"
        icon={<Bookmark className="h-3.5 w-3.5" aria-hidden />}
        onClick={() => onDecision(decision === "saved" ? null : "saved")}
      />
      <CandidateDecisionButton
        active={decision === "order"}
        label="Queue order"
        icon={<ArrowUpCircle className="h-3.5 w-3.5" aria-hidden />}
        onClick={() => onDecision(decision === "order" ? null : "order")}
      />
    </div>
  );
}

function CandidateDecisionButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-[44px] items-center gap-1.5 rounded border px-3 py-2 t-mono text-[11px] transition-colors",
        active
          ? "border-[color:var(--brand)] bg-[color:var(--brand-tint)] u-brand"
          : "border-[color:var(--border)] bg-transparent u-muted hover:border-[color:var(--brand)] hover:u-brand",
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

/**
 * Round-5 (NEW-Y8): exported so tests can verify the copy strings without
 * re-rendering the whole detail panel. Round-5 split `news_unavailable`
 * into a cooldown variant + a hard-error variant; we surface the
 * distinction so users know whether to retry or check logs. Unknown
 * codes pass through verbatim — we don't suppress new codes shipped
 * before this map is updated.
 */
// Round-12 / PD-1 (P2): make the partial-data warning copy concrete +
// actionable. Pre-fix the strings said "X unavailable" with no hint at
// the upstream cause — the user couldn't tell whether to retry, check
// the broker, or wait for a rate-limit window. Each copy string now
// names the upstream provider, the likely cause, and the recommended
// next action.
export const ERROR_CODE_COPY: Record<EarningsErrorCode, string> = {
  stub_detail: "Limited data — next earnings >2 weeks out (FMP calendar gap)",
  news_unavailable:
    "News feed in cooldown — newsdata.io rate limit hit (resumes in ~15 min)",
  news_error: "News feed unavailable — newsdata.io returned an error; retry shortly",
  chain_demo:
    "⚠ Options chain is SYNTHETIC (BSM-modelled) — Polygon options feed unavailable. Strikes/Greeks are estimates, not OPRA quotes",
  iv_unavailable: "IV rank unavailable — daily HV/IV-rank job hasn't backfilled this symbol yet",
  iv_term_partial:
    "IV term structure incomplete — ≥3 of 6 expiry fetches failed; longer-dated expiries may be missing",
  metrics_unavailable:
    "Volatility metrics unavailable — HV pipeline output missing for this symbol",
  hv_unavailable: "Historical volatility unavailable — daily HV job hasn't completed",
  claude_unavailable:
    "AI thesis unavailable — Claude budget tripped, upstream timeout, or daily $ cap reached. Retry in ~30s",
};

/**
 * Round-4 (CLUSTER D/12): yellow-tint info banner above the metrics
 * strip when one or more upstreams degraded. Distinct from the
 * destructive red-tint error panel: this is "data is partially fine,
 * here's what's stale".
 */
function PartialDataBanner({ codes }: { codes: EarningsErrorCode[] }) {
  return (
    <div
      data-slot="partial-data-banner"
      role="status"
      aria-live="polite"
      className="mb-3 rounded border border-[color:var(--warn,#d97706)] bg-[color:var(--warn-tint,rgba(217,119,6,0.12))] px-3 py-2"
    >
      <p className="font-mono text-[12px] text-[color:var(--warn,#d97706)]" aria-hidden="true">
        ⚠ PARTIAL DATA
      </p>
      <ul className="mt-1 space-y-0.5 font-mono text-[11px] u-muted">
        {codes.map((c) => (
          <li key={c} data-slot="partial-data-banner-item">
            {ERROR_CODE_COPY[c] ?? c}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Pull an optional list of missing-field names off the detail payload.
 * Agent α's B-81 work may add `missing_fields` or `validation_errors`
 * to the schema — read without hard-typing so we surface whichever
 * lands without pushing types/index.ts changes through this bundle.
 */
function extractMissingFields(detail: EarningsDetail): string[] | null {
  const raw = detail as unknown as {
    missing_fields?: unknown;
    validation_errors?: unknown;
  };
  const src = raw.missing_fields ?? raw.validation_errors;
  if (!Array.isArray(src)) return null;
  const out = src.filter((x): x is string => typeof x === "string" && x.length > 0);
  return out.length > 0 ? out : null;
}

/**
 * Track whether the viewport (or the panel's container ideally — but
 * without a ResizeObserver setup we use window width as a proxy) is wider
 * than `px`. Panel-width comes out close to viewport-width minus 280px
 * sidebar, so viewport >= 1480 ≈ panel >= 1200.
 *
 * Resize handler is debounced (150 ms) so dragging a window edge across
 * the 1280 px breakpoint doesn't thrash React into re-laying out the
 * two-column grid dozens of times per second.
 */
function useIsWide(panelThresholdPx: number): boolean {
  const [wide, setWide] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const viewportThreshold = panelThresholdPx + 300; // +sidebar+gutters
    const check = () => setWide(window.innerWidth >= viewportThreshold);
    check();
    const onResize = () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(check, 150);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [panelThresholdPx]);
  return wide;
}

/**
 * Slice-3 / FZ-1: page-level expected-move strip rendered between the
 * DecisionStrip and the TradeButtonRow. Wraps ``<PnLZones>`` with the
 * subset of fields the earnings-page actually has: spot quote +
 * straddle-implied 1σ move from ``metrics.expectedMovePct``. The
 * profitZone is intentionally null at this level — once the user
 * hovers a specific defined-risk button (bull put / bear call / iron
 * condor / long straddle) we render a strategy-specific overlay
 * with the green profit zone. Until then this is the at-a-glance
 * "where could it land" Tastytrade hero.
 */
function _ExpectedMoveStrip({
  underlying,
  expectedMovePct,
  reportDate,
  hoveredStrategyZone,
}: {
  underlying: number;
  expectedMovePct: number;
  reportDate?: string | Date | null;
  /**
   * Slice-6 / CH-3F: the hovered defined-risk strategy's profit zone
   * as ``[low, high]``. When set, the strip renders this as the green
   * profit zone over the brown expected-move band so the user can
   * instantly see whether the implied move sits inside or outside
   * the strategy's profit range. Null (default) shows the brown
   * expected-move band only.
   */
  hoveredStrategyZone?: [number, number] | null;
}) {
  if (!Number.isFinite(underlying) || underlying <= 0) return null;
  if (!Number.isFinite(expectedMovePct) || expectedMovePct <= 0) return null;
  // ``expectedMovePct`` arrives as a fraction (0.064 = 6.4%).
  const sigma = underlying * expectedMovePct;
  const expectedLow = underlying - sigma;
  const expectedHigh = underlying + sigma;
  // Show ±2σ on the strip so the 1σ band sits centered with breathing
  // room either side.
  const priceMin = underlying - sigma * 2;
  const priceMax = underlying + sigma * 2;
  const reportLabel = reportDate
    ? new Date(reportDate).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })
    : "the report";
  return (
    <section data-slot="expected-move-strip" className="mt-3">
      <PnLZones
        label={`Expected move ±$${sigma.toFixed(2)} (${(
          expectedMovePct * 100
        ).toFixed(1)}%) by ${reportLabel}`}
        underlying={underlying}
        priceMin={priceMin}
        priceMax={priceMax}
        profitZone={hoveredStrategyZone ?? null}
        expectedMove={[expectedLow, expectedHigh]}
        caption={
          hoveredStrategyZone
            ? `Profit zone $${hoveredStrategyZone[0].toFixed(2)} → $${hoveredStrategyZone[1].toFixed(2)} · expected move overlay shows whether ±1σ stays inside`
            : `Expected move ±$${sigma.toFixed(2)} · ${(
                expectedMovePct * 100
              ).toFixed(1)}% · 1σ implied by front-month straddle · hover a strategy below to overlay its profit zone`
        }
      />
    </section>
  );
}
