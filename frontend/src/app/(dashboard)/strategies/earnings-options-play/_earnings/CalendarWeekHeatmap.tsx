"use client";

import Eyebrow from "@/components/typography/Eyebrow";
import Mono from "@/components/typography/Mono";
import { cn } from "@/lib/utils";
import type { CalendarRow } from "@/types";

interface CalendarWeekHeatmapProps {
  rows: CalendarRow[];
  onSelect: (symbol: string) => void;
  headlineSymbol?: string;
}

function groupByDate(rows: CalendarRow[]) {
  const out = new Map<string, CalendarRow[]>();
  for (const row of rows) {
    const key = row.reportDate;
    const existing = out.get(key) ?? [];
    existing.push(row);
    out.set(key, existing);
  }
  return Array.from(out.entries()).sort(([a], [b]) => a.localeCompare(b));
}

function formatDayLabel(iso: string) {
  const d = new Date(iso + "T00:00:00");
  const dow = d.toLocaleDateString("en-US", { weekday: "short" });
  const date = d.toLocaleDateString("en-US", { month: "numeric", day: "numeric" });
  return `${dow} ${date}`;
}

export default function CalendarWeekHeatmap({
  rows,
  onSelect,
  headlineSymbol,
}: CalendarWeekHeatmapProps) {
  const grouped = groupByDate(rows);
  // Simple split: first 5 day groups = this week, rest = next week (works for 2-week horizon)
  const thisWeek = grouped.slice(0, 5);
  const nextWeek = grouped.slice(5);

  return (
    <section
      data-slot="calendar-week-heatmap"
      aria-label="Earnings calendar week overview"
      className="flex flex-col gap-8 p-6"
    >
      {thisWeek.length > 0 && (
        <div className="flex flex-col gap-4">
          <Eyebrow as="div">
            § THIS WEEK · {formatDayLabel(thisWeek[0][0])} —{" "}
            {formatDayLabel(thisWeek[thisWeek.length - 1][0])}
          </Eyebrow>
          {thisWeek.map(([date, dayRows]) => (
            <DayGroup
              key={date}
              date={date}
              rows={dayRows}
              onSelect={onSelect}
              headlineSymbol={headlineSymbol}
            />
          ))}
        </div>
      )}

      {nextWeek.length > 0 && (
        <div className="flex flex-col gap-4">
          <Eyebrow as="div">
            § NEXT WEEK · {formatDayLabel(nextWeek[0][0])} —{" "}
            {formatDayLabel(nextWeek[nextWeek.length - 1][0])}
          </Eyebrow>
          {nextWeek.map(([date, dayRows]) => (
            <DayGroup
              key={date}
              date={date}
              rows={dayRows}
              onSelect={onSelect}
              headlineSymbol={headlineSymbol}
            />
          ))}
        </div>
      )}

      <p className="border-t border-[color:var(--border-hair)] pt-3 text-label text-[color:var(--fg-muted)]">
        Pick any row above — or use ↑↓ — for the full options play.
      </p>
    </section>
  );
}

function DayGroup({
  date,
  rows,
  onSelect,
  headlineSymbol,
}: {
  date: string;
  rows: CalendarRow[];
  onSelect: (symbol: string) => void;
  headlineSymbol?: string;
}) {
  return (
    <div className="flex gap-4">
      <div className="flex w-32 shrink-0 flex-col gap-1 border-l border-[color:var(--border-hair)] pl-3">
        <span className="font-mono text-body-sm text-[color:var(--fg)]">
          {formatDayLabel(date)}
        </span>
        <span className="t-label text-[color:var(--fg-muted)]">
          {rows.length} report{rows.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-2">
        {rows.map((row) => {
          const isHeadline = row.symbol === headlineSymbol;
          return (
            <button
              key={`${row.symbol}-${row.reportDate}`}
              type="button"
              onClick={() => onSelect(row.symbol)}
              className={cn(
                "flex items-center gap-3 rounded-sm px-3 py-2 text-left transition-colors",
                "hover:bg-[color:var(--bg-elev-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--brand)]",
              )}
            >
              <span
                className="w-1.5 self-stretch rounded-full bg-[color:var(--brand)]/40"
                aria-hidden
              />
              <span className="font-mono text-body-sm font-semibold text-[color:var(--fg)]">
                {row.symbol}
              </span>
              <span className="t-label text-[color:var(--fg-muted)]">
                {row.reportTime ?? "DMT"}
              </span>
              {row.ivRank != null && (
                <Mono size="hint" className="text-[color:var(--fg-muted)]">
                  IV {row.ivRank.toFixed(0)}
                </Mono>
              )}
              {row.expectedMovePct != null && (
                <Mono size="hint" className="text-[color:var(--fg-muted)]">
                  ±{(row.expectedMovePct * 100).toFixed(1)}%
                </Mono>
              )}
              {isHeadline && (
                <span className="ml-auto t-label text-[color:var(--brand)]">
                  ◀ HEADLINE
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
