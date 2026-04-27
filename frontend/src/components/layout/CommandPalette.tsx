"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Command } from "cmdk";
import {
  BarChart3,
  LineChart,
  Search,
  TrendingUp,
  Wallet,
  ArrowRightLeft,
  Loader2,
  Target,
  LayoutDashboard,
  Bell,
  Bot,
  FileText,
  Clock,
} from "lucide-react";
import { useUIStore } from "@/stores/ui";
import { useMarketStore } from "@/stores/market";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogHeader, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { searchSymbols } from "@/lib/api";
import { STRATEGY_META, STRATEGY_ORDER } from "@/lib/strategies";
import { useToast } from "@/hooks/useToast";

const POPULAR_SYMBOLS = [
  "SPY", "QQQ", "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "TSLA", "META", "AMD",
  "NFLX", "JPM", "V", "BA", "DIS", "COIN", "SOFI", "PLTR", "SMCI", "AVGO",
];

const PAGES = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard },
  { path: "/trade", label: "Trade", icon: BarChart3 },
  { path: "/analytics", label: "Analytics", icon: LineChart },
  { path: "/alerts", label: "Alerts", icon: Bell },
  { path: "/pipeline", label: "Pipeline", icon: Bot },
  { path: "/reports", label: "Reports", icon: FileText },
  { path: "/docs", label: "Documentation", icon: FileText },
];

const RECENT_ACTIONS = [
  { id: "last-order", label: "Last order submitted", keywords: ["last order", "recent order"] },
  { id: "last-trade", label: "Last trade executed", keywords: ["last trade", "recent trade"] },
  { id: "last-alert", label: "Last alert triggered", keywords: ["last alert", "recent alert"] },
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
  const { commandPaletteOpen, setCommandPaletteOpen, toggleCommandPalette, setTradingMode } = useUIStore();
  const { selectedSymbol, setSelectedSymbol, addToWatchlist } = useMarketStore();
  const router = useRouter();
  const { toast } = useToast();

  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SymbolResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  // BUG-039: confirmation modal for live-trading flip. paper→live must
  // never be one keystroke away; live→paper is always safe (no gate).
  const [confirmLiveOpen, setConfirmLiveOpen] = useState(false);
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

  // Screen momentum — route to the momentum-quality strategy page
  function handleScreenMomentum() {
    setCommandPaletteOpen(false);
    router.push("/strategies/momentum-quality");
  }

  // Show portfolio — analytics page owns portfolio-level charts
  function handleShowPortfolio() {
    setCommandPaletteOpen(false);
    router.push("/analytics");
  }

  // Switch trading mode — live requires explicit action, paper is always safe.
  // BUG-039: flipping paper→live is destructive (real money!) — gate it
  // behind a confirmation modal with explicit risk copy. Going live→paper
  // remains a single keystroke since it only reduces risk.
  function handleSwitchLive() {
    if (useUIStore.getState().tradingMode === "live") {
      // Switching back to paper is always safe
      setCommandPaletteOpen(false);
      setTradingMode("paper");
      toast({ type: "info", message: "Switched to paper trading" });
    } else {
      // Close the palette and open the confirmation modal; the flip
      // itself only happens once the user hits "Enable live trading".
      setCommandPaletteOpen(false);
      setConfirmLiveOpen(true);
    }
  }

  function handleConfirmLive() {
    // Round-10 / W-2 (P0): the previous flow flipped
    // ``useUIStore.tradingMode`` to "live" purely on the client and
    // toasted "Live trading enabled — orders will use real capital."
    // — but there's NO ``/auth/switch-mode`` endpoint, the backend
    // continues to use paper credentials, and ProfileMenu + Settings
    // both correctly tell users this requires admin action. Three
    // surfaces presented contradictory truth: a user could convince
    // themselves they were live via the palette while still trading
    // paper, or worse, take a real-money posture knowing it was
    // really a paper account. Aligned now: only paper→paper is
    // user-toggleable; live requires admin contact.
    setConfirmLiveOpen(false);
    toast({
      type: "info",
      message:
        "Live trading is admin-gated — contact your AlphaDesk operator to enable real-capital orders.",
    });
  }

  // Focus chart panel — scroll the desk chart into view
  function handleFocusChart() {
    setCommandPaletteOpen(false);
    setTimeout(() => {
      const el =
        document.querySelector("[data-slot='price-chart-panel']") ??
        document.querySelector("[data-slot='chart-panel']") ??
        document.querySelector(".tradingview-widget-container");
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      } else {
        toast({ type: "info", message: "Chart not mounted on this page" });
      }
    }, 50);
  }

  // Phase-2 / KP-1 (2026 design brief): Linear/Ramp pattern — Cmd+K
  // becomes the unifying action surface for navigate + act + search.
  // These are the high-leverage trading actions the brief calls out.
  function handleCancelAllOrders() {
    setCommandPaletteOpen(false);
    // Dispatch an event the dashboard listens for; the actual API call
    // lives in the page-level handler so it can show the right toast +
    // optimistic update + react-query invalidation.
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("alphadesk:cancel-all-orders"));
    }
    toast({
      type: "info",
      message: "Cancelling all working orders…",
    });
  }

  function handleFlattenCurrentSymbol() {
    const sym = selectedSymbol;
    setCommandPaletteOpen(false);
    if (!sym) {
      toast({ type: "info", message: "No symbol selected — pick one first." });
      return;
    }
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("alphadesk:flatten-symbol", { detail: { symbol: sym } }),
      );
    }
    toast({
      type: "info",
      message: `Flattening ${sym} — closing position at market…`,
    });
  }

  function handleOpenShortcuts() {
    setCommandPaletteOpen(false);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("alphadesk:open-shortcuts"));
    }
  }

  function handlePauseAllStrategies() {
    setCommandPaletteOpen(false);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("alphadesk:pause-all-strategies"));
    }
    toast({
      type: "info",
      message: "Pausing all strategies — pipeline will skip the next dispatch.",
    });
  }

  // Focus options chain — router.push rather than hard nav
  function handleFocusOptions() {
    setCommandPaletteOpen(false);
    const el = document.querySelector("[data-slot='options-panel']");
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
      return;
    }
    // No options surface today — toast rather than loop via /trade.
    toast({ type: "info", message: "Options chain — coming soon" });
  }

  return (
    <>
    <Dialog open={commandPaletteOpen} onOpenChange={setCommandPaletteOpen}>
      <DialogContent
        data-testid="command-palette"
        className="overflow-hidden p-0 max-w-xl bg-[var(--surface)] border-border shadow-2xl [&>button]:hidden"
      >
        {/* a11y audit r3 — WCAG 4.1.2 / 2.4.6: Dialog needs an accessible name.
            The command palette is visually headerless, so use sr-only title +
            description so SR users hear "Command Palette" instead of "dialog". */}
        <DialogTitle className="sr-only">Command Palette</DialogTitle>
        <DialogDescription className="sr-only">
          Quick navigation and actions
        </DialogDescription>
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
              // Wave 29 mobile a11y: `text-sm` (14px) on a native <input>
              // trips iOS Safari's auto-zoom on focus. Bump to text-base
              // (16px) on mobile, drop back to text-sm on md+ where the
              // palette lives in its desk resolution.
              className="flex h-12 w-full bg-transparent py-3 text-base md:text-sm text-foreground outline-none placeholder:text-muted-foreground overflow-hidden text-ellipsis"
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
              {/* Wave 32 persona-6 #8: "Analyze current symbol" removed —
                  it toasted "coming soon" with no real analysis surface, and
                  the decorative shortcut hint misled keyboard users into
                  expecting an "A" binding that didn't exist. Re-add when the
                  analysis page ships. */}
              <CommandItem
                icon={<BarChart3 className="h-4 w-4" />}
                label="Screen momentum stocks"
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
              {/* Phase-2 / KP-1: high-leverage trading actions per the
                  2026 design brief (Linear/Ramp pattern — Cmd+K unifies
                  navigate + act + search). */}
              <CommandItem
                icon={<Target className="h-4 w-4" />}
                label="Cancel all working orders"
                onSelect={handleCancelAllOrders}
              />
              <CommandItem
                icon={<TrendingUp className="h-4 w-4" />}
                label={
                  selectedSymbol
                    ? `Flatten ${selectedSymbol} — close at market`
                    : "Flatten current symbol (none selected)"
                }
                onSelect={handleFlattenCurrentSymbol}
              />
              <CommandItem
                icon={<Bot className="h-4 w-4" />}
                label="Pause all strategies"
                onSelect={handlePauseAllStrategies}
              />
              <CommandItem
                icon={<Clock className="h-4 w-4" />}
                label="Show keyboard shortcuts"
                shortcut="?"
                onSelect={handleOpenShortcuts}
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
                onSelect={handleFocusChart}
              />
              <CommandItem
                icon={<BarChart3 className="h-4 w-4" />}
                label="Focus options chain"
                onSelect={handleFocusOptions}
              />
            </Command.Group>

            {/* Strategies — filtered by query */}
            {(() => {
              const q = query.toLowerCase();
              const filteredStrategies = STRATEGY_ORDER
                .map((id) => ({ id, ...STRATEGY_META[id] }))
                .filter((s) =>
                  !q ||
                  s.name.toLowerCase().includes(q) ||
                  s.shortName.toLowerCase().includes(q) ||
                  s.id.toLowerCase().includes(q)
                );
              if (filteredStrategies.length === 0) return null;
              return (
                <>
                  <Command.Separator className="my-1 h-px bg-border" />
                  <Command.Group
                    heading="Strategies"
                    className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
                  >
                    {filteredStrategies.slice(0, 6).map((s) => (
                      <CommandItem
                        key={s.id}
                        icon={<Target className="h-4 w-4" />}
                        label={s.shortName}
                        onSelect={() => {
                          router.push(`/strategies/${s.id}`);
                          setCommandPaletteOpen(false);
                        }}
                      />
                    ))}
                  </Command.Group>
                </>
              );
            })()}

            {/* Pages — filtered by query */}
            {(() => {
              const q = query.toLowerCase();
              const filteredPages = PAGES.filter(
                (p) =>
                  !q ||
                  p.label.toLowerCase().includes(q) ||
                  p.path.toLowerCase().includes(q)
              );
              if (filteredPages.length === 0) return null;
              return (
                <>
                  <Command.Separator className="my-1 h-px bg-border" />
                  <Command.Group
                    heading="Pages"
                    className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
                  >
                    {filteredPages.map((p) => {
                      const Icon = p.icon;
                      return (
                        <CommandItem
                          key={p.path}
                          icon={<Icon className="h-4 w-4" />}
                          label={`Go to ${p.label}`}
                          onSelect={() => {
                            router.push(p.path);
                            setCommandPaletteOpen(false);
                          }}
                        />
                      );
                    })}
                  </Command.Group>
                </>
              );
            })()}

            {/* Recent Actions — shown when query matches */}
            {(() => {
              const q = query.toLowerCase();
              if (!q) return null;
              const matchedActions = RECENT_ACTIONS.filter((a) =>
                a.keywords.some((kw) => kw.includes(q) || q.includes(kw)) ||
                a.label.toLowerCase().includes(q)
              );
              if (matchedActions.length === 0) return null;
              return (
                <>
                  <Command.Separator className="my-1 h-px bg-border" />
                  <Command.Group
                    heading="Recent Actions"
                    className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
                  >
                    {matchedActions.map((a) => (
                      <CommandItem
                        key={a.id}
                        icon={<Clock className="h-4 w-4" />}
                        label={a.label}
                        onSelect={() => {
                          setCommandPaletteOpen(false);
                          if (a.id === "last-order" || a.id === "last-trade") {
                            // Recent orders live on the /trade workspace
                            router.push("/trade");
                          } else if (a.id === "last-alert") {
                            router.push("/alerts");
                          }
                        }}
                      />
                    ))}
                  </Command.Group>
                </>
              );
            })()}
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

    {/* BUG-039: paper → live confirmation modal. Explicit risk copy + a
        destructive-styled confirm button so the operator can't drift into
        real capital via one keystroke. Escape / clicking outside cancels. */}
    <Dialog open={confirmLiveOpen} onOpenChange={setConfirmLiveOpen}>
      <DialogContent
        data-testid="confirm-live-modal"
        className="max-w-md bg-[var(--surface)] border-border"
      >
        <DialogHeader>
          <DialogTitle className="text-foreground">
            Enable live trading?
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Orders will route to the live broker and use real capital.
            Strategy signals, risk monitors and manual orders will all
            execute against your funded account.
          </DialogDescription>
        </DialogHeader>
        <ul className="list-disc space-y-1 pl-5 text-[12px] text-muted-foreground">
          <li>Paper-mode safeties no longer apply.</li>
          <li>Live fills may deviate from backtest P&L.</li>
          <li>You can switch back to paper from this palette at any time.</li>
        </ul>
        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConfirmLiveOpen(false)}
            data-testid="confirm-live-cancel"
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleConfirmLive}
            data-testid="confirm-live-confirm"
          >
            Enable live trading
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
