"use client";

import { useMemo } from "react";
import type { CalendarRow } from "@/types";
import { cn } from "@/lib/utils";
import { fmtDate } from "@/lib/intl";

export interface EarningsCalendarSidebarProps {
  rows: CalendarRow[];
  loading: boolean;
  error: string | null;
  selected: string | null;
  onSelect: (symbol: string) => void;
}

export default function EarningsCalendarSidebar({
  rows, loading, error, selected, onSelect,
}: EarningsCalendarSidebarProps) {
  const grouped = useMemo(() => groupByDate(rows), [rows]);

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
    return (
      <aside data-slot="earnings-calendar-sidebar" className="rounded border border-[color:var(--fg-border)] p-3">
        <p className="font-mono text-[13px] text-[color:var(--fg-muted)]">No earnings match — loosen filters.</p>
      </aside>
    );
  }

  return (
    <aside
      data-slot="earnings-calendar-sidebar"
      className="self-start rounded border border-[color:var(--fg-border)] bg-[color:var(--bg-card)] p-3"
    >
      <p className="t-label mb-2 text-[color:var(--fg-muted)]">§ CALENDAR</p>
      {grouped.map(({ date, label, rows: dayRows }) => (
        <div key={date} data-slot="day-group" className="mb-3">
          <h3 className="t-display-section italic text-[13px] pb-1 border-b border-[color:var(--fg-border)]">
            {label} <span className="t-label text-[color:var(--fg-muted)]">· {dayRows.length} reporting</span>
          </h3>
          <ul className="mt-1 space-y-0.5">
            {dayRows.map((r) => (
              <li key={r.symbol}>
                <button
                  type="button"
                  onClick={() => onSelect(r.symbol)}
                  data-selected={r.symbol === selected}
                  className={cn(
                    "flex w-full items-center justify-between rounded px-2 py-1 font-mono text-[12.5px] text-left transition-colors",
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
