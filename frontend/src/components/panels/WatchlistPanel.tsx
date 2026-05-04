"use client";

import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import Link from "next/link";
import { Plus, X, TrendingUp, TrendingDown, MoreHorizontal, ChevronUp, ChevronDown, Save, ShoppingCart, Settings } from "lucide-react";
import { HelpCircle } from "@/components/ui/HelpCircle";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMarketStore, useQuotes } from "@/stores/market";
import { useUIStore } from "@/stores/ui";
import { formatCurrency, formatPercent, getChangeTextClass, cn } from "@/lib/utils";
import { screenStocks } from "@/lib/api";
import { useToast } from "@/hooks/useToast";
import type { Quote, QuickOrderEvent } from "@/types";

// ─── Column Configuration ────────────────────────────────────

interface WatchlistColumn {
  id: string;
  label: string;
  default: boolean;
}

const AVAILABLE_COLUMNS: WatchlistColumn[] = [
  { id: "last", label: "Last", default: true },
  { id: "changePct", label: "Chg%", default: true },
  { id: "volume", label: "Vol", default: false },
  { id: "bid", label: "Bid", default: false },
  { id: "ask", label: "Ask", default: false },
  { id: "high", label: "High", default: false },
  { id: "low", label: "Low", default: false },
];

const COLUMNS_STORAGE_KEY = "alphadesk-watchlist-columns";

function loadSelectedColumns(): string[] {
  try {
    const stored = localStorage.getItem(COLUMNS_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as string[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch { /* ignore */ }
  return AVAILABLE_COLUMNS.filter((c) => c.default).map((c) => c.id);
}

function saveSelectedColumns(cols: string[]) {
  try {
    localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(cols));
  } catch { /* ignore */ }
}

function formatVolume(vol: number): string {
  if (vol >= 1_000_000_000) return (vol / 1_000_000_000).toFixed(1) + "B";
  if (vol >= 1_000_000) return (vol / 1_000_000).toFixed(1) + "M";
  if (vol >= 1_000) return (vol / 1_000).toFixed(1) + "K";
  return String(vol);
}

// ─── Column Selector Dropdown ────────────────────────────────

function ColumnSelector({
  selectedColumns,
  onToggle,
}: {
  selectedColumns: string[];
  onToggle: (colId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Configure watchlist columns"
        className={cn(
          "flex h-9 w-9 sm:h-5 sm:w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors",
          open && "text-primary bg-primary/10"
        )}
        title="Configure columns"
      >
        <Settings className="h-3.5 w-3.5 sm:h-3 sm:w-3" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-[140px] rounded-md border border-border bg-[var(--panel)] p-1.5 shadow-lg shadow-black/20">
          <div className="text-label uppercase tracking-wider text-muted-foreground px-2 py-1 mb-0.5">
            Columns
          </div>
          {AVAILABLE_COLUMNS.map((col) => (
            <label
              key={col.id}
              className="flex items-center gap-2 px-2 py-1 text-label rounded hover:bg-accent/50 cursor-pointer transition-colors"
            >
              <input
                type="checkbox"
                checked={selectedColumns.includes(col.id)}
                onChange={() => onToggle(col.id)}
                className="h-3 w-3 rounded border-border accent-primary"
              />
              <span className="text-foreground">{col.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Mock sparkline (tiny SVG) ───────────────────────────────

function MiniSparkline({ trend, symbol }: { trend: number; symbol: string }) {
  // Generate unique sparkline shape per symbol using a simple hash seed
  let seed = 0;
  for (let i = 0; i < symbol.length; i++) seed += symbol.charCodeAt(i) * (i + 1);

  const rng = () => {
    seed = (seed * 16807 + 11) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  const numPoints = 9;
  const rawValues: number[] = [];
  for (let i = 0; i < numPoints; i++) rawValues.push(rng());

  // Bias toward upward or downward trend
  const biased = rawValues.map((v, i) => {
    const trendBias = trend > 0 ? (i / numPoints) * 0.4 : trend < 0 ? ((numPoints - i) / numPoints) * 0.4 : 0;
    return v * 0.6 + trendBias;
  });

  const minV = Math.min(...biased);
  const maxV = Math.max(...biased);
  const range = maxV - minV || 1;

  const points = biased
    .map((v, i) => {
      const x = (i / (numPoints - 1)) * 32;
      const y = 12 - ((v - minV) / range) * 10 + 1;
      return `${(x ?? 0).toFixed(1)},${(y ?? 0).toFixed(1)}`;
    })
    .join(" ");

  const color = trend > 0 ? "var(--profit)" : trend < 0 ? "var(--loss)" : "var(--neutral)";

  return (
    <svg width="36" height="14" className="shrink-0">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ─── Watchlist Row ────────────────────────────────────────────

const WatchlistRow = React.memo(function WatchlistRow({
  symbol,
  quote,
  isSelected,
  onSelect,
  onRemove,
  onAnalyze,
  onTrade,
  selectedColumns,
}: {
  symbol: string;
  quote: Quote | undefined;
  isSelected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onAnalyze: () => void;
  onTrade: () => void;
  selectedColumns: string[];
}) {
  const [flashClass, setFlashClass] = useState("");
  const [showQuickTrade, setShowQuickTrade] = useState(false);
  const prevPrice = useRef<number | undefined>(undefined);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Flash green/red on price change — color based on DAILY direction (vs prev close),
  // not tick direction. A stock that's up +1.5% for the day should always flash green,
  // even when an individual tick is slightly lower than the previous tick.
  useEffect(() => {
    const currentPrice = quote?.last;
    if (currentPrice != null && prevPrice.current != null && currentPrice !== prevPrice.current) {
      // Clear any pending flash so we can re-trigger the animation
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);

      // Use daily change direction: compare to previous day's close, not last tick
      const dailyUp = (quote?.changePct ?? 0) >= 0;

      setFlashClass("");
      requestAnimationFrame(() => {
        setFlashClass(dailyUp ? "flash-profit" : "flash-loss");
      });
      flashTimerRef.current = setTimeout(() => setFlashClass(""), 600);
    }
    prevPrice.current = currentPrice;
    return () => { if (flashTimerRef.current) clearTimeout(flashTimerRef.current); };
  }, [quote?.last, quote?.changePct]);

  // Close popover on outside click
  useEffect(() => {
    if (!showQuickTrade) return;
    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setShowQuickTrade(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showQuickTrade]);

  const emitQuickOrder = useCallback((side: "buy" | "sell") => {
    if (!quote) return;
    const detail: QuickOrderEvent = { symbol, side, price: quote.last };
    window.dispatchEvent(new CustomEvent<QuickOrderEvent>("alphadesk:quick-order", { detail }));
    setShowQuickTrade(false);
  }, [symbol, quote]);

  // Calculate change from quote data
  const hasRealChange = quote?.changePct != null;
  const change = (() => {
    if (!hasRealChange) return 0;
    let raw = quote!.changePct!;
    if (Math.abs(raw) < 0.005) raw = 0;
    return raw;
  })();
  const changeColor = getChangeTextClass(change);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onSelect();
      }}
      className={`group flex w-full items-center gap-2 px-3 py-2.5 sm:py-1.5 text-body-sm sm:text-xs min-h-[44px] sm:min-h-0 transition-colors hover:bg-accent/50 active:bg-accent/60 cursor-pointer ${flashClass} ${
        isSelected ? "bg-primary/10 border-l-2 border-l-primary" : "border-l-2 border-l-transparent"
      }`}
    >
      <div className="w-14 shrink-0 truncate">
        <div className="font-medium text-foreground tabular-nums">{symbol}</div>
      </div>

      <MiniSparkline trend={hasRealChange ? change : 0} symbol={symbol} />

      {/* Price area — click to open quick-trade popover */}
      {selectedColumns.includes("last") && (
        <div className="relative">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowQuickTrade((v) => !v);
            }}
            aria-label={`Quick trade ${symbol}`}
            className="w-16 text-right tabular-nums hover:text-primary transition-colors"
          >
            {quote ? formatCurrency(quote.last) : "---"}
          </button>
          {showQuickTrade && quote && (
            <div
              ref={popoverRef}
              className="absolute right-0 top-full mt-1 z-50 flex gap-1.5 sm:gap-1 rounded-md border border-border bg-[var(--panel)] p-2 sm:p-1.5 shadow-lg"
            >
              <button
                onClick={(e) => { e.stopPropagation(); emitQuickOrder("buy"); }}
                className="rounded px-3.5 py-2 sm:px-2.5 sm:py-1 text-xs sm:text-label font-bold bg-[var(--profit)] text-black hover:bg-[var(--profit)]/80 transition-colors min-h-[36px] sm:min-h-0"
              >
                BUY
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); emitQuickOrder("sell"); }}
                className="rounded px-3.5 py-2 sm:px-2.5 sm:py-1 text-xs sm:text-label font-bold bg-[var(--loss)] text-black hover:bg-[var(--loss)]/80 transition-colors min-h-[36px] sm:min-h-0"
              >
                SELL
              </button>
            </div>
          )}
        </div>
      )}

      {selectedColumns.includes("changePct") && (
        <div className={cn(
          "w-14 text-right tabular-nums rounded px-1 py-0.5",
          hasRealChange ? changeColor : "text-muted-foreground",
          hasRealChange && change > 0 && "bg-[var(--profit)]/10",
          hasRealChange && change < 0 && "bg-[var(--loss)]/10",
        )}>
          {hasRealChange && <span className="sr-only">{change >= 0 ? "gain" : "loss"}</span>}
          {hasRealChange ? formatPercent(change) : "\u2014"}
        </div>
      )}

      {selectedColumns.includes("volume") && (
        <div className="w-14 text-right tabular-nums text-muted-foreground">
          {quote ? formatVolume(quote.volume) : "\u2014"}
        </div>
      )}

      {selectedColumns.includes("bid") && (
        <div className="w-14 text-right tabular-nums text-muted-foreground">
          {quote?.bid ? (quote.bid).toFixed(2) : "\u2014"}
        </div>
      )}

      {selectedColumns.includes("ask") && (
        <div className="w-14 text-right tabular-nums text-muted-foreground">
          {quote?.ask ? (quote.ask).toFixed(2) : "\u2014"}
        </div>
      )}

      {selectedColumns.includes("high") && (
        <div className="w-14 text-right tabular-nums text-muted-foreground">
          {quote?.high ? (quote.high).toFixed(2) : "\u2014"}
        </div>
      )}

      {selectedColumns.includes("low") && (
        <div className="w-14 text-right tabular-nums text-muted-foreground">
          {quote?.low ? (quote.low).toFixed(2) : "\u2014"}
        </div>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Options for ${symbol}`}
          onClick={(e) => e.stopPropagation()}
          className="flex h-9 w-9 sm:h-5 sm:w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/50 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 shrink-0"
          style={{ opacity: isSelected ? 1 : undefined }}
        >
          <MoreHorizontal className="h-4 w-4 sm:h-3 sm:w-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="right"
          className="bg-[var(--panel)] border-border"
        >
          <DropdownMenuItem onClick={onAnalyze}>
            <TrendingUp className="mr-2 h-3.5 w-3.5" /> Analyze
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onTrade}>
            <TrendingDown className="mr-2 h-3.5 w-3.5" /> Trade
          </DropdownMenuItem>
          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onRemove(); }} className="text-[var(--loss)]">
            <X className="mr-2 h-3.5 w-3.5" /> Remove
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
});

// ─── Screener tab content ─────────────────────────────────────

// ─── Screener filter types & presets ─────────────────────────

interface ScreenerFilters {
  marketCap: string;
  sector: string;
  minChange: string;
  maxChange: string;
  minVolume: string;
  minPrice: string;
  maxPrice: string;
}

const EMPTY_FILTERS: ScreenerFilters = {
  marketCap: "",
  sector: "",
  minChange: "",
  maxChange: "",
  minVolume: "",
  minPrice: "",
  maxPrice: "",
};

const MARKET_CAP_OPTIONS = ["", "Mega", "Large", "Mid", "Small", "Micro"];
const SECTOR_OPTIONS = [
  "",
  "Technology",
  "Healthcare",
  "Financial Services",
  "Consumer Cyclical",
  "Consumer Defensive",
  "Energy",
  "Industrials",
  "Communication Services",
  "Materials",
  "Utilities",
  "Real Estate",
];

interface SavedPreset {
  name: string;
  apiPreset: string;
  filters: ScreenerFilters;
}

const BUILTIN_PRESETS: SavedPreset[] = [
  { name: "Momentum", apiPreset: "momentum-quality", filters: { ...EMPTY_FILTERS, minChange: "0" } },
  { name: "Oversold", apiPreset: "oversold", filters: { ...EMPTY_FILTERS, maxChange: "0" } },
  { name: "High Volume", apiPreset: "momentum-quality", filters: { ...EMPTY_FILTERS, minVolume: "1000000" } },
];

function loadSavedPresets(): SavedPreset[] {
  try {
    const raw = localStorage.getItem("alphadesk-screener-presets");
    if (raw) return JSON.parse(raw) as SavedPreset[];
  } catch { /* ignore */ }
  return [];
}

function saveSavedPresets(presets: SavedPreset[]) {
  try {
    localStorage.setItem("alphadesk-screener-presets", JSON.stringify(presets));
  } catch { /* ignore */ }
}

type SortColumn = "symbol" | "score" | "changePct" | "price";
type SortDirection = "asc" | "desc";

function ScreenerTab() {
  const { addToWatchlist } = useMarketStore();
  const [apiPreset, setApiPreset] = useState("momentum-quality");
  const [filters, setFilters] = useState<ScreenerFilters>(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [results, setResults] = useState<Array<{ symbol: string; name: string; price: number; changePct: number; compositeScore: number; sector: string; volume: number }>>([]);
  const [loading, setLoading] = useState(false);
  const [sortCol, setSortCol] = useState<SortColumn>("score");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");
  const [userPresets, setUserPresets] = useState<SavedPreset[]>(() => loadSavedPresets());
  const [saveName, setSaveName] = useState("");
  const [showSave, setShowSave] = useState(false);

  const apiPresets = [
    { id: "momentum-quality", name: "Momentum + Quality" },
    { id: "high-iv", name: "High IV Rank" },
    { id: "earnings", name: "Earnings Plays" },
    { id: "value-growth", name: "Value + Growth" },
    { id: "oversold", name: "Oversold Bounce" },
  ];

  const runScreener = useCallback(async () => {
    setLoading(true);
    try {
      const data = await screenStocks(apiPreset, filters);
      const mapped = data.slice(0, 50).map((r) => ({
        symbol: r.symbol,
        name: r.symbol,
        price: r.price ?? 0,
        changePct: r.changePct ?? 0,
        compositeScore: r.composite ?? 0,
        sector: r.sector ?? "Unknown",
        volume: r.volume ?? 0,
      }));
      setResults(mapped);
    } catch (err) {
      console.error("Screener fetch failed:", err);
    } finally {
      setLoading(false);
    }
  }, [apiPreset, filters]);

  useEffect(() => { runScreener(); }, [runScreener]);

  // Client-side filtering
  const filtered = useMemo(() => {
    return results.filter((r) => {
      if (filters.sector && r.sector !== filters.sector) return false;
      if (filters.minChange && r.changePct < parseFloat(filters.minChange)) return false;
      if (filters.maxChange && r.changePct > parseFloat(filters.maxChange)) return false;
      if (filters.minPrice && r.price < parseFloat(filters.minPrice)) return false;
      if (filters.maxPrice && r.price > parseFloat(filters.maxPrice)) return false;
      if (filters.minVolume && r.volume < parseFloat(filters.minVolume)) return false;
      // Market cap is a server-side hint — we pass it but can't precisely filter client-side
      return true;
    });
  }, [results, filters]);

  // Sort
  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let valA = 0, valB = 0;
      if (sortCol === "symbol") return sortDir === "asc" ? a.symbol.localeCompare(b.symbol) : b.symbol.localeCompare(a.symbol);
      if (sortCol === "score") { valA = a.compositeScore; valB = b.compositeScore; }
      if (sortCol === "changePct") { valA = a.changePct; valB = b.changePct; }
      if (sortCol === "price") { valA = a.price; valB = b.price; }
      return sortDir === "asc" ? valA - valB : valB - valA;
    });
    return arr;
  }, [filtered, sortCol, sortDir]);

  const handleSort = (col: SortColumn) => {
    if (col === sortCol) setSortDir((d) => d === "desc" ? "asc" : "desc");
    else { setSortCol(col); setSortDir("desc"); }
  };

  const applyPreset = (preset: SavedPreset) => {
    setApiPreset(preset.apiPreset);
    setFilters(preset.filters);
  };

  const handleSavePreset = () => {
    if (!saveName.trim()) return;
    const newPreset: SavedPreset = { name: saveName.trim(), apiPreset, filters };
    const updated = [...userPresets.filter((p) => p.name !== newPreset.name), newPreset];
    setUserPresets(updated);
    saveSavedPresets(updated);
    setSaveName("");
    setShowSave(false);
  };

  const deletePreset = (name: string) => {
    const updated = userPresets.filter((p) => p.name !== name);
    setUserPresets(updated);
    saveSavedPresets(updated);
  };

  const SortIcon = ({ col }: { col: SortColumn }) => {
    if (sortCol !== col) return null;
    return sortDir === "asc" ? <ChevronUp className="h-2.5 w-2.5 inline" /> : <ChevronDown className="h-2.5 w-2.5 inline" />;
  };

  return (
    <div className="flex flex-col h-full">
      {/* Preset selector + filter toggle */}
      <div className="px-3 py-2 border-b border-border space-y-1.5">
        <div className="flex gap-1.5">
          <select
            value={apiPreset}
            onChange={(e) => setApiPreset(e.target.value)}
            aria-label="Screener preset"
            className="flex-1 h-7 rounded border border-border bg-background px-2 text-label text-foreground"
          >
            {apiPresets.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button
            onClick={() => setShowFilters((v) => !v)}
            aria-label="Toggle filters"
            className={cn(
              "h-7 px-2 rounded border border-border text-label transition-colors",
              showFilters ? "bg-primary/20 text-primary border-primary/40" : "bg-background text-muted-foreground hover:text-foreground"
            )}
          >
            Filters
          </button>
          <button
            onClick={() => setShowSave((v) => !v)}
            aria-label="Save preset"
            className="h-7 px-1.5 rounded border border-border bg-background text-muted-foreground hover:text-foreground transition-colors"
          >
            <Save className="h-3 w-3" />
          </button>
        </div>

        {/* Quick preset chips */}
        <div className="flex gap-1 flex-wrap">
          {[...BUILTIN_PRESETS, ...userPresets].map((p) => (
            <span
              key={p.name}
              className="inline-flex items-center rounded-full border border-border text-label text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
            >
              <button
                type="button"
                onClick={() => applyPreset(p)}
                className="px-2 py-0.5"
              >
                {p.name}
              </button>
              {userPresets.some((u) => u.name === p.name) && (
                <button
                  type="button"
                  onClick={() => deletePreset(p.name)}
                  className="border-l border-border px-1.5 py-0.5 text-[var(--loss)] hover:text-[var(--loss)]/80"
                  aria-label={`Delete ${p.name} preset`}
                >
                  x
                </button>
              )}
            </span>
          ))}
        </div>

        {/* Save preset input */}
        {showSave && (
          <div className="flex gap-1">
            <input
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="Preset name..."
              aria-label="Preset name"
              className="flex-1 h-6 rounded border border-border bg-background px-2 text-label text-foreground placeholder:text-muted-foreground/60"
              onKeyDown={(e) => { if (e.key === "Enter") handleSavePreset(); }}
            />
            <button onClick={handleSavePreset} className="h-6 px-2 rounded bg-primary text-primary-foreground text-label font-medium">
              Save
            </button>
          </div>
        )}
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="px-3 py-2 border-b border-border bg-[var(--surface)]">
          <div className="grid grid-cols-2 gap-1.5">
            <select
              value={filters.marketCap}
              onChange={(e) => setFilters((f) => ({ ...f, marketCap: e.target.value }))}
              aria-label="Market cap filter"
              className="h-6 rounded border border-border bg-background px-1.5 text-label text-foreground"
            >
              <option value="">Market Cap</option>
              {MARKET_CAP_OPTIONS.filter(Boolean).map((mc) => (
                <option key={mc} value={mc}>{mc}</option>
              ))}
            </select>
            <select
              value={filters.sector}
              onChange={(e) => setFilters((f) => ({ ...f, sector: e.target.value }))}
              aria-label="Sector filter"
              className="h-6 rounded border border-border bg-background px-1.5 text-label text-foreground"
            >
              <option value="">Sector</option>
              {SECTOR_OPTIONS.filter(Boolean).map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <input
              value={filters.minChange}
              onChange={(e) => setFilters((f) => ({ ...f, minChange: e.target.value }))}
              placeholder="Min Chg%"
              aria-label="Minimum change percentage filter"
              className="h-6 rounded border border-border bg-background px-1.5 text-label text-foreground placeholder:text-muted-foreground/60"
            />
            <input
              value={filters.maxChange}
              onChange={(e) => setFilters((f) => ({ ...f, maxChange: e.target.value }))}
              placeholder="Max Chg%"
              aria-label="Maximum change percentage filter"
              className="h-6 rounded border border-border bg-background px-1.5 text-label text-foreground placeholder:text-muted-foreground/60"
            />
            <input
              value={filters.minPrice}
              onChange={(e) => setFilters((f) => ({ ...f, minPrice: e.target.value }))}
              placeholder="Min Price"
              aria-label="Minimum price filter"
              className="h-6 rounded border border-border bg-background px-1.5 text-label text-foreground placeholder:text-muted-foreground/60"
            />
            <input
              value={filters.maxPrice}
              onChange={(e) => setFilters((f) => ({ ...f, maxPrice: e.target.value }))}
              placeholder="Max Price"
              aria-label="Maximum price filter"
              className="h-6 rounded border border-border bg-background px-1.5 text-label text-foreground placeholder:text-muted-foreground/60"
            />
            <input
              value={filters.minVolume}
              onChange={(e) => setFilters((f) => ({ ...f, minVolume: e.target.value }))}
              placeholder="Min Volume"
              aria-label="Minimum volume filter"
              className="col-span-2 h-6 rounded border border-border bg-background px-1.5 text-label text-foreground placeholder:text-muted-foreground/60"
            />
          </div>
          <button
            onClick={() => setFilters(EMPTY_FILTERS)}
            className="mt-1.5 text-label text-muted-foreground hover:text-foreground transition-colors"
          >
            Clear all filters
          </button>
        </div>
      )}

      {/* Sortable column headers */}
      <div className="flex items-center gap-2 px-3 py-1 text-label uppercase tracking-wider text-muted-foreground border-b border-border bg-[var(--surface)]">
        <button onClick={() => handleSort("symbol")} className="flex-1 text-left hover:text-foreground transition-colors">
          Symbol <SortIcon col="symbol" />
        </button>
        <button onClick={() => handleSort("price")} className="w-14 text-right hover:text-foreground transition-colors">
          Price <SortIcon col="price" />
        </button>
        <button onClick={() => handleSort("changePct")} className="w-12 text-right hover:text-foreground transition-colors">
          Chg% <SortIcon col="changePct" />
        </button>
        <button onClick={() => handleSort("score")} className="w-8 text-center hover:text-foreground transition-colors">
          Score <SortIcon col="score" />
        </button>
      </div>

      {/* Results */}
      <ScrollArea className="flex-1">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="text-xs text-muted-foreground">Screening...</div>
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <div className="text-xs text-muted-foreground">No results match filters</div>
          </div>
        ) : (
          <div className="py-1">
            {sorted.map((r) => (
              <button
                key={r.symbol}
                onClick={() => addToWatchlist(r.symbol)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent/50 transition-colors"
              >
                <div className="flex-1 text-left">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-foreground">{r.symbol}</span>
                    <span className="text-muted-foreground truncate text-label">{r.sector}</span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="tabular-nums text-foreground">${(r.price ?? 0).toFixed(2)}</div>
                  <div className={cn("text-label tabular-nums", (r.changePct ?? 0) >= 0 ? "text-[var(--profit)]" : "text-[var(--loss)]")}>
                    {(r.changePct ?? 0) >= 0 ? "+" : ""}{(r.changePct ?? 0).toFixed(1)}%
                  </div>
                </div>
                <div className="w-8 text-center">
                  <span className={cn(
                    "text-label font-bold rounded px-1 py-0.5",
                    r.compositeScore >= 70 ? "bg-[var(--profit)]/15 text-[var(--profit)]" :
                    r.compositeScore >= 40 ? "bg-amber-500/15 text-amber-400" :
                    "bg-[var(--loss)]/15 text-[var(--loss)]"
                  )}>
                    {r.compositeScore}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Footer */}
      <div className="px-3 py-1.5 border-t border-border text-label text-muted-foreground">
        Click to add to watchlist | {sorted.length}/{results.length} results
        {Object.values(filters).some(Boolean) && " (filtered)"}
      </div>
    </div>
  );
}

// ─── Signals tab content ──────────────────────────────────────

function SignalsTab() {
  // Honest empty state — there is no live signals endpoint wired to the
  // watchlist today. Previously this tab shipped a hardcoded demo array
  // ("NVDA Golden Cross, 1h ago") that could easily be mistaken for real
  // detected signals. See audit-reports/01-frontend.md [P0-3].
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-4 py-10 text-center">
      <p className="font-display italic text-body-sm text-muted-foreground">
        No live signals.
      </p>
      <Link
        href="/alerts"
        className="font-sans text-label uppercase tracking-[0.18em] text-brand transition-colors hover:text-gold-300"
      >
        Configure alerts
      </Link>
    </div>
  );
}

// ─── Main Panel ──────────────────────────────────────────────

export function WatchlistPanel() {
  const watchlist = useMarketStore((s) => s.watchlist);
  // Wave 14 perf-audit-r3 P0 #3: was `useMarketStore((s) => s.quotes)` which
  // returned the whole map ref and rerendered this ~1000-LOC panel on every
  // tick. `useQuotes(watchlist)` shallow-compares only the symbols we care
  // about, and each `<WatchlistRow>` below is memo'd against its quote prop.
  const quotes = useQuotes(watchlist);
  const selectedSymbol = useMarketStore((s) => s.selectedSymbol);
  const setSelectedSymbol = useMarketStore((s) => s.setSelectedSymbol);
  const addToWatchlist = useMarketStore((s) => s.addToWatchlist);
  const removeFromWatchlist = useMarketStore((s) => s.removeFromWatchlist);
  const { activePanels, setActiveTab } = useUIStore();
  const { toast } = useToast();
  const [addInput, setAddInput] = useState("");
  const [sortKey, setSortKey] = useState<"default" | "symbol" | "last" | "changePct">("default");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selectedColumns, setSelectedColumns] = useState<string[]>(() => loadSelectedColumns());

  const toggleColumn = useCallback((colId: string) => {
    setSelectedColumns((prev) => {
      const next = prev.includes(colId)
        ? prev.filter((c) => c !== colId)
        : [...prev, colId];
      // Ensure at least one column is always selected
      if (next.length === 0) return prev;
      saveSelectedColumns(next);
      return next;
    });
  }, []);

  const handleSort = (key: typeof sortKey) => {
    if (key === sortKey) {
      // Cycle: desc → asc → default
      if (sortDir === "desc") setSortDir("asc");
      else { setSortKey("default"); setSortDir("desc"); }
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const sortedWatchlist = useMemo(() => {
    if (sortKey === "default") return watchlist;
    const sorted = [...watchlist].sort((a, b) => {
      const quoteA = quotes[a];
      const quoteB = quotes[b];
      let valA = 0, valB = 0;
      if (sortKey === "symbol") { return sortDir === "asc" ? a.localeCompare(b) : b.localeCompare(a); }
      if (sortKey === "last") { valA = quoteA?.last ?? 0; valB = quoteB?.last ?? 0; }
      if (sortKey === "changePct") { valA = quoteA?.changePct ?? 0; valB = quoteB?.changePct ?? 0; }
      return sortDir === "asc" ? valA - valB : valB - valA;
    });
    return sorted;
  }, [watchlist, quotes, sortKey, sortDir]);

  const handleAdd = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const sym = addInput.trim().toUpperCase();
      if (!sym) return;
      // Wave 8: relaxed regex to accept modern tickers with dots and dashes
      // (e.g. "BRK.B", "BTC-USD", "SHEL.L", 6-char SPACs). Must start with a
      // letter and stay <=10 chars to match the backend `^[A-Z]{1,10}$`
      // contract with some slack for composite symbols.
      if (/^[A-Z][A-Z0-9.\-]{0,9}$/.test(sym)) {
        addToWatchlist(sym);
        setAddInput("");
      } else {
        toast({
          type: "error",
          message: `Invalid ticker "${sym}". Use uppercase letters, digits, dot, or hyphen (≤10 chars).`,
        });
      }
    },
    [addInput, addToWatchlist, toast]
  );

  const handleAnalyze = useCallback(
    (symbol: string) => {
      setSelectedSymbol(symbol);
      setActiveTab("right", "technical");
    },
    [setSelectedSymbol, setActiveTab]
  );

  const handleTrade = useCallback(
    (symbol: string) => {
      setSelectedSymbol(symbol);
      setActiveTab("bottom", "trade");
    },
    [setSelectedSymbol, setActiveTab]
  );

  return (
    <div className="flex h-full flex-col bg-[var(--panel)] border-r border-border">
      <Tabs
        value={activePanels.left}
        onValueChange={(v) => setActiveTab("left", v)}
        className="flex flex-col h-full"
      >
        <div className="flex items-center justify-between gap-2 mx-2 mt-2 shrink-0">
          <TabsList className="h-10 sm:h-7 bg-[var(--background)] p-0.5 flex-1 border border-border">
          <TabsTrigger value="watchlist" className="text-xs sm:text-label h-9 sm:h-6 px-3 sm:px-2.5">
            Watchlist
          </TabsTrigger>
          <TabsTrigger value="screener" className="text-xs sm:text-label h-9 sm:h-6 px-3 sm:px-2.5">
            Screener
          </TabsTrigger>
          <TabsTrigger value="signals" className="text-xs sm:text-label h-9 sm:h-6 px-3 sm:px-2.5">
            Signals
          </TabsTrigger>
          </TabsList>
          <HelpCircle text="Your tracked symbols. Click a symbol to view its chart and analysis. Right-click for more options." />
        </div>

        <TabsContent value="watchlist" className="flex-1 mt-0 overflow-hidden">
          <form onSubmit={handleAdd} className="flex gap-2 sm:gap-1 px-2 py-2 sm:py-1.5">
            <Input
              placeholder="Add symbol..."
              aria-label="Add symbol to watchlist"
              value={addInput}
              onChange={(e) => setAddInput(e.target.value.toUpperCase())}
              className="h-11 sm:h-7 bg-[var(--background)] text-base sm:text-xs border-border placeholder:text-muted-foreground/60"
            />
            <button
              type="submit"
              aria-label="Add symbol to watchlist"
              className="flex h-11 w-11 sm:h-7 sm:w-7 shrink-0 items-center justify-center rounded-md border border-border bg-background/50 text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
            >
              <Plus className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
            </button>
          </form>

          {/* Keyboard hint */}
          <div className="flex items-center gap-1.5 px-3 py-1 text-label text-muted-foreground/60 bg-[var(--surface)] border-b border-border">
            <span>Click to select</span>
            <span className="text-muted-foreground/30">|</span>
            <span>
              <MoreHorizontal className="inline h-2.5 w-2.5" /> for actions
            </span>
          </div>

          {/* Column headers */}
          <div className="flex items-center gap-2 px-3 py-1 text-label uppercase tracking-wider text-muted-foreground border-b border-border bg-[var(--surface)]">
            <button aria-label="Sort by symbol" onClick={() => handleSort("symbol")} className="flex-1 text-left hover:text-foreground transition-colors flex items-center gap-0.5">
              Symbol {sortKey === "symbol" && <span>{sortDir === "asc" ? "▲" : "▼"}</span>}
            </button>
            <div className="w-9" />
            {selectedColumns.includes("last") && (
              <button aria-label="Sort by last price" onClick={() => handleSort("last")} className="w-16 text-right hover:text-foreground transition-colors flex items-center justify-end gap-0.5">
                Last {sortKey === "last" && <span>{sortDir === "asc" ? "▲" : "▼"}</span>}
              </button>
            )}
            {selectedColumns.includes("changePct") && (
              <button aria-label="Sort by percent change" onClick={() => handleSort("changePct")} className="w-14 text-right hover:text-foreground transition-colors flex items-center justify-end gap-0.5">
                Chg% {sortKey === "changePct" && <span>{sortDir === "asc" ? "▲" : "▼"}</span>}
              </button>
            )}
            {selectedColumns.includes("volume") && (
              <div className="w-14 text-right">Vol</div>
            )}
            {selectedColumns.includes("bid") && (
              <div className="w-14 text-right">Bid</div>
            )}
            {selectedColumns.includes("ask") && (
              <div className="w-14 text-right">Ask</div>
            )}
            {selectedColumns.includes("high") && (
              <div className="w-14 text-right">High</div>
            )}
            {selectedColumns.includes("low") && (
              <div className="w-14 text-right">Low</div>
            )}
            <ColumnSelector selectedColumns={selectedColumns} onToggle={toggleColumn} />
          </div>

          <ScrollArea className="flex-1">
            <div className="py-0.5">
              {watchlist.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
                  <TrendingUp className="h-6 w-6 text-muted-foreground/40 mb-2" />
                  <p className="text-xs text-muted-foreground mb-1">No symbols in watchlist</p>
                  <p className="text-label text-muted-foreground/60">Type a ticker above and press + to add one</p>
                </div>
              ) : (
                sortedWatchlist.map((symbol) => (
                  <WatchlistRow
                    key={symbol}
                    symbol={symbol}
                    quote={quotes[symbol]}
                    isSelected={symbol === selectedSymbol}
                    onSelect={() => setSelectedSymbol(symbol)}
                    onRemove={() => removeFromWatchlist(symbol)}
                    onAnalyze={() => handleAnalyze(symbol)}
                    onTrade={() => handleTrade(symbol)}
                    selectedColumns={selectedColumns}
                  />
                ))
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="screener" className="flex-1 mt-0 overflow-hidden">
          <ScreenerTab />
        </TabsContent>

        <TabsContent value="signals" className="flex-1 mt-0 overflow-hidden">
          <ScrollArea className="h-full">
            <SignalsTab />
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}
