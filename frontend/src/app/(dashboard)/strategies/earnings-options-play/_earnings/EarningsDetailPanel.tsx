"use client";

import {
  forwardRef,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import { ArrowUpCircle, Bookmark, X } from "lucide-react";
import type {
  CalendarRow,
  EarningsCandidateDecision,
  EarningsDetail,
  EarningsErrorCode,
  EarningsSetup,
  EarningsTopSetup,
  Quote,
  TickerContext,
} from "@/types";
import CalendarWeekHeatmap from "./CalendarWeekHeatmap";
import type { SelectionSource } from "../page";
import { cn } from "@/lib/utils";

import DetailHeader from "./DetailHeader";
import DecisionStrip from "./DecisionStrip";
import MetricsStrip from "./MetricsStrip";
import AIThesisCard from "./AIThesisCard";
import StrikeLadder from "./StrikeLadder";
import HistoricalMoves from "./HistoricalMoves";
import HistoricalSetupReplay from "./HistoricalSetupReplay";
import IVTermSkew from "./IVTermSkew";
import NewsFeed from "./NewsFeed";
import TickerFreshnessStrip from "./TickerFreshnessStrip";
import TradeButtonRow from "./TradeButtonRow";
import PnLZones from "@/components/primitives/PnLZones";
import OptionsPayoffPanel from "@/components/options/OptionsPayoffPanel";
import type { OptionStrategyDraft } from "@/lib/optionsPayoff";
import { buildEarningsStrategyDraft } from "./payoffDraft";

export interface EarningsDetailPanelProps {
  detail: EarningsDetail | null;
  tickerContext?: TickerContext | null;
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
  /** PR-2 / BUG-04: calendar rows for the pre-selection heatmap view. */
  calendarRows?: CalendarRow[];
  /** PR-2 / BUG-04: handler for heatmap row clicks. */
  onSelectSymbol?: (symbol: string) => void;
  /**
   * PR-1 / T3 (earnings discipline gates): ranked recommended setups
   * from the analysis endpoint. Each setup's ``confidence`` is keyed by
   * its ``setupId`` (= ``EarningsTopSetup``) into a map TradeButtonRow
   * uses to render per-button credibility chips. Null/empty hides the
   * chips entirely (back-compat).
   */
  recommendedSetups?: EarningsSetup[] | null;
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
      tickerContext = null,
      loading,
      refetching = false,
      error,
      runningFull,
      fullResearchError = null,
      onRunFullResearch,
      candidateDecision = null,
      onCandidateDecision,
      selectionSource = null,
      calendarRows = [],
      onSelectSymbol,
      recommendedSetups = null,
    },
    ref,
  ) {
  const isWide = useIsWide(1200);
  const detailSymbol = detail?.symbol ?? null;
  const [undoDecisionState, setUndoDecisionState] = useState<{
    symbol: string | null;
    decision: {
      previous: EarningsCandidateDecision | null;
      next: EarningsCandidateDecision | null;
    } | null;
  }>({ symbol: null, decision: null });
  const undoDecision =
    undoDecisionState.symbol === detailSymbol ? undoDecisionState.decision : null;
  const commitCandidateDecision = (
    next: EarningsCandidateDecision | null,
  ) => {
    if (!onCandidateDecision) return;
    setUndoDecisionState({
      symbol: detailSymbol,
      decision: { previous: candidateDecision ?? null, next },
    });
    onCandidateDecision(next);
    if (next && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("alphadesk:earnings-select-next"));
    }
  };
  const undoCandidateDecision = () => {
    if (!undoDecision || !onCandidateDecision) return;
    onCandidateDecision(undoDecision.previous);
    setUndoDecisionState({ symbol: detailSymbol, decision: null });
  };
  const swipeHandlers = useCandidateDecisionSwipe(commitCandidateDecision);

  // Slice-6 / CH-3F: which defined-risk strategy is the user hovering?
  // Set by ``TradeButtonRow`` via the new ``onHoverStrategy`` callback;
  // consumed by ``_ExpectedMoveStrip`` to render the strategy-specific
  // green profit zone over the brown expected-move band.
  const [hoveredStrategyZone, setHoveredStrategyZone] = useState<
    [number, number] | null
  >(null);
  const [hoveredPayoffDraft, setHoveredPayoffDraft] =
    useState<OptionStrategyDraft | null>(null);
  // EOP-AUDIT 2026-05-06 / B1.2 (sticky-after-hover): the payoff chart
  // used to revert to the default suggestion the moment the cursor
  // left a card. Users couldn't compare cards because the chart only
  // held shape while pointer was inside one. Now we track
  // ``lastPayoffDraft`` separately — set on every hover, NEVER cleared
  // on un-hover — and resolve the displayed draft as
  // ``hovered ?? lastPayoffDraft ?? defaultPayoffDraft``. Default is
  // shown only on initial render before any hover.
  const [lastPayoffDraft, setLastPayoffDraft] =
    useState<OptionStrategyDraft | null>(null);
  const handleHoverPayoffDraft = (draft: OptionStrategyDraft | null) => {
    // Set transient hovered draft for the immediate update.
    setHoveredPayoffDraft(draft);
    // When a card is hovered (draft != null), persist as the "last"
    // draft so un-hover keeps showing it. Hovering a different card
    // simply overwrites both. Mouse-leave fires with null and we
    // intentionally don't clear ``lastPayoffDraft``.
    if (draft) setLastPayoffDraft(draft);
  };
  const defaultPayoffDraft = useMemo(
    () =>
      detail
        ? buildEarningsStrategyDraft(
            detail.symbol,
            detail.strikeLadder,
            detail.claudeStructured?.suggestedPlay ?? null,
          )
        : null,
    [detail],
  );

  // PR-1 / T3: collapse the ranked setups list into a map keyed by the
  // space-delimited ``setupLabel`` (``EarningsTopSetup``) so TradeButtonRow
  // can look up each card's confidence by the same label it renders.
  //
  // P0 fix: previously keyed by ``setupId`` (snake_case wire form) while
  // TradeButtonRow looked up by space-delimited label ("bull put spread"),
  // so every confidence chip silently resolved to ``undefined`` and the
  // low-confidence warning modal never fired. ``setupLabel`` is ``null``
  // for unrecognized backend setup IDs (legacy / future) — skip those.
  const setupConfidenceMap = useMemo(() => {
    if (!recommendedSetups || recommendedSetups.length === 0) return undefined;
    const map: Partial<Record<EarningsTopSetup, number | null>> = {};
    for (const setup of recommendedSetups) {
      if (setup.setupLabel) {
        map[setup.setupLabel] = setup.confidence;
      }
    }
    return map;
  }, [recommendedSetups]);

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
          <p className="font-mono text-body-sm text-[color:var(--fg-neg)]">Error · {error}</p>
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
        className="rounded border border-border-hair bg-bg-elev-1/60 p-4"
      >
        <div role="status" aria-live="polite" aria-atomic="true">
          <p className="font-mono text-body-sm text-fg-muted">Loading detail…</p>
        </div>
      </section>
    );
  }
  if (!detail) {
    // PR-2 / BUG-04: show the calendar-week heatmap instead of the blank prompt.
    const headlineSymbol = pickHeadlineSymbol(calendarRows);
    return (
      <section
        ref={ref}
        data-slot="earnings-detail-panel"
        className="rounded border border-border-hair bg-bg-elev-1/60"
      >
        <CalendarWeekHeatmap
          rows={calendarRows}
          onSelect={onSelectSymbol ?? (() => {})}
          headlineSymbol={headlineSymbol}
        />
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
          <p className="font-mono text-label text-[color:var(--warn,#d97706)]">
            ⚠ Partial data — some providers were unavailable.
          </p>
          {missingFields && missingFields.length > 0 ? (
            <p className="mt-1 font-mono text-label u-muted">
              Missing: {missingFields.join(", ")}
            </p>
          ) : (
            <p className="mt-1 font-mono text-label u-muted">
              Some data unavailable — see fields marked —
            </p>
          )}
        </div>
      )}
      <TickerFreshnessStrip context={tickerContext} />
      <DetailHeader
        symbol={detail.symbol} company={detail.company} sector={detail.sector}
        reportDate={detail.reportDate} reportTime={detail.reportTime}
        quote={detail.quote} generatedAt={detail.generatedAt}
        selectionSource={selectionSource}
        // PM-B: hand the (possibly null) ticker-context quote envelope to
        // DetailHeader so the after-hours / pre-market secondary line can
        // render. The cast is safe because the envelope's ``value`` is
        // the backend's quote payload (snake_case keys mirroring the
        // ``Quote`` interface — see types/index.ts EH-1 contract); it
        // arrives as ``Record<string, unknown>`` because the envelope is
        // schema-version-agnostic.
        extendedQuote={(tickerContext?.quote?.value ?? null) as Partial<Quote> | null}
      />
      <div
        data-slot="candidate-swipe-card"
        aria-describedby="candidate-swipe-card-hint"
        className="touch-pan-y select-none"
        {...swipeHandlers}
      >
        <span id="candidate-swipe-card-hint" className="sr-only">
          On touch screens, swipe left to discard or right to save, then advance. Use the visible button to mark for order review.
        </span>
        <div
          aria-hidden="true"
          className="mb-2 flex items-center justify-between rounded border border-[color:var(--border)] bg-[color:var(--bg-elev-1)] px-3 py-2 font-mono text-label uppercase tracking-[0.08em] text-[color:var(--fg-muted)] md:hidden"
        >
          <span>Swipe left: discard</span>
          <span>Swipe right: save</span>
        </div>
        <CandidateDecisionBar
          decision={candidateDecision}
          onDecision={commitCandidateDecision}
        />
        {undoDecision && onCandidateDecision && (
          <div
            data-slot="candidate-decision-undo"
            role="status"
            aria-live="polite"
            className="mb-2 flex items-center justify-between gap-3 rounded border border-[color:var(--border)] bg-[color:var(--bg-elev-1)] px-3 py-2 t-mono text-label text-[color:var(--fg-muted)]"
          >
            <span>
              {undoDecision.next
                ? `Marked ${undoDecision.next.replace("_", " ")}`
                : "Cleared decision"}
            </span>
            <button
              type="button"
              onClick={undoCandidateDecision}
              className="shrink-0 u-brand hover:underline"
            >
              Undo
            </button>
          </div>
        )}
        {/* Round-8 single-view B: DECISION STRIP — page hero. Renders
            only when Claude's structured response has loaded; the
            ``claude_unavailable`` partial-data banner above already
            surfaces the missing-data case explicitly so a placeholder
            strip would just add noise. */}
        <DecisionStrip structured={detail.claudeStructured} metrics={detail.metrics} />
        {/* Maverick FIX-C (pro-trader P0 #2 + data-skeptic HIGH):
            tail-risk surface. Sits directly under the recommendation
            so a trader cannot miss a "skip" signal that the recommender
            already flagged. Reads from the (forward-compat) detail
            fields wired in by mapEarningsDetail; renders nothing when
            backend didn't emit a score. */}
        <_TailRiskBanner
          score={detail.tailRiskScore ?? null}
          reasons={detail.tailRiskReasons ?? []}
        />
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
      {detail.historicalEarnings && (
        <HistoricalMoves historical={detail.historicalEarnings} />
      )}
      <HistoricalSetupReplay detail={detail} />

      {isWide ? (
        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          {/* Left column: thesis + news */}
          <div className="min-w-0 space-y-3">
            <AIThesisCard
              structured={detail.claudeStructured} full={detail.claudeFullResearch}
              running={runningFull} error={fullResearchError}
              onRunFull={onRunFullResearch}
              symbol={detail.symbol}
              showResearchLink
            />
            <NewsFeed news={detail.news} />
          </div>
          {/* Right column: ladder + term/skew */}
          <div className="min-w-0 space-y-3">
            <StrikeLadder ladder={detail.strikeLadder} underlying={detail.symbol} />
            <IVTermSkew term={detail.ivTermStructure} skew={detail.skew} />
          </div>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <AIThesisCard
            structured={detail.claudeStructured} full={detail.claudeFullResearch}
            running={runningFull} error={fullResearchError}
            onRunFull={onRunFullResearch}
            symbol={detail.symbol}
            showResearchLink
          />
          <StrikeLadder ladder={detail.strikeLadder} underlying={detail.symbol} />
          <IVTermSkew term={detail.ivTermStructure} skew={detail.skew} />
          <NewsFeed news={detail.news} />
        </div>
      )}

      <TradeButtonRow
        symbol={detail.symbol}
        ladder={detail.strikeLadder}
        onHoverStrategy={setHoveredStrategyZone}
        onHoverPayoffDraft={handleHoverPayoffDraft}
        recommendedSetup={detail.claudeStructured?.suggestedPlay ?? null}
        reportState={detail.reportState}
        syntheticChain={detail.errorCodes?.includes("chain_demo") ?? false}
        setupConfidenceMap={setupConfidenceMap}
      />

      <OptionsPayoffPanel
        draft={hoveredPayoffDraft ?? lastPayoffDraft ?? defaultPayoffDraft}
        title="Earnings payoff"
        className="mt-4"
      />

      <p
        data-slot="data-disclaimer"
        className="mt-3 border-t border-[color:var(--border)] pt-2 font-mono text-label u-muted"
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

/** PR-2 / BUG-04: returns the symbol with the highest IV rank in the
 *  calendar rows, used to label the HEADLINE row in CalendarWeekHeatmap.
 *  Falls back to the first row's symbol if no row has an ivRank. */
function pickHeadlineSymbol(rows: CalendarRow[]): string | undefined {
  if (rows.length === 0) return undefined;
  let best = rows[0];
  for (const row of rows) {
    if (row.ivRank != null && (best.ivRank == null || row.ivRank > best.ivRank)) {
      best = row;
    }
  }
  return best.symbol;
}

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
  }

  function commitSwipeDecision(decision: EarningsCandidateDecision) {
    onDecision?.(decision);
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
  const commitDecision = (nextDecision: EarningsCandidateDecision) => {
    const value = decision === nextDecision ? null : nextDecision;
    onDecision(value);
  };
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
        onClick={() => commitDecision("discarded")}
      />
      <CandidateDecisionButton
        active={decision === "saved"}
        label="Save candidate"
        icon={<Bookmark className="h-3.5 w-3.5" aria-hidden />}
        onClick={() => commitDecision("saved")}
      />
      <CandidateDecisionButton
        active={decision === "order"}
        label="Mark for order review"
        icon={<ArrowUpCircle className="h-3.5 w-3.5" aria-hidden />}
        onClick={() => commitDecision("order")}
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
        "inline-flex min-h-touch items-center gap-1.5 rounded border px-3 py-2 t-mono text-label transition-colors",
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
  regime_unavailable:
    "Market regime unavailable — Alpaca/SPY/VIXY context failed; AI treats regime as neutral",
  claude_unavailable:
    "AI thesis unavailable — model budget tripped, upstream timeout, or daily $ cap reached. Retry in ~30s",
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
      <p className="font-mono text-label text-[color:var(--warn,#d97706)]" aria-hidden="true">
        ⚠ PARTIAL DATA
      </p>
      <ul className="mt-1 space-y-0.5 font-mono text-label u-muted">
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
    ? formatDateOnly(reportDate, {
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

function formatDateOnly(
  value: string | Date,
  options: Intl.DateTimeFormatOptions,
): string {
  if (value instanceof Date) {
    return value.toLocaleDateString("en-US", options);
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match) {
    const localDate = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return localDate.toLocaleDateString("en-US", options);
  }
  return new Date(value).toLocaleDateString("en-US", options);
}

/**
 * Maverick FIX-C (pro-trader P0 #2 + data-skeptic HIGH):
 * tail-risk surface. Mirrors the recommender's internal demotion
 * thresholds so the user sees the same signal the engine acted on:
 *
 *   - score >= 0.85 → red banner "RECOMMENDED: SKIP THIS TRADE"
 *     with the reason list inline. Matches ``extreme_tail`` in the
 *     recommender (forces a "skip" outcome on the BE).
 *   - 0.6 ≤ score < 0.85 → amber pill "TAIL RISK ELEVATED" with
 *     reasons in the title attribute. Matches the threshold that
 *     demotes short-vol setups in the BE recommender.
 *   - score < 0.6 (or null/undefined) → render nothing — no need to
 *     advertise "your trade is safe" with a green chip.
 *
 * Inline divs (no Badge primitive) because the banner shape needs a
 * full-width red callout, which doesn't fit the badge sizing tokens.
 */
function _TailRiskBanner({
  score,
  reasons,
}: {
  score: number | null;
  reasons: string[];
}) {
  if (score == null || !Number.isFinite(score) || score < 0.6) return null;
  const reasonText = reasons.length > 0 ? reasons.join("; ") : null;
  if (score >= 0.85) {
    return (
      <div
        data-slot="tail-risk-banner"
        data-severity="skip"
        role="alert"
        className="mt-3 rounded border px-3 py-2"
        style={{
          borderColor: "var(--loss)",
          background: "color-mix(in oklab, var(--loss) 12%, transparent)",
          color: "var(--loss)",
        }}
      >
        <p className="t-mono text-label font-semibold uppercase tracking-[0.08em]">
          ⚠ RECOMMENDED: SKIP THIS TRADE
        </p>
        <p className="mt-1 t-mono text-label">
          Tail-risk score {score.toFixed(2)} ≥ 0.85.
          {reasonText && (
            <>
              {" "}
              <span className="u-muted">Reasons: {reasonText}.</span>
            </>
          )}
        </p>
      </div>
    );
  }
  // 0.6 ≤ score < 0.85 — amber pill with reasons in the tooltip.
  return (
    <div
      data-slot="tail-risk-banner"
      data-severity="elevated"
      className="mt-3 inline-flex items-center gap-2 rounded border px-2 py-0.5 t-mono text-label"
      style={{
        borderColor: "var(--state-warning)",
        color: "var(--state-warning)",
      }}
      title={reasonText ?? "Elevated tail-risk score"}
    >
      <span className="font-semibold uppercase tracking-[0.08em]">
        TAIL RISK ELEVATED
      </span>
      <span className="u-muted tabular-nums">{score.toFixed(2)}</span>
    </div>
  );
}
