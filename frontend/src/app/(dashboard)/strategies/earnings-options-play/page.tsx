"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import DashboardPageLayout from "@/components/layouts/DashboardPageLayout";
import {
  getEarningsCalendar,
  getEarningsDetail,
  postEarningsFullResearch,
} from "@/lib/api";
import type {
  EarningsCandidateDecision,
  EarningsDetail,
  EarningsCalendarFilters,
} from "@/types";
import { safeGetItem, safeSetItem } from "@/lib/storage";
import { useMarketStore } from "@/stores/market";
import {
  CANDIDATE_DECISIONS_KEY,
  candidateDecisionKey,
  countVisibleCandidateDecisions,
  readCandidateDecisions,
  type CandidateDecisionMap,
} from "./_earnings/candidateDecisions";

import EarningsCalendarSidebar from "./_earnings/EarningsCalendarSidebar";
import FiltersBar from "./_earnings/FiltersBar";
import EarningsDetailPanel from "./_earnings/EarningsDetailPanel";
import { useTickerContext } from "@/hooks/useQueries";

/**
 * Round-4: tags _why_ a selection changed so DetailHeader can decide
 * whether to autofocus its <h2>. Pointer clicks should NOT steal focus
 * mid-click; keyboard / URL navigations should land focus on the new
 * symbol so SR users keep their place.
 */
export type SelectionSource = "pointer" | "keyboard" | "url" | null;

/**
 * /strategies/earnings-options-play — research screener.
 *
 * Layout C (Bloomberg): left calendar sidebar + right persistent detail panel.
 * URL state: ?symbol=NVDA&window=both&minIvRank=50&sort=date — refresh
 * preserves selection and filters.
 *
 * Data layer (B-97): react-query owns calendar + detail + full-research.
 * Auto stale-while-revalidate, one retry on transient 5xx, AbortSignal-based
 * cancellation when filters/symbol change. The page only owns UI state
 * (`filters`, `selectedSymbol`) plus the URL sync side-effect.
 *
 * Round-4 fixes:
 *  - Esc dispatches `alphadesk:earnings-clear-selection` from
 *    EarningsDetailPanel — the page listens and resets `selectedSymbol`,
 *    setting `userClearedRef` so the auto-select effect doesn't
 *    immediately rehydrate (B-NEW-2).
 *  - B-56 focus props (firstRowRef, onSettleRef) are wired so the
 *    keyboard flow goes filters → list (B-NEW-3).
 *  - DetailHeader autofocus only fires on keyboard/url selections
 *    (B-NEW-4).
 *  - Title uses backend windowLabel when present (CLUSTER A).
 */
export default function EarningsOptionsPlayPage() {
  const queryClient = useQueryClient();
  const marketWatchlist = useMarketStore((s) => s.watchlist);

  const [filters, setFilters] = useState<EarningsCalendarFilters>(() =>
    readFiltersFromURL(),
  );
  const [selectedSymbol, setSelectedSymbolState] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    return params.get("symbol");
  });
  const [candidateDecisions, setCandidateDecisions] =
    useState<CandidateDecisionMap>(() => readCandidateDecisions());

  // Round-4 (B-NEW-4): track the source of the last selection change so
  // DetailHeader knows whether to refocus its <h2>.
  //
  // Round-7 / EP-1: this used to live in a ref mutated synchronously
  // before the setState. React doesn't re-render on ref mutation, so
  // the source value the rendered tree read was whatever happened to
  // be in the ref at the next React render. Two near-simultaneous
  // setSelectedSymbol calls (e.g. keyboard ``j`` plus the auto-select
  // effect on a calendar refetch) would both stomp the ref, the
  // commit would coalesce, and DetailHeader's autofocus would key off
  // the wrong source. Promote to real state so React tracks the
  // (sym, source) tuple as one render-time value.
  const [selectionSource, setSelectionSourceState] =
    useState<SelectionSource>(null);
  const setSelectedSymbol = useCallback(
    (sym: string | null, source: SelectionSource = null) => {
      setSelectionSourceState(source);
      setSelectedSymbolState(sym);
    },
    [],
  );

  // Round-4 (B-NEW-2): user explicitly cleared via Esc — auto-select
  // effect should skip the next rehydrate.
  const userClearedRef = useRef(false);

  // Round-4 (B-NEW-3 / B-56): focus restoration target for the first
  // sidebar row.
  const firstRowRef = useRef<HTMLButtonElement | null>(null);

  // Round-5 (NEW-Y4 / G-19): preserve a URL-supplied symbol that isn't
  // in the fresh calendar response. Backend `getDetail` returns a stub
  // for off-calendar curated symbols, so the user can land on a deeplink
  // and still get the panel rendering. Once the user picks a different
  // row the ref clears and the normal "snap to first row" auto-select
  // resumes for subsequent calendar refetches.
  //
  // Initialised lazily on the first render so the auto-select effect
  // can read the pinned symbol on the very first calendar resolution
  // — populating in a separate useEffect would have left the ref null
  // for the first render's auto-select pass and the URL pin would lose
  // the race.
  const urlSymbolRef = useRef<string | null>(
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("symbol")
      : null,
  );

  // Round-5 (NEW-Y6 / G-2): scroll-target for the detail panel. Below
  // the lg breakpoint the sidebar stacks above the panel, so a row tap
  // would otherwise leave the detail update off-screen. The page reads
  // this ref + the viewport-width hook below in a post-selection effect
  // and scrolls smoothly into view (honoring prefers-reduced-motion).
  const detailPanelRef = useRef<HTMLElement | null>(null);
  const isWideViewport = useIsWideViewport();
  const calendarFilters = useMemo<EarningsCalendarFilters>(() => {
    if (!filters.watchlistOnly) return filters;
    return { ...filters, watchlistSymbols: marketWatchlist };
  }, [filters, marketWatchlist]);

  // ── Calendar ─────────────────────────────────────────────
  const calendarQuery = useQuery({
    queryKey: ["earnings-calendar", calendarFilters],
    queryFn: ({ signal }) => getEarningsCalendar(calendarFilters, { signal }),
  });
  const calendar = calendarQuery.data ?? null;
  const visibleRows = useMemo(() => calendar?.earnings ?? [], [calendar?.earnings]);
  const loadingCalendar = calendarQuery.isLoading;
  // CLUSTER D (10): isFetching covers the refetch case (stale data on
  // screen + a fresh request in flight). Sidebar uses this to dim itself
  // and set aria-busy without flipping back to the loading skeleton.
  const refetchingCalendar = calendarQuery.isFetching && !calendarQuery.isLoading;
  // Round-5 (NEW-Y3 / G-18): when react-query cancels an in-flight calendar
  // fetch on filter change, the rejection lands as an AbortError. Without
  // this filter the sidebar flashes a red "Error · aborted" banner for the
  // one frame between cancel → new fetch starts. Suppress it.
  const calendarError = calendarQuery.error && !isAbortError(calendarQuery.error)
    ? (calendarQuery.error as Error).message
    : null;

  // ── Detail ───────────────────────────────────────────────
  // K-15 (round-6): high-cardinality query — every symbol the user
  // hovers/clicks creates a unique cache key. The default 10-minute
  // gcTime (set in providers.tsx) lets the cache balloon during a
  // long research session. 60 s gcTime is plenty: if the user comes
  // back to a symbol within the minute we still hit cache, otherwise
  // we'd refetch anyway because earnings detail goes stale fast.
  // Calendar query keeps the default — there are far fewer unique
  // calendar filter combinations.
  const detailQuery = useQuery({
    queryKey: ["earnings-detail", selectedSymbol],
    queryFn: ({ signal }) => getEarningsDetail(selectedSymbol!, { signal }),
    enabled: !!selectedSymbol,
    gcTime: 60_000,
  });
  const detail = selectedSymbol ? detailQuery.data ?? null : null;
  const loadingDetail = !!selectedSymbol && detailQuery.isLoading;
  const refetchingDetail =
    !!selectedSymbol && detailQuery.isFetching && !detailQuery.isLoading;
  // Round-5 (NEW-Y3 / G-18): same AbortError suppression for the detail
  // query — filter-mash + symbol-mash both cancel the previous request.
  const detailError = detailQuery.error && !isAbortError(detailQuery.error)
    ? (detailQuery.error as Error).message
    : null;
  const tickerContextQuery = useTickerContext(
    selectedSymbol ? [selectedSymbol] : [],
    ["quote", "options_summary", "earnings", "research"],
  );
  const tickerContext = selectedSymbol
    ? tickerContextQuery.data?.symbols[selectedSymbol] ?? null
    : null;

  // ── Auto-select first symbol when calendar loads ─────────
  // Runs post-fetch (separate from the query) to keep the query function
  // pure. If current selection is not in the fresh list, fall back to row 0.
  // Round-4: skip when the user just cleared with Esc — they explicitly
  // chose empty state, don't fight them.
  // Round-5 (NEW-Y4 / G-19): respect a URL-pinned symbol even when the
  // calendar comes back empty or doesn't include it — the detail query
  // serves a stub for off-calendar curated symbols.
  useEffect(() => {
    if (!calendar) return;
    let shouldClearSelection = false;
    if (visibleRows.length === 0) {
      // Empty calendar — only clear if we don't have a URL-pinned symbol.
      const isUrlPinned =
        urlSymbolRef.current && urlSymbolRef.current === selectedSymbol;
      shouldClearSelection = !isUrlPinned && selectedSymbol !== null;
    } else if (!userClearedRef.current) {
      const stillValid =
        selectedSymbol && visibleRows.some((r) => r.symbol === selectedSymbol);
      const isUrlPinned =
        urlSymbolRef.current && urlSymbolRef.current === selectedSymbol;
      // Phase-2 / EP-3 (per user directive 2026-04-26): do NOT auto-select
      // the first calendar row on cold load. Heavy work (Claude structured
      // analysis, options chain fetch, IV term backfill, news scoring)
      // only fires once /detail is hit, so an auto-selection burns Opus
      // tokens + chain bandwidth on a symbol the user never asked for.
      // We still rehydrate URL-pinned selections (deeplink path) and
      // preserve the current selection if it's still in the visible
      // calendar — but we no longer pre-pick the top row.
      shouldClearSelection = !stillValid && !isUrlPinned && selectedSymbol !== null;
    }
    if (!shouldClearSelection) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setSelectedSymbol(null, null);
    });
    return () => {
      cancelled = true;
    };
  }, [calendar, selectedSymbol, setSelectedSymbol, visibleRows]);

  // ── Full research (on-demand Claude Opus note) ───────────
  // CLUSTER D (11): expose the mutation error so ClaudeThesisCard can
  // render an inline alert (and a live RateLimitError countdown).
  const fullResearchMutation = useMutation({
    mutationFn: (symbol: string) => postEarningsFullResearch(symbol),
    onSuccess: (full, symbol) => {
      queryClient.setQueryData(
        ["earnings-detail", symbol],
        (prev: EarningsDetail | undefined) =>
          prev ? { ...prev, claudeFullResearch: full } : prev,
      );
    },
  });
  const fullResearchSymbol = fullResearchMutation.variables ?? null;
  const fullResearchAppliesToSelection = fullResearchSymbol === selectedSymbol;
  const runningFull = fullResearchMutation.isPending && fullResearchAppliesToSelection;
  const fullError = fullResearchAppliesToSelection
    ? (fullResearchMutation.error as Error | null)
    : null;
  const runFull = useCallback(() => {
    if (!selectedSymbol) return;
    fullResearchMutation.mutate(selectedSymbol);
  }, [selectedSymbol, fullResearchMutation]);

  // ── Sync state to URL ────────────────────────────────────
  // First run normalizes the URL on mount (replaceState — avoid polluting
  // history with a no-op redirect). Subsequent runs are user-initiated
  // selection/filter changes and use pushState so the back-button works.
  const firstSyncRef = useRef(true);
  useEffect(() => {
    const mode: "replace" | "push" = firstSyncRef.current ? "replace" : "push";
    firstSyncRef.current = false;
    syncURL({ symbol: selectedSymbol, ...filters }, mode);
  }, [selectedSymbol, filters]);

  // ── Round-5 (NEW-Y6 / G-2): mobile scroll-to-detail ──────
  // Below the lg breakpoint the sidebar stacks above the detail panel,
  // so a tap on a sidebar row would leave the panel update off-screen.
  // Smoothly scroll the panel into view when the viewport is below
  // 1024px and the user hasn't asked for reduced-motion. jsdom doesn't
  // implement scrollIntoView, so the test asserts the ref-attachment +
  // overscroll-behavior wiring rather than the call itself.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!selectedSymbol) return;
    if (isWideViewport) return;
    if (!detailPanelRef.current) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    if (reduce) return;
    if (typeof detailPanelRef.current.scrollIntoView === "function") {
      detailPanelRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [selectedSymbol, isWideViewport]);

  // ── B-98: popstate listener — browser back/forward re-reads state
  // from the URL. Without this, history entries pushed by B-39 would
  // only affect the address bar; the page state would be stale.
  // Round-4: source = "url" so DetailHeader is allowed to refocus.
  useEffect(() => {
    function onPopState() {
      if (typeof window === "undefined") return;
      // Suppress the next sync effect's push (it's now catching up to
      // the user's navigation, not initiating a new entry).
      firstSyncRef.current = true;
      setFilters(readFiltersFromURL());
      const params = new URLSearchParams(window.location.search);
      // popstate = re-engage the page; reset the "user cleared" flag.
      userClearedRef.current = false;
      setSelectedSymbol(params.get("symbol"), "url");
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [setSelectedSymbol]);

  // Round-4 (B-NEW-2): listen for the Esc-clear event the detail panel
  // has been dispatching since the start of the project. Set the
  // "user cleared" flag so the auto-select effect doesn't immediately
  // rehydrate the panel.
  useEffect(() => {
    const h = () => {
      userClearedRef.current = true;
      setSelectedSymbol(null, null);
    };
    document.addEventListener("alphadesk:earnings-clear-selection", h);
    return () =>
      document.removeEventListener("alphadesk:earnings-clear-selection", h);
  }, [setSelectedSymbol]);

  // ── B-60: j/k and ArrowUp/ArrowDown shortcuts from useKeyboardShortcuts
  // dispatch these window-level events; we advance selection through the
  // currently-loaded calendar.
  useEffect(() => {
    function step(dir: 1 | -1) {
      const rows = visibleRows;
      if (rows.length === 0) return;
      const currentIdx = rows.findIndex((r) => r.symbol === selectedSymbol);
      const base = currentIdx === -1 ? (dir === 1 ? -1 : 0) : currentIdx;
      const nextIdx = (base + dir + rows.length) % rows.length;
      // Round-4 (B-NEW-4): keyboard nav allows DetailHeader to refocus.
      // Round-5 (NEW-Y4 / G-19): keyboard navigation also counts as a
      // user-driven choice — clear the URL pin so subsequent refetches
      // can snap back to row 0 if needed.
      const nextSym = rows[nextIdx].symbol;
      if (urlSymbolRef.current && nextSym !== urlSymbolRef.current) {
        urlSymbolRef.current = null;
      }
      userClearedRef.current = false;
      setSelectedSymbol(nextSym, "keyboard");
    }
    const next = () => step(1);
    const prev = () => step(-1);
    window.addEventListener("alphadesk:earnings-select-next", next);
    window.addEventListener("alphadesk:earnings-select-prev", prev);
    return () => {
      window.removeEventListener("alphadesk:earnings-select-next", next);
      window.removeEventListener("alphadesk:earnings-select-prev", prev);
    };
  }, [selectedSymbol, setSelectedSymbol, visibleRows]);

  // Round-4: source-tagging wrappers for sidebar/keyboard handlers.
  // Round-5 (NEW-Y4 / G-19): clear the URL pin on the first user-driven
  // selection change so the auto-select effect's "snap to first row"
  // behaviour re-engages on subsequent calendar refetches.
  const onSelectFromSidebar = useCallback(
    (sym: string) => {
      if (urlSymbolRef.current && sym !== urlSymbolRef.current) {
        urlSymbolRef.current = null;
      }
      userClearedRef.current = false;
      setSelectedSymbol(sym, "pointer");
    },
    [setSelectedSymbol],
  );
  const onSettleRef = useCallback(() => {
    firstRowRef.current?.focus();
  }, []);

  const setCandidateDecision = useCallback(
    (symbol: string, reportDate: string | null, decision: EarningsCandidateDecision | null) => {
      setCandidateDecisions((prev) => {
        const next: CandidateDecisionMap = { ...prev };
        const key = candidateDecisionKey(symbol, reportDate);
        if (decision) next[key] = decision;
        else delete next[key];
        safeSetItem(CANDIDATE_DECISIONS_KEY, JSON.stringify(next));
        return next;
      });
    },
    [],
  );

  const selectedReportDate = useMemo(() => {
    if (!selectedSymbol) return null;
    const upper = selectedSymbol.toUpperCase();
    return (
      calendar?.earnings.find((r) => r.symbol.toUpperCase() === upper)?.reportDate
      ?? detail?.reportDate
      ?? null
    );
  }, [calendar, detail, selectedSymbol]);

  const onCandidateDecision = useCallback(
    (decision: EarningsCandidateDecision | null) => {
      if (!selectedSymbol) return;
      setCandidateDecision(selectedSymbol, selectedReportDate, decision);
    },
    [selectedReportDate, selectedSymbol, setCandidateDecision],
  );

  const selectedCandidateDecision = selectedSymbol
    ? candidateDecisions[candidateDecisionKey(selectedSymbol, selectedReportDate)] ?? null
    : null;

  const decisionCounts = useMemo(
    () => countVisibleCandidateDecisions(calendar?.earnings ?? [], candidateDecisions),
    [calendar?.earnings, candidateDecisions],
  );

  const actions = (
    <span
      role="status"
      aria-live="polite"
      className="t-meta tabular-nums text-[color:var(--fg-muted)]"
    >
      {calendar
        ? `${calendar.earnings.length} earnings · sorted by ${filters.sort ?? "date"}${
            decisionCounts.total > 0
              ? ` · ${decisionCounts.saved} saved · ${decisionCounts.order} marked for order review`
              : ""
          }`
        : "Loading…"}
    </span>
  );

  // CLUSTER A (1): prefer the backend-rendered windowLabel when present
  // — it accounts for weekends, month rollovers, holidays, and the NY
  // market date in a way the front-end title shouldn't reverse-engineer.
  // Falls back to the static "this/next" label when the field is absent
  // (older backends or test fixtures that don't thread it).
  const title = calendar?.windowLabel
    ? `${titleForWindow(filters.window)} · ${calendar.windowLabel}`
    : titleForWindow(filters.window);

  return (
    <DashboardPageLayout
      eyebrow="§ EARNINGS · OPTIONS PLAY"
      title={title}
      actions={actions}
    >
      <h1 className="sr-only">Earnings options play</h1>
      {/* Round-8 / AX-05: skip-to-detail link for keyboard users so a
          large calendar (12+ rows after sort/filter) doesn't force a
          long tab cycle to reach the active symbol's panel. Visible on
          focus, ``sr-only`` otherwise. */}
      <a
        href="#earnings-detail-panel"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:border focus:border-[color:var(--brand)] focus:bg-[color:var(--bg-card)] focus:px-3 focus:py-2 focus:t-mono focus:text-[12px]"
      >
        Skip to detail panel
      </a>

      {/* Round-8 / NV-01: dismissible "what is this strategy?" intro
          for first-time users. Persisted in localStorage so power
          users only see it once. */}
      <StrategyIntroCard />

      <FiltersBar
        filters={filters}
        onChange={setFilters}
        onSettleRef={onSettleRef}
      />

      <div
        data-slot="earnings-page-grid"
        className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]"
        // Round-5 (NEW-Y7 / G-7): belt-and-braces over the global
        // `contain` rule on html/body — `overscroll-behavior-y: none`
        // here kills any iOS Safari pull-to-refresh hijack inside the
        // earnings layout without affecting other dashboard pages.
        style={{ overscrollBehaviorY: "none" }}
      >
        <EarningsCalendarSidebar
          rows={calendar?.earnings ?? []}
          loading={loadingCalendar}
          refetching={refetchingCalendar}
          error={calendarError}
          selected={selectedSymbol}
          onSelect={onSelectFromSidebar}
          firstRowRef={firstRowRef}
          candidateDecisions={candidateDecisions}
          windowLabel={calendar?.windowLabel ?? null}
          metaReason={calendar?.meta?.reason ?? null}
          filters={filters}
          // B-107: restore defaults from the empty-state "Loosen a filter"
          // CTA. Matches the initial state in readFiltersFromURL.
          onResetFilters={() => setFilters({ window: "both", minIvRank: 0, sort: "date" })}
        />
        {/* Round-8 / AX-05: id target for the skip-to-detail link. */}
        <div id="earnings-detail-panel">
          <EarningsDetailPanel
            ref={detailPanelRef}
            detail={detail}
            tickerContext={tickerContext}
            loading={loadingDetail}
            refetching={refetchingDetail}
            error={detailError}
            runningFull={runningFull}
            fullResearchError={fullError}
            onRunFullResearch={runFull}
            candidateDecision={selectedCandidateDecision}
            onCandidateDecision={onCandidateDecision}
            selectionSource={selectionSource}
          />
        </div>
      </div>
    </DashboardPageLayout>
  );
}

/**
 * Round-8 / NV-01: dismissible plain-language explainer for first-time
 * users. The page previously dropped novices straight into a calendar
 * with no orientation on how defined-risk earnings structures differ
 * across premium-selling, debit, and long-volatility theses.
 * Dismissal persists in localStorage so power users see it once.
 */
const INTRO_DISMISS_KEY = "alphadesk:earnings-intro-dismissed";
const INTRO_DISMISS_EVENT = "alphadesk:earnings-intro-dismissed-change";

function subscribeIntroDismissed(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(INTRO_DISMISS_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(INTRO_DISMISS_EVENT, onStoreChange);
  };
}

function readIntroDismissed() {
  return safeGetItem(INTRO_DISMISS_KEY) === "1";
}

function StrategyIntroCard() {
  const dismissed = useSyncExternalStore(
    subscribeIntroDismissed,
    readIntroDismissed,
    () => true,
  );
  if (dismissed) return null;
  return (
    <aside
      data-slot="earnings-intro"
      className="mb-3 rounded border border-[color:var(--border)] bg-[color:var(--bg-elev-1)] px-4 py-3 text-[13px] leading-relaxed text-fg-muted"
    >
      <p>
        <strong className="u-brand">This strategy looks for defined-risk earnings option trades.</strong>{" "}
        High IV often favors credit spreads or iron condors that profit if the move stays inside the
        implied range; lower IV or a strong catalyst can favor debit spreads, long calls/puts, or long
        straddles. Naked short calls have <span className="u-loss">unlimited risk</span>; every actionable
        setup here should cap max loss before it becomes tradable.
      </p>
      <button
        type="button"
        onClick={() => {
          safeSetItem(INTRO_DISMISS_KEY, "1");
          window.dispatchEvent(new Event(INTRO_DISMISS_EVENT));
        }}
        className="mt-2 t-meta underline text-fg-muted hover:text-brand"
      >
        Got it — don&apos;t show again
      </button>
    </aside>
  );
}

// ─── Presentation helpers ────────────────────────────────────

/**
 * Round-5 (NEW-Y3 / G-18): true when an error came from a cancelled
 * fetch. AbortError surfaces in two flavours:
 *   · `DOMException` with `name === "AbortError"` (native fetch abort)
 *   · `Error` whose message contains "abort" (older shims, axios)
 * We catch both so the calendar/detail error banners don't flash red for
 * the one frame between filter mash → cancel → new fetch starts.
 *
 * Timeouts produce a `TimeoutError` DOMException, NOT AbortError — those
 * still surface as real errors so we explicitly don't match "timeout".
 */
function isAbortError(err: unknown): boolean {
  if (!err) return false;
  if (typeof err === "object" && (err as { name?: string }).name === "AbortError") return true;
  if (err instanceof Error) {
    if (err.name === "AbortError") return true;
    if (/aborted|signal is aborted/i.test(err.message)) return true;
  }
  return false;
}

/**
 * Round-5 (NEW-Y6 / G-2): track whether the viewport is at lg+ (≥1024px).
 * Used by the mobile scroll-to-detail effect — at lg+ the sidebar and
 * panel are side-by-side so no scroll is needed. Older Safari fallback
 * via the deprecated `addListener`/`removeListener` to keep the hook
 * working across the full target browser matrix.
 */
function useIsWideViewport(): boolean {
  // Round-8 / MO-01: SSR default = false (mobile-first). The earlier
  // ``useState(true)`` was an SSR-optimism tradeoff that broke
  // deeplinked phone users: the scroll-to-detail effect's
  // ``if (isWideViewport) return`` short-circuited on first paint
  // and the panel never auto-scrolled into view when the calendar
  // hydrated. Defaulting false means desktop pays one re-render on
  // hydration to flip back to true (negligible) but mobile gets a
  // correct first paint.
  const [wide, setWide] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia?.("(min-width: 1024px)")?.matches ?? false;
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia?.("(min-width: 1024px)");
    if (!mq) return;
    const update = () => setWide(mq.matches);
    update();
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", update);
      return () => mq.removeEventListener("change", update);
    }
    // Older Safari fallback
    mq.addListener?.(update);
    return () => mq.removeListener?.(update);
  }, []);
  return wide;
}

function titleForWindow(win: EarningsCalendarFilters["window"]): string {
  switch (win) {
    case "current":
      return "This week's earnings";
    case "next":
      return "Next week's earnings";
    case "both":
    default:
      return "This + next week's earnings";
  }
}

// ─── URL sync helpers ────────────────────────────────────────

function readFiltersFromURL(): EarningsCalendarFilters {
  // Phase-2 / EP-4 (per user directive 2026-04-26): default filters
  // relaxed to show ALL interesting (curated-universe) names. Pre-fix
  // ``minIvRank=70`` filtered out 80%+ of legitimate setups — the user
  // reasonably objected: "we want all the companies which are
  // interesting, in the calendar." The curated universe filter
  // already keeps the catalog tight (~130 mega/large caps with deep
  // options); a vol-rank floor on top of that is over-screening.
  // Premium sellers can still re-impose ``minIvRank=70`` via the
  // FiltersBar, which the URL syncs back.
  if (typeof window === "undefined") return { window: "both", minIvRank: 0, sort: "date" };
  const p = new URLSearchParams(window.location.search);
  const out: EarningsCalendarFilters = {};

  // B-58: validate every param strictly. If the URL value is missing or
  // invalid, leave the field undefined so the defaults apply via the
  // spread below — no silent coercion of "abc" to NaN → fallback 50.
  const win = p.get("window");
  if (win === "current" || win === "next" || win === "both") out.window = win;

  // B-58 + B-66: strict range validation for minIvRank; market_cap
  // dropped entirely (curated-universe filter is always on now).
  const rawIv = p.get("minIvRank");
  if (rawIv != null) {
    const n = Number(rawIv);
    if (Number.isFinite(n) && n >= 0 && n <= 100) out.minIvRank = n;
  }

  const ba = p.get("bmoAmc");
  if (ba && ["bmo", "amc", "both"].includes(ba)) {
    out.bmoAmc = ba as EarningsCalendarFilters["bmoAmc"];
  }

  const wl = p.get("watchlistOnly");
  if (wl === "true") out.watchlistOnly = true;
  else if (wl === "false") out.watchlistOnly = false;

  const sort = p.get("sort");
  if (sort && ["date", "iv_rank", "yield", "claude_confidence", "edge_score"].includes(sort)) {
    out.sort = sort as EarningsCalendarFilters["sort"];
  }

  // Round-8 / DT-05: same defaults as the SSR branch above.
  return { window: "both", minIvRank: 0, sort: "date", ...out };
}

function syncURL(
  state: { symbol: string | null } & EarningsCalendarFilters,
  mode: "replace" | "push" = "replace",
) {
  if (typeof window === "undefined") return;
  const p = new URLSearchParams();
  if (state.symbol) p.set("symbol", state.symbol);
  if (state.window) p.set("window", state.window);
  if (state.minIvRank !== undefined) p.set("minIvRank", String(state.minIvRank));
  // B-66: market_cap removed from URL sync.
  if (state.bmoAmc && state.bmoAmc !== "both") p.set("bmoAmc", state.bmoAmc);
  if (state.watchlistOnly) p.set("watchlistOnly", "true");
  if (state.sort && state.sort !== "date") p.set("sort", state.sort);
  const newUrl = `${window.location.pathname}?${p.toString()}`;
  // B-39: only the initial mount-normalization should replaceState.
  // Every subsequent (user-driven) change pushState so the back-button
  // walks through filter/selection changes.
  if (mode === "push" && newUrl !== `${window.location.pathname}${window.location.search}`) {
    window.history.pushState({}, "", newUrl);
  } else {
    window.history.replaceState({}, "", newUrl);
  }
}
