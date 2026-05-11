"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Command } from "cmdk";
import {
  ArrowsLeftRight,
  Bell,
  Buildings,
  ChartBar,
  ChartLineUp,
  Clock,
  FileText,
  Gauge,
  MagnifyingGlass,
  Robot,
  ShieldCheck,
  SpinnerGap,
  Target,
  TrendUp,
  Wallet,
} from "@phosphor-icons/react";
import { useUIStore } from "@/stores/ui";
import { useMarketStore } from "@/stores/market";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogHeader, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ApiError, commitUserTradingMode, searchSymbols } from "@/lib/api";
import { STRATEGY_META, STRATEGY_ORDER } from "@/lib/strategies";
import { useToast } from "@/hooks/useToast";

const POPULAR_SYMBOLS = [
  "SPY", "QQQ", "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "TSLA", "META", "AMD",
  "NFLX", "JPM", "V", "BA", "DIS", "COIN", "SOFI", "PLTR", "SMCI", "AVGO",
];

const PAGES = [
  { path: "/", label: "Dashboard", icon: Gauge },
  { path: "/symbols", label: "Research", icon: Buildings },
  { path: "/trade", label: "Trade", icon: ChartBar },
  { path: "/strategies", label: "Strategies", icon: Target },
  { path: "/pipeline", label: "Pipeline", icon: Robot },
  { path: "/analytics", label: "Analytics", icon: ChartLineUp },
  { path: "/alerts", label: "Alerts", icon: Bell },
  { path: "/reports", label: "Reports", icon: FileText },
  { path: "/admin/control-center", label: "Admin control center", icon: ShieldCheck },
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

type DestructiveAction = "cancel-all-orders" | "flatten-symbol" | "pause-all-strategies";

interface PendingDestructiveAction {
  type: DestructiveAction;
  symbol?: string;
  blockedReason?: string;
}

function CommandItem({ icon, label, shortcut, onSelect }: CommandItemProps) {
  return (
    <Command.Item
      onSelect={onSelect}
      className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm text-foreground cursor-pointer data-[selected=true]:bg-primary/10 data-[selected=true]:text-primary"
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {shortcut && (
        <kbd className="rounded bg-[var(--panel)] px-1.5 py-0.5 text-label font-mono text-muted-foreground">
          {shortcut}
        </kbd>
      )}
    </Command.Item>
  );
}

export function CommandPalette() {
  const { commandPaletteOpen, setCommandPaletteOpen, tradingMode, setTradingMode } = useUIStore();
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
  const [liveTotpCode, setLiveTotpCode] = useState("");
  const [pendingDestructiveAction, setPendingDestructiveAction] = useState<PendingDestructiveAction | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pathname = usePathname();
  const deskActionsAvailable = pathname === "/";
  const destructiveDialogOpen = pendingDestructiveAction !== null;

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

  useEffect(() => {
    if (!confirmLiveOpen) {
      setLiveTotpCode("");
    }
  }, [confirmLiveOpen]);

  // Clean up debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

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
  async function handleSwitchLive() {
    if (useUIStore.getState().tradingMode === "live") {
      // Switching back to paper is always safe
      setCommandPaletteOpen(false);
      try {
        const res = await commitUserTradingMode({ mode: "paper" });
        setTradingMode(res.mode);
        toast({ type: "info", message: "Switched to paper trading" });
      } catch (err) {
        toast({
          type: "error",
          message: err instanceof ApiError && err.detail ? err.detail : "Could not switch to paper trading.",
        });
      }
    } else {
      // Close the palette and open the confirmation modal; the flip
      // itself only happens once the user hits "Enable live trading".
      setCommandPaletteOpen(false);
      setConfirmLiveOpen(true);
    }
  }

  async function handleConfirmLive() {
    setConfirmLiveOpen(false);
    try {
      const res = await commitUserTradingMode({
        mode: "live",
        totp_code: liveTotpCode.trim() || undefined,
      });
      setTradingMode(res.mode);
      toast({ type: "warning", message: "Live trading mode enabled" });
    } catch (err) {
      toast({
        type: "warning",
        message: err instanceof ApiError && err.detail
          ? err.detail
          : "Live trading requires a fresh 2FA step-up before it can be enabled.",
      });
      setConfirmLiveOpen(true);
    }
  }

  function tradeUrl(): string {
    const sym = useMarketStore.getState().selectedSymbol;
    return sym ? `/trade?symbol=${encodeURIComponent(sym)}` : "/trade";
  }

  // Open the dedicated trade surface; on /trade, focus the mounted chart.
  function handleFocusChart() {
    setCommandPaletteOpen(false);
    if (pathname !== "/trade") {
      router.push(tradeUrl());
      return;
    }
    window.setTimeout(() => {
      const el =
        document.querySelector("[data-slot='price-chart-panel']") ??
        document.querySelector("[data-slot='chart-panel']") ??
        document.querySelector(".tradingview-widget-container");
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
  }

  // Phase-2 / KP-1 (2026 design brief): Linear/Ramp pattern — Cmd+K
  // becomes the unifying action surface for navigate + act + search.
  // These are the high-leverage trading actions the brief calls out.
  function handleCancelAllOrders() {
    setCommandPaletteOpen(false);
    setPendingDestructiveAction({
      type: "cancel-all-orders",
      blockedReason: deskActionsAvailable
        ? undefined
        : "Open the Dashboard to cancel working orders.",
    });
  }

  function handleConfirmCancelAllOrders() {
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
    // Round-28 / persona-A P0: pre-fix this read ``selectedSymbol`` from
    // the render closure, which is captured at component mount. If the
    // user typed in the palette while another tab / WS event updated
    // selectedSymbol, the dispatched ``alphadesk:flatten-symbol`` would
    // ship the STALE symbol — flattening the wrong position. Read fresh
    // from the store at click time, mirroring ``handleSwitchLive``.
    const sym = useMarketStore.getState().selectedSymbol;
    setCommandPaletteOpen(false);
    setPendingDestructiveAction({
      type: "flatten-symbol",
      symbol: sym || undefined,
      blockedReason: !deskActionsAvailable
        ? "Open the Dashboard to flatten the selected symbol."
        : sym
          ? undefined
          : "No symbol selected — pick one first.",
    });
  }

  function handleConfirmFlattenCurrentSymbol(symbol: string) {
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("alphadesk:flatten-symbol", { detail: { symbol } }),
      );
    }
    toast({
      type: "info",
      message: `Flattening ${symbol} — closing position at market…`,
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
    setPendingDestructiveAction({
      type: "pause-all-strategies",
      blockedReason: deskActionsAvailable
        ? undefined
        : "Open the Dashboard to pause all strategies.",
    });
  }

  function handleConfirmPauseAllStrategies() {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("alphadesk:pause-all-strategies"));
    }
    toast({
      type: "info",
      message: "Pausing all strategies — pipeline will skip the next dispatch.",
    });
  }

  function destructiveActionCopy(action: PendingDestructiveAction) {
    if (action.type === "cancel-all-orders") {
      return {
        testId: "confirm-cancel-all-orders",
        title: "Cancel all working orders?",
        description:
          "This sends a desk-wide cancel request for every open working order. Filled orders and existing positions are not reversed.",
        bullets: [
          "Open limit, stop, and staged working orders may be cancelled.",
          "Orders that fill before the cancel reaches the broker can still execute.",
          "No positions are flattened by this action.",
        ],
        confirmLabel: "Cancel orders",
      };
    }

    if (action.type === "flatten-symbol") {
      const symbol = action.symbol ?? "the current symbol";
      return {
        testId: "confirm-flatten-symbol",
        title: `Flatten ${symbol}?`,
        description:
          "This requests market orders to close the current position for the selected symbol.",
        bullets: [
          `${symbol} exposure will be reduced to zero if the broker accepts the closeout orders.`,
          "Open orders for other symbols are not changed.",
          "Market orders can fill with slippage during fast conditions.",
        ],
        confirmLabel: `Flatten ${symbol}`,
      };
    }

    return {
      testId: "confirm-pause-all-strategies",
      title: "Pause all strategies?",
      description:
        "This pauses automated strategy dispatch across the desk until strategies are resumed.",
      bullets: [
        "The strategy pipeline will skip new automated dispatches.",
        "Existing broker orders and open positions are not cancelled.",
        "Manual trading remains available.",
      ],
      confirmLabel: "Pause strategies",
    };
  }

  function handleConfirmDestructiveAction() {
    if (!pendingDestructiveAction) return;
    const action = pendingDestructiveAction;
    if (action.blockedReason) return;
    setPendingDestructiveAction(null);

    if (action.type === "cancel-all-orders") {
      handleConfirmCancelAllOrders();
      return;
    }

    if (action.type === "flatten-symbol" && action.symbol) {
      handleConfirmFlattenCurrentSymbol(action.symbol);
      return;
    }

    if (action.type === "pause-all-strategies") {
      handleConfirmPauseAllStrategies();
    }
  }

  // Focus options chain; from the dashboard this moves to the trade workspace
  // instead of promising a chartless dashboard panel that no longer exists.
  function handleFocusOptions() {
    setCommandPaletteOpen(false);
    const el = document.querySelector("[data-slot='options-panel']");
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
      return;
    }
    router.push(tradeUrl());
  }

  const destructiveCopy = pendingDestructiveAction
    ? destructiveActionCopy(pendingDestructiveAction)
    : null;

  return (
    <>
    <Dialog open={commandPaletteOpen} onOpenChange={setCommandPaletteOpen}>
      <DialogContent
        data-testid="command-palette"
        className="overflow-hidden p-0 max-w-xl bg-[var(--bg-card)] border-border shadow-2xl [&>button]:hidden"
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
              <SpinnerGap className="mr-2 h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
            ) : (
              <MagnifyingGlass className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
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
              className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-label [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
            >
              {showApiResults && hasSearched && searchResults.length === 0 && !isSearching && (
                <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                  No symbols found for &ldquo;{query}&rdquo;
                </div>
              )}
              {symbolsToShow.map((sym) => (
                <CommandItem
                  key={sym.symbol}
                  icon={<TrendUp className="h-4 w-4" />}
                  label={
                    sym.name && sym.name !== sym.symbol
                      ? `${sym.symbol} — ${sym.name}${sym.exchange ? ` (${sym.exchange})` : ""}`
                      : sym.symbol
                  }
                  onSelect={() => selectSymbol(sym.symbol)}
                />
              ))}
              {/* T11 — per-symbol research deep-link. Keeps the symbol-
                  selection entry above as the primary action; this is
                  the secondary "go research this" jump. Only rendered
                  when the user is searching (showApiResults) so the
                  popular-symbols list stays tight. */}
              {showApiResults &&
                symbolsToShow.map((sym) => (
                  <CommandItem
                    key={`research-${sym.symbol}`}
                    icon={<FileText className="h-4 w-4" />}
                    label={`${sym.symbol} — research`}
                    onSelect={() => {
                      setCommandPaletteOpen(false);
                      router.push(`/symbols/${encodeURIComponent(sym.symbol)}`);
                    }}
                  />
                ))}
            </Command.Group>

            <Command.Separator className="my-1 h-px bg-border" />

            <Command.Group
              heading="Commands"
              className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-label [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
            >
              {/* Wave 32 persona-6 #8: "Analyze current symbol" removed —
                  it toasted "coming soon" with no real analysis surface, and
                  the decorative shortcut hint misled keyboard users into
                  expecting an "A" binding that didn't exist. Re-add when the
                  analysis page ships. */}
              <CommandItem
                icon={<ChartBar className="h-4 w-4" />}
                label="Screen momentum stocks"
                onSelect={handleScreenMomentum}
              />
              <CommandItem
                icon={<Wallet className="h-4 w-4" />}
                label="Show portfolio"
                onSelect={handleShowPortfolio}
              />
              <CommandItem
                icon={<ArrowsLeftRight className="h-4 w-4" />}
                label={tradingMode === "live" ? "Switch to paper trading" : "Live trading access"}
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
                icon={<TrendUp className="h-4 w-4" />}
                label={
                  selectedSymbol
                    ? `Flatten ${selectedSymbol} — close at market`
                    : "Flatten current symbol (none selected)"
                }
                onSelect={handleFlattenCurrentSymbol}
              />
              <CommandItem
                icon={<Robot className="h-4 w-4" />}
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
              className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-label [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
            >
              <CommandItem
                icon={<ChartLineUp className="h-4 w-4" />}
                label={pathname === "/trade" ? "Focus chart panel" : "Open trade chart"}
                onSelect={handleFocusChart}
              />
              <CommandItem
                icon={<ChartBar className="h-4 w-4" />}
                label={pathname === "/trade" ? "Focus options chain" : "Open options chain"}
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
                    className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-label [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
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
                    className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-label [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
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
                    className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-label [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
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

          <div className="flex items-center justify-between border-t border-border px-3 py-2 text-label text-muted-foreground">
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
        className="max-w-md bg-[var(--bg-card)] border-border"
      >
        <DialogHeader>
          <DialogTitle className="text-foreground">
            Enable live trading
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Enter your current 2FA code to commit live mode on the server.
            Orders still require preview and confirmation before submission.
          </DialogDescription>
        </DialogHeader>
        <ul className="list-disc space-y-1 pl-5 text-label text-muted-foreground">
          <li>The mode change is audited.</li>
          <li>Paper mode remains available without step-up.</li>
          <li>Live orders are rejected if the request mode disagrees.</li>
        </ul>
        <label className="space-y-1 text-label font-medium text-muted-foreground">
          <span>2FA code</span>
          <input
            value={liveTotpCode}
            onChange={(event) => setLiveTotpCode(event.target.value.replace(/\D/g, "").slice(0, 8))}
            inputMode="numeric"
            autoComplete="one-time-code"
            className="h-9 w-full rounded-md border border-border bg-[var(--panel)] px-3 font-mono text-sm text-foreground outline-none focus:border-brand"
            placeholder="123456"
          />
        </label>
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
            variant="primary"
            size="sm"
            onClick={handleConfirmLive}
            disabled={liveTotpCode.trim().length < 6}
            data-testid="confirm-live-confirm"
          >
            Enable live
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog
      open={destructiveDialogOpen}
      onOpenChange={(open) => {
        if (!open) setPendingDestructiveAction(null);
      }}
    >
      {destructiveCopy && (
        <DialogContent
          data-testid={`${destructiveCopy.testId}-dialog`}
          className="max-w-md bg-[var(--bg-card)] border-border"
        >
          <DialogHeader>
            <DialogTitle className="text-foreground">
              {destructiveCopy.title}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {destructiveCopy.description}
            </DialogDescription>
          </DialogHeader>
          <ul className="list-disc space-y-1 pl-5 text-label text-muted-foreground">
            {destructiveCopy.bullets.map((bullet) => (
              <li key={bullet}>{bullet}</li>
            ))}
          </ul>
          {pendingDestructiveAction?.blockedReason && (
            <p
              className="rounded-sm border border-border bg-[var(--panel)] px-3 py-2 text-label text-muted-foreground"
              data-testid={`${destructiveCopy.testId}-blocked-reason`}
            >
              {pendingDestructiveAction.blockedReason}
            </p>
          )}
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPendingDestructiveAction(null)}
              data-testid={`${destructiveCopy.testId}-cancel`}
            >
              Keep as is
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleConfirmDestructiveAction}
              disabled={Boolean(pendingDestructiveAction?.blockedReason)}
              data-testid={`${destructiveCopy.testId}-confirm`}
            >
              {destructiveCopy.confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
    </>
  );
}
