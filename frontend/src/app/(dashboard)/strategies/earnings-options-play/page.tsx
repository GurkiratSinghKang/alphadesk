"use client";

import { useCallback, useEffect, useState } from "react";
import DashboardPageLayout from "@/components/layouts/DashboardPageLayout";
import {
  getEarningsCalendar,
  getEarningsDetail,
  postEarningsFullResearch,
} from "@/lib/api";
import type {
  CalendarResponse,
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
 */
export default function EarningsOptionsPlayPage() {
  const [calendar, setCalendar] = useState<CalendarResponse | null>(null);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [loadingCalendar, setLoadingCalendar] = useState(true);

  const [detail, setDetail] = useState<EarningsDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [filters, setFilters] = useState<EarningsCalendarFilters>(() =>
    readFiltersFromURL(),
  );
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    return params.get("symbol");
  });

  const [runningFull, setRunningFull] = useState(false);

  // ── Fetch calendar whenever filters change ───────────────
  useEffect(() => {
    let cancelled = false;
    setLoadingCalendar(true);
    setCalendarError(null);
    getEarningsCalendar(filters)
      .then((resp) => {
        if (cancelled) return;
        setCalendar(resp);
        // Auto-select first symbol if none selected, or selected no longer in list
        if (resp.earnings.length > 0) {
          const stillValid = selectedSymbol && resp.earnings.some((r) => r.symbol === selectedSymbol);
          if (!stillValid) {
            setSelectedSymbol(resp.earnings[0].symbol);
          }
        } else {
          setSelectedSymbol(null);
        }
      })
      .catch((e: Error) => {
        if (!cancelled) setCalendarError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoadingCalendar(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(filters)]);

  // ── Fetch detail when selectedSymbol changes ─────────────
  useEffect(() => {
    if (!selectedSymbol) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoadingDetail(true);
    setDetailError(null);
    getEarningsDetail(selectedSymbol)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((e: Error) => {
        if (!cancelled) setDetailError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSymbol]);

  // ── Sync state to URL ────────────────────────────────────
  useEffect(() => {
    syncURL({ symbol: selectedSymbol, ...filters });
  }, [selectedSymbol, filters]);

  // ── Full research mutation ───────────────────────────────
  const runFull = useCallback(async () => {
    if (!selectedSymbol) return;
    setRunningFull(true);
    try {
      const full = await postEarningsFullResearch(selectedSymbol);
      setDetail((prev) =>
        prev ? { ...prev, claude_full_research: full } : prev,
      );
    } finally {
      setRunningFull(false);
    }
  }, [selectedSymbol]);

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
