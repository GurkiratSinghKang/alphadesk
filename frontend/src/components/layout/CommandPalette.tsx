"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { usePathname } from "next/navigation";
import { Command } from "cmdk";
import {
  BarChart3,
  LineChart,
  Search,
  TrendingUp,
  Wallet,
  Zap,
  ArrowRightLeft,
  Loader2,
} from "lucide-react";
import { useUIStore } from "@/stores/ui";
import { useMarketStore } from "@/stores/market";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { analyzeSymbol, searchSymbols } from "@/lib/api";

const POPULAR_SYMBOLS = [
  "SPY", "QQQ", "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "TSLA", "META", "AMD",
  "NFLX", "JPM", "V", "BA", "DIS", "COIN", "SOFI", "PLTR", "SMCI", "AVGO",
];

interface SymbolResult {
  symbol: string;
  name: string;
  type: string;
  exchange: string;
  sector: string;
}

interface CommandItemProps {
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  onSelect: () => void;
}

function CommandItem({ icon, label, shortcut, onSelect }: CommandItemProps) {
  return (
    <Command.Item
      onSelect={onSelect}
      className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm text-foreground cursor-pointer data-[selected=true]:bg-primary/10 data-[selected=true]:text-primary"
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="flex-1">{label}</span>
      {shortcut && (
        <kbd className="rounded bg-[var(--panel)] px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
          {shortcut}
        </kbd>
      )}
    </Command.Item>
  );
}

export function CommandPalette() {
  const { commandPaletteOpen, setCommandPaletteOpen, toggleCommandPalette, setActiveTab, setTradingMode } = useUIStore();
  const { selectedSymbol, setSelectedSymbol, addToWatchlist } = useMarketStore();

  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SymbolResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pathname = usePathname();

  // Close command palette on navigation
  useEffect(() => {
    setCommandPaletteOpen(false);
  }, [pathname, setCommandPaletteOpen]);

  // Debounced search
  const debouncedSearch = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      setHasSearched(false);
      return;
    }
    setIsSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const results = await searchSymbols(q.trim());
        setSearchResults(results);
        setHasSearched(true);
      } catch {
        // On API failure, fall back to filtering popular symbols
        const filtered = POPULAR_SYMBOLS.filter((s) =>
          s.toLowerCase().includes(q.trim().toLowerCase())
        ).map((s) => ({ symbol: s, name: s, type: "stock", exchange: "", sector: "" }));
        setSearchResults(filtered);
        setHasSearched(true);
      } finally {
        setIsSearching(false);
      }
    }, 300);
  }, []);

  function handleValueChange(value: string) {
    setQuery(value);
    debouncedSearch(value);
  }

  // Reset state when closing
  useEffect(() => {
    if (!commandPaletteOpen) {
      setQuery("");
      setSearchResults([]);
      setIsSearching(false);
      setHasSearched(false);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    }
  }, [commandPaletteOpen]);

  // Clean up debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Ctrl+K global shortcut
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        toggleCommandPalette();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [toggleCommandPalette]);

  function selectSymbol(symbol: string) {
    setSelectedSymbol(symbol);
    addToWatchlist(symbol);
    setCommandPaletteOpen(false);
  }

  // Determine which symbols to show
  const showApiResults = query.trim().length > 0;
  const symbolsToShow = showApiResults ? searchResults : POPULAR_SYMBOLS.map((s) => ({ symbol: s, name: "", type: "stock", exchange: "", sector: "" }));

  // Analyze current symbol — trigger analysis API + switch to TA tab
  function handleAnalyze() {
    if (!selectedSymbol) return;
    setCommandPaletteOpen(false);
    setActiveTab("right", "technical");
    analyzeSymbol(selectedSymbol).catch(() => {});
  }

  // BUG #9: "Screen momentum stocks" — switch to screener tab + trigger screen
  function handleScreenMomentum() {
    setCommandPaletteOpen(false);
    setActiveTab("left", "screener");
  }

  // BUG #9: "Show portfolio" — switch bottom-right panel to positions tab
  function handleShowPortfolio() {
    setCommandPaletteOpen(false);
    setActiveTab("bottom", "positions");
  }

  // Switch trading mode — live requires explicit action, paper is always safe
  function handleSwitchLive() {
    setCommandPaletteOpen(false);
    if (useUIStore.getState().tradingMode === "live") {
      // Switching back to paper is always safe
      setTradingMode("paper");
    } else {
      // Switch to live — the StatusStrip mode badge turns red as visual confirmation
      setTradingMode("live");
    }
  }

  // Focus options chain — scroll to panel, or navigate to trade page first if not there
  function handleFocusOptions() {
    setCommandPaletteOpen(false);
    const el = document.querySelector("[data-slot='options-panel']");
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
    } else {
      // Navigate to trade page if not already there
      window.location.href = "/trade";
    }
  }

  return (
    <Dialog open={commandPaletteOpen} onOpenChange={setCommandPaletteOpen}>
      <DialogContent className="overflow-hidden p-0 max-w-xl bg-[var(--surface)] border-border shadow-2xl [&>button]:hidden">
        <Command
          className="bg-transparent"
          loop
          shouldFilter={false}
        >
          <div className="flex items-center border-b border-border px-3">
            {isSearching ? (
              <Loader2 className="mr-2 h-4 w-4 shrink-0 text-muted-foreground animate-spin" />
            ) : (
              <Search className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <Command.Input
              placeholder="Search symbols, commands..."
              className="flex h-12 w-full bg-transparent py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground overflow-hidden text-ellipsis"
              maxLength={100}
              value={query}
              onValueChange={handleValueChange}
            />
          </div>

          <Command.List className="max-h-80 overflow-y-auto p-2 scrollbar-thin">
            <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
              {isSearching ? "Searching..." : "No results found."}
            </Command.Empty>

            <Command.Group
              heading={showApiResults ? "Search Results" : "Popular Symbols"}
              className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
            >
              {showApiResults && hasSearched && searchResults.length === 0 && !isSearching && (
                <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                  No symbols found for &ldquo;{query}&rdquo;
                </div>
              )}
              {symbolsToShow.map((sym) => (
                <CommandItem
                  key={sym.symbol}
                  icon={<TrendingUp className="h-4 w-4" />}
                  label={
                    sym.name && sym.name !== sym.symbol
                      ? `${sym.symbol} — ${sym.name}${sym.exchange ? ` (${sym.exchange})` : ""}`
                      : sym.symbol
                  }
                  onSelect={() => selectSymbol(sym.symbol)}
                />
              ))}
            </Command.Group>

            <Command.Separator className="my-1 h-px bg-border" />

            <Command.Group
              heading="Commands"
              className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
            >
              <CommandItem
                icon={<Zap className="h-4 w-4" />}
                label="Analyze current symbol"
                shortcut="A"
                onSelect={handleAnalyze}
              />
              <CommandItem
                icon={<BarChart3 className="h-4 w-4" />}
                label="Screen momentum stocks"
                shortcut="S"
                onSelect={handleScreenMomentum}
              />
              <CommandItem
                icon={<Wallet className="h-4 w-4" />}
                label="Show portfolio"
                onSelect={handleShowPortfolio}
              />
              <CommandItem
                icon={<ArrowRightLeft className="h-4 w-4" />}
                label="Switch to live trading"
                onSelect={handleSwitchLive}
              />
            </Command.Group>

            <Command.Separator className="my-1 h-px bg-border" />

            <Command.Group
              heading="Navigation"
              className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
            >
              <CommandItem
                icon={<LineChart className="h-4 w-4" />}
                label="Focus chart panel"
                shortcut="1"
                onSelect={() => {
                  setCommandPaletteOpen(false);
                  // Scroll chart into view and dispatch timeframe event to signal focus
                  setTimeout(() => {
                    const el = document.querySelector("[data-slot='chart-panel']") ?? document.querySelector(".tradingview-widget-container");
                    if (el) el.scrollIntoView({ behavior: "smooth" });
                  }, 100);
                }}
              />
              <CommandItem
                icon={<BarChart3 className="h-4 w-4" />}
                label="Focus options chain"
                onSelect={handleFocusOptions}
              />
            </Command.Group>
          </Command.List>

          <div className="flex items-center justify-between border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
            <div className="flex gap-3">
              <span>
                <kbd className="rounded bg-[var(--panel)] px-1 py-0.5 font-mono">
                  &uarr;&darr;
                </kbd>{" "}
                navigate
              </span>
              <span>
                <kbd className="rounded bg-[var(--panel)] px-1 py-0.5 font-mono">
                  &crarr;
                </kbd>{" "}
                select
              </span>
              <span>
                <kbd className="rounded bg-[var(--panel)] px-1 py-0.5 font-mono">
                  esc
                </kbd>{" "}
                close
              </span>
            </div>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
