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
 * /strategies/earnings-options-play — research screener.
 *
 * Layout C (Bloomberg): left calendar sidebar + right persistent detail panel.
 * URL state: ?symbol=NVDA&window=both&min_iv_rank=50&sort=date — refresh
 * preserves selection and filters.
 *
 * Data layer (B-97): react-query owns calendar + detail + full-research.
 * Auto stale-while-revalidate, one retry on transient 5xx, AbortSignal-based
 * cancellation when filters/symbol change. The page only owns UI state
 * (`filters`, `selectedSymbol`) plus the URL sync side-effect.
 */
export default function EarningsOptionsPlayPage() {
  const queryClient = useQueryClient();

  const [filters, setFilters] = useState<EarningsCalendarFilters>(() =>
    readFiltersFromURL(),
  );
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    return params.get("symbol");
  });

  // ── Calendar ─────────────────────────────────────────────
  const calendarQuery = useQuery({
    queryKey: ["earnings-calendar", filters],
    queryFn: ({ signal }) => getEarningsCalendar(filters, { signal }),
  });
  const calendar = calendarQuery.data ?? null;
  const loadingCalendar = calendarQuery.isLoading;
  const calendarError = calendarQuery.error
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
  const detailError = detailQuery.error ? (detailQuery.error as Error).message : null;

  // ── Auto-select first symbol when calendar loads ─────────
  // Runs post-fetch (separate from the query) to keep the query function
  // pure. If current selection is not in the fresh list, fall back to row 0.
  useEffect(() => {
    if (!calendar) return;
    if (calendar.earnings.length === 0) {
      if (selectedSymbol !== null) setSelectedSymbol(null);
      return;
    }
    const stillValid =
      selectedSymbol && calendar.earnings.some((r) => r.symbol === selectedSymbol);
    if (!stillValid) {
      setSelectedSymbol(calendar.earnings[0].symbol);
    }
  }, [calendar, selectedSymbol]);

  // ── Full research (on-demand Claude Opus note) ───────────
  const fullResearchMutation = useMutation({
    mutationFn: (symbol: string) => postEarningsFullResearch(symbol),
    onSuccess: (full) => {
      if (!selectedSymbol) return;
      queryClient.setQueryData(
        ["earnings-detail", selectedSymbol],
        (prev: EarningsDetail | undefined) =>
          prev ? { ...prev, claude_full_research: full } : prev,
      );
    },
  });
  const runningFull = fullResearchMutation.isPending;
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

  // ── B-98: popstate listener — browser back/forward re-reads state
  // from the URL. Without this, history entries pushed by B-39 would
  // only affect the address bar; the page state would be stale.
  useEffect(() => {
    function onPopState() {
      if (typeof window === "undefined") return;
      // Suppress the next sync effect's push (it's now catching up to
      // the user's navigation, not initiating a new entry).
      firstSyncRef.current = true;
      setFilters(readFiltersFromURL());
      const params = new URLSearchParams(window.location.search);
      setSelectedSymbol(params.get("symbol"));
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

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
      setSelectedSymbol(rows[nextIdx].symbol);
    }
    const next = () => step(1);
    const prev = () => step(-1);
    window.addEventListener("alphadesk:earnings-select-next", next);
    window.addEventListener("alphadesk:earnings-select-prev", prev);
    return () => {
      window.removeEventListener("alphadesk:earnings-select-next", next);
      window.removeEventListener("alphadesk:earnings-select-prev", prev);
    };
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

  // B-102: title reflects the active window filter so the header updates
  // as users toggle between current / next / both.
  const title = titleForWindow(filters.window);

  return (
    <DashboardPageLayout
      eyebrow="§ EARNINGS · OPTIONS PLAY"
      title={title}
      actions={actions}
    >
      <FiltersBar filters={filters} onChange={setFilters} />

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
        <EarningsCalendarSidebar
          rows={calendar?.earnings ?? []}
          loading={loadingCalendar}
          error={calendarError}
          selected={selectedSymbol}
          onSelect={setSelectedSymbol}
          filters={filters}
          // B-107: restore defaults from the empty-state "Loosen a filter"
          // CTA. Matches the initial state in readFiltersFromURL.
          onResetFilters={() => setFilters({ window: "both", min_iv_rank: 50, sort: "date" })}
        />
        <EarningsDetailPanel
          detail={detail}
          loading={loadingDetail}
          error={detailError}
          runningFull={runningFull}
          onRunFullResearch={runFull}
        />
      </div>
    </DashboardPageLayout>
  );
}

// ─── Presentation helpers ────────────────────────────────────

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
  if (typeof window === "undefined") return { window: "both", min_iv_rank: 50, sort: "date" };
  const p = new URLSearchParams(window.location.search);
  const out: EarningsCalendarFilters = {};

  // B-58: validate every param strictly. If the URL value is missing or
  // invalid, leave the field undefined so the defaults apply via the
  // spread below — no silent coercion of "abc" to NaN → fallback 50.
  const win = p.get("window");
  if (win === "current" || win === "next" || win === "both") out.window = win;

  // B-58 + B-66: strict range validation for min_iv_rank; market_cap
  // dropped entirely (curated-universe filter is always on now).
  const rawIv = p.get("min_iv_rank");
  if (rawIv != null) {
    const n = Number(rawIv);
    if (Number.isFinite(n) && n >= 0 && n <= 100) out.min_iv_rank = n;
  }

  const ba = p.get("bmo_amc");
  if (ba && ["bmo", "amc", "both"].includes(ba)) {
    out.bmo_amc = ba as EarningsCalendarFilters["bmo_amc"];
  }

  const wl = p.get("watchlist_only");
  if (wl === "true") out.watchlist_only = true;
  else if (wl === "false") out.watchlist_only = false;

  const sort = p.get("sort");
  if (sort && ["date", "iv_rank", "yield", "claude_confidence"].includes(sort)) {
    out.sort = sort as EarningsCalendarFilters["sort"];
  }

  return { window: "both", min_iv_rank: 50, sort: "date", ...out };
}

function syncURL(
  state: { symbol: string | null } & EarningsCalendarFilters,
  mode: "replace" | "push" = "replace",
) {
  if (typeof window === "undefined") return;
  const p = new URLSearchParams();
  if (state.symbol) p.set("symbol", state.symbol);
  if (state.window) p.set("window", state.window);
  if (state.min_iv_rank !== undefined) p.set("min_iv_rank", String(state.min_iv_rank));
  // B-66: market_cap removed from URL sync.
  if (state.bmo_amc && state.bmo_amc !== "both") p.set("bmo_amc", state.bmo_amc);
  if (state.watchlist_only) p.set("watchlist_only", "true");
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
