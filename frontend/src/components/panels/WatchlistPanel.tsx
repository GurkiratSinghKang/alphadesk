"use client";

import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Plus, X, TrendingUp, TrendingDown, Minus, MoreHorizontal } from "lucide-react";
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
import { useMarketStore } from "@/stores/market";
import { useUIStore } from "@/stores/ui";
import { formatCurrency, formatPercent, getChangeTextClass, cn } from "@/lib/utils";
import { screenStocks } from "@/lib/api";
import type { Quote } from "@/types";

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
      return `${x.toFixed(1)},${y.toFixed(1)}`;
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
}: {
  symbol: string;
  quote: Quote | undefined;
  isSelected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onAnalyze: () => void;
  onTrade: () => void;
}) {
  const [flashClass, setFlashClass] = useState("");
  const prevPrice = useRef(quote?.last);

  useEffect(() => {
    if (quote && prevPrice.current !== undefined && quote.last !== prevPrice.current) {
      setFlashClass(quote.last > prevPrice.current ? "flash-profit" : "flash-loss");
      const t = setTimeout(() => setFlashClass(""), 600);
      prevPrice.current = quote.last;
      return () => clearTimeout(t);
    }
    prevPrice.current = quote?.last;
  }, [quote?.last]);

  // Calculate change from quote data — show "—" when no real data exists
  const hasRealChange = quote?.changePct != null;
  const change = (() => {
    if (!hasRealChange) return 0;
    let raw = quote!.changePct!;
    // Clamp near-zero to exactly zero to avoid "-0.00%"
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
      className={`group flex w-full items-center gap-2 px-3 py-1.5 text-xs transition-colors hover:bg-accent/50 cursor-pointer ${flashClass} ${
        isSelected ? "bg-primary/10 border-l-2 border-l-primary" : "border-l-2 border-l-transparent"
      }`}
    >
      <div className="w-14 shrink-0 truncate">
        <div className="font-medium text-foreground tabular-nums">{symbol}</div>
      </div>

      <MiniSparkline trend={hasRealChange ? change : 0} symbol={symbol} />

      <div className="w-16 text-right tabular-nums">
        {quote ? formatCurrency(quote.last) : "---"}
      </div>

      <div className={cn(
        "w-14 text-right tabular-nums rounded px-1 py-0.5",
        hasRealChange ? changeColor : "text-muted-foreground",
        hasRealChange && change > 0 && "bg-[var(--profit)]/10",
        hasRealChange && change < 0 && "bg-[var(--loss)]/10",
      )}>
        {hasRealChange && <span className="sr-only">{change >= 0 ? "gain" : "loss"}</span>}
        {hasRealChange ? formatPercent(change) : "\u2014"}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Options for ${symbol}`}
          onClick={(e) => e.stopPropagation()}
          className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/50 opacity-0 group-hover:opacity-100 shrink-0"
          style={{ opacity: isSelected ? 1 : undefined }}
        >
          <MoreHorizontal className="h-3 w-3" />
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

function ScreenerTab() {
  const { addToWatchlist } = useMarketStore();
  const [preset, setPreset] = useState("momentum-quality");
  const [results, setResults] = useState<Array<{ symbol: string; name: string; price: number; changePct: number; compositeScore: number; sector: string }>>([]);
  const [loading, setLoading] = useState(false);

  const presets = [
    { id: "momentum-quality", name: "Momentum + Quality" },
    { id: "high-iv", name: "High IV Rank" },
    { id: "earnings", name: "Earnings Plays" },
    { id: "value-growth", name: "Value + Growth" },
    { id: "oversold", name: "Oversold Bounce" },
  ];

  const runScreener = useCallback(async () => {
    setLoading(true);
    try {
      const data = await screenStocks(preset);
      const mapped = data.slice(0, 15).map((r) => ({
        symbol: r.symbol,
        name: r.symbol,
        price: r.price ?? 0,
        changePct: r.changePct ?? 0,
        compositeScore: r.composite ?? 0,
        sector: r.sector ?? "—",
      }));
      setResults(mapped);
    } catch (err) {
      console.error("Screener fetch failed:", err);
    } finally {
      setLoading(false);
    }
  }, [preset]);

  useEffect(() => { runScreener(); }, [runScreener]);

  return (
    <div className="flex flex-col h-full">
      {/* Preset selector */}
      <div className="px-3 py-2 border-b border-border">
        <select
          value={preset}
          onChange={(e) => setPreset(e.target.value)}
          aria-label="Screener preset"
          className="w-full h-7 rounded border border-border bg-background px-2 text-[11px] text-foreground"
        >
          {presets.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {/* Results */}
      <ScrollArea className="flex-1">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="text-xs text-muted-foreground">Screening...</div>
          </div>
        ) : results.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <div className="text-xs text-muted-foreground">No results</div>
          </div>
        ) : (
          <div className="py-1">
            {results.map((r) => (
              <button
                key={r.symbol}
                onClick={() => addToWatchlist(r.symbol)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent/50 transition-colors"
              >
                <div className="flex-1 text-left">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-foreground">{r.symbol}</span>
                    <span className="text-muted-foreground truncate text-[10px]">{r.sector}</span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="tabular-nums text-foreground">${r.price.toFixed(2)}</div>
                  <div className={cn("text-[10px] tabular-nums", r.changePct >= 0 ? "text-[var(--profit)]" : "text-[var(--loss)]")}>
                    {r.changePct >= 0 ? "+" : ""}{r.changePct.toFixed(1)}%
                  </div>
                </div>
                <div className="w-8 text-center">
                  <span className={cn(
                    "text-[10px] font-bold rounded px-1 py-0.5",
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
      <div className="px-3 py-1.5 border-t border-border text-[9px] text-muted-foreground">
        Click a result to add to watchlist · {results.length} results
      </div>
    </div>
  );
}

// ─── Signals tab content ──────────────────────────────────────

function SignalsTab() {
  const { setSelectedSymbol } = useMarketStore();

  const signals = [
    { symbol: "NVDA", signal: "Golden Cross", type: "bullish" as const },
    { symbol: "AAPL", signal: "RSI Oversold", type: "bullish" as const },
    { symbol: "TSLA", signal: "Death Cross", type: "bearish" as const },
    { symbol: "META", signal: "MACD Crossover", type: "bullish" as const },
    { symbol: "AMD", signal: "Volume Spike", type: "neutral" as const },
  ];

  return (
    <div className="p-2 space-y-1">
      {signals.map((s, i) => (
        <div
          key={i}
          role="button"
          tabIndex={0}
          onClick={() => setSelectedSymbol(s.symbol)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") setSelectedSymbol(s.symbol);
          }}
          className="flex items-center gap-2 rounded-md px-3 py-2 text-xs hover:bg-accent/50 transition-colors cursor-pointer opacity-40"
        >
          {s.type === "bullish" ? (
            <TrendingUp className="h-3.5 w-3.5 text-[var(--profit)]" />
          ) : s.type === "bearish" ? (
            <TrendingDown className="h-3.5 w-3.5 text-[var(--loss)]" />
          ) : (
            <Minus className="h-3.5 w-3.5 text-[var(--neutral)]" />
          )}
          <span className="font-medium text-foreground">{s.symbol}</span>
          <span className="text-muted-foreground flex-1">{s.signal}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Main Panel ──────────────────────────────────────────────

export function WatchlistPanel() {
  const watchlist = useMarketStore((s) => s.watchlist);
  const quotes = useMarketStore((s) => s.quotes);
  const selectedSymbol = useMarketStore((s) => s.selectedSymbol);
  const setSelectedSymbol = useMarketStore((s) => s.setSelectedSymbol);
  const addToWatchlist = useMarketStore((s) => s.addToWatchlist);
  const removeFromWatchlist = useMarketStore((s) => s.removeFromWatchlist);
  const { activePanels, setActiveTab } = useUIStore();
  const [addInput, setAddInput] = useState("");
  const [sortKey, setSortKey] = useState<"default" | "symbol" | "last" | "changePct">("default");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

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
      if (sym && /^[A-Z]{1,5}$/i.test(sym)) {
        addToWatchlist(sym);
        setAddInput("");
      }
    },
    [addInput, addToWatchlist]
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
        <div className="flex items-center justify-between mx-2 mt-2 shrink-0">
          <TabsList className="h-7 bg-[var(--background)] p-0.5 flex-1 border border-border">
          <TabsTrigger value="watchlist" className="text-[11px] h-6 px-2.5">
            Watchlist
          </TabsTrigger>
          <TabsTrigger value="screener" className="text-[11px] h-6 px-2.5">
            Screener
          </TabsTrigger>
          <TabsTrigger value="signals" className="text-[11px] h-6 px-2.5">
            Signals
          </TabsTrigger>
          </TabsList>
          <HelpCircle text="Your tracked symbols. Click a symbol to view its chart and analysis. Right-click for more options." />
        </div>

        <TabsContent value="watchlist" className="flex-1 mt-0 overflow-hidden">
          <form onSubmit={handleAdd} className="flex gap-1 px-2 py-1.5">
            <Input
              placeholder="Add symbol..."
              aria-label="Add symbol to watchlist"
              value={addInput}
              onChange={(e) => setAddInput(e.target.value.toUpperCase())}
              className="h-7 bg-[var(--background)] text-xs border-border placeholder:text-muted-foreground/60"
            />
            <button
              type="submit"
              aria-label="Add symbol to watchlist"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-background/50 text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </form>

          {/* Keyboard hint */}
          <div className="flex items-center gap-1.5 px-3 py-1 text-[9px] text-muted-foreground/60 bg-[var(--surface)] border-b border-border">
            <span>Click to select</span>
            <span className="text-muted-foreground/30">|</span>
            <span>
              <MoreHorizontal className="inline h-2.5 w-2.5" /> for actions
            </span>
          </div>

          {/* Column headers */}
          <div className="flex items-center gap-2 px-3 py-1 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border bg-[var(--surface)]">
            <button aria-label="Sort by symbol" onClick={() => handleSort("symbol")} className="flex-1 text-left hover:text-foreground transition-colors flex items-center gap-0.5">
              Symbol {sortKey === "symbol" && <span>{sortDir === "asc" ? "▲" : "▼"}</span>}
            </button>
            <div className="w-9" />
            <button aria-label="Sort by last price" onClick={() => handleSort("last")} className="w-16 text-right hover:text-foreground transition-colors flex items-center justify-end gap-0.5">
              Last {sortKey === "last" && <span>{sortDir === "asc" ? "▲" : "▼"}</span>}
            </button>
            <button aria-label="Sort by percent change" onClick={() => handleSort("changePct")} className="w-14 text-right hover:text-foreground transition-colors flex items-center justify-end gap-0.5">
              Chg% {sortKey === "changePct" && <span>{sortDir === "asc" ? "▲" : "▼"}</span>}
            </button>
            <div className="w-5" />
          </div>

          <ScrollArea className="flex-1">
            <div className="py-0.5">
              {watchlist.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
                  <TrendingUp className="h-6 w-6 text-muted-foreground/40 mb-2" />
                  <p className="text-xs text-muted-foreground mb-1">No symbols in watchlist</p>
                  <p className="text-[10px] text-muted-foreground/60">Type a ticker above and press + to add one</p>
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
