"use client";

import { useMemo } from "react";
import type { RefObject } from "react";
import type {
  CalendarRow,
  CalendarMetaReason,
  EarningsCalendarFilters,
} from "@/types";
import { cn } from "@/lib/utils";
import { fmtDate, fmtPlural } from "@/lib/intl";

export interface EarningsCalendarSidebarProps {
  rows: CalendarRow[];
  loading: boolean;
  /** Round-4 (CLUSTER D/10): true during a refetch when stale rows are
   *  still on screen. Drives `aria-busy` + dim-opacity styling without
   *  flipping back to the loading skeleton. */
  refetching?: boolean;
  error: string | null;
  selected: string | null;
  onSelect: (symbol: string) => void;
  // B-56: parent can pass a ref that the sidebar will attach to the first
  // row's button so focus can be programmatically restored after a
  // filter-triggered refetch.
  firstRowRef?: RefObject<HTMLButtonElement | null>;
  /** Round-4 (CLUSTER A/2): backend-rendered window label for the header
   *  ("§ CALENDAR · Apr 27 – May 1, 2026 · 12 reports"). */
  windowLabel?: string | null;
  /** Round-4 (CLUSTER A/3): backend hint for empty-state copy
   *  (weekend_no_reports, fmp_unavailable, no_curated_matches). */
  metaReason?: CalendarMetaReason | null;
  // B-107: pass the active filter set so the empty-state can name the
  // restricting filter (e.g. "… with IV rank ≥ 80").
  filters?: EarningsCalendarFilters;
  // B-107: parent hands in a reset callback so the empty-state "Loosen a
  // filter" button can restore defaults.
  onResetFilters?: () => void;
}

// B-40: build a same-route deeplink that carries the currently-active
// query string but overrides (or sets) `symbol=<sym>`. Called at click
// time because query string mutates as the user changes filters.
function buildSymbolDeeplink(sym: string): string {
  if (typeof window === "undefined") return `?symbol=${encodeURIComponent(sym)}`;
  const params = new URLSearchParams(window.location.search);
  params.set("symbol", sym);
  return `${window.location.pathname}?${params.toString()}`;
}

export default function EarningsCalendarSidebar({
  rows,
  loading,
  refetching = false,
  error,
  selected,
  onSelect,
  firstRowRef,
  windowLabel,
  metaReason,
  filters,
  onResetFilters,
}: EarningsCalendarSidebarProps) {
  const grouped = useMemo(() => groupByDate(rows), [rows]);
  // B-56: first row across all day groups gets the shared ref so the
  // parent page can restore focus after a filter refetch.
  const firstSymbol = grouped[0]?.rows[0]?.symbol ?? null;

  if (error) {
    return (
      <aside data-slot="earnings-calendar-sidebar" className="rounded border border-[color:var(--fg-border)] p-3">
        <p className="t-label text-[color:var(--fg-neg)]">Error · {error}</p>
      </aside>
    );
  }

  if (loading && rows.length === 0) {
    return (
      <aside
        data-slot="earnings-calendar-sidebar"
        aria-busy="true"
        className="rounded border border-[color:var(--fg-border)] p-3"
      >
        <p className="font-mono text-[13px] text-[color:var(--fg-muted)]">Loading earnings…</p>
      </aside>
    );
  }

  if (!loading && rows.length === 0) {
    // Round-4 (CLUSTER A/3): backend reason hints take precedence over
    // the locally-derived "name the restricting filter" message — the
    // weekend-no-reports case is what Persona R caught reading as a
    // generic "no matches" screen.
    const emptyMessage = buildEmptyStateMessage({
      reason: metaReason ?? null,
      windowLabel: windowLabel ?? null,
      filters,
    });
    return (
      <aside data-slot="earnings-calendar-sidebar" className="rounded border border-[color:var(--fg-border)] p-3">
        <p className="font-mono text-[13px] text-[color:var(--fg-muted)]">
          {emptyMessage}
          {onResetFilters && (
            <>
              {" "}
              <button
                type="button"
                onClick={onResetFilters}
                className="underline decoration-dotted text-[color:var(--fg-accent)] hover:text-[color:var(--fg-base)]"
                data-slot="reset-filters-link"
              >
                Loosen a filter
              </button>.
            </>
          )}
        </p>
      </aside>
    );
  }

  // Round-4 (CLUSTER A/2): prefer the backend-rendered windowLabel for
  // the header. Falls back to a locally-derived label if the response
  // didn't include one (older backend or test fixture).
  const headerLabel =
    windowLabel ??
    ((filters?.window ?? "both") === "current"
      ? "This week"
      : (filters?.window ?? "both") === "next"
      ? "Next week"
      : "This + next week");

  return (
    <aside
      data-slot="earnings-calendar-sidebar"
      data-refetching={refetching || undefined}
      aria-busy={refetching || undefined}
      className={cn(
        "self-start rounded border border-[color:var(--fg-border)] bg-[color:var(--bg-card)] p-3 transition-opacity",
        refetching && "opacity-70",
      )}
    >
      <p className="t-label mb-2 text-[color:var(--fg-muted)]" data-slot="calendar-summary">
        § CALENDAR <span className="text-[color:var(--fg-muted)]">· {headerLabel} · {fmtPlural(rows.length, "report")}</span>
      </p>
      {grouped.map(({ date, label, rows: dayRows }) => (
        <div key={date} data-slot="day-group" className="mb-3">
          <h3 className="t-display-section italic text-[13px] pb-1 border-b border-[color:var(--fg-border)]">
            {label} <span className="t-label text-[color:var(--fg-muted)]">· {fmtPlural(dayRows.length, "report")}</span>
          </h3>
          <ul className="mt-1 space-y-0.5">
            {dayRows.map((r) => {
              // Round-5 (NEW-Y1 / E-2 / E-12): backend reportState drives the
              // dimmed "(reported)" rendering for past + today_done rows
              // and the small "TODAY" pill for today_pre. Absent backend
              // value falls through to "upcoming" — no dim, no pill — so
              // older fixtures + un-reschedule'd reports render normally.
              const state = r.reportState ?? "upcoming";
              const isReported = state === "today_done" || state === "past";
              const isToday = state === "today_pre";
              const reportedSuffix = isReported ? " (reported)" : "";
              return (
                <li key={r.symbol}>
                  <button
                    ref={r.symbol === firstSymbol ? firstRowRef : undefined}
                    type="button"
                    onClick={(e) => {
                      // B-40: ⌘/Ctrl-click or middle-click opens the symbol
                      // in a new tab with the current filter query string,
                      // matching browser conventions for anchors.
                      if (e.metaKey || e.ctrlKey || e.button === 1) {
                        e.preventDefault();
                        window.open(
                          buildSymbolDeeplink(r.symbol),
                          "_blank",
                          "noopener,noreferrer",
                        );
                        return;
                      }
                      onSelect(r.symbol);
                    }}
                    onAuxClick={(e) => {
                      // Middle-click (button===1) fires auxclick, not click,
                      // in modern browsers — handle it here too.
                      if (e.button === 1) {
                        e.preventDefault();
                        window.open(
                          buildSymbolDeeplink(r.symbol),
                          "_blank",
                          "noopener,noreferrer",
                        );
                      }
                    }}
                    title={`${r.symbol} — ⌘/Ctrl-click to open in a new tab`}
                    aria-description="Hold ⌘ or Ctrl and click to open this symbol in a new tab."
                    aria-label={`Select ${r.symbol} · reports ${fmtDate(r.reportDate, { weekday: "long", month: "long", day: "numeric" })}${r.ivRank != null ? ' · IV rank ' + Math.round(r.ivRank) : ''}${reportedSuffix}`}
                    data-selected={r.symbol === selected}
                    data-report-state={state}
                    className={cn(
                      // B-57: px-3/py-2 ensures ≥44 px touch target on iPad.
                      "flex w-full items-center justify-between rounded px-3 py-2 font-mono text-[12.5px] text-left transition-colors",
                      r.symbol === selected
                        ? "bg-[color:var(--bg-accent-subtle)] border-l-2 border-[color:var(--fg-accent)] text-[color:var(--fg-base)]"
                        : "hover:bg-[color:var(--bg-elevated)] text-[color:var(--fg-muted)] hover:text-[color:var(--fg-base)]",
                      // Round-5 (NEW-Y1): dim today_done + past rows so the
                      // user can see they're already reported.
                      isReported && "opacity-60",
                    )}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="font-semibold text-[color:var(--fg-base)]">{r.symbol}</span>
                      <span className="text-[10px] text-[color:var(--fg-muted)]">{r.reportTime}</span>
                      {isToday && (
                        <span
                          data-slot="today-pill"
                          className="rounded bg-[color:var(--brand)] px-1 py-px font-mono text-[8.5px] font-semibold uppercase leading-none text-[color:var(--bg)]"
                        >
                          Today
                        </span>
                      )}
                    </span>
                    {r.ivRank != null && (
                      <span className="text-[11px] tabular-nums text-[color:var(--fg-pos)]">
                        {Math.round(r.ivRank)}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </aside>
  );
}

function groupByDate(rows: CalendarRow[]): { date: string; label: string; rows: CalendarRow[] }[] {
  const map = new Map<string, CalendarRow[]>();
  for (const r of rows) {
    if (!map.has(r.reportDate)) map.set(r.reportDate, []);
    map.get(r.reportDate)!.push(r);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, dateRows]) => ({ date, label: formatDateLabel(date), rows: dateRows }));
}

function formatDateLabel(iso: string): string {
  // Locale-aware — e.g. en-US "Fri 04/24", de-DE "Fr., 24.04." — via Intl.
  return fmtDate(iso, { weekday: "short", month: "2-digit", day: "2-digit" });
}

/**
 * Compose an empty-state message. Backend `metaReason` hints take
 * precedence (Round-4); otherwise we fall back to the previous B-107
 * behaviour of naming whichever filters are restricting the result set.
 */
export function buildEmptyStateMessage({
  reason,
  windowLabel,
  filters,
}: {
  reason: CalendarMetaReason | null;
  windowLabel: string | null;
  filters: EarningsCalendarFilters | undefined;
}): string {
  // Round-4 (CLUSTER A/3): weekend / provider-down hints come from the
  // backend and trump the locally-derived filter narration.
  // Round-5 (NEW-Y2 / E-7): use the actual weekday name rather than
  // hard-coding "Saturday". Backend only emits this reason on weekends,
  // so the weekday name will always be Saturday or Sunday — but that's
  // a backend invariant, not a frontend one. Falling back to the
  // computed weekday means the message reads correctly on Sundays too.
  if (reason === "weekend_no_reports") {
    const today = new Date().toLocaleDateString("en-US", { weekday: "long" });
    return `No earnings reports today (${today}). Markets reopen Monday — see the rest of the week below.`;
  }
  if (reason === "fmp_unavailable") {
    return "Earnings calendar provider unavailable — try again in a moment.";
  }
  if (reason === "no_curated_matches") {
    return windowLabel
      ? `No curated matches for ${windowLabel} — loosen filters.`
      : "No curated matches — loosen filters.";
  }

  // B-107 fallback: name whichever filters are restricting the set.
  if (!filters) return "No earnings match —";
  const windowKey = filters.window ?? "both";
  const windowText =
    windowKey === "current" ? "the current week"
    : windowKey === "next"  ? "the next week"
    : "the current/next week";
  const parts: string[] = [`No earnings in ${windowText}`];
  if (filters.minIvRank != null && filters.minIvRank > 0) {
    parts.push(`with IV rank \u2265 ${filters.minIvRank}`);
  }
  if (filters.bmoAmc && filters.bmoAmc !== "both") {
    parts.push(`reporting ${filters.bmoAmc.toUpperCase()}`);
  }
  if (filters.watchlistOnly) {
    parts.push("on your watchlist");
  }
  return `${parts.join(" ")} \u00b7`;
}
