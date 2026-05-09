"use client";

import * as React from "react";

import StatusDot, { type StatusDotTone } from "@/components/primitives/StatusDot";
import { MOCK_HEALTH_TILES, type HealthTile, type HealthTone } from "@/lib/mocks";
import { cn } from "@/lib/utils";

/**
 * HealthTileRow
 * ──────────────
 * v2 redesign — top-of-page admin health row per v2-plan §1.6c. Nine
 * tiles, equal width, status dot + key fact + caption. Critical tone
 * gets a coral-tinted background; watch a faint gold tint; clear stays
 * neutral. Click → scrolls into ArchitectureExplorer / focuses the
 * matching control module by anchor id.
 *
 * Phase 0 reads from MOCK_HEALTH_TILES; Phase 1.6 swaps to a real
 * `GET /api/v1/admin/health-tiles` once backend B.6/B.8 lands.
 */
export interface HealthTileRowProps {
  /** Click handler — receives the anchor id of the matched component. */
  onTileClick?: (anchor: string | undefined) => void;
  className?: string;
  /** Override the data — primarily for /_design and tests. */
  tiles?: HealthTile[];
}

const toneToDot: Record<HealthTone, StatusDotTone> = {
  ok: "profit",
  watch: "amber",
  critical: "loss",
};

const toneToBg: Record<HealthTone, string> = {
  ok: "bg-bg-elev-1 border-border-hair",
  watch: "bg-tint-brand-1 border-state-warning/40",
  critical: "bg-tint-down-1 border-loss/40 animate-pulse",
};

export default function HealthTileRow({
  onTileClick,
  className,
  tiles = MOCK_HEALTH_TILES,
}: HealthTileRowProps) {
  return (
    <div
      data-slot="health-tile-row"
      role="list"
      aria-label="System health tiles"
      className={cn(
        "grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2",
        className,
      )}
    >
      {tiles.map((tile) => (
        <button
          key={tile.id}
          type="button"
          role="listitem"
          onClick={() => onTileClick?.(tile.anchor)}
          data-tile={tile.id}
          data-tone={tile.tone}
          className={cn(
            "flex flex-col items-start gap-1 rounded-md border px-3 py-2 text-left transition-colors hover:border-brand/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand min-h-[88px]",
            toneToBg[tile.tone],
          )}
        >
          <div className="flex items-center justify-between w-full">
            <span className="t-label text-fg-muted truncate">{tile.name}</span>
            <StatusDot tone={toneToDot[tile.tone]} size={5} pulse={tile.tone === "critical"} />
          </div>
          <span className="t-num-md text-fg truncate w-full">{tile.value}</span>
          <span className="text-eyebrow text-fg-muted leading-tight line-clamp-2 w-full">
            {tile.caption}
          </span>
        </button>
      ))}
    </div>
  );
}
