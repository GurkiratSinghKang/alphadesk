"use client";

import { useMemo } from "react";
import type { RefObject } from "react";
import type { CalendarRow, EarningsCalendarFilters } from "@/types";
import { cn } from "@/lib/utils";
import { fmtDate, fmtPlural } from "@/lib/intl";

export interface EarningsCalendarSidebarProps {
  rows: CalendarRow[];
  loading: boolean;
  error: string | null;
  selected: string | null;
  onSelect: (symbol: string) => void;
  // B-56: parent can pass a ref that the sidebar will attach to the first
  // row's button so focus can be programmatically restored after a
  // filter-triggered refetch.
  firstRowRef?: RefObject<HTMLButtonElement | null>;
  // B-107: pass the active filter set so the empty-state can name the
  // restricting filter (e.g. "… with IV rank ≥ 80").
  filters?: EarningsCalendarFilters;
  // B-107: parent hands in a reset callback so the empty-state "Loosen a
  // filter" button can restore defaults. Previously a window-scoped
  // CustomEvent that no-one listened to — the button was a no-op in prod
  // (simplify review). Omit to hide the button entirely.
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
  rows, loading, error, selected, onSelect, firstRowRef, filters, onResetFilters,
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
      <aside data-slot="earnings-calendar-sidebar" className="rounded border border-[color:var(--fg-border)] p-3">
        <p className="font-mono text-[13px] text-[color:var(--fg-muted)]">Loading earnings…</p>
      </aside>
    );
  }

  if (!loading && rows.length === 0) {
    // B-107: name the restricting filter + (if the parent provided a
    // reset callback) offer a one-click way out of the empty state.
    const emptyMessage = buildEmptyStateMessage(filters);
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

  // B-108: summary row above the day groups names the active window and
  // the total number of reporting symbols (pluralized via fmtPlural).
  const windowLabel =
    (filters?.window ?? "both") === "current" ? "This week"
    : (filters?.window ?? "both") === "next"  ? "Next week"
    : "This + next week";

  return (
    <aside
      data-slot="earnings-calendar-sidebar"
      className="self-start rounded border border-[color:var(--fg-border)] bg-[color:var(--bg-card)] p-3"
    >
      <p className="t-label mb-2 text-[color:var(--fg-muted)]" data-slot="calendar-summary">
        § CALENDAR <span className="text-[color:var(--fg-muted)]">· {windowLabel} · {fmtPlural(rows.length, "report")}</span>
      </p>
      {grouped.map(({ date, label, rows: dayRows }) => (
        <div key={date} data-slot="day-group" className="mb-3">
          <h3 className="t-display-section italic text-[13px] pb-1 border-b border-[color:var(--fg-border)]">
            {label} <span className="t-label text-[color:var(--fg-muted)]">· {fmtPlural(dayRows.length, "report")}</span>
          </h3>
          <ul className="mt-1 space-y-0.5">
            {dayRows.map((r) => (
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
                  aria-label={`Select ${r.symbol} · reports ${fmtDate(r.report_date, { weekday: "long", month: "long", day: "numeric" })}${r.iv_rank != null ? ' · IV rank ' + Math.round(r.iv_rank) : ''}`}
                  data-selected={r.symbol === selected}
                  className={cn(
                    // B-57: px-3/py-2 ensures ≥44 px touch target on iPad.
                    "flex w-full items-center justify-between rounded px-3 py-2 font-mono text-[12.5px] text-left transition-colors",
                    r.symbol === selected
                      ? "bg-[color:var(--bg-accent-subtle)] border-l-2 border-[color:var(--fg-accent)] text-[color:var(--fg-base)]"
                      : "hover:bg-[color:var(--bg-elevated)] text-[color:var(--fg-muted)] hover:text-[color:var(--fg-base)]",
                  )}
                >
                  <span>
                    <span className="font-semibold text-[color:var(--fg-base)]">{r.symbol}</span>
                    <span className="ml-1 text-[10px] text-[color:var(--fg-muted)]">{r.report_time}</span>
                  </span>
                  {r.iv_rank != null && (
                    <span className="text-[11px] tabular-nums text-[color:var(--fg-pos)]">
                      {Math.round(r.iv_rank)}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </aside>
  );
}

function groupByDate(rows: CalendarRow[]): { date: string; label: string; rows: CalendarRow[] }[] {
  const map = new Map<string, CalendarRow[]>();
  for (const r of rows) {
    if (!map.has(r.report_date)) map.set(r.report_date, []);
    map.get(r.report_date)!.push(r);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, dateRows]) => ({ date, label: formatDateLabel(date), rows: dateRows }));
}

function formatDateLabel(iso: string): string {
  // Locale-aware — e.g. en-US "Fri 04/24", de-DE "Fr., 24.04." — via Intl.
  return fmtDate(iso, { weekday: "short", month: "2-digit", day: "2-digit" });
}

// B-107: compose a human sentence that names the currently-restricting
// filters so the user knows which knob to loosen. Falls back to a
// generic message when `filters` wasn't passed.
function buildEmptyStateMessage(filters: EarningsCalendarFilters | undefined): string {
  if (!filters) return "No earnings match —";
  const windowKey = filters.window ?? "both";
  const windowLabel =
    windowKey === "current" ? "the current week"
    : windowKey === "next"  ? "the next week"
    : "the current/next week";
  const parts: string[] = [`No earnings in ${windowLabel}`];
  if (filters.min_iv_rank != null && filters.min_iv_rank > 0) {
    parts.push(`with IV rank \u2265 ${filters.min_iv_rank}`);
  }
  if (filters.bmo_amc && filters.bmo_amc !== "both") {
    parts.push(`reporting ${filters.bmo_amc.toUpperCase()}`);
  }
  if (filters.watchlist_only) {
    parts.push("on your watchlist");
  }
  return `${parts.join(" ")} \u00b7`;
}
