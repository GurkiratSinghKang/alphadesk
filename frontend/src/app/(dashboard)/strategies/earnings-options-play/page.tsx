"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

  // B-58: validate every param strictly. If the URL value is missing or
  // invalid, leave the field undefined so the defaults apply via the
  // spread below — no silent coercion of "abc" to NaN → fallback 50.
  const win = p.get("window");
  if (win === "current" || win === "next" || win === "both") out.window = win;

  const rawIv = p.get("min_iv_rank");
  if (rawIv != null) {
    const n = Number(rawIv);
    if (Number.isFinite(n) && n >= 0 && n <= 100) out.min_iv_rank = n;
  }

  const mc = p.get("market_cap");
  if (mc && ["mega", "large", "mid", "small", "all"].includes(mc)) {
    out.market_cap = mc as EarningsCalendarFilters["market_cap"];
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
  if (state.market_cap && state.market_cap !== "all") p.set("market_cap", state.market_cap);
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
