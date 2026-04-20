"use client";

import { useState } from "react";
import {
  Bell,
  Shield,
  Key,
  Palette,
  Monitor,
  Download,
  Loader2,
  RefreshCw,
  Check,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DashboardPageLayout } from "@/components/layouts";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useUIStore } from "@/stores/ui";
import { usePreferencesStore } from "@/stores/preferences";
import { useMarketStore } from "@/stores/market";
import { PerformanceMetrics } from "@/components/dashboard/PerformanceMetrics";
import { getTradeHistory, type TradeHistoryEntry } from "@/lib/api";
import { useToast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";

// ─── Toggle Switch ──────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <div>
        <p className="text-xs font-medium text-foreground">{label}</p>
        {description && (
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {description}
          </p>
        )}
      </div>
      {/* Wave 29 persona-5 #3: Apple HIG + WCAG 2.5.5 require a 44x44 tap
          target. The switch itself stays 20x36 for visual balance; we wrap
          in an invisible 44x44 button so fingers land without needing
          pixel-perfect aim. `-mr-2.5` + `p-2.5` keeps the visible switch
          aligned right. */}
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex min-h-11 min-w-11 items-center justify-center shrink-0 p-2.5 -mr-2.5"
        )}
      >
        <span
          className={cn(
            "relative inline-flex h-5 w-9 items-center rounded-full border transition-colors",
            checked
              ? "bg-primary border-primary/60"
              : "bg-[var(--panel)] border-border"
          )}
        >
          <span
            className={cn(
              "inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform",
              checked ? "translate-x-4" : "translate-x-0.5"
            )}
          />
        </span>
      </button>
    </div>
  );
}

// ─── Slider ─────────────────────────────────────────────────

function IntervalSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  // Values are in seconds. Lower bound 10s; upper bound 300s (5m). Both
  // bounds are also enforced in the store setter (see preferences.ts).
  const options = [10, 30, 60, 120, 300];
  const labels: Record<number, string> = {
    10: "10s",
    30: "30s",
    60: "1m",
    120: "2m",
    300: "5m",
  };

  return (
    <div className="py-1.5">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-medium text-foreground" id="interval-label">
          Portfolio refresh interval: {value} seconds
        </p>
        <span className="text-xs font-semibold text-primary tabular-nums">
          {labels[value] ?? `${value}s`}
        </span>
      </div>
      <div
        role="radiogroup"
        aria-labelledby="interval-label"
        className="flex rounded-lg border border-border overflow-hidden"
      >
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            role="radio"
            aria-checked={value === opt}
            onClick={() => onChange(opt)}
            className={cn(
              "flex-1 px-3 py-1.5 text-[11px] font-medium transition-colors",
              value === opt
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-accent/30"
            )}
          >
            {labels[opt]}
          </button>
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground mt-1">
        Lower intervals increase API usage. Default is 30s.
      </p>
    </div>
  );
}

// ─── Main Settings Page ─────────────────────────────────────

export default function SettingsPage() {
  const tradingMode = useUIStore((s) => s.tradingMode);
  const setTradingMode = useUIStore((s) => s.setTradingMode);
  const { toast } = useToast();
  // Wave 29 persona-1 #7: the old toggle flipped straight to live with no
  // guard. There's no /auth/switch-mode endpoint yet (ProfileMenu confirms);
  // the dialog below asks for confirmation first, and confirming toasts
  // honestly instead of silently staying on paper.
  const [liveConfirmOpen, setLiveConfirmOpen] = useState(false);

  function handleTradingModeToggle() {
    if (tradingMode === "live") {
      // Switching back to paper is always safe
      setTradingMode("paper");
    } else {
      setLiveConfirmOpen(true);
    }
  }

  const notifications = usePreferencesStore((s) => s.notifications);
  const display = usePreferencesStore((s) => s.display);
  const data = usePreferencesStore((s) => s.data);
  const setNotificationPref = usePreferencesStore(
    (s) => s.setNotificationPref
  );
  const setDisplayPref = usePreferencesStore((s) => s.setDisplayPref);
  const setDataPref = usePreferencesStore((s) => s.setDataPref);
  const resetAllPrefs = usePreferencesStore((s) => s.resetAll);

  const watchlist = useMarketStore((s) => s.watchlist);

  const [exportingTrades, setExportingTrades] = useState(false);
  const [exportDone, setExportDone] = useState<string | null>(null);
  // Persona-8 #6: `resetAll` lived in the store unwired. The button below
  // commits the reset; this dialog ensures a stray click doesn't nuke a
  // carefully-tuned setup.
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [resetDone, setResetDone] = useState(false);

  // ─── Export Handlers ──────────────────────────────────────

  function downloadJSON(data: unknown, filename: string) {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function handleExportWatchlist() {
    downloadJSON(
      { watchlist, exported: new Date().toISOString() },
      `alphadesk-watchlist-${new Date().toISOString().slice(0, 10)}.json`
    );
    setExportDone("watchlist");
    setTimeout(() => setExportDone(null), 2000);
  }

  async function handleExportTrades() {
    setExportingTrades(true);
    try {
      const trades = await getTradeHistory(1000);
      if (!trades || trades.length === 0) {
        toast({
          type: "info",
          message: "No trade history to export",
        });
        return;
      }

      const headers = [
        "Date",
        "Symbol",
        "Side",
        "Shares",
        "Entry Price",
        "Exit Price",
        "P&L",
        "P&L %",
        "Strategy",
        "Status",
      ];

      const rows = trades.map((t: TradeHistoryEntry) => [
        t.entry_time
          ? new Date(t.entry_time).toISOString().slice(0, 10)
          : "",
        t.symbol,
        t.side,
        t.quantity,
        t.entry_price != null ? t.entry_price.toFixed(2) : "",
        t.exit_price != null ? t.exit_price.toFixed(2) : "",
        t.pnl != null ? t.pnl.toFixed(2) : "",
        t.pnl_pct != null ? t.pnl_pct.toFixed(2) : "",
        t.strategy ?? "",
        t.status,
      ]);

      const csvContent = [
        headers.join(","),
        ...rows.map((row) =>
          row
            .map((cell) => {
              const str = String(cell);
              if (str.includes(",") || str.includes('"')) {
                return `"${str.replace(/"/g, '""')}"`;
              }
              return str;
            })
            .join(",")
        ),
      ].join("\n");

      const blob = new Blob([csvContent], {
        type: "text/csv;charset=utf-8;",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `alphadesk-trades-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setExportDone("trades");
      setTimeout(() => setExportDone(null), 2000);
    } catch (err) {
      console.error("Export failed:", err);
    } finally {
      setExportingTrades(false);
    }
  }

  function handleExportSettings() {
    const settings = {
      tradingMode,
      notifications,
      display,
      data,
      watchlist,
      exported: new Date().toISOString(),
    };
    downloadJSON(
      settings,
      `alphadesk-settings-${new Date().toISOString().slice(0, 10)}.json`
    );
    setExportDone("settings");
    setTimeout(() => setExportDone(null), 2000);
  }

  return (
    <DashboardPageLayout eyebrow="§ SETTINGS" title="Settings">
      <div className="space-y-4">
        {/* Trading Mode */}
        <div className="rounded-lg border border-border bg-bg-elev-1 p-4">
          <div className="flex items-center gap-3 mb-3">
            <Monitor className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Trading Mode</h2>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">
                Switch between paper and live trading environments.
              </p>
              <p className="text-[10px] text-amber mt-1">
                {tradingMode === "live"
                  ? "Live mode uses real capital. Be cautious."
                  : "Paper mode uses simulated funds. Safe for testing."}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "text-[11px] font-medium",
                  tradingMode === "paper"
                    ? "text-foreground"
                    : "text-muted-foreground"
                )}
              >
                Paper
              </span>
              {/* Wave 29 persona-5 #3: trading-mode toggle is the most
                  consequential switch on the page — wrap in 44x44 min tap
                  target and gate switching to live through a confirmation
                  dialog. */}
              <button
                role="switch"
                aria-checked={tradingMode === "live"}
                aria-label="Trading mode toggle"
                onClick={handleTradingModeToggle}
                className="relative inline-flex min-h-11 min-w-11 items-center justify-center shrink-0 p-2.5 -mr-2.5"
              >
                <span
                  className={cn(
                    "relative inline-flex h-6 w-11 items-center rounded-full border-2 transition-colors",
                    tradingMode === "live"
                      ? "bg-loss/80 border-loss/60"
                      : "bg-profit/60 border-profit/40"
                  )}
                >
                  <span
                    className={cn(
                      "inline-block h-4 w-4 rounded-full bg-fg shadow transition-transform",
                      tradingMode === "live"
                        ? "translate-x-5"
                        : "translate-x-0.5"
                    )}
                  />
                </span>
              </button>
              <span
                className={cn(
                  "text-[11px] font-medium",
                  tradingMode === "live"
                    ? "text-loss"
                    : "text-muted-foreground"
                )}
              >
                Live
              </span>
            </div>
          </div>
        </div>

        {/* API Keys */}
        <div className="rounded-lg border border-border bg-bg-elev-1 p-4">
          <div className="flex items-center gap-3 mb-3">
            <Key className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">API Keys</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            Alpaca API keys are configured on the server. Contact admin to update
            brokerage credentials.
          </p>
        </div>

        {/* Notifications */}
        <div className="rounded-lg border border-border bg-bg-elev-1 p-4">
          <div className="flex items-center gap-3 mb-3">
            <Bell className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Notifications</h2>
          </div>
          <div className="space-y-1">
            <Toggle
              checked={notifications.orderFills}
              onChange={(v) => setNotificationPref("orderFills", v)}
              label="Order Fills"
              description="Get notified when orders are filled"
            />
            <Toggle
              checked={notifications.alertsTriggered}
              onChange={(v) => setNotificationPref("alertsTriggered", v)}
              label="Alerts Triggered"
              description="Notify when price alerts hit their target"
            />
            <Toggle
              checked={notifications.pipelineCompleted}
              onChange={(v) => setNotificationPref("pipelineCompleted", v)}
              label="Pipeline Completed"
              description="Notify when trading pipeline finishes a run"
            />
            {/* Persona-8 #4: "Strategy Events" toggle removed — no producer
                ever called shouldNotify("strategyEvents"); flipping it only
                wrote to localStorage. The three categories above are the
                ones actually wired in useNotifications. */}
          </div>
        </div>

        {/* Display */}
        <div className="rounded-lg border border-border bg-bg-elev-1 p-4">
          <div className="flex items-center gap-3 mb-3">
            <Palette className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Display</h2>
          </div>
          <div className="space-y-1">
            <Toggle
              checked={display.tickerTapeOn}
              onChange={(v) => setDisplayPref("tickerTapeOn", v)}
              label="Ticker Tape"
              description="Show the scrolling market ticker below the header"
            />
            <Toggle
              checked={display.compactStrategyView}
              onChange={(v) => setDisplayPref("compactStrategyView", v)}
              label="Compact Strategy View"
              description="Single-line rows in the strategy rail. Hides subtitles, packs more strategies into the same vertical space."
            />
            {/* Persona-8 #2: "Animation Speed" picker removed — there's no
                single global animation-speed knob that cleanly controls
                lightweight-charts, the marquee, the pulse dots, etc. The
                rest of the app honours `prefers-reduced-motion` instead.
                Honest move: don't ship a setting we can't back. */}
            {/* Wave 6γ (persona-112 + Round 5 deferred): "Light" removed
                from the theme picker. The ``.light {}`` CSS tokens were
                never fleshed out, so toggling the radio produced no visible
                change — a promise the app couldn't keep. Until the light
                palette is tuned, only System and Dark are offered, and
                ``ThemeController`` treats a persisted "light" preference as
                "dark" so users who flipped the radio pre-fix land on a
                theme that actually renders. */}
            <div className="flex items-center justify-between gap-4 py-1.5">
              <div>
                <p className="text-xs font-medium text-foreground">Theme</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Dark mode is fully tuned today. Light mode is coming in a
                  future release.
                </p>
              </div>
              <div
                role="radiogroup"
                aria-label="Theme preference"
                className="flex rounded-md border border-border overflow-hidden"
              >
                {(["system", "dark"] as const).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    role="radio"
                    aria-checked={display.theme === opt}
                    onClick={() => setDisplayPref("theme", opt)}
                    className={cn(
                      "min-h-11 px-3 text-[11px] font-medium capitalize transition-colors",
                      display.theme === opt
                        ? "bg-primary/15 text-primary"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent/30"
                    )}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Data Refresh */}
        <div className="rounded-lg border border-border bg-bg-elev-1 p-4">
          <div className="flex items-center gap-3 mb-3">
            <RefreshCw className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Data Refresh</h2>
          </div>
          <IntervalSlider
            value={data.refreshInterval}
            onChange={(v) => setDataPref("refreshInterval", v)}
          />
        </div>

        {/* Export */}
        <div className="rounded-lg border border-border bg-bg-elev-1 p-4">
          <div className="flex items-center gap-3 mb-3">
            <Download className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Export Data</h2>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Download your data in standard formats for backup or analysis.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              className="text-xs gap-1.5 h-7"
              onClick={handleExportWatchlist}
            >
              {exportDone === "watchlist" ? (
                <Check className="h-3 w-3 text-profit" />
              ) : (
                <Download className="h-3 w-3" />
              )}
              Watchlist (JSON)
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs gap-1.5 h-7"
              onClick={handleExportTrades}
              disabled={exportingTrades}
            >
              {exportingTrades ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : exportDone === "trades" ? (
                <Check className="h-3 w-3 text-profit" />
              ) : (
                <Download className="h-3 w-3" />
              )}
              Trade History (CSV)
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs gap-1.5 h-7"
              onClick={handleExportSettings}
            >
              {exportDone === "settings" ? (
                <Check className="h-3 w-3 text-profit" />
              ) : (
                <Download className="h-3 w-3" />
              )}
              Settings (JSON)
            </Button>
          </div>
        </div>

        {/* Security */}
        <div className="rounded-lg border border-border bg-bg-elev-1 p-4">
          <div className="flex items-center gap-3 mb-3">
            <Shield className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Security</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            Sessions expire after 8 hours. JWT tokens are stored in HttpOnly
            cookies with Secure and SameSite flags.
          </p>
        </div>

        {/* Performance Monitoring */}
        <PerformanceMetrics />

        {/* Persona-8 #6: reset-to-defaults. The store always exposed
            `resetAll()`; this button is the missing UI. Confirmation
            dialog prevents accidental clicks from blowing away a
            carefully-tuned setup. */}
        <div className="flex items-center justify-between rounded-lg border border-border bg-bg-elev-1 p-4">
          <div>
            <p className="text-xs font-medium text-foreground">
              Reset preferences
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Restore notifications, display, and data-refresh preferences
              to defaults. Trading mode and watchlist are not affected.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="text-xs gap-1.5 h-7"
            onClick={() => setResetConfirmOpen(true)}
          >
            {resetDone ? (
              <Check className="h-3 w-3 text-profit" />
            ) : (
              <RotateCcw className="h-3 w-3" />
            )}
            Reset to defaults
          </Button>
        </div>
      </div>

      {/* Wave 29 persona-5 #3 + persona-1 #7: honest live-mode confirmation.
          There is no /auth/switch-mode endpoint today, so confirming toasts
          the real state of affairs instead of silently flipping UI state. */}
      <Dialog open={liveConfirmOpen} onOpenChange={setLiveConfirmOpen}>
        <DialogContent className="bg-[var(--surface)] border-border">
          <DialogHeader>
            <DialogTitle>Switch to Live Trading?</DialogTitle>
            <DialogDescription>
              Live trading requires broker API keys configured on the server.
              Contact your admin to provision credentials — this toggle does
              not enable live trading on its own.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setLiveConfirmOpen(false)}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                setLiveConfirmOpen(false);
                toast({
                  type: "warning",
                  message: "Live mode is not enabled on this account. Contact support to unlock live trading.",
                });
              }}
              className="bg-[var(--loss)] hover:bg-[var(--loss)]/90 text-white text-xs"
            >
              Got it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Persona-8 #6: confirm before nuking saved preferences. */}
      <Dialog open={resetConfirmOpen} onOpenChange={setResetConfirmOpen}>
        <DialogContent className="bg-[var(--surface)] border-border">
          <DialogHeader>
            <DialogTitle>Reset preferences to defaults?</DialogTitle>
            <DialogDescription>
              This will restore notifications, display, and data-refresh
              preferences to their factory defaults. Trading mode and your
              watchlist are not affected. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setResetConfirmOpen(false)}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                resetAllPrefs();
                setResetConfirmOpen(false);
                setResetDone(true);
                setTimeout(() => setResetDone(false), 2000);
                toast({
                  type: "success",
                  message: "Preferences reset to defaults.",
                });
              }}
              className="text-xs"
            >
              Reset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardPageLayout>
  );
}
