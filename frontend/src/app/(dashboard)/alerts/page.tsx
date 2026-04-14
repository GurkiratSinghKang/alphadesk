"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Bell,
  Plus,
  Trash2,
  Loader2,
  ArrowUp,
  ArrowDown,
  CheckCircle2,
  Clock,
  AlertTriangle,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  getPriceAlerts,
  createPriceAlert,
  deletePriceAlert,
  type PriceAlert,
} from "@/lib/api";
import { useToast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";

// ─── Helpers ──────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return "--";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── Create Alert Form ──────────────────────────────────────

function CreateAlertForm({ onCreated }: { onCreated: () => void }) {
  const { toast } = useToast();
  const [symbol, setSymbol] = useState("");
  const [price, setPrice] = useState("");
  const [condition, setCondition] = useState<"above" | "below">("above");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const sym = symbol.trim().toUpperCase();
    const p = parseFloat(price);
    if (!sym || isNaN(p) || p <= 0) {
      toast({ type: "error", message: "Enter a valid symbol and price" });
      return;
    }
    setSubmitting(true);
    try {
      await createPriceAlert(sym, p, condition);
      toast({ type: "success", message: `Alert created: ${sym} ${condition} $${p.toFixed(2)}` });
      setSymbol("");
      setPrice("");
      onCreated();
    } catch (err: any) {
      toast({ type: "error", message: err?.message ?? "Failed to create alert" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-border bg-[var(--surface)] p-4">
      <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
        <Plus className="h-4 w-4 text-primary" />
        Create Alert
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <div>
          <label htmlFor="alert-symbol" className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Symbol
          </label>
          <input
            id="alert-symbol"
            type="text"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            placeholder="AAPL"
            className="mt-1 w-full h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground/50"
          />
        </div>
        <div>
          <label htmlFor="alert-condition" className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Condition
          </label>
          <div className="flex gap-1 mt-1">
            <button
              type="button"
              onClick={() => setCondition("above")}
              className={cn(
                "flex-1 rounded-md h-9 text-xs font-medium transition-colors flex items-center justify-center gap-1",
                condition === "above"
                  ? "bg-[var(--profit)]/15 text-[var(--profit)] ring-1 ring-[var(--profit)]/30"
                  : "bg-[var(--panel)] text-muted-foreground hover:text-foreground"
              )}
            >
              <ArrowUp className="h-3 w-3" /> Above
            </button>
            <button
              type="button"
              onClick={() => setCondition("below")}
              className={cn(
                "flex-1 rounded-md h-9 text-xs font-medium transition-colors flex items-center justify-center gap-1",
                condition === "below"
                  ? "bg-[var(--loss)]/15 text-[var(--loss)] ring-1 ring-[var(--loss)]/30"
                  : "bg-[var(--panel)] text-muted-foreground hover:text-foreground"
              )}
            >
              <ArrowDown className="h-3 w-3" /> Below
            </button>
          </div>
        </div>
        <div>
          <label htmlFor="alert-price" className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Target Price
          </label>
          <input
            id="alert-price"
            type="number"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="150.00"
            step={0.01}
            min={0}
            className="mt-1 w-full h-9 rounded-md border border-border bg-background px-3 text-sm tabular-nums text-foreground placeholder:text-muted-foreground/50"
          />
        </div>
        <div className="flex items-end">
          <Button
            type="submit"
            disabled={submitting}
            className="w-full h-9 text-xs font-semibold"
          >
            {submitting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              "Create Alert"
            )}
          </Button>
        </div>
      </div>
    </form>
  );
}

// ─── Alert Row ──────────────────────────────────────────────

function AlertRow({
  alert,
  onDelete,
}: {
  alert: PriceAlert;
  onDelete: (id: string) => void;
}) {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    await onDelete(alert.id);
    setDeleting(false);
  };

  return (
    <div
      className={cn(
        "flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-accent/30",
        alert.triggered && "opacity-60"
      )}
    >
      {/* Status icon */}
      <div className="shrink-0">
        {alert.triggered ? (
          <CheckCircle2 className="h-4 w-4 text-[var(--profit)]" />
        ) : (
          <Clock className="h-4 w-4 text-primary" />
        )}
      </div>

      {/* Symbol */}
      <span className="w-16 shrink-0 font-semibold text-foreground tabular-nums">
        {alert.symbol}
      </span>

      {/* Condition */}
      <span className="w-20 shrink-0">
        <Badge
          variant={alert.condition === "above" ? "default" : "destructive"}
          className="text-[10px] px-1.5"
        >
          {alert.condition === "above" ? (
            <ArrowUp className="h-2.5 w-2.5 mr-0.5" />
          ) : (
            <ArrowDown className="h-2.5 w-2.5 mr-0.5" />
          )}
          {alert.condition}
        </Badge>
      </span>

      {/* Target Price */}
      <span className="w-24 shrink-0 tabular-nums text-foreground">
        ${alert.price.toFixed(2)}
      </span>

      {/* Status */}
      <span className="w-20 shrink-0">
        {alert.triggered ? (
          <span className="text-[var(--profit)] text-xs font-medium">
            Triggered
          </span>
        ) : (
          <span className="text-primary text-xs font-medium">Active</span>
        )}
      </span>

      {/* Created / Triggered date */}
      <span className="flex-1 text-xs text-muted-foreground truncate">
        {alert.triggered && alert.triggered_at
          ? `Triggered ${formatDate(alert.triggered_at)}`
          : `Created ${formatDate(alert.created_at)}`}
      </span>

      {/* Delete */}
      <button
        onClick={handleDelete}
        disabled={deleting}
        className="shrink-0 rounded p-1 text-muted-foreground hover:text-[var(--loss)] hover:bg-[var(--loss)]/10 transition-colors disabled:opacity-50"
        aria-label={`Delete alert for ${alert.symbol}`}
      >
        {deleting ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Trash2 className="h-3.5 w-3.5" />
        )}
      </button>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────

export default function AlertsPage() {
  const { toast } = useToast();
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAlerts = useCallback(async () => {
    try {
      const data = await getPriceAlerts();
      setAlerts(data);
    } catch {
      // API may not be available yet - show empty state
      setAlerts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  const activeAlerts = alerts.filter((a) => !a.triggered);
  const triggeredAlerts = alerts.filter((a) => a.triggered);

  const handleDelete = async (id: string) => {
    try {
      await deletePriceAlert(id);
      setAlerts((prev) => prev.filter((a) => a.id !== id));
      toast({ type: "success", message: "Alert deleted" });
    } catch (err: any) {
      toast({ type: "error", message: err?.message ?? "Failed to delete alert" });
    }
  };

  const handleClearTriggered = async () => {
    const triggered = alerts.filter((a) => a.triggered);
    let failed = 0;
    await Promise.all(
      triggered.map(async (a) => {
        try {
          await deletePriceAlert(a.id);
        } catch {
          failed++;
        }
      })
    );
    if (failed > 0) {
      toast({ type: "error", message: `Failed to delete ${failed} alert(s)` });
    } else {
      toast({ type: "success", message: `Cleared ${triggered.length} triggered alert(s)` });
    }
    fetchAlerts();
  };

  const handleDeleteAll = async () => {
    let failed = 0;
    await Promise.all(
      alerts.map(async (a) => {
        try {
          await deletePriceAlert(a.id);
        } catch {
          failed++;
        }
      })
    );
    if (failed > 0) {
      toast({ type: "error", message: `Failed to delete ${failed} alert(s)` });
    } else {
      toast({ type: "success", message: "All alerts deleted" });
    }
    fetchAlerts();
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
            <Bell className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground">
              Price Alerts
            </h1>
            <p className="text-xs text-muted-foreground">
              {activeAlerts.length} active{" "}
              {triggeredAlerts.length > 0 &&
                `/ ${triggeredAlerts.length} triggered`}
            </p>
          </div>
        </div>

        {alerts.length > 0 && (
          <div className="flex items-center gap-2">
            {triggeredAlerts.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="text-xs h-8"
                onClick={handleClearTriggered}
              >
                Clear Triggered
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-8 text-[var(--loss)] hover:text-[var(--loss)] hover:bg-[var(--loss)]/10"
              onClick={handleDeleteAll}
            >
              <Trash2 className="h-3 w-3 mr-1" />
              Delete All
            </Button>
          </div>
        )}
      </div>

      {/* Create Form */}
      <CreateAlertForm onCreated={fetchAlerts} />

      {/* Loading */}
      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-lg border border-border bg-[var(--panel)] p-4 animate-pulse">
              <div className="flex items-center gap-3">
                <div className="h-4 w-4 rounded-full bg-muted-foreground/20" />
                <div className="h-4 w-16 rounded bg-muted-foreground/20" />
                <div className="h-4 w-20 rounded bg-muted-foreground/20" />
                <div className="h-4 w-24 rounded bg-muted-foreground/20" />
                <div className="flex-1" />
                <div className="h-4 w-32 rounded bg-muted-foreground/20" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Active Alerts */}
      {!loading && (
        <div className="rounded-lg border border-border bg-[var(--surface)] overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-[var(--panel)]/50">
            <Clock className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs font-semibold text-foreground">
              Active Alerts ({activeAlerts.length})
            </span>
          </div>

          {/* Column headers */}
          {activeAlerts.length > 0 && (
            <div className="flex items-center gap-3 px-4 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border/50">
              <span className="w-4 shrink-0" />
              <span className="w-16 shrink-0">Symbol</span>
              <span className="w-20 shrink-0">Condition</span>
              <span className="w-24 shrink-0">Target</span>
              <span className="w-20 shrink-0">Status</span>
              <span className="flex-1">Date</span>
              <span className="w-8 shrink-0" />
            </div>
          )}

          <ScrollArea className="max-h-[400px]">
            {activeAlerts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <AlertTriangle className="h-6 w-6 text-muted-foreground/30 mb-2" />
                <p className="text-sm text-muted-foreground">
                  No active alerts
                </p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  Create one above to get started
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border/50">
                {activeAlerts.map((alert) => (
                  <AlertRow
                    key={alert.id}
                    alert={alert}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      )}

      {/* Triggered History */}
      {!loading && triggeredAlerts.length > 0 && (
        <div className="rounded-lg border border-border bg-[var(--surface)] overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-[var(--panel)]/50">
            <CheckCircle2 className="h-3.5 w-3.5 text-[var(--profit)]" />
            <span className="text-xs font-semibold text-foreground">
              Triggered History ({triggeredAlerts.length})
            </span>
          </div>

          {/* Column headers */}
          <div className="flex items-center gap-3 px-4 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border/50">
            <span className="w-4 shrink-0" />
            <span className="w-16 shrink-0">Symbol</span>
            <span className="w-20 shrink-0">Condition</span>
            <span className="w-24 shrink-0">Target</span>
            <span className="w-20 shrink-0">Status</span>
            <span className="flex-1">Date</span>
            <span className="w-8 shrink-0" />
          </div>

          <ScrollArea className="max-h-[300px]">
            <div className="divide-y divide-border/50">
              {triggeredAlerts.map((alert) => (
                <AlertRow
                  key={alert.id}
                  alert={alert}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
