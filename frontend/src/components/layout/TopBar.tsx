"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  Settings,
  Search,
  Zap,
  LayoutDashboard,
  BarChart3,
  Bot,
  Wifi,
  WifiOff,
  ChevronDown,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useUIStore } from "@/stores/ui";
import { useAlertsStore } from "@/stores/alerts";
import { usePortfolioStore } from "@/stores/portfolio";
import { useWs } from "@/lib/providers";
import { formatTimestamp, cn, formatCurrency } from "@/lib/utils";

type BrokerType = "alpaca_paper" | "alpaca_live" | "ib";

const BROKER_LABELS: Record<BrokerType, string> = {
  alpaca_paper: "Alpaca (Paper)",
  alpaca_live: "Alpaca (Live)",
  ib: "Interactive Brokers",
};

export function TopBar() {
  const router = useRouter();
  const pathname = usePathname();
  const { tradingMode, setTradingMode, setCommandPaletteOpen } = useUIStore();
  const { isConnected } = useWs();
  const alerts = useAlertsStore((s) => s.alerts);
  const unacknowledgedCount = useAlertsStore((s) =>
    s.alerts.filter((a) => !a.acknowledged).length
  );
  const acknowledgeAlert = useAlertsStore((s) => s.acknowledgeAlert);

  const summary = usePortfolioStore((s) => s.summary);
  const hasSummaryData = Number.isFinite(summary.dayPnl) && summary.dayPnl !== 0;
  const dayPnl = hasSummaryData ? summary.dayPnl : 0;
  const dayPnlPct = hasSummaryData ? summary.dayPnlPct : 0;

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [modeConfirmOpen, setModeConfirmOpen] = useState(false);
  const [broker, setBroker] = useState<BrokerType>("alpaca_paper");
  const [brokerConnected, setBrokerConnected] = useState(true);
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");

  const handleModeClick = () => {
    if (tradingMode === "paper") {
      setModeConfirmOpen(true);
    } else {
      setTradingMode("paper");
    }
  };

  const confirmLiveMode = () => {
    setTradingMode("live");
    setModeConfirmOpen(false);
  };

  const isHome = pathname === "/";
  const isTrade = pathname === "/trade";
  const isPipeline = pathname === "/pipeline";

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-[var(--surface)] px-4">
      {/* Left: Logo + Nav */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-primary" />
          <span className="text-base font-bold tracking-tight text-foreground">
            AlphaDesk
          </span>
        </div>

        {/* Nav Tabs */}
        <nav className="flex items-center gap-1 ml-2">
          <button
            onClick={() => router.push("/")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-medium transition-colors",
              isHome
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
            )}
          >
            <LayoutDashboard className="h-3.5 w-3.5" />
            Dashboard
          </button>
          <button
            onClick={() => router.push("/trade")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-medium transition-colors",
              isTrade
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
            )}
          >
            <BarChart3 className="h-3.5 w-3.5" />
            Trade
          </button>
          <button
            onClick={() => router.push("/pipeline")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-medium transition-colors",
              isPipeline
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
            )}
          >
            <Bot className="h-3.5 w-3.5" />
            Pipeline
          </button>
        </nav>

        {/* WS status */}
        <div className="flex items-center gap-1.5 ml-1">
          {isConnected ? (
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--profit)] opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--profit)]" />
            </span>
          ) : (
            <span className="inline-block h-2 w-2 rounded-full bg-[var(--loss)]" />
          )}
          <span className={cn("text-[11px] font-medium", isConnected ? "text-[var(--profit)]" : "text-[var(--loss)]")}>
            {isConnected ? "LIVE" : "OFFLINE"}
          </span>
        </div>
      </div>

      {/* Center: Search trigger */}
      <button
        onClick={() => setCommandPaletteOpen(true)}
        className="flex h-8 w-96 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="flex-1 text-left">Search symbols, commands...</span>
        <kbd className="rounded bg-[var(--panel)] px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
          Ctrl+K
        </kbd>
      </button>

      {/* Right: P&L, Broker, Mode, Alerts, Settings */}
      <div className="flex items-center gap-2">
        {/* P&L Today Indicator */}
        <div className="flex items-center gap-1.5 rounded-md border border-border bg-background/50 px-2.5 py-1 text-[11px]">
          <span className="text-muted-foreground font-medium">P&amp;L</span>
          {hasSummaryData ? (
            <>
              <span
                className={cn(
                  "font-bold tabular-nums",
                  dayPnl > 0
                    ? "text-[var(--profit)]"
                    : dayPnl < 0
                    ? "text-[var(--loss)]"
                    : "text-muted-foreground"
                )}
              >
                {dayPnl >= 0 ? "+" : ""}{formatCurrency(dayPnl)}
              </span>
              {dayPnlPct !== 0 && (
                <span
                  className={cn(
                    "tabular-nums",
                    dayPnlPct > 0 ? "text-[var(--profit)]" : "text-[var(--loss)]"
                  )}
                >
                  ({dayPnlPct >= 0 ? "+" : ""}{dayPnlPct.toFixed(2)}%)
                </span>
              )}
            </>
          ) : (
            <span className="font-bold tabular-nums text-muted-foreground">---</span>
          )}
        </div>

        {/* Broker Connection Indicator */}
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-1.5 rounded-md border border-border bg-background/50 px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors">
            {brokerConnected ? (
              <Wifi className="h-3 w-3 text-[var(--profit)]" />
            ) : (
              <WifiOff className="h-3 w-3 text-[var(--loss)]" />
            )}
            <span className="font-medium">{BROKER_LABELS[broker]}</span>
            <ChevronDown className="h-3 w-3" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="bottom"
            align="end"
            className="w-64 bg-[var(--surface)] border-border"
          >
            {/* Account info */}
            <div className="px-3 py-2 space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Status</span>
                <div className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      "inline-block h-1.5 w-1.5 rounded-full",
                      brokerConnected
                        ? "bg-[var(--profit)]"
                        : "bg-[var(--loss)]"
                    )}
                  />
                  <span
                    className={
                      brokerConnected
                        ? "text-[var(--profit)]"
                        : "text-[var(--loss)]"
                    }
                  >
                    {brokerConnected ? "Connected" : "Disconnected"}
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Equity</span>
                <span className="text-foreground tabular-nums font-medium">
                  {formatCurrency(summary.equity > 0 ? summary.equity : 0)}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Buying Power</span>
                <span className="text-foreground tabular-nums font-medium">
                  {formatCurrency(summary.buyingPower > 0 ? summary.buyingPower : 0)}
                </span>
              </div>
            </div>

            <DropdownMenuSeparator />

            {/* Switch mode */}
            <div className="px-3 py-1.5">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                Switch Broker
              </p>
            </div>
            <DropdownMenuItem
              onClick={() => {
                setBroker("alpaca_paper");
                setBrokerConnected(true);
              }}
              className={broker === "alpaca_paper" ? "text-primary" : ""}
            >
              <span className={cn("mr-2 h-2 w-2 rounded-full", broker === "alpaca_paper" ? "bg-primary" : "bg-transparent")} />
              Alpaca (Paper)
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                setBroker("alpaca_live");
                setBrokerConnected(true);
              }}
              className={broker === "alpaca_live" ? "text-primary" : ""}
            >
              <span className={cn("mr-2 h-2 w-2 rounded-full", broker === "alpaca_live" ? "bg-primary" : "bg-transparent")} />
              Alpaca (Live)
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                setBroker("ib");
                setBrokerConnected(false);
              }}
              className={broker === "ib" ? "text-primary" : ""}
            >
              <span className={cn("mr-2 h-2 w-2 rounded-full", broker === "ib" ? "bg-primary" : "bg-transparent")} />
              Interactive Brokers
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
              <Settings className="mr-2 h-3.5 w-3.5" />
              API Settings
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Mode badge */}
        <Badge
          variant={tradingMode === "paper" ? "default" : "destructive"}
          className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 cursor-pointer select-none ${
            tradingMode === "paper"
              ? "bg-[var(--profit)]/15 text-[var(--profit)] border-[var(--profit)]/30"
              : "bg-[var(--loss)]/15 text-[var(--loss)] border-[var(--loss)]/30"
          }`}
          onClick={handleModeClick}
        >
          {tradingMode}
        </Badge>

        {/* Alerts */}
        <Popover>
          <PopoverTrigger
            render={
              <Button variant="ghost" size="icon" className="relative h-8 w-8">
                <Bell className="h-4 w-4 text-muted-foreground" />
                {unacknowledgedCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">
                    {unacknowledgedCount > 9 ? "9+" : unacknowledgedCount}
                  </span>
                )}
              </Button>
            }
          />
          <PopoverContent
            side="bottom"
            align="end"
            className="w-80 bg-[var(--surface)] border-border p-0"
          >
            <div className="border-b border-border px-3 py-2">
              <span className="text-xs font-medium text-foreground">
                Alerts
              </span>
            </div>
            <ScrollArea className="max-h-64">
              {alerts.length === 0 ? (
                <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                  No alerts yet
                </div>
              ) : (
                <div className="py-1">
                  {alerts.slice(0, 20).map((alert) => (
                    <button
                      key={alert.id}
                      onClick={() => acknowledgeAlert(alert.id)}
                      className={`flex w-full items-start gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-accent/50 ${
                        alert.acknowledged
                          ? "opacity-50"
                          : ""
                      }`}
                    >
                      <span
                        className={`mt-0.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                          alert.type === "price"
                            ? "bg-primary"
                            : alert.type === "order"
                            ? "bg-[var(--profit)]"
                            : alert.type === "signal"
                            ? "bg-[var(--chart-4)]"
                            : "bg-muted-foreground"
                        }`}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-foreground leading-tight">
                          {alert.message}
                        </p>
                        <span className="text-[10px] text-muted-foreground">
                          {formatTimestamp(alert.time)}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
          </PopoverContent>
        </Popover>

        {/* Settings */}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings className="h-4 w-4 text-muted-foreground" />
        </Button>
      </div>

      {/* Settings Sheet */}
      <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
        <SheetContent side="right" className="bg-[var(--surface)] border-border">
          <SheetHeader>
            <SheetTitle>Settings</SheetTitle>
            <SheetDescription>
              Configure your trading environment.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-6 p-4">
            <div>
              <h4 className="text-xs font-medium text-muted-foreground mb-2">
                Trading Mode
              </h4>
              <div className="flex gap-2">
                <button
                  onClick={() => setTradingMode("paper")}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    tradingMode === "paper"
                      ? "bg-[var(--profit)]/15 text-[var(--profit)] border border-[var(--profit)]/30"
                      : "bg-background text-muted-foreground border border-border"
                  }`}
                >
                  Paper
                </button>
                <button
                  onClick={handleModeClick}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    tradingMode === "live"
                      ? "bg-[var(--loss)]/15 text-[var(--loss)] border border-[var(--loss)]/30"
                      : "bg-background text-muted-foreground border border-border"
                  }`}
                >
                  Live
                </button>
              </div>
            </div>
            <div>
              <h4 className="text-xs font-medium text-muted-foreground mb-2">
                API Configuration
              </h4>
              <div className="space-y-2">
                <div>
                  <label className="text-[11px] text-muted-foreground">Broker</label>
                  <select
                    value={broker}
                    onChange={(e) => setBroker(e.target.value as BrokerType)}
                    className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground"
                  >
                    <option value="alpaca_paper">Alpaca (Paper)</option>
                    <option value="alpaca_live">Alpaca (Live)</option>
                    <option value="ib">Interactive Brokers</option>
                  </select>
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground">API Key</label>
                  <input
                    type="password"
                    placeholder="Enter API key..."
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground">API Secret</label>
                  <input
                    type="password"
                    placeholder="Enter API secret..."
                    value={apiSecret}
                    onChange={(e) => setApiSecret(e.target.value)}
                    className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground"
                  />
                </div>
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Live mode confirmation dialog */}
      <Dialog open={modeConfirmOpen} onOpenChange={setModeConfirmOpen}>
        <DialogContent className="bg-[var(--surface)] border-border">
          <DialogHeader>
            <DialogTitle>Switch to Live Trading?</DialogTitle>
            <DialogDescription>
              You are about to switch to LIVE trading mode. Real orders will be
              submitted to your broker. Make sure your API keys are configured.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setModeConfirmOpen(false)}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              onClick={confirmLiveMode}
              className="bg-[var(--loss)] hover:bg-[var(--loss)]/90 text-white text-xs"
            >
              Confirm Live Mode
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </header>
  );
}
