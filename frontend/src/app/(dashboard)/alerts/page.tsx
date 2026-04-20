"use client";

import { useState, useEffect, useCallback } from "react";
import {
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
import { DashboardPageLayout } from "@/components/layouts";
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

// BUG-042 — alerts validation. Symbol must be 1-6 uppercase letters or
// dots (e.g. AAPL, BRK.B); price must be a finite positive number.
// Weakly-typed validation previously accepted `<script>alert(1)</script>`
// as a "symbol" because it was non-empty, and a negative `-50` price
// fell through to a backend 4xx with a generic "Failed to create" toast.
const ALERT_SYMBOL_REGEX = /^[A-Z.]{1,6}$/;
const ALERT_PRICE_MAX = 1_000_000;

function CreateAlertForm({ onCreated }: { onCreated: () => void }) {
  const { toast } = useToast();
  const [symbol, setSymbol] = useState("");
  const [price, setPrice] = useState("");
  const [condition, setCondition] = useState<"above" | "below">("above");
  const [submitting, setSubmitting] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFieldError(null);
    const rawSym = symbol.trim();
    const sym = rawSym.toUpperCase();
    const p = parseFloat(price);

    // Specific, field-pointing error messages — "required" when the
    // field is empty, otherwise a format hint. Matches audit BUG-042.
    const fail = (msg: string) => {
      toast({ type: "error", message: msg });
      setFieldError(msg);
    };
    if (!rawSym) {
      fail("Symbol is required");
      return;
    }
    if (!ALERT_SYMBOL_REGEX.test(sym)) {
      fail("Symbol must be 1–6 letters (e.g. AAPL, BRK.B)");
      return;
    }
    if (!price.trim()) {
      fail("Price is required");
      return;
    }
    if (!Number.isFinite(p) || p <= 0) {
      fail("Price must be greater than 0");
      return;
    }
    if (p > ALERT_PRICE_MAX) {
      fail(`Price must be ≤ ${ALERT_PRICE_MAX.toLocaleString()}`);
      return;
    }
    setSubmitting(true);
    try {
      await createPriceAlert(sym, p, condition);
      toast({ type: "success", message: `Alert created: ${sym} ${condition} $${(p ?? 0).toFixed(2)}` });
      setSymbol("");
      setPrice("");
      onCreated();
    } catch (err: any) {
      const msg = err?.message ?? "Failed to create alert";
      toast({ type: "error", message: msg });
      setFieldError(msg);
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
            // BUG-042 — cap symbol length + hint the pattern so browsers
            // with pattern-validation UI can preempt bogus input (XSS
            // payloads etc). Runtime regex in handleSubmit is still the
            // source of truth; this is just a UI assist.
            maxLength={6}
            pattern="[A-Za-z.]{1,6}"
            autoCapitalize="characters"
            spellCheck={false}
            aria-invalid={fieldError != null || undefined}
            // Wave 29 mobile a11y: `text-sm` on a native input < 16px
            // triggers iOS Safari's auto-zoom on focus. Use text-base on
            // mobile and drop back to text-sm at md+ where the desk lives.
            // `h-10 md:h-9` keeps the 40px minimum tap target on phones.
            className="mt-1 w-full h-10 md:h-9 rounded-md border border-border bg-background px-3 text-base md:text-sm text-foreground placeholder:text-muted-foreground/50"
          />
        </div>
        <div>
          <label htmlFor="alert-condition" className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Condition
          </label>
          <div
            role="radiogroup"
            aria-label="Alert condition"
            className="flex gap-1 mt-1"
          >
            <button
              type="button"
              role="radio"
              aria-checked={condition === "above"}
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
              role="radio"
              aria-checked={condition === "below"}
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
            // BUG-042 — `min={0}` allowed 0; require strictly positive.
            // `0.01` is the smallest meaningful price on US equities.
            min={0.01}
            max={ALERT_PRICE_MAX}
            aria-invalid={fieldError != null || undefined}
            // Wave 29 mobile a11y: see symbol input above — text-base on
            // mobile prevents iOS focus-zoom; h-10 keeps the 40px tap target.
            className="mt-1 w-full h-10 md:h-9 rounded-md border border-border bg-background px-3 text-base md:text-sm tabular-nums text-foreground placeholder:text-muted-foreground/50"
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
      {/* BUG-042 — inline error under the form so the validation reason
          stays visible even after the toast animates out. */}
      {fieldError && (
        <p
          role="alert"
          data-testid="alert-form-error"
          className="mt-2 text-[11px] text-[var(--loss)]"
        >
          {fieldError}
        </p>
      )}
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
      data-testid="alert-row"
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
        ${(alert.price ?? 0).toFixed(2)}
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
  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false);

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

  const headerActions = alerts.length > 0 ? (
    <>
      <span className="font-sans text-[11px] text-fg-muted">
        {activeAlerts.length} active
        {triggeredAlerts.length > 0 ? ` / ${triggeredAlerts.length} triggered` : ""}
      </span>
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
      <div className="relative">
        <Button
          variant="outline"
          size="sm"
          className="text-xs h-8 text-loss hover:text-loss hover:bg-loss/10"
          onClick={() => setShowDeleteAllConfirm(true)}
        >
          <Trash2 className="h-3 w-3 mr-1" />
          Delete All
        </Button>
        {showDeleteAllConfirm && (
          <div className="absolute right-0 top-full mt-2 z-50 rounded-md border border-border bg-bg-elev-1 p-4 shadow-lg min-w-[240px]">
            <p className="font-sans text-[13px] font-medium text-fg mb-1">Delete all alerts?</p>
            <p className="font-sans text-[11px] text-fg-muted mb-3">
              This will permanently delete {alerts.length} alert{alerts.length !== 1 ? "s" : ""}. This action cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                size="sm"
                className="text-xs h-7"
                onClick={() => setShowDeleteAllConfirm(false)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="text-xs h-7"
                onClick={() => {
                  setShowDeleteAllConfirm(false);
                  handleDeleteAll();
                }}
              >
                Delete All
              </Button>
            </div>
          </div>
        )}
      </div>
    </>
  ) : null;

  return (
    <DashboardPageLayout
      eyebrow="§ ALERTS"
      title="Alerts & triggers"
      actions={headerActions}
    >

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
          {/* Header + column row only shown when there are alerts — the
              centered empty-state block below is enough on its own. */}
          {activeAlerts.length > 0 && (
            <>
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-[var(--panel)]/50">
                <Clock className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-semibold text-foreground">
                  Active Alerts ({activeAlerts.length})
                </span>
              </div>
              <div className="flex items-center gap-3 px-4 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border/50">
                <span className="w-4 shrink-0" />
                <span className="w-16 shrink-0">Symbol</span>
                <span className="w-20 shrink-0">Condition</span>
                <span className="w-24 shrink-0">Target</span>
                <span className="w-20 shrink-0">Status</span>
                <span className="flex-1">Date</span>
                <span className="w-8 shrink-0" />
              </div>
            </>
          )}

          <ScrollArea className="max-h-[400px]">
            {activeAlerts.length === 0 ? (
              // BUG-040 — empty-state voice aligned with analytics /
              // reports: italic-serif sentence headline, sans
              // sentence-case follow-up. Full sentences, full stops.
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <AlertTriangle className="h-6 w-6 text-muted-foreground/30 mb-2" />
                <p className="font-display italic text-[15px] text-fg">
                  You haven&rsquo;t set up any alerts yet.
                </p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  Create one above to start watching a symbol or condition.
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
    </DashboardPageLayout>
  );
}
