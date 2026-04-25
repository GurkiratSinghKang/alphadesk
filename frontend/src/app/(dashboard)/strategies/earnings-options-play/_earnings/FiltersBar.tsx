"use client";

import { useEffect, useState } from "react";
import type { EarningsCalendarFilters } from "@/types";
import { cn } from "@/lib/utils";

export interface FiltersBarProps {
  filters: EarningsCalendarFilters;
  onChange: (next: EarningsCalendarFilters) => void;
  // B-56 / Round-4 (B-NEW-3): called once the IV-rank slider settles
  // (pointerup / keyup / blur) or once the sort dropdown commits, so
  // the parent page can hand focus off to a more-useful target
  // (typically the first sidebar row). Absent = no-op (back-compat).
  onSettleRef?: () => void;
}

type WindowOption = { key: "current" | "next" | "both"; label: string };
const WINDOW_OPTIONS: WindowOption[] = [
  { key: "current", label: "Current week" },
  { key: "next", label: "Next week" },
  // Round-4 (CLUSTER C/8): renamed from "Both" → "Both weeks" so the
  // label reads correctly when paired with "All hours" in TIME (no
  // longer ambiguous between two different "Both" buttons).
  { key: "both", label: "Both weeks" },
];

type TimeOption = { key: "bmo" | "amc" | "both"; label: string };
const TIME_OPTIONS: TimeOption[] = [
  { key: "bmo", label: "BMO" },
  { key: "amc", label: "AMC" },
  // Round-4 (CLUSTER C/8): renamed from "Both" → "All hours".
  { key: "both", label: "All hours" },
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
// other key is highest-first descending).
const SORT_DIRECTION: Record<SortOption["key"], { aria: string; dir: "asc" | "desc" }> = {
  date:              { aria: "ascending (earliest first)",  dir: "asc"  },
  iv_rank:           { aria: "descending (highest first)",  dir: "desc" },
  yield:             { aria: "descending (highest first)",  dir: "desc" },
  claude_confidence: { aria: "descending (highest first)",  dir: "desc" },
};

// Round-4 (CLUSTER E/9): 24×24 thumb meets WCAG 2.5.8 minimum (24px on
// Android; iOS gets touch tolerance for free). Tailwind arbitrary
// selectors for both -webkit and -moz vendor pseudo-elements.
const SLIDER_THUMB_CLASSES =
  "appearance-none " +
  "[&::-webkit-slider-thumb]:appearance-none " +
  "[&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:w-6 " +
  "[&::-webkit-slider-thumb]:rounded-full " +
  "[&::-webkit-slider-thumb]:bg-[color:var(--brand)] " +
  "[&::-moz-range-thumb]:h-6 [&::-moz-range-thumb]:w-6 " +
  "[&::-moz-range-thumb]:rounded-full " +
  "[&::-moz-range-thumb]:bg-[color:var(--brand)]";

export default function FiltersBar({ filters, onChange, onSettleRef }: FiltersBarProps) {
  const ivRank = filters.minIvRank ?? 50;
  // K-7 (round-6): the slider used to call `onChange` on every `onChange`
  // event during a drag, so each notch (step=5 over 0..100 = 21 stops)
  // mutated the parent `filters` object → re-keyed the calendar
  // useQuery → kicked off a new HTTP request. Track the value locally
  // for instant visual feedback during drag and only commit on release
  // (pointerup / Arrow / Home / End / blur). The visible thumb position
  // and label both use `localIvRank`, so the user still sees the value
  // moving in real-time.
  const [localIvRank, setLocalIvRank] = useState(ivRank);
  // Keep local state in sync when parent value changes from outside
  // (e.g. URL pop-state, filter reset). Skip when the local matches —
  // that's our own commit cycle settling.
  useEffect(() => {
    setLocalIvRank((cur) => (cur === ivRank ? cur : ivRank));
  }, [ivRank]);
  const sortKey = (filters.sort ?? "date") as SortOption["key"];
  const sortDir = SORT_DIRECTION[sortKey];
  const currentWindow = filters.window ?? "both";
  const currentTime = filters.bmoAmc ?? "both";

  const commitIvRank = () => {
    if (localIvRank !== (filters.minIvRank ?? 50)) {
      onChange({ ...filters, minIvRank: localIvRank });
    }
    onSettleRef?.();
  };

  return (
    <div
      data-slot="filters-bar"
      className="flex flex-wrap items-center gap-4 rounded border border-[color:var(--fg-border)] bg-[color:var(--bg-card)] p-3"
    >
      {/* WINDOW — radiogroup (CLUSTER C/7) */}
      <div
        role="radiogroup"
        aria-label="Earnings calendar window"
        className="flex items-center gap-1"
      >
        <span className="t-label mr-2 text-[color:var(--fg-muted)]" aria-hidden="true">
          WINDOW
        </span>
        {WINDOW_OPTIONS.map((opt) => {
          const checked = currentWindow === opt.key;
          return (
            <button
              key={opt.key}
              type="button"
              role="radio"
              aria-checked={checked}
              onClick={() => onChange({ ...filters, window: opt.key })}
              className={cn(
                "rounded border px-2 py-1 font-mono text-[12px]",
                checked
                  ? "border-[color:var(--fg-accent)] text-[color:var(--fg-accent)]"
                  : "border-[color:var(--fg-border)] text-[color:var(--fg-muted)] hover:text-[color:var(--fg-base)]",
              )}
            >
              {/* Filled-bullet redundancy so we don't rely on color alone */}
              <span aria-hidden="true" className="mr-1 inline-block">
                {checked ? "●" : "○"}
              </span>
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* IV rank slider — K-7 (round-6): commit on release, not per-notch */}
      <label className="flex items-center gap-2">
        <span className="t-label text-[color:var(--fg-muted)]">IV RANK &ge;</span>
        <input
          type="range"
          name="minIvRank"
          min={0}
          max={100}
          step={5}
          value={localIvRank}
          // K-7: visual feedback only — does NOT call parent onChange.
          // The parent's queryKey only updates when the user releases
          // the slider, so dragging from 0 → 100 fires one fetch
          // instead of 21 cancelled-and-restarted fetches.
          onChange={(e) => setLocalIvRank(Number(e.target.value))}
          // B-56: once the user stops dragging/typing the slider, let
          // the parent page move focus somewhere more useful (a filter
          // change re-renders the sidebar, which used to eat focus).
          // K-7: commitIvRank also pushes the local value up to the
          // parent — see definition above.
          onPointerUp={commitIvRank}
          onKeyUp={(e) => {
            if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Home" || e.key === "End") {
              commitIvRank();
            }
          }}
          onBlur={commitIvRank}
          // B-96: full-width on small viewports (usable at 200% zoom),
          // clamps to 128px on md+ screens.
          // Round-4 (CLUSTER E/9): 24×24 thumb classes for touch targets.
          className={cn("w-full md:w-32 max-w-full", SLIDER_THUMB_CLASSES)}
        />
        <span className="font-mono text-[13px] tabular-nums">{localIvRank}</span>
      </label>

      {/* TIME — radiogroup (CLUSTER C/7). Replaces the previous select
          with three role=radio buttons matching the WINDOW pattern. */}
      <div
        role="radiogroup"
        aria-label="Time of day"
        className="flex items-center gap-1"
      >
        <span className="t-label mr-2 text-[color:var(--fg-muted)]" aria-hidden="true">
          TIME
        </span>
        {TIME_OPTIONS.map((opt) => {
          const checked = currentTime === opt.key;
          return (
            <button
              key={opt.key}
              type="button"
              role="radio"
              aria-checked={checked}
              onClick={() => onChange({ ...filters, bmoAmc: opt.key })}
              className={cn(
                "rounded border px-2 py-1 font-mono text-[12px]",
                checked
                  ? "border-[color:var(--fg-accent)] text-[color:var(--fg-accent)]"
                  : "border-[color:var(--fg-border)] text-[color:var(--fg-muted)] hover:text-[color:var(--fg-base)]",
              )}
            >
              <span aria-hidden="true" className="mr-1 inline-block">
                {checked ? "●" : "○"}
              </span>
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* Watchlist only */}
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={filters.watchlistOnly ?? false}
          onChange={(e) => onChange({ ...filters, watchlistOnly: e.target.checked })}
        />
        <span className="t-label text-[color:var(--fg-muted)]">WATCHLIST ONLY</span>
      </label>

      {/* Sort + sort-direction indicator. The triangle is now a proper
          inline SVG with explicit currentColor + 1px outline, so the
          marker reads at the smallest supported viewport even on themes
          where --fg-muted has weak contrast (CLUSTER E/17). */}
      <label className="ml-auto flex items-center gap-2">
        <span className="t-label text-[color:var(--fg-muted)]">SORT</span>
        <select
          value={filters.sort ?? "date"}
          onChange={(e) => {
            onChange({ ...filters, sort: e.target.value as EarningsCalendarFilters["sort"] });
            // Round-4 (B-NEW-3): committing a sort warps focus to the
            // first sidebar row — same intent as the slider settle.
            onSettleRef?.();
          }}
          onBlur={() => onSettleRef?.()}
          className="rounded border border-[color:var(--fg-border)] bg-transparent px-1 py-0.5 font-mono text-[12px]"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.key} value={o.key}>{o.label}</option>
          ))}
        </select>
        <SortIndicator dir={sortDir.dir} ariaLabel={`Sort direction: ${sortDir.aria}`} />
      </label>
    </div>
  );
}

/**
 * Sort-direction caret. Persona R flagged the previous "▼" character as
 * invisible at 11px on dim themes — switched to a 14px SVG on
 * `currentColor` with a 1px outline so the marker reads at the smallest
 * supported viewport (CLUSTER E/17).
 */
function SortIndicator({ dir, ariaLabel }: { dir: "asc" | "desc"; ariaLabel: string }) {
  // ASC: triangle pointing up; DESC: pointing down. We rotate via
  // transform so we ship one path in the SVG.
  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      width="14"
      height="14"
      viewBox="0 0 14 14"
      data-slot="sort-direction-indicator"
      className="text-[color:var(--fg-base)]"
      style={{ filter: "drop-shadow(0 0 1px currentColor)", transform: dir === "asc" ? "rotate(180deg)" : undefined }}
    >
      <path d="M3 5 L7 10 L11 5 Z" fill="currentColor" />
    </svg>
  );
}
