"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { safeGetItem, safeSetItem } from "@/lib/storage";

/**
 * SavedViewsBar — Brex Smart Tables / Airtable convention.
 *
 * Slice-7 / TBL-1 (2026 design brief):
 *
 *   • Tabs for saved filter/sort presets across the top of a data table
 *   • "+ Save" captures the current state under a user-named preset
 *   • Click a tab → applies that preset
 *   • Right-click / hover-X → delete a preset
 *
 * Storage: localStorage keyed by ``alphadesk:saved-views:{scope}`` —
 * one bucket per table consumer (e.g. ``trade-history``,
 * ``positions``, ``orders``). Persists across sessions, scoped per
 * device. A future slice can promote this to user-settings sync.
 *
 * Generic over the filter shape via ``T`` so each consumer keeps its
 * own typed filter object. The primitive only persists + dispatches
 * — the consumer interprets the filter shape on apply.
 */

export interface SavedView<T> {
  id: string;
  name: string;
  filter: T;
  createdAt: string;
}

export interface SavedViewsBarProps<T> {
  /** Storage scope — keys the localStorage bucket. */
  scope: string;
  /** Current filter state — needed to capture on "Save" click. */
  current: T;
  /** Apply a saved view's filter. Caller is responsible for state restore. */
  onApply: (filter: T) => void;
  /** Optional: id of the currently-active view; renders the matching tab as selected. */
  activeId?: string | null;
  className?: string;
}

const VIEW_LIMIT = 8; // max saved views per scope; oldest is dropped on overflow

function loadViews<T>(scope: string): SavedView<T>[] {
  try {
    const raw = safeGetItem(`alphadesk:saved-views:${scope}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (v): v is SavedView<T> =>
        typeof v === "object" && v != null && "id" in v && "name" in v && "filter" in v,
    );
  } catch {
    return [];
  }
}

function saveViews<T>(scope: string, views: SavedView<T>[]): void {
  safeSetItem(`alphadesk:saved-views:${scope}`, JSON.stringify(views));
}

export default function SavedViewsBar<T>({
  scope,
  current,
  onApply,
  activeId,
  className,
}: SavedViewsBarProps<T>) {
  const [views, setViews] = React.useState<SavedView<T>[]>(() => loadViews<T>(scope));

  function handleSave() {
    const name = window.prompt("Name this view (e.g. 'Q3 winners'):");
    if (!name || name.trim().length === 0) return;
    const next: SavedView<T>[] = [
      ...views,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: name.trim().slice(0, 64),
        filter: current,
        createdAt: new Date().toISOString(),
      },
    ].slice(-VIEW_LIMIT);
    setViews(next);
    saveViews(scope, next);
  }

  function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    const next = views.filter((v) => v.id !== id);
    setViews(next);
    saveViews(scope, next);
  }

  return (
    <div
      data-slot="saved-views-bar"
      className={cn(
        "flex flex-wrap items-center gap-1.5 border-b border-[color:var(--border)] px-3 py-2",
        className,
      )}
    >
      <span className="font-mono text-label uppercase tracking-[0.16em] text-[color:var(--fg-muted)] mr-1">
        Views
      </span>
      {views.length === 0 ? (
        <span className="font-mono text-label text-[color:var(--fg-muted)] italic">
          — no saved views
        </span>
      ) : (
        views.map((v) => (
          // Two adjacent buttons inside a styled wrapper — keeps the
          // visual "tab with an X" without nesting a button inside a
          // button (invalid HTML; some browsers split focus weirdly
          // and AT announces both).
          <span
            key={v.id}
            className={cn(
              "group inline-flex items-center rounded border t-mono text-label transition-colors",
              activeId === v.id
                ? "border-[color:var(--brand)] bg-[color:var(--brand)]/15"
                : "border-[color:var(--border)] hover:border-[color:var(--brand)]/60",
            )}
          >
            <button
              type="button"
              onClick={() => onApply(v.filter)}
              className={cn(
                "px-2 py-0.5",
                activeId === v.id
                  ? "text-[color:var(--brand)]"
                  : "text-[color:var(--fg)]",
              )}
            >
              {v.name}
            </button>
            <button
              type="button"
              aria-label={`Delete view ${v.name}`}
              onClick={(e) => handleDelete(v.id, e)}
              className="px-1.5 py-0.5 opacity-40 hover:opacity-100 hover:text-[color:var(--loss)] transition-opacity"
            >
              ×
            </button>
          </span>
        ))
      )}
      <button
        type="button"
        onClick={handleSave}
        className="ml-auto inline-flex items-center gap-1 rounded border border-dashed border-[color:var(--border)] px-2 py-0.5 t-mono text-label text-[color:var(--fg-muted)] hover:border-[color:var(--brand)] hover:text-[color:var(--brand)] transition-colors"
        title="Capture the current filter + sort state as a named view"
      >
        <span aria-hidden="true">+</span>
        Save view
      </button>
    </div>
  );
}
