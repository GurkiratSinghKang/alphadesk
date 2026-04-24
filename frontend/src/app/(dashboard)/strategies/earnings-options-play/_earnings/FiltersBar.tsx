"use client";

import type { EarningsCalendarFilters } from "@/types";
import { cn } from "@/lib/utils";

export interface FiltersBarProps {
  filters: EarningsCalendarFilters;
  onChange: (next: EarningsCalendarFilters) => void;
}

type WindowOption = { key: "current" | "next" | "both"; label: string };
const WINDOW_OPTIONS: WindowOption[] = [
  { key: "current", label: "Current week" },
  { key: "next", label: "Next week" },
  { key: "both", label: "Both" },
];

type SortOption = { key: "date" | "iv_rank" | "yield" | "claude_confidence"; label: string };
const SORT_OPTIONS: SortOption[] = [
  { key: "date", label: "Earnings date" },
  { key: "iv_rank", label: "IV rank" },
  { key: "yield", label: "Premium yield" },
  { key: "claude_confidence", label: "Claude confidence" },
];

// B-9: data model has no explicit sort direction yet — label each sort
// key with the natural default ("date" is chronological ascending, every
// other key is highest-first descending). Renders as a unicode arrow
// next to the Sort label so the user has visual confirmation of what
// "first" means for the active sort.
const SORT_DIRECTION: Record<SortOption["key"], { arrow: string; aria: string }> = {
  date:              { arrow: "\u2191", aria: "ascending (earliest first)" },
  iv_rank:           { arrow: "\u2193", aria: "descending (highest first)" },
  yield:             { arrow: "\u2193", aria: "descending (highest first)" },
  claude_confidence: { arrow: "\u2193", aria: "descending (highest first)" },
};

export default function FiltersBar({ filters, onChange }: FiltersBarProps) {
  const ivRank = filters.min_iv_rank ?? 50;
  const sortKey = (filters.sort ?? "date") as SortOption["key"];
  const sortDir = SORT_DIRECTION[sortKey];

  return (
    <div
      data-slot="filters-bar"
      className="flex flex-wrap items-center gap-4 rounded border border-[color:var(--fg-border)] bg-[color:var(--bg-card)] p-3"
    >
      {/* Window toggles */}
      <div className="flex items-center gap-1">
        <span className="t-label mr-2 text-[color:var(--fg-muted)]">WINDOW</span>
        {WINDOW_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange({ ...filters, window: opt.key })}
            className={cn(
              "rounded border px-2 py-1 font-mono text-[12px]",
              (filters.window ?? "both") === opt.key
                ? "border-[color:var(--fg-accent)] text-[color:var(--fg-accent)]"
                : "border-[color:var(--fg-border)] text-[color:var(--fg-muted)] hover:text-[color:var(--fg-base)]",
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* IV rank slider */}
      <label className="flex items-center gap-2">
        <span className="t-label text-[color:var(--fg-muted)]">IV RANK &ge;</span>
        <input
          type="range"
          name="min_iv_rank"
          min={0}
          max={100}
          step={5}
          value={ivRank}
          onChange={(e) => onChange({ ...filters, min_iv_rank: Number(e.target.value) })}
          className="w-32"
        />
        <span className="font-mono text-[13px] tabular-nums">{ivRank}</span>
      </label>

      {/* BMO/AMC */}
      <label className="flex items-center gap-2">
        <span className="t-label text-[color:var(--fg-muted)]">TIME</span>
        <select
          value={filters.bmo_amc ?? "both"}
          onChange={(e) => onChange({ ...filters, bmo_amc: e.target.value as EarningsCalendarFilters["bmo_amc"] })}
          className="rounded border border-[color:var(--fg-border)] bg-transparent px-1 py-0.5 font-mono text-[12px]"
        >
          <option value="both">Both</option>
          <option value="bmo">BMO</option>
          <option value="amc">AMC</option>
        </select>
      </label>

      {/* Watchlist only */}
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={filters.watchlist_only ?? false}
          onChange={(e) => onChange({ ...filters, watchlist_only: e.target.checked })}
        />
        <span className="t-label text-[color:var(--fg-muted)]">WATCHLIST ONLY</span>
      </label>

      {/* Sort */}
      <label className="ml-auto flex items-center gap-2">
        <span className="t-label text-[color:var(--fg-muted)]">SORT</span>
        <select
          value={filters.sort ?? "date"}
          onChange={(e) => onChange({ ...filters, sort: e.target.value as EarningsCalendarFilters["sort"] })}
          className="rounded border border-[color:var(--fg-border)] bg-transparent px-1 py-0.5 font-mono text-[12px]"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.key} value={o.key}>{o.label}</option>
          ))}
        </select>
        {/* B-9: visual confirmation of the applied sort direction. */}
        <span
          data-slot="sort-direction-indicator"
          aria-label={`Sort direction: ${sortDir.aria}`}
          className="font-mono text-[13px] tabular-nums text-[color:var(--fg-muted)]"
        >
          {sortDir.arrow}
        </span>
      </label>
    </div>
  );
}
