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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DashboardPageLayout } from "@/components/layouts";
import { useUIStore } from "@/stores/ui";
import { usePreferencesStore } from "@/stores/preferences";
import { useMarketStore } from "@/stores/market";
import { PerformanceMetrics } from "@/components/dashboard/PerformanceMetrics";
import { getTradeHistory, type TradeHistoryEntry } from "@/lib/api";
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
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors",
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
      </button>
    </div>
  );
}

// ─── Segment Picker ─────────────────────────────────────────

function SegmentPicker<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="py-1.5">
      <p className="text-xs font-medium text-foreground mb-2">{label}</p>
      <div className="flex rounded-lg border border-border overflow-hidden">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={cn(
              "flex-1 px-3 py-1.5 text-[11px] font-medium transition-colors",
              value === opt.value
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-accent/30"
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
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
  const options = [10, 30, 60, 120];
  const labels: Record<number, string> = {
    10: "10s",
    30: "30s",
    60: "1m",
    120: "2m",
  };

  return (
    <div className="py-1.5">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-medium text-foreground">
          Portfolio Refresh Interval
        </p>
        <span className="text-xs font-semibold text-primary tabular-nums">
          {labels[value]}
        </span>
      </div>
      <div className="flex rounded-lg border border-border overflow-hidden">
        {options.map((opt) => (
          <button
            key={opt}
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
        Lower intervals increase API usage. Default is 60s.
      </p>
    </div>
  );
}

// ─── Main Settings Page ─────────────────────────────────────

export default function SettingsPage() {
  const tradingMode = useUIStore((s) => s.tradingMode);
  const setTradingMode = useUIStore((s) => s.setTradingMode);

  const notifications = usePreferencesStore((s) => s.notifications);
  const display = usePreferencesStore((s) => s.display);
  const data = usePreferencesStore((s) => s.data);
  const setNotificationPref = usePreferencesStore(
    (s) => s.setNotificationPref
  );
  const setDisplayPref = usePreferencesStore((s) => s.setDisplayPref);
  const setDataPref = usePreferencesStore((s) => s.setDataPref);

  const watchlist = useMarketStore((s) => s.watchlist);

  const [exportingTrades, setExportingTrades] = useState(false);
  const [exportDone, setExportDone] = useState<string | null>(null);

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
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("alphadesk:api-error", {
              detail: { status: 0, message: "No trade history to export" },
            })
          );
        }
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
              <button
                role="switch"
                aria-checked={tradingMode === "live"}
                aria-label="Trading mode toggle"
                onClick={() =>
                  setTradingMode(tradingMode === "paper" ? "live" : "paper")
                }
                className={cn(
                  "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 transition-colors",
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
            <Toggle
              checked={notifications.strategyEvents}
              onChange={(v) => setNotificationPref("strategyEvents", v)}
              label="Strategy Events"
              description="Notify on strategy activation/pause changes"
            />
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
              description="Use list view by default on the dashboard"
            />
            <SegmentPicker
              value={display.animationSpeed}
              options={[
                { value: "normal" as const, label: "Normal" },
                { value: "reduced" as const, label: "Reduced" },
                { value: "none" as const, label: "None" },
              ]}
              onChange={(v) => setDisplayPref("animationSpeed", v)}
              label="Animation Speed"
            />
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
      </div>
    </DashboardPageLayout>
  );
}
