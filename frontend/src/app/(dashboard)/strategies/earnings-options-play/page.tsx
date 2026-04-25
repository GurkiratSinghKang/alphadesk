"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import DashboardPageLayout from "@/components/layouts/DashboardPageLayout";
import {
  getEarningsCalendar,
  getEarningsDetail,
  postEarningsFullResearch,
} from "@/lib/api";
import type {
  EarningsDetail,
  EarningsCalendarFilters,
} from "@/types";

import EarningsCalendarSidebar from "./_earnings/EarningsCalendarSidebar";
import FiltersBar from "./_earnings/FiltersBar";
import EarningsDetailPanel from "./_earnings/EarningsDetailPanel";

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

  const [filters, setFilters] = useState<EarningsCalendarFilters>(() =>
    readFiltersFromURL(),
  );
  const [selectedSymbol, setSelectedSymbolState] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    return params.get("symbol");
  });

  // Round-4 (B-NEW-4): track the source of the last selection change so
  // DetailHeader knows whether to refocus its <h2>.
  const lastSelectionSourceRef = useRef<SelectionSource>(null);
  const setSelectedSymbol = useCallback(
    (sym: string | null, source: SelectionSource = null) => {
      lastSelectionSourceRef.current = source;
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

  // ── Calendar ─────────────────────────────────────────────
  const calendarQuery = useQuery({
    queryKey: ["earnings-calendar", filters],
    queryFn: ({ signal }) => getEarningsCalendar(filters, { signal }),
  });
  const calendar = calendarQuery.data ?? null;
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
  const detailQuery = useQuery({
    queryKey: ["earnings-detail", selectedSymbol],
    queryFn: ({ signal }) => getEarningsDetail(selectedSymbol!, { signal }),
    enabled: !!selectedSymbol,
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
    if (calendar.earnings.length === 0) {
      // Empty calendar — only clear if we don't have a URL-pinned symbol.
      const isUrlPinned =
        urlSymbolRef.current && urlSymbolRef.current === selectedSymbol;
      if (!isUrlPinned && selectedSymbol !== null) setSelectedSymbol(null, null);
      return;
    }
    if (userClearedRef.current) return;
    const stillValid =
      selectedSymbol && calendar.earnings.some((r) => r.symbol === selectedSymbol);
    const isUrlPinned =
      urlSymbolRef.current && urlSymbolRef.current === selectedSymbol;
    if (!stillValid && !isUrlPinned) {
      // Auto-fill is treated as a URL-equivalent selection (deeplink-y) —
      // DetailHeader is allowed to focus the heading.
      setSelectedSymbol(calendar.earnings[0].symbol, "url");
    }
  }, [calendar, selectedSymbol, setSelectedSymbol]);

  // ── Full research (on-demand Claude Opus note) ───────────
  // CLUSTER D (11): expose the mutation error so ClaudeThesisCard can
  // render an inline alert (and a live RateLimitError countdown).
  const fullResearchMutation = useMutation({
    mutationFn: (symbol: string) => postEarningsFullResearch(symbol),
    onSuccess: (full) => {
      if (!selectedSymbol) return;
      queryClient.setQueryData(
        ["earnings-detail", selectedSymbol],
        (prev: EarningsDetail | undefined) =>
          prev ? { ...prev, claudeFullResearch: full } : prev,
      );
    },
  });
  const runningFull = fullResearchMutation.isPending;
  const fullError = fullResearchMutation.error as Error | null;
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
  // currently-loaded calendar. Use a ref so the handlers always see the
  // latest rows without re-binding on every fetch.
  const rowsRef = useRef(calendar?.earnings ?? []);
  rowsRef.current = calendar?.earnings ?? [];
  const selectedRef = useRef(selectedSymbol);
  selectedRef.current = selectedSymbol;

  useEffect(() => {
    function step(dir: 1 | -1) {
      const rows = rowsRef.current;
      if (rows.length === 0) return;
      const currentIdx = rows.findIndex((r) => r.symbol === selectedRef.current);
      const base = currentIdx === -1 ? 0 : currentIdx;
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
  }, [setSelectedSymbol]);

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

  const actions = (
    <span
      role="status"
      aria-live="polite"
      className="t-meta tabular-nums text-[color:var(--fg-muted)]"
    >
      {calendar
        ? `${calendar.earnings.length} earnings · sorted by ${filters.sort ?? "date"}`
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
          windowLabel={calendar?.windowLabel ?? null}
          metaReason={calendar?.meta?.reason ?? null}
          filters={filters}
          // B-107: restore defaults from the empty-state "Loosen a filter"
          // CTA. Matches the initial state in readFiltersFromURL.
          onResetFilters={() => setFilters({ window: "both", minIvRank: 50, sort: "date" })}
        />
        <EarningsDetailPanel
          ref={detailPanelRef}
          detail={detail}
          loading={loadingDetail}
          refetching={refetchingDetail}
          error={detailError}
          runningFull={runningFull}
          fullResearchError={fullError}
          onRunFullResearch={runFull}
          selectionSource={lastSelectionSourceRef.current}
        />
      </div>
    </DashboardPageLayout>
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
  const [wide, setWide] = useState(true);
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
  if (typeof window === "undefined") return { window: "both", minIvRank: 50, sort: "date" };
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
  if (sort && ["date", "iv_rank", "yield", "claude_confidence"].includes(sort)) {
    out.sort = sort as EarningsCalendarFilters["sort"];
  }

  return { window: "both", minIvRank: 50, sort: "date", ...out };
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
