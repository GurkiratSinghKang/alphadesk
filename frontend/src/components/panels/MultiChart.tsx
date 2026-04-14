"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Grid2x2, LayoutGrid, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { ChartPanel } from "@/components/panels/ChartPanel";
import { useMarketStore } from "@/stores/market";

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

const STORAGE_KEY = "alphadesk-chart-layout";
const SYMBOLS_KEY = "alphadesk-chart-symbols";

function getLayoutCount(layout: ChartLayout): number {
  return LAYOUT_OPTIONS.find((o) => o.value === layout)?.count ?? 1;
}

// ─── Component ──────────────────────────────────────────────

interface MultiChartProps {
  className?: string;
}

export function MultiChart({ className }: MultiChartProps) {
  const globalSymbol = useMarketStore((s) => s.selectedSymbol);

  const [layout, setLayout] = useState<ChartLayout>(() => {
    if (typeof window === "undefined") return "1x1";
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && ["1x1", "2x1", "1x2", "2x2"].includes(stored)) return stored as ChartLayout;
    return "1x1";
  });

  const [chartSymbols, setChartSymbols] = useState<string[]>(() => {
    if (typeof window === "undefined") return ["SPY"];
    try {
      const stored = JSON.parse(localStorage.getItem(SYMBOLS_KEY) || "[]");
      if (Array.isArray(stored) && stored.length > 0) return stored;
    } catch { /* ignore */ }
    return ["SPY"];
  });

  // Persist layout preference
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, layout);
  }, [layout]);

  // Persist chart symbols
  useEffect(() => {
    localStorage.setItem(SYMBOLS_KEY, JSON.stringify(chartSymbols));
  }, [chartSymbols]);

  // Keep the first chart in sync with the global symbol
  useEffect(() => {
    setChartSymbols((prev) => {
      if (prev[0] === globalSymbol) return prev;
      const next = [...prev];
      next[0] = globalSymbol;
      return next;
    });
  }, [globalSymbol]);

  const handleSymbolChange = useCallback((index: number, symbol: string) => {
    setChartSymbols((prev) => {
      const next = [...prev];
      // Ensure the array is long enough
      while (next.length <= index) next.push("SPY");
      next[index] = symbol;
      return next;
    });
  }, []);

  const chartCount = getLayoutCount(layout);

  // Grid classes
  const gridClasses = cn(
    "grid h-full w-full",
    layout === "2x1" && "grid-cols-2 grid-rows-1",
    layout === "1x2" && "grid-cols-1 grid-rows-2",
    layout === "2x2" && "grid-cols-2 grid-rows-2",
    layout === "1x1" && "grid-cols-1 grid-rows-1",
  );

  return (
    <div className={cn("flex h-full w-full flex-col overflow-hidden", className)}>
      {/* Layout selector toolbar — only visible when not 1x1 */}
      <div className={gridClasses} style={{ gap: layout === "1x1" ? 0 : 1 }}>
        {Array.from({ length: chartCount }).map((_, i) => (
          <div
            key={`chart-${i}`}
            className="min-h-0 min-w-0 overflow-hidden"
            style={{
              borderRight: layout === "2x1" && i === 0 ? "1px solid var(--border)" : layout === "2x2" && i % 2 === 0 ? "1px solid var(--border)" : undefined,
              borderBottom: layout === "1x2" && i === 0 ? "1px solid var(--border)" : layout === "2x2" && i < 2 ? "1px solid var(--border)" : undefined,
            }}
          >
            <ChartPanel
              symbol={chartSymbols[i] || "SPY"}
              onSymbolChange={(sym) => handleSymbolChange(i, sym)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Layout Selector Button (used in the chart toolbar) ─────

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
