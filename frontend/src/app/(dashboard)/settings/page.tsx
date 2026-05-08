"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  AlertTriangle,
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
  Trash2,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { DashboardPageLayout } from "@/components/layouts";
import ExitRulesPanel from "@/components/settings/ExitRulesPanel";
// v2 phase 1.5 — additive Appearance section using ControlModule.
// Lives at the top of the page; existing settings panels render
// below unchanged.
import AppearanceSection from "./_v2/AppearanceSection";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import DestructiveConfirmModal from "@/components/destructive/DestructiveConfirmModal";
import { useDestructiveAction } from "@/components/destructive/useDestructiveAction";
import { useUIStore } from "@/stores/ui";
import { usePreferencesStore } from "@/stores/preferences";
import { useMarketStore } from "@/stores/market";
import { PerformanceMetrics } from "@/components/dashboard/PerformanceMetrics";
import {
  approveReconciliationIssue,
  deleteBrokerConnection,
  getBrokerConnections,
  getBrokerProviders,
  getReconciliationIssues,
  getTradeHistory,
  rejectReconciliationIssue,
  runBrokerReconciliation,
  saveBrokerConnection,
  type BrokerConnection,
  type BrokerProvider,
  type BrokerProviderInfo,
  type ReconciliationIssue,
  type TradeHistoryEntry,
} from "@/lib/api";
import { useToast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";
import { handleRadioGroupKeyDown } from "@/lib/radioGroupKeyboard";

type BrokerEnv = "paper" | "live";
type BrokerCredentialField = {
  key: string;
  label: string;
  placeholder: string;
  secret?: boolean;
  optional?: boolean;
};

const BROKER_FORMS: Record<BrokerProvider, {
  label: string;
  envs: BrokerEnv[];
  note: string;
  fields: BrokerCredentialField[];
}> = {
  alpaca: {
    label: "Alpaca",
    envs: ["paper", "live"],
    note: "API key + secret",
    fields: [
      { key: "api_key", label: "API key", placeholder: "PK..." },
      { key: "secret_key", label: "Secret", placeholder: "Secret", secret: true },
    ],
  },
  ibkr: {
    label: "IBKR",
    envs: ["paper", "live"],
    note: "Client Portal Gateway",
    fields: [
      { key: "gateway_url", label: "Gateway URL", placeholder: "https://localhost:5000/v1/api" },
      { key: "account_id", label: "Account", placeholder: "DU123456", optional: true },
    ],
  },
  etrade: {
    label: "E*TRADE",
    envs: ["paper", "live"],
    note: "OAuth 1.0a token set",
    fields: [
      { key: "consumer_key", label: "Consumer key", placeholder: "Key" },
      { key: "consumer_secret", label: "Consumer secret", placeholder: "Secret", secret: true },
      { key: "oauth_token", label: "Access token", placeholder: "OAuth token", secret: true },
      { key: "oauth_token_secret", label: "Token secret", placeholder: "OAuth token secret", secret: true },
      { key: "account_id_key", label: "Account key", placeholder: "Optional", optional: true },
    ],
  },
  schwab: {
    label: "Schwab",
    envs: ["live"],
    note: "OAuth 2.0 refresh token",
    fields: [
      { key: "client_id", label: "Client ID", placeholder: "App key" },
      { key: "client_secret", label: "Client secret", placeholder: "Secret", secret: true },
      { key: "refresh_token", label: "Refresh token", placeholder: "Refresh token", secret: true },
      { key: "redirect_uri", label: "Redirect URI", placeholder: "https://127.0.0.1", optional: true },
    ],
  },
  robinhood: {
    label: "Robinhood",
    envs: [],
    note: "No official options order API available",
    fields: [],
  },
};

function formatIsoShort(iso: string | null): string {
  if (!iso) return "Never";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function brokerErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Request failed";
}

function brokerLabel(provider: BrokerProvider | string): string {
  return BROKER_FORMS[(provider as BrokerProvider)]?.label ?? provider.toUpperCase();
}

function issueTitle(issue: ReconciliationIssue): string {
  if (issue.issue_type === "broker_missing_local") return "Broker order missing locally";
  if (issue.issue_type === "local_missing_broker") return "Local order missing at broker";
  if (issue.issue_type === "status_mismatch") return "Status mismatch";
  return issue.issue_type.replace(/_/g, " ");
}

function actionLabel(issue: ReconciliationIssue): string {
  const action = String(issue.proposed_action?.action ?? "");
  if (action === "insert_trade") return "Add to local trade ledger";
  if (action === "mark_orphaned") return "Mark local trade orphaned";
  if (action === "update_trade_status") {
    return `Update local status to ${String(issue.proposed_action?.status ?? "broker status")}`;
  }
  return "Review proposed update";
}

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
    <div className="flex items-start justify-between gap-3 py-2 sm:items-center sm:gap-4">
      <div className="min-w-0 pr-1">
        <p className="text-label font-medium text-foreground">{label}</p>
        {description && (
          // Per-toggle hint — `t-meta` (13px mono fg-muted) matches the
          // dashboard's "field caption" voice used on settings rows.
          <p className="t-meta mt-0.5 whitespace-normal leading-snug">{description}</p>
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
          "relative -mr-2.5 inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center p-2.5"
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
        <p className="text-label font-medium text-foreground" id="interval-label">
          Portfolio refresh interval
        </p>
        <span className="t-num-md text-primary">
          {labels[value] ?? `${value}s`}
        </span>
      </div>
      <div
        role="radiogroup"
        aria-labelledby="interval-label"
        className="flex rounded-lg border border-border overflow-hidden"
        onKeyDown={handleRadioGroupKeyDown}
      >
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            role="radio"
            aria-checked={value === opt}
            onClick={() => onChange(opt)}
            // `h-10` matches the dashboard's form-input hit-target rule —
            // small pills in a 5-option radiogroup can drift below 30px
            // otherwise, violating WCAG 2.5.5.
            className={cn(
              "flex-1 h-10 px-3 text-label font-medium transition-colors",
              value === opt
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-accent/30"
            )}
          >
            {labels[opt]}
          </button>
        ))}
      </div>
      <p className="t-meta mt-1">
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
  // honestly instead of silently staying on paper. The segmented-control
  // below calls `setLiveConfirmOpen` / `setTradingMode` inline so this
  // helper was removed in the 2026-04 polish pass.
  const [liveConfirmOpen, setLiveConfirmOpen] = useState(false);

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
  const [brokerProvider, setBrokerProvider] = useState<BrokerProvider>("alpaca");
  const [brokerEnv, setBrokerEnv] = useState<BrokerEnv>("paper");
  const [brokerDisplayName, setBrokerDisplayName] = useState("");
  const [brokerCredentials, setBrokerCredentials] = useState<Record<string, string>>({
    gateway_url: "https://localhost:5000/v1/api",
  });
  const [brokerLoading, setBrokerLoading] = useState(true);
  const [brokerSaving, setBrokerSaving] = useState(false);
  const [reconcileRunning, setReconcileRunning] = useState(false);
  const [issueBusyId, setIssueBusyId] = useState<number | null>(null);
  const [connectionBusyId, setConnectionBusyId] = useState<number | null>(null);
  const [brokerConnections, setBrokerConnections] = useState<BrokerConnection[]>([]);
  const [brokerProviders, setBrokerProviders] = useState<BrokerProviderInfo[]>([]);
  const [reconciliationIssues, setReconciliationIssues] = useState<ReconciliationIssue[]>([]);
  const brokerForm = BROKER_FORMS[brokerProvider];
  const hasActiveAlpaca = brokerConnections.some((c) => c.provider === "alpaca" && c.status === "active");

  // R4-5 W-6: replaced the old native browser confirm() with the same
  // destructive-confirmation pattern used by the other six destructive sites
  // in app/. Keeps copy/visual treatment consistent and gives screen readers
  // a real dialog instead of a native alert box.
  const destructive = useDestructiveAction();

  const loadBrokerData = useCallback(async () => {
    setBrokerLoading(true);
    try {
      const [providers, connections, issues] = await Promise.all([
        getBrokerProviders(),
        getBrokerConnections(),
        getReconciliationIssues("open"),
      ]);
      setBrokerProviders(providers);
      setBrokerConnections(connections);
      setReconciliationIssues(issues);
    } catch (err) {
      toast({
        type: "error",
        message: brokerErrorMessage(err),
      });
    } finally {
      setBrokerLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadBrokerData();
  }, [loadBrokerData]);

  useEffect(() => {
    const allowed = BROKER_FORMS[brokerProvider].envs;
    if (allowed.length > 0 && !allowed.includes(brokerEnv)) {
      setBrokerEnv(allowed[0]);
    }
    if (brokerProvider === "ibkr") {
      setBrokerCredentials((current) => ({
        gateway_url: current.gateway_url || "https://localhost:5000/v1/api",
        account_id: current.account_id || "",
      }));
    }
  }, [brokerEnv, brokerProvider]);

  async function handleSaveBrokerConnection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const missing = brokerForm.fields.find((field) => (
      !field.optional && !String(brokerCredentials[field.key] ?? "").trim()
    ));
    if (missing) {
      toast({ type: "warning", message: `${missing.label} is required.` });
      return;
    }
    setBrokerSaving(true);
    try {
      await saveBrokerConnection({
        provider: brokerProvider,
        credentials: brokerCredentials,
        account_env: brokerEnv,
        display_name: brokerDisplayName.trim() || null,
      });
      setBrokerCredentials(brokerProvider === "ibkr" ? { gateway_url: "https://localhost:5000/v1/api" } : {});
      toast({ type: "success", message: "Broker connection verified and saved." });
      await loadBrokerData();
    } catch (err) {
      toast({ type: "error", message: brokerErrorMessage(err) });
    } finally {
      setBrokerSaving(false);
    }
  }

  async function executeDisableConnection(connection: BrokerConnection) {
    setConnectionBusyId(connection.id);
    try {
      await deleteBrokerConnection(connection.id);
      toast({ type: "success", message: "Broker connection disabled." });
      await loadBrokerData();
    } catch (err) {
      toast({ type: "error", message: brokerErrorMessage(err) });
    } finally {
      setConnectionBusyId(null);
    }
  }

  function handleDisableConnection(connection: BrokerConnection) {
    const providerLabel = brokerLabel(connection.provider);
    const last4 = connection.key_last4 ? `ending ${connection.key_last4}` : "(no key fingerprint)";
    destructive.request({
      title: "Disable broker connection",
      description: `${providerLabel} (${connection.account_env}) ${last4}.`,
      consequences: [
        "Stops the periodic reconciler from reading this account.",
        "Existing trades, fills, and history remain in the local ledger.",
        "You can re-enable by re-entering credentials in the form above.",
      ],
      confirmLabel: "Disable connection",
      onConfirm: () => executeDisableConnection(connection),
    });
  }

  async function handleRunReconciliation() {
    setReconcileRunning(true);
    try {
      const counts = await runBrokerReconciliation();
      toast({
        type: counts.backfilled + counts.orphaned > 0 ? "warning" : "success",
        message: `${counts.matched} matched, ${counts.backfilled + counts.orphaned} queued for review.`,
      });
      await loadBrokerData();
    } catch (err) {
      toast({ type: "error", message: brokerErrorMessage(err) });
    } finally {
      setReconcileRunning(false);
    }
  }

  async function handleIssueDecision(issue: ReconciliationIssue, approved: boolean) {
    setIssueBusyId(issue.id);
    try {
      const action = approved ? approveReconciliationIssue : rejectReconciliationIssue;
      await action(issue.id);
      setReconciliationIssues((current) => current.filter((item) => item.id !== issue.id));
      toast({
        type: approved ? "success" : "info",
        message: approved ? "Ledger update approved." : "Reconciliation issue rejected.",
      });
    } catch (err) {
      toast({ type: "error", message: brokerErrorMessage(err) });
    } finally {
      setIssueBusyId(null);
    }
  }

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

      // CSV-injection hardening: Excel/Sheets/Numbers interpret any cell
      // whose first character is `=`, `+`, `-`, `@`, TAB (0x09) or CR
      // (0x0D) as a formula. A user-supplied symbol or strategy name like
      // `=cmd|'/c calc'!A1` would then execute on open. Prefix such values
      // with a single-quote sentinel per OWASP before quote-wrapping so
      // the sentinel lives inside the quoted payload. Mirrors the helper
      // in `reports/page.tsx`.
      const CSV_INJECTION_PREFIXES = ["=", "+", "-", "@", "\t", "\r"];
      const escapeCsv = (val: unknown): string => {
        let str = String(val ?? "");
        if (str.length > 0 && CSV_INJECTION_PREFIXES.includes(str[0])) {
          str = `'${str}`;
        }
        if (str.includes(",") || str.includes('"') || str.includes("\n")) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };

      const csvContent = [
        headers.map(escapeCsv).join(","),
        ...rows.map((row) => row.map(escapeCsv).join(",")),
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
    <>
    <DashboardPageLayout eyebrow="§ SETTINGS" title="Settings">
      <div className="space-y-4">
        {/* v2 phase 1.5 — Appearance section using ControlModule
         * primitive scoped to the user. Density (quiet/dense) +
         * theme. Phase 1.5 follow-up will tab the full settings
         * page (Account · Trading · Risk · Alerts · Data ·
         * Appearance · Shortcuts · Privacy · Danger). */}
        <AppearanceSection />

        {/* PM-5 (audit/2026-05-05-position-management): minimal admin
            CRUD for the configurable exit-rules engine. Backed by
            /api/v1/exit-rules. Sits above Trading Mode because rule
            edits are the most consequential action on this page —
            an enabled 21-DTE rule will close every position one
            Friday before opex. */}
        <ExitRulesPanel />

        {/* Trading Mode */}
        <div className="rounded-lg border border-border bg-bg-elev-1 p-4">
          <div className="flex items-center gap-3 mb-3">
            <Monitor className="h-4 w-4 text-muted-foreground" aria-hidden />
            <h2 className="t-section-display text-foreground">Trading mode</h2>
          </div>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-label text-muted-foreground">
                Switch between paper and live trading environments.
              </p>
              <p className="t-meta text-amber mt-1">
                {tradingMode === "live"
                  ? "Live mode uses real capital. Be cautious."
                  : "Paper mode uses simulated funds. Safe for testing."}
              </p>
            </div>
            {/* BUG (market standard): the previous pill used a red/green
                "switch" whose resting state (green = paper) looked like a
                positive live indicator — ambiguous on first glance. Replaced
                with a two-button segmented control where the ACTIVE side
                wears the gold brand accent (`bg-primary/20 text-primary`). A
                sibling `aria-labelledby="trading-mode-label"` radiogroup
                exposes the same semantics for AT. */}
            <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
              <span
                id="trading-mode-label"
                className="t-label"
              >
                Mode
              </span>
              <div
                role="radiogroup"
                aria-labelledby="trading-mode-label"
                className="flex max-w-full overflow-hidden rounded-md border border-border"
                onKeyDown={handleRadioGroupKeyDown}
              >
                {(["paper", "live"] as const).map((opt) => {
                  const active = tradingMode === opt;
                  return (
                    <button
                      key={opt}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => {
                        if (opt === "live" && tradingMode !== "live") {
                          setLiveConfirmOpen(true);
                        } else if (opt === "paper" && tradingMode !== "paper") {
                          setTradingMode("paper");
                        }
                      }}
                      className={cn(
                        // WCAG 2.5.5: ≥44x44 tap target on each option.
                        // Both sides keep the same geometry so the active
                        // pill is signalled by colour alone — the gold
                        // accent on the selected side is unmistakable;
                        // live carries a loss-red accent to keep the
                        // cost-of-being-wrong legible at a glance.
                        "min-h-11 min-w-[88px] px-4 font-sans text-label font-semibold uppercase tracking-wider transition-colors",
                        active
                          ? opt === "live"
                            ? "bg-loss/15 text-loss"
                            : "bg-primary/20 text-primary"
                          : "text-muted-foreground hover:text-foreground hover:bg-accent/30"
                      )}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Brokerage */}
        <div className="rounded-lg border border-border bg-bg-elev-1 p-4">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <Key className="h-4 w-4 text-muted-foreground" aria-hidden />
              <h2 className="t-section-display text-foreground">Brokerage</h2>
              <Badge
                variant={brokerConnections.some((c) => c.status === "active") ? "active" : "idle"}
                withDot
              >
                {brokerConnections.some((c) => c.status === "active") ? "Connected" : "Not connected"}
              </Badge>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-10 text-label"
              onClick={() => void loadBrokerData()}
              disabled={brokerLoading}
            >
              {brokerLoading ? (
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="h-3 w-3" aria-hidden />
              )}
              Refresh
            </Button>
          </div>

          <form onSubmit={handleSaveBrokerConnection} className="space-y-3">
            <div className="grid gap-3 lg:grid-cols-[minmax(160px,0.8fr)_minmax(180px,1fr)_1fr] lg:items-end">
              <div>
                <span className="t-label mb-1 block">Broker</span>
                <div
                  role="radiogroup"
                  aria-label="Broker provider"
                  className="grid grid-cols-2 overflow-hidden rounded-sm border border-border sm:flex"
                  onKeyDown={handleRadioGroupKeyDown}
                >
                  {(Object.keys(BROKER_FORMS) as BrokerProvider[]).map((provider) => (
                    <button
                      key={provider}
                      type="button"
                      role="radio"
                      aria-checked={brokerProvider === provider}
                      onClick={() => setBrokerProvider(provider)}
                      className={cn(
                        "min-h-9 px-3 text-label font-semibold uppercase transition-colors",
                        brokerProvider === provider
                          ? "bg-primary/20 text-primary"
                          : "text-muted-foreground hover:bg-accent/30 hover:text-foreground",
                      )}
                    >
                      {BROKER_FORMS[provider].label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="t-label mb-1 block" htmlFor="broker-display-name">
                  Label
                </label>
                <Input
                  id="broker-display-name"
                  value={brokerDisplayName}
                  onChange={(e) => setBrokerDisplayName(e.target.value)}
                  placeholder="Main paper"
                  className="font-sans"
                  maxLength={160}
                />
              </div>

              <div>
                <span className="t-label mb-1 block">Environment</span>
                <div
                  role="radiogroup"
                  aria-label="Broker environment"
                  className="flex h-9 overflow-hidden rounded-sm border border-border"
                  onKeyDown={handleRadioGroupKeyDown}
                >
                  {brokerForm.envs.map((env) => (
                    <button
                      key={env}
                      type="button"
                      role="radio"
                      aria-checked={brokerEnv === env}
                      onClick={() => setBrokerEnv(env)}
                      className={cn(
                        "flex-1 px-3 text-label font-semibold uppercase transition-colors",
                        brokerEnv === env
                          ? env === "live"
                            ? "bg-loss/15 text-loss"
                            : "bg-primary/20 text-primary"
                          : "text-muted-foreground hover:bg-accent/30 hover:text-foreground",
                      )}
                    >
                      {env}
                    </button>
                  ))}
                  {brokerForm.envs.length === 0 && (
                    <span className="flex flex-1 items-center justify-center px-3 text-label font-semibold uppercase text-muted-foreground">
                      unavailable
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[repeat(5,minmax(150px,1fr))_auto] xl:items-end">
              {brokerForm.fields.map((field) => (
                <div key={field.key}>
                  <label className="t-label mb-1 block" htmlFor={`broker-${field.key}`}>
                    {field.label}
                  </label>
                  <Input
                    id={`broker-${field.key}`}
                    type={field.secret ? "password" : "text"}
                    value={brokerCredentials[field.key] ?? ""}
                    onChange={(e) => setBrokerCredentials((current) => ({
                      ...current,
                      [field.key]: e.target.value,
                    }))}
                    placeholder={field.placeholder}
                    autoComplete="off"
                    spellCheck={false}
                    className={field.key === "gateway_url" || field.key === "redirect_uri" ? "font-sans" : undefined}
                  />
                </div>
              ))}
              <Button
                type="submit"
                className="h-10 text-label"
                disabled={brokerSaving || brokerForm.fields.length === 0}
                aria-busy={brokerSaving}
              >
                {brokerSaving ? (
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                ) : (
                  <Check className="h-3 w-3" aria-hidden />
                )}
                Verify & save
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="idle">{brokerForm.note}</Badge>
              {brokerProvider !== "alpaca" && (
                <Badge variant="paused">connection vault only</Badge>
              )}
              {brokerProviders.find((provider) => provider.provider === brokerProvider)?.trading_enabled && (
                <Badge variant="active">order routing</Badge>
              )}
            </div>
          </form>

          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <div className="rounded-md border border-border bg-bg-elev-2/35 p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-label font-medium text-foreground">Saved connections</p>
                {brokerLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden />}
              </div>
              {brokerConnections.length === 0 ? (
                <p className="t-meta">No saved brokerage connection.</p>
              ) : (
                <div className="space-y-2">
                  {brokerConnections.map((connection) => (
                    <div
                      key={connection.id}
                      className="flex items-center justify-between gap-3 rounded-sm border border-border bg-bg-elev-1 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-eyebrow font-semibold uppercase text-foreground">
                            {brokerLabel(connection.provider)} {connection.account_env}
                          </p>
                          <Badge
                            variant={connection.status === "active" ? "active" : "disabled"}
                            withDot
                          >
                            {connection.status}
                          </Badge>
                          {connection.metadata?.trading_enabled !== true && (
                            <Badge variant="paused">vault</Badge>
                          )}
                        </div>
                        <p className="t-meta mt-1">
                          {connection.display_name || "Unnamed"} · id ending {connection.key_last4 ?? "----"}
                        </p>
                        <p className="t-meta">
                          Verified {formatIsoShort(connection.verified_at)} · synced {formatIsoShort(connection.last_sync_at)}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Disable broker connection"
                        onClick={() => void handleDisableConnection(connection)}
                        disabled={connectionBusyId === connection.id}
                      >
                        {connectionBusyId === connection.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                        ) : (
                          <Trash2 className="h-4 w-4" aria-hidden />
                        )}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-md border border-border bg-bg-elev-2/35 p-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-label font-medium text-foreground">Reconciliation review</p>
                  <p className="t-meta mt-0.5">
                    {reconciliationIssues.length} open {reconciliationIssues.length === 1 ? "issue" : "issues"}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-10 text-label"
                  onClick={() => void handleRunReconciliation()}
                  disabled={reconcileRunning || !hasActiveAlpaca}
                  aria-busy={reconcileRunning}
                >
                  {reconcileRunning ? (
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                  ) : (
                    <RefreshCw className="h-3 w-3" aria-hidden />
                  )}
                  Reconcile now
                </Button>
              </div>

              {reconciliationIssues.length === 0 ? (
                <p className="t-meta">No broker drift waiting for review.</p>
              ) : (
                <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
                  {reconciliationIssues.map((issue) => (
                    <div
                      key={issue.id}
                      className="rounded-sm border border-amber/30 bg-amber/5 p-3"
                    >
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber" aria-hidden />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-label font-semibold text-foreground">
                              {issueTitle(issue)}
                            </p>
                            {issue.symbol && (
                              <span className="t-num-md text-primary">{issue.symbol}</span>
                            )}
                          </div>
                          <p className="t-meta mt-1">
                            {actionLabel(issue)} · detected {formatIsoShort(issue.detected_at)}
                          </p>
                          <p className="t-meta break-all">
                            Order {issue.client_order_id ?? issue.broker_order_id ?? "unknown"}
                          </p>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-9 text-label"
                          onClick={() => void handleIssueDecision(issue, false)}
                          disabled={issueBusyId === issue.id}
                        >
                          <XCircle className="h-3 w-3" aria-hidden />
                          Reject
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          className="h-9 text-label"
                          onClick={() => void handleIssueDecision(issue, true)}
                          disabled={issueBusyId === issue.id}
                        >
                          {issueBusyId === issue.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                          ) : (
                            <Check className="h-3 w-3" aria-hidden />
                          )}
                          Approve
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Notifications */}
        <div className="rounded-lg border border-border bg-bg-elev-1 p-4">
          <div className="flex items-center gap-3 mb-3">
            <Bell className="h-4 w-4 text-muted-foreground" aria-hidden />
            <h2 className="t-section-display text-foreground">Notifications</h2>
          </div>
          <div className="space-y-1">
            <Toggle
              checked={notifications.orderFills}
              onChange={(v) => setNotificationPref("orderFills", v)}
              label="Order fills"
              description="Get notified when orders are filled"
            />
            <Toggle
              checked={notifications.alertsTriggered}
              onChange={(v) => setNotificationPref("alertsTriggered", v)}
              label="Alerts triggered"
              description="Notify when price alerts hit their target"
            />
            <Toggle
              checked={notifications.pipelineCompleted}
              onChange={(v) => setNotificationPref("pipelineCompleted", v)}
              label="Pipeline completed"
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
            <Palette className="h-4 w-4 text-muted-foreground" aria-hidden />
            <h2 className="t-section-display text-foreground">Display</h2>
          </div>
          <div className="space-y-1">
            <Toggle
              checked={display.compactStrategyView}
              onChange={(v) => setDisplayPref("compactStrategyView", v)}
              label="Compact strategy view"
              description="Single-line rows in the strategy rail. Hides subtitles, packs more strategies into the same vertical space."
            />
            {/* Persona-8 #2: "Animation Speed" picker removed — there's no
                single global animation-speed knob that cleanly controls
                lightweight-charts, the marquee, the pulse dots, etc. The
                rest of the app honours `prefers-reduced-motion` instead.
                Honest move: don't ship a setting we can't back. */}
            <div className="flex flex-col gap-3 py-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-label font-medium text-foreground">Theme</p>
                <p className="t-meta mt-0.5">
                  Choose dark, light, or follow your OS preference.
                </p>
              </div>
              <div
                role="radiogroup"
                aria-label="Theme preference"
                className="flex max-w-full overflow-hidden rounded-md border border-border"
                onKeyDown={handleRadioGroupKeyDown}
              >
                {(["system", "dark", "light"] as const).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    role="radio"
                    aria-checked={display.theme === opt}
                    onClick={() => setDisplayPref("theme", opt)}
                    className={cn(
                      "min-h-11 px-4 text-label font-medium capitalize transition-colors",
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
            <RefreshCw className="h-4 w-4 text-muted-foreground" aria-hidden />
            <h2 className="t-section-display text-foreground">Data refresh</h2>
          </div>
          <IntervalSlider
            value={data.refreshInterval}
            onChange={(v) => setDataPref("refreshInterval", v)}
          />
        </div>

        {/* Export */}
        <div className="rounded-lg border border-border bg-bg-elev-1 p-4">
          <div className="flex items-center gap-3 mb-3">
            <Download className="h-4 w-4 text-muted-foreground" aria-hidden />
            <h2 className="t-section-display text-foreground">Export data</h2>
          </div>
          <p className="text-label text-muted-foreground mb-3">
            Download your data in standard formats for backup or analysis.
          </p>
          {/* Market-standard hit-target: `h-10` (40px) aligns with the
              frontend typography contract's form-input rule. */}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              className="text-label gap-1.5 h-10"
              onClick={handleExportWatchlist}
            >
              {exportDone === "watchlist" ? (
                <Check className="h-3 w-3 text-profit" aria-hidden />
              ) : (
                <Download className="h-3 w-3" aria-hidden />
              )}
              Watchlist (JSON)
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-label gap-1.5 h-10"
              onClick={handleExportTrades}
              disabled={exportingTrades}
            >
              {exportingTrades ? (
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              ) : exportDone === "trades" ? (
                <Check className="h-3 w-3 text-profit" aria-hidden />
              ) : (
                <Download className="h-3 w-3" aria-hidden />
              )}
              Trade history (CSV)
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-label gap-1.5 h-10"
              onClick={handleExportSettings}
            >
              {exportDone === "settings" ? (
                <Check className="h-3 w-3 text-profit" aria-hidden />
              ) : (
                <Download className="h-3 w-3" aria-hidden />
              )}
              Settings (JSON)
            </Button>
          </div>
        </div>

        {/* Security */}
        <div className="rounded-lg border border-border bg-bg-elev-1 p-4">
          <div className="flex items-center gap-3 mb-3">
            <Shield className="h-4 w-4 text-muted-foreground" aria-hidden />
            <h2 className="t-section-display text-foreground">Security</h2>
          </div>
          <p className="text-label text-muted-foreground">
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
        <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-bg-elev-1 p-4">
          <div>
            <p className="text-label font-medium text-foreground">
              Reset preferences
            </p>
            <p className="t-meta mt-0.5">
              Restore notifications, display, and data-refresh preferences
              to defaults. Trading mode and watchlist are not affected.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="text-label gap-1.5 h-10"
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
        <DialogContent className="bg-[var(--bg-card)] border-border">
          <DialogHeader>
            <DialogTitle>Live trading requires admin enablement</DialogTitle>
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
              className="text-label"
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
              className="bg-[var(--loss)] hover:bg-[var(--loss)]/90 text-white text-label"
            >
              Understood
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Persona-8 #6: confirm before nuking saved preferences. */}
      <Dialog open={resetConfirmOpen} onOpenChange={setResetConfirmOpen}>
        <DialogContent className="bg-[var(--bg-card)] border-border">
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
              className="text-label"
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
              className="text-label"
            >
              Reset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardPageLayout>
    {destructive.pending && (
      <DestructiveConfirmModal
        open={true}
        onOpenChange={(open) => !open && destructive.dismiss()}
        loading={destructive.loading}
        title={destructive.pending.title}
        description={destructive.pending.description}
        consequences={destructive.pending.consequences}
        confirmLabel={destructive.pending.confirmLabel}
        onConfirm={destructive.fire}
      />
    )}
    </>
  );
}
