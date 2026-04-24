"use client";

import { useCallback, useEffect, useState } from "react";
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
  useEffect(() => {
    syncURL({ symbol: selectedSymbol, ...filters });
  }, [selectedSymbol, filters]);

  const actions = (
    <span className="t-meta tabular-nums text-[color:var(--fg-muted)]">
      {calendar
        ? `${calendar.earnings.length} earnings · sorted by ${filters.sort ?? "date"}`
        : "Loading…"}
    </span>
  );

  return (
    <DashboardPageLayout
      eyebrow="§ EARNINGS · OPTIONS PLAY"
      title="This week · next week"
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

// ─── URL sync helpers ────────────────────────────────────────

function readFiltersFromURL(): EarningsCalendarFilters {
  if (typeof window === "undefined") return { window: "both", min_iv_rank: 50, sort: "date" };
  const p = new URLSearchParams(window.location.search);
  const out: EarningsCalendarFilters = {};
  const win = p.get("window");
  if (win === "current" || win === "next" || win === "both") out.window = win;
  const minIvRank = p.get("min_iv_rank");
  if (minIvRank !== null) out.min_iv_rank = Number(minIvRank);
  const mc = p.get("market_cap");
  if (mc && ["mega", "large", "mid", "small", "all"].includes(mc)) out.market_cap = mc as EarningsCalendarFilters["market_cap"];
  const ba = p.get("bmo_amc");
  if (ba && ["bmo", "amc", "both"].includes(ba)) out.bmo_amc = ba as EarningsCalendarFilters["bmo_amc"];
  if (p.get("watchlist_only") === "true") out.watchlist_only = true;
  const sort = p.get("sort");
  if (sort && ["date", "iv_rank", "yield", "claude_confidence"].includes(sort)) out.sort = sort as EarningsCalendarFilters["sort"];
  return { window: "both", min_iv_rank: 50, sort: "date", ...out };
}

function syncURL(state: { symbol: string | null } & EarningsCalendarFilters) {
  if (typeof window === "undefined") return;
  const p = new URLSearchParams();
  if (state.symbol) p.set("symbol", state.symbol);
  if (state.window) p.set("window", state.window);
  if (state.min_iv_rank !== undefined) p.set("min_iv_rank", String(state.min_iv_rank));
  if (state.market_cap && state.market_cap !== "all") p.set("market_cap", state.market_cap);
  if (state.bmo_amc && state.bmo_amc !== "both") p.set("bmo_amc", state.bmo_amc);
  if (state.watchlist_only) p.set("watchlist_only", "true");
  if (state.sort && state.sort !== "date") p.set("sort", state.sort);
  const newUrl = `${window.location.pathname}?${p.toString()}`;
  window.history.replaceState({}, "", newUrl);
}
