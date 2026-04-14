"use client";

import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────

export type ChartLayout = "1x1" | "2x1" | "1x2" | "2x2";

const LAYOUT_OPTIONS: { value: ChartLayout; label: string; icon: React.ReactNode; count: number }[] = [
  {
    value: "1x1",
    label: "Single",
    count: 1,
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <rect x="1" y="1" width="12" height="12" rx="1" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    ),
  },
  {
    value: "2x1",
    label: "Side by Side",
    count: 2,
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <rect x="1" y="1" width="5.5" height="12" rx="1" stroke="currentColor" strokeWidth="1.2" />
        <rect x="7.5" y="1" width="5.5" height="12" rx="1" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    ),
  },
  {
    value: "1x2",
    label: "Stacked",
    count: 2,
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <rect x="1" y="1" width="12" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.2" />
        <rect x="1" y="7.5" width="12" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    ),
  },
  {
    value: "2x2",
    label: "Quad",
    count: 4,
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <rect x="1" y="1" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.2" />
        <rect x="7.5" y="1" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.2" />
        <rect x="1" y="7.5" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.2" />
        <rect x="7.5" y="7.5" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    ),
  },
];

export function getLayoutCount(layout: ChartLayout): number {
  return LAYOUT_OPTIONS.find((o) => o.value === layout)?.count ?? 1;
}

// ─── Component ──────────────────────────────────────────────

interface LayoutSelectorProps {
  layout: ChartLayout;
  onLayoutChange: (layout: ChartLayout) => void;
}

export function LayoutSelector({ layout, onLayoutChange }: LayoutSelectorProps) {
  const currentOption = LAYOUT_OPTIONS.find((o) => o.value === layout) ?? LAYOUT_OPTIONS[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex items-center justify-center rounded-md h-7 gap-1 px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        aria-label="Chart layout selector"
      >
        {currentOption.icon}
        <ChevronDown className="h-3 w-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="bg-[var(--panel)] border-border min-w-[140px]">
        {LAYOUT_OPTIONS.map((opt) => (
          <DropdownMenuItem
            key={opt.value}
            onClick={() => onLayoutChange(opt.value)}
            className={cn(
              "flex items-center gap-2",
              layout === opt.value && "text-primary"
            )}
          >
            <span className={cn(
              "flex items-center justify-center w-5 h-5",
              layout === opt.value ? "text-primary" : "text-muted-foreground"
            )}>
              {opt.icon}
            </span>
            <span>{opt.label}</span>
            <span className="ml-auto text-[10px] text-muted-foreground">{opt.count} chart{opt.count > 1 ? "s" : ""}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
