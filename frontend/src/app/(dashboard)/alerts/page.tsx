"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Plus,
  Trash2,
  Loader2,
  ArrowUp,
  ArrowDown,
  CheckCircle2,
  Clock,
  ChevronDown,
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
import { fmtPlural } from "@/lib/intl";
import EmptyState from "@/components/primitives/EmptyState";

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
//
// Round-5 F-7: the regex now accepts either bare equity tickers OR full
// 21-char OCC option symbols (e.g. NVDA260424P00200000) so users can
// alert on a specific contract. The alternation prevents the malicious
// payload `<script>…` from passing because none of the branches accept
// `<` or `>`.
const ALERT_SYMBOL_REGEX = /^(?:[A-Z][A-Z0-9.\-]{0,9}|[A-Z]{1,6}\d{6}[CP]\d{8})$/;
const ALERT_PRICE_MAX = 1_000_000;

type AlertConditionUI =
  | "above"
  | "below"
  | "percent_move_above"
  | "percent_move_below";

type AlertReferenceUI = "static" | "prev_close" | "session_open";
type AlertScopeUI = "symbol" | "watchlist" | "strategy";

function createOptimisticAlert(
  value: unknown,
  fallback: {
    condition: AlertConditionUI;
    price: number;
    reference?: AlertReferenceUI;
    reference_price?: number;
    symbol: string;
  },
): PriceAlert {
  const candidate = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Partial<PriceAlert>)
    : null;
  return {
    id:
      typeof candidate?.id === "string" && candidate.id
        ? candidate.id
        : typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `local-${Date.now()}`,
    symbol: typeof candidate?.symbol === "string" && candidate.symbol ? candidate.symbol : fallback.symbol,
    price: Number.isFinite(Number(candidate?.price)) ? Number(candidate?.price) : fallback.price,
    condition: candidate?.condition ?? fallback.condition,
    triggered: candidate?.triggered === true,
    triggered_at: candidate?.triggered_at ?? null,
    created_at: candidate?.created_at ?? new Date().toISOString(),
    reference: candidate?.reference ?? fallback.reference ?? null,
    reference_price: candidate?.reference_price ?? fallback.reference_price ?? null,
    position_id: candidate?.position_id ?? null,
    expires_at: candidate?.expires_at ?? null,
  };
}

function CreateAlertForm({ onCreated }: { onCreated: (alert: PriceAlert) => void }) {
  const { toast } = useToast();
  const [symbol, setSymbol] = useState("");
  const [price, setPrice] = useState("");
  const [condition, setCondition] = useState<AlertConditionUI>("above");
  const [reference, setReference] = useState<AlertReferenceUI>("static");
  const [scope, setScope] = useState<AlertScopeUI>("symbol");
  const [secondaryEnabled, setSecondaryEnabled] = useState(false);
  const [secondaryCondition, setSecondaryCondition] = useState<AlertConditionUI>("below");
  const [secondaryValue, setSecondaryValue] = useState("");
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [webhookEnabled, setWebhookEnabled] = useState(false);
  const [referencePrice, setReferencePrice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const isPercentMove =
    condition === "percent_move_above" || condition === "percent_move_below";
  const normalizedSymbol = symbol.trim().toUpperCase() || "SYMBOL";
  const primaryPreview = isPercentMove
    ? `${normalizedSymbol} moves ${condition.endsWith("above") ? "above" : "below"} ${price || "threshold"}% vs ${reference.replace("_", " ")}`
    : `${normalizedSymbol} trades ${condition} ${price ? `$${price}` : "target price"}`;
  const secondaryPreview = secondaryEnabled
    ? ` and ${secondaryCondition.replace("percent_move_", "").replace("_", " ")} ${secondaryValue || "secondary threshold"}`
    : "";
  const scopePreview =
    scope === "watchlist"
      ? " across the active watchlist"
      : scope === "strategy"
        ? " for strategy-linked symbols"
        : "";
  const channelPreview = [
    "in-app",
    emailEnabled ? "email" : null,
    webhookEnabled ? "webhook draft" : null,
  ].filter(Boolean).join(", ");

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
      fail("Symbol must be a ticker (e.g. AAPL, BRK.B) or full OCC contract");
      return;
    }
    if (!price.trim()) {
      fail(isPercentMove ? "Percent threshold is required" : "Price is required");
      return;
    }
    if (!Number.isFinite(p) || p <= 0) {
      fail(isPercentMove ? "Percent threshold must be greater than 0" : "Price must be greater than 0");
      return;
    }
    if (p > ALERT_PRICE_MAX) {
      fail(`Value must be ≤ ${ALERT_PRICE_MAX.toLocaleString()}`);
      return;
    }
    // Round-5 F-7 — when reference=static and condition is percent-move,
    // the reference_price is required so the backend knows the anchor.
    let staticRefPrice: number | undefined;
    if (isPercentMove && reference === "static") {
      const rp = parseFloat(referencePrice);
      if (!referencePrice.trim() || !Number.isFinite(rp) || rp <= 0) {
        fail("Reference price is required for static percent-move alerts");
        return;
      }
      staticRefPrice = rp;
    }
    setSubmitting(true);
    try {
      const created = await createPriceAlert(sym, p, condition, {
        reference: isPercentMove ? reference : undefined,
        reference_price: staticRefPrice,
      });
      const nextAlert = createOptimisticAlert(created, {
        condition,
        price: p,
        reference: isPercentMove ? reference : undefined,
        reference_price: staticRefPrice,
        symbol: sym,
      });
      const successMsg = isPercentMove
        ? `Alert created: ${sym} ${condition.replace("percent_move_", "")} ${p.toFixed(2)}% vs ${reference}`
        : `Alert created: ${sym} ${condition} $${(p ?? 0).toFixed(2)}`;
      toast({ type: "success", message: successMsg });
      setSymbol("");
      setPrice("");
      setReferencePrice("");
      onCreated(nextAlert);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create alert";
      toast({ type: "error", message: msg });
      setFieldError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-border bg-[var(--bg-card)] p-4">
      <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
        <Plus className="h-4 w-4 text-primary" />
        Create Alert
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <div>
          <label htmlFor="alert-symbol" className="text-label uppercase tracking-wider text-muted-foreground">
            Symbol
          </label>
          <input
            id="alert-symbol"
            type="text"
            value={symbol}
            onChange={(e) => { setSymbol(e.target.value); if (fieldError) setFieldError(null); }}
            placeholder="AAPL or NVDA260424P00200000"
            // Round-5 F-7: cap at 21 chars (full OCC option contract
            // length) so the UI no longer truncates a pasted OCC. The
            // regex still rejects `<script>…` payloads — every branch
            // of the alternation requires uppercase letters/digits only.
            maxLength={21}
            pattern="[A-Za-z0-9.\-]{1,21}"
            autoCapitalize="characters"
            spellCheck={false}
            aria-invalid={fieldError != null || undefined}
            // Wave 29 mobile a11y: `text-sm` on a native input < 16px
            // triggers iOS Safari's auto-zoom on focus. Use text-base on
            // mobile and drop back to text-sm at md+ where the desk lives.
            // `h-10 md:h-9` keeps the 40px minimum tap target on phones.
            className="mt-1 w-full h-10 md:h-9 rounded-md border border-border bg-background px-3 text-base md:text-sm font-mono text-foreground placeholder:text-muted-foreground"
          />
        </div>
        <div>
          <label htmlFor="alert-condition-select" className="text-label uppercase tracking-wider text-muted-foreground">
            Condition
          </label>
          {/* Round-5 F-7: replaced the binary radio with a 4-option
              <select> so the form supports percent-move conditions
              without doubling its width. The two legacy options keep
              their existing values; the two new ones default `reference`
              to `static` so the user has to consciously opt into a
              market-data-anchored alert. */}
          <select
            id="alert-condition-select"
            value={condition}
            onChange={(e) => setCondition(e.target.value as AlertConditionUI)}
            aria-label="Alert condition"
            className="mt-1 w-full h-10 md:h-9 rounded-md border border-border bg-background px-3 text-base md:text-sm text-foreground"
          >
            <option value="above">Above ($)</option>
            <option value="below">Below ($)</option>
            <option value="percent_move_above">Percent move above</option>
            <option value="percent_move_below">Percent move below</option>
          </select>
        </div>
        <div>
          <label htmlFor="alert-price" className="text-label uppercase tracking-wider text-muted-foreground">
            {isPercentMove ? "Threshold (%)" : "Target Price"}
          </label>
          <input
            id="alert-price"
            type="number"
            value={price}
            onChange={(e) => { setPrice(e.target.value); if (fieldError) setFieldError(null); }}
            placeholder={isPercentMove ? "5.0" : "150.00"}
            step={0.01}
            // BUG-042 — `min={0}` allowed 0; require strictly positive.
            // `0.01` is the smallest meaningful price on US equities.
            min={0.01}
            max={ALERT_PRICE_MAX}
            aria-invalid={fieldError != null || undefined}
            // Wave 29 mobile a11y: see symbol input above — text-base on
            // mobile prevents iOS focus-zoom; h-10 keeps the 40px tap target.
            className="mt-1 w-full h-10 md:h-9 rounded-md border border-border bg-background px-3 text-base md:text-sm tabular-nums text-foreground placeholder:text-muted-foreground"
          />
        </div>
        <div className="flex items-end">
          <Button
            type="submit"
            disabled={submitting}
            className="w-full h-11 md:h-9 text-label font-semibold"
          >
            {submitting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              "Create Alert"
            )}
          </Button>
        </div>
      </div>
      {/* Round-5 F-7: reference picker only matters for percent-move
          alerts. Hidden when the condition is the legacy absolute-price
          form so existing users don't see new fields appear. */}
      {isPercentMove && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
          <div>
            <label htmlFor="alert-reference" className="text-label uppercase tracking-wider text-muted-foreground">
              Reference
            </label>
            <select
              id="alert-reference"
              value={reference}
              onChange={(e) => setReference(e.target.value as AlertReferenceUI)}
              className="mt-1 w-full h-10 md:h-9 rounded-md border border-border bg-background px-3 text-base md:text-sm text-foreground"
            >
              <option value="static">Static (you supply)</option>
              <option value="prev_close">Previous close</option>
              <option value="session_open">Session open</option>
            </select>
          </div>
          {reference === "static" && (
            <div>
              <label htmlFor="alert-reference-price" className="text-label uppercase tracking-wider text-muted-foreground">
                Reference Price ($)
              </label>
              <input
                id="alert-reference-price"
                type="number"
                value={referencePrice}
                onChange={(e) => { setReferencePrice(e.target.value); if (fieldError) setFieldError(null); }}
                placeholder="150.00"
                step={0.01}
                min={0.01}
                max={ALERT_PRICE_MAX}
                className="mt-1 w-full h-10 md:h-9 rounded-md border border-border bg-background px-3 text-base md:text-sm tabular-nums text-foreground placeholder:text-muted-foreground"
              />
            </div>
          )}
        </div>
      )}
      <div className="mt-3 grid gap-3 rounded-md border border-border-hair bg-bg px-3 py-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="grid gap-3">
          <label className="grid gap-1.5">
            <span className="text-label uppercase tracking-wider text-muted-foreground">Alert scope</span>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as AlertScopeUI)}
              className="h-10 rounded-md border border-border bg-background px-3 text-base text-foreground md:h-9 md:text-sm"
            >
              <option value="symbol">Single symbol</option>
              <option value="watchlist">Watchlist rule</option>
              <option value="strategy">Strategy-linked rule</option>
            </select>
          </label>
          <label className="flex min-h-11 items-start gap-2 rounded-sm border border-border-hair bg-bg-elev-1 px-3 py-2">
            <input
              type="checkbox"
              checked={secondaryEnabled}
              onChange={(e) => setSecondaryEnabled(e.target.checked)}
              className="mt-1 size-4 accent-brand"
            />
            <span>
              <span className="block text-body-sm font-semibold text-fg">Add second condition</span>
              <span className="block text-label leading-snug text-fg-muted">Use this for price plus percent-move, watchlist, or strategy confirmation rules.</span>
            </span>
          </label>
          {secondaryEnabled ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <select
                value={secondaryCondition}
                onChange={(e) => setSecondaryCondition(e.target.value as AlertConditionUI)}
                aria-label="Second alert condition"
                className="h-10 rounded-md border border-border bg-background px-3 text-base text-foreground md:h-9 md:text-sm"
              >
                <option value="above">Above ($)</option>
                <option value="below">Below ($)</option>
                <option value="percent_move_above">Percent move above</option>
                <option value="percent_move_below">Percent move below</option>
              </select>
              <input
                value={secondaryValue}
                onChange={(e) => setSecondaryValue(e.target.value)}
                inputMode="decimal"
                aria-label="Second alert threshold"
                placeholder="Second threshold"
                className="h-10 rounded-md border border-border bg-background px-3 text-base text-foreground placeholder:text-muted-foreground md:h-9 md:text-sm"
              />
            </div>
          ) : null}
        </div>
        <div className="rounded-md border border-border-hair bg-bg-elev-1 px-3 py-3">
          <p className="text-label uppercase tracking-wider text-muted-foreground">Trigger preview</p>
          <p className="mt-2 text-body-sm leading-relaxed text-fg">
            This triggers when {primaryPreview}{secondaryPreview}{scopePreview}.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <label className="flex min-h-10 items-center gap-2 rounded-sm border border-profit/25 bg-profit/10 px-3 text-label font-semibold text-profit">
              <input type="checkbox" checked readOnly className="size-4 accent-brand" />
              In-app
            </label>
            <label className="flex min-h-10 items-center gap-2 rounded-sm border border-border-hair bg-bg px-3 text-label font-semibold text-fg-muted">
              <input
                type="checkbox"
                checked={emailEnabled}
                onChange={(e) => setEmailEnabled(e.target.checked)}
                className="size-4 accent-brand"
              />
              Email
            </label>
            <label className="flex min-h-10 items-center gap-2 rounded-sm border border-border-hair bg-bg px-3 text-label font-semibold text-fg-muted">
              <input
                type="checkbox"
                checked={webhookEnabled}
                onChange={(e) => setWebhookEnabled(e.target.checked)}
                className="size-4 accent-brand"
              />
              Webhook
            </label>
          </div>
          <p className="mt-2 text-label leading-snug text-fg-muted">
            Delivery: {channelPreview}. Email and webhook routing are staged as explicit preferences until backend delivery channels are enabled.
          </p>
        </div>
      </div>
      {/* BUG-042 — inline error under the form so the validation reason
          stays visible even after the toast animates out. */}
      {fieldError && (
        <p
          role="alert"
          data-testid="alert-form-error"
          className="mt-2 text-label text-[var(--loss)]"
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
  // Two-tap delete confirmation — `confirmArmed` flips to true on the
  // first click; the button re-labels to "Confirm?" and a second click
  // (or Enter) within the 4s window actually deletes. A stray tap on
  // the small 14px trash icon previously wiped a row with no recovery.
  // ToS / TradingView / Webull all gate delete actions this way.
  const [confirmArmed, setConfirmArmed] = useState(false);
  const disarmTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (disarmTimer.current) window.clearTimeout(disarmTimer.current);
    };
  }, []);

  const arm = () => {
    setConfirmArmed(true);
    if (disarmTimer.current) window.clearTimeout(disarmTimer.current);
    disarmTimer.current = window.setTimeout(() => setConfirmArmed(false), 4000);
  };

  const handleDeleteClick = async () => {
    if (!confirmArmed) {
      arm();
      return;
    }
    if (disarmTimer.current) window.clearTimeout(disarmTimer.current);
    setDeleting(true);
    await onDelete(alert.id);
    // Row unmounts on success; on failure we re-enable so the user can retry.
    setDeleting(false);
    setConfirmArmed(false);
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

      {/* Symbol — mono (alphabetic, not numeric) so tickers stay aligned
          in the column without the tabular-nums misapplication. OCC
          contracts are 21 chars, so we widen the column for those. */}
      <span
        className={cn(
          "shrink-0 font-mono font-semibold text-foreground",
          alert.symbol.length > 8 ? "w-44 text-label" : "w-16",
        )}
      >
        {alert.symbol}
      </span>

      {/* Condition — Round-5 F-7: handles all four condition values. */}
      <span className="w-32 shrink-0">
        <Badge
          variant={
            alert.condition === "above" || alert.condition === "percent_move_above"
              ? "default"
              : "destructive"
          }
          className="text-label px-1.5"
        >
          {alert.condition === "above" || alert.condition === "percent_move_above" ? (
            <ArrowUp className="h-2.5 w-2.5 mr-0.5" />
          ) : (
            <ArrowDown className="h-2.5 w-2.5 mr-0.5" />
          )}
          {alert.condition.replace("percent_move_", "")}
          {alert.condition.startsWith("percent_move") && " %"}
        </Badge>
      </span>

      {/* Target Price — t-num-md token so prices sit in the 16px mono
          tabular row the rest of the polished pages use. Percent-move
          alerts render the threshold as a percentage. */}
      <span className="w-24 shrink-0 t-num-md text-foreground">
        {alert.condition.startsWith("percent_move")
          ? `${(alert.price ?? 0).toFixed(2)}%`
          : `$${(alert.price ?? 0).toFixed(2)}`}
      </span>

      {/* Status */}
      <span className="w-20 shrink-0">
        {alert.triggered ? (
          <span className="text-[var(--profit)] text-label font-medium">
            Triggered
          </span>
        ) : (
          <span className="text-primary text-label font-medium">Active</span>
        )}
      </span>

      {/* Created / Triggered date — t-meta for the 13px mono muted
          timestamp style that matches dashboard/analytics rows. */}
      <span className="flex-1 t-meta truncate">
        {alert.triggered && alert.triggered_at
          ? `Triggered ${formatDate(alert.triggered_at)}`
          : `Created ${formatDate(alert.created_at)}`}
      </span>

      {/* Delete — two-tap confirmation. h-9 / 36px hit target (was 22px,
          below the 36px floor) so the button is comfortable on touch
          and doesn't get fat-fingered. Arms on first click; commits on
          the second within 4s. */}
      <button
        onClick={handleDeleteClick}
        disabled={deleting}
        className={cn(
          "shrink-0 rounded transition-colors disabled:opacity-50 inline-flex items-center justify-center",
          "h-9 px-2 gap-1",
          confirmArmed
            ? "bg-[var(--loss)]/15 text-[var(--loss)] ring-1 ring-[var(--loss)]/40 text-label font-semibold"
            : "text-muted-foreground hover:text-[var(--loss)] hover:bg-[var(--loss)]/10 w-9"
        )}
        aria-label={
          confirmArmed
            ? `Confirm delete alert for ${alert.symbol}`
            : `Delete alert for ${alert.symbol}`
        }
        data-testid={confirmArmed ? "alert-delete-confirm" : "alert-delete-arm"}
      >
        {deleting ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : confirmArmed ? (
          <>
            <Trash2 className="h-3.5 w-3.5" />
            <span>Confirm?</span>
          </>
        ) : (
          <Trash2 className="h-3.5 w-3.5" />
        )}
      </button>
    </div>
  );
}

function AlertMobileCard({
  alert,
  onDelete,
}: {
  alert: PriceAlert;
  onDelete: (id: string) => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [confirmArmed, setConfirmArmed] = useState(false);
  const disarmTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (disarmTimer.current) window.clearTimeout(disarmTimer.current);
    };
  }, []);

  const handleDeleteClick = async () => {
    if (!confirmArmed) {
      setConfirmArmed(true);
      if (disarmTimer.current) window.clearTimeout(disarmTimer.current);
      disarmTimer.current = window.setTimeout(() => setConfirmArmed(false), 4000);
      return;
    }
    if (disarmTimer.current) window.clearTimeout(disarmTimer.current);
    setDeleting(true);
    await onDelete(alert.id);
    setDeleting(false);
    setConfirmArmed(false);
  };

  const rising = alert.condition === "above" || alert.condition === "percent_move_above";

  return (
    <article className={cn("px-4 py-3", alert.triggered && "opacity-60")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {alert.triggered ? (
              <CheckCircle2 className="h-4 w-4 text-[var(--profit)]" />
            ) : (
              <Clock className="h-4 w-4 text-primary" />
            )}
            <span className="break-all font-mono text-body font-semibold text-foreground">{alert.symbol}</span>
            <Badge
              variant={rising ? "default" : "destructive"}
              className="px-1.5 text-label"
            >
              {rising ? <ArrowUp className="mr-0.5 h-2.5 w-2.5" /> : <ArrowDown className="mr-0.5 h-2.5 w-2.5" />}
              {alert.condition.replace("percent_move_", "")}
              {alert.condition.startsWith("percent_move") && " %"}
            </Badge>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-label">
            <div>
              <dt className="t-label">Target</dt>
              <dd className="mt-1 t-num-md text-foreground">
                {alert.condition.startsWith("percent_move")
                  ? `${(alert.price ?? 0).toFixed(2)}%`
                  : `$${(alert.price ?? 0).toFixed(2)}`}
              </dd>
            </div>
            <div>
              <dt className="t-label">Status</dt>
              <dd className={cn("mt-1 text-label font-medium", alert.triggered ? "text-[var(--profit)]" : "text-primary")}>
                {alert.triggered ? "Triggered" : "Active"}
              </dd>
            </div>
            <div className="col-span-2">
              <dt className="t-label">Date</dt>
              <dd className="mt-1 t-meta">
                {alert.triggered && alert.triggered_at
                  ? `Triggered ${formatDate(alert.triggered_at)}`
                  : `Created ${formatDate(alert.created_at)}`}
              </dd>
            </div>
          </dl>
        </div>
        <button
          onClick={handleDeleteClick}
          disabled={deleting}
          className={cn(
            "inline-flex min-h-11 shrink-0 items-center justify-center rounded px-2 transition-colors disabled:opacity-50",
            confirmArmed
              ? "gap-1 bg-[var(--loss)]/15 text-[var(--loss)] ring-1 ring-[var(--loss)]/40 text-label font-semibold"
              : "w-11 text-muted-foreground hover:bg-[var(--loss)]/10 hover:text-[var(--loss)]",
          )}
          aria-label={
            confirmArmed
              ? `Confirm delete alert for ${alert.symbol}`
              : `Delete alert for ${alert.symbol}`
          }
        >
          {deleting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : confirmArmed ? (
            <>
              <Trash2 className="h-3.5 w-3.5" />
              <span>Confirm?</span>
            </>
          ) : (
            <Trash2 className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
    </article>
  );
}

// ─── Main Page ──────────────────────────────────────────────

export default function AlertsPage() {
  const { toast } = useToast();
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false);
  const [showClearTriggeredConfirm, setShowClearTriggeredConfirm] = useState(false);
  // Triggered-history section is collapsible (brief call-out). Default
  // open so current users' mental model is unchanged; state is per-session.
  const [triggeredOpen, setTriggeredOpen] = useState(true);
  // Track whether we've had a successful load so subsequent transient
  // fetch failures don't wipe the list (same anti-pattern the /trade
  // recent-orders strip fixed). First-load 5xx still falls through to
  // the empty state so the user isn't stuck on a skeleton.
  const hasLoadedOnce = useRef(false);

  const fetchAlerts = useCallback(async () => {
    try {
      const data = await getPriceAlerts();
      setAlerts(data);
      hasLoadedOnce.current = true;
    } catch {
      // Only wipe to empty on the *first* load — otherwise a flaky
      // refetch (e.g. after createPriceAlert / deletePriceAlert) would
      // erase the list the user is editing. Keep the last-known array.
      if (!hasLoadedOnce.current) {
        setAlerts([]);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  const activeAlerts = alerts.filter((a) => !a.triggered);
  // Brief: priority sort the triggered section by time. Newest fired first
  // — that's the "most-actionable" ordering traders expect (fresh fires
  // at the top, older history decays down). Missing `triggered_at`
  // falls back to `created_at` so nothing sinks to the bottom blank.
  const triggeredAlerts = alerts
    .filter((a) => a.triggered)
    .slice()
    .sort((a, b) => {
      const ta = new Date(a.triggered_at ?? a.created_at).getTime();
      const tb = new Date(b.triggered_at ?? b.created_at).getTime();
      return tb - ta;
    });

  const handleDelete = async (id: string) => {
    try {
      await deletePriceAlert(id);
      setAlerts((prev) => prev.filter((a) => a.id !== id));
      toast({ type: "success", message: "Alert deleted" });
    } catch (err: unknown) {
      toast({ type: "error", message: err instanceof Error ? err.message : "Failed to delete alert" });
    }
  };

  const handleCreated = useCallback((alert: PriceAlert) => {
    hasLoadedOnce.current = true;
    setLoading(false);
    setAlerts((prev) => [alert, ...prev.filter((item) => item.id !== alert.id)]);
  }, []);

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
      toast({ type: "error", message: `Failed to delete ${fmtPlural(failed, "alert")}` });
    } else {
      toast({ type: "success", message: `Cleared ${fmtPlural(triggered.length, "triggered alert")}` });
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
      toast({ type: "error", message: `Failed to delete ${fmtPlural(failed, "alert")}` });
    } else {
      toast({ type: "success", message: "All alerts deleted" });
    }
    fetchAlerts();
  };

  const headerActions = alerts.length > 0 ? (
    <>
      <span className="font-sans text-label text-fg-muted">
        {activeAlerts.length} active
        {triggeredAlerts.length > 0 ? ` / ${triggeredAlerts.length} triggered` : ""}
      </span>
      {triggeredAlerts.length > 0 && (
        // Clear Triggered is a bulk-delete — put it behind the same
        // popover-confirm gate as "Delete All" so a single fat-finger
        // tap doesn't erase the triggered history. Matches market
        // convention for bulk destructive actions in trading UIs.
        <div className="relative">
          <Button
            variant="outline"
            size="sm"
            className="text-label h-8"
            onClick={() => setShowClearTriggeredConfirm(true)}
          >
            Clear Triggered
          </Button>
          {showClearTriggeredConfirm && (
            <div className="absolute right-0 top-full mt-2 z-50 rounded-md border border-border bg-bg-elev-1 p-4 shadow-lg min-w-[240px]">
              <p className="font-sans text-body-sm font-medium text-fg mb-1">Clear triggered alerts?</p>
              <p className="font-sans text-label text-fg-muted mb-3">
                This will permanently delete {triggeredAlerts.length} triggered alert
                {triggeredAlerts.length !== 1 ? "s" : ""}. This action cannot be undone.
              </p>
              <div className="flex gap-2 justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-label h-7"
                  onClick={() => setShowClearTriggeredConfirm(false)}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  className="text-label h-7"
                  onClick={() => {
                    setShowClearTriggeredConfirm(false);
                    handleClearTriggered();
                  }}
                >
                  Clear
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
      <div className="relative">
        <Button
          variant="outline"
          size="sm"
          className="text-label h-8 text-loss hover:text-loss hover:bg-loss/10"
          onClick={() => setShowDeleteAllConfirm(true)}
        >
          <Trash2 className="h-3 w-3 mr-1" />
          Delete All
        </Button>
        {showDeleteAllConfirm && (
          <div className="absolute right-0 top-full mt-2 z-50 rounded-md border border-border bg-bg-elev-1 p-4 shadow-lg min-w-[240px]">
            <p className="font-sans text-body-sm font-medium text-fg mb-1">Delete all alerts?</p>
            <p className="font-sans text-label text-fg-muted mb-3">
              This will permanently delete {alerts.length} alert{alerts.length !== 1 ? "s" : ""}. This action cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                size="sm"
                className="text-label h-7"
                onClick={() => setShowDeleteAllConfirm(false)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="text-label h-7"
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
      {/* Round-8 killer-move 2: alerts hero summary line. The page
          previously had no anchor — a 30%-vertical Create form
          dominated even when alerts existed. This 1-line t-meta
          summary gives a 1-second status answer ("3 watching · 1
          fired today · 0 errors") above the form. Hidden until at
          least one alert exists so the cold empty state still
          dominates for first-time users (which is the right hero
          for that mode). */}
      {!loading && alerts.length > 0 && (
        <p
          data-slot="alerts-summary"
          className="mb-4 t-meta tabular-nums u-muted"
        >
          <span className="u-brand">{activeAlerts.length} watching</span>
          {" · "}
          {triggeredAlerts.length > 0 ? (
            <>
              <span className="u-profit">{triggeredAlerts.length} triggered</span>
              {" "}
            </>
          ) : (
            <>0 triggered </>
          )}
          {" · "}
          {alerts.length} total
        </p>
      )}

      {/* Create Form */}
      <CreateAlertForm onCreated={handleCreated} />

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
        <div className="rounded-lg border border-border bg-[var(--bg-card)] overflow-hidden">
          {activeAlerts.length === 0 ? (
            <EmptyState
              title="No alerts set"
              description="Define a price, indicator, or P&L trigger above to start watching."
              className="rounded-none border-0 bg-transparent"
            />
          ) : (
            <>
            <div className="divide-y divide-border/50 sm:hidden">
              {activeAlerts.map((alert) => (
                <AlertMobileCard
                  key={alert.id}
                  alert={alert}
                  onDelete={handleDelete}
                />
              ))}
            </div>
            <div className="hidden overflow-x-auto scrollbar-thin sm:block">
              {/* Header + column row only shown when there are alerts — the
                  centered empty-state block above is enough on its own. */}
              <div className="min-w-[720px]">
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-[var(--panel)]/50">
                  <Clock className="h-3.5 w-3.5 text-primary" />
                  <span className="text-label font-semibold text-foreground">
                    Active Alerts ({activeAlerts.length})
                  </span>
                </div>
                <div className="flex items-center gap-3 px-4 py-1.5 border-b border-border/50">
                  {/* t-label: aligns column titles with the dashboard wave's
                      eyebrow style instead of ad-hoc 10px caps styling. */}
                  <span className="w-4 shrink-0" />
                  <span className="w-16 shrink-0 t-label">Symbol</span>
                  <span className="w-32 shrink-0 t-label">Condition</span>
                  <span className="w-24 shrink-0 t-label">Target</span>
                  <span className="w-20 shrink-0 t-label">Status</span>
                  <span className="flex-1 t-label">Date</span>
                  <span className="w-8 shrink-0" />
                </div>
                <ScrollArea className="max-h-[400px]">
                  <div className="divide-y divide-border/50">
                    {activeAlerts.map((alert) => (
                      <AlertRow
                        key={alert.id}
                        alert={alert}
                        onDelete={handleDelete}
                      />
                    ))}
                  </div>
                </ScrollArea>
              </div>
            </div>
            </>
          )}
        </div>
      )}

      {/* Triggered History — collapsible (brief call-out). Using a
          plain button + aria-expanded rather than <details> so the
          styling matches the adjacent "Active Alerts" panel and we
          control the chevron animation. Sort order is newest-first
          (see triggeredAlerts sort above). */}
      {!loading && triggeredAlerts.length > 0 && (
        <div className="rounded-lg border border-border bg-[var(--bg-card)] overflow-hidden">
          <button
            type="button"
            onClick={() => setTriggeredOpen((v) => !v)}
            aria-expanded={triggeredOpen}
            aria-controls="triggered-history-body"
            className="w-full flex items-center gap-2 px-4 py-2.5 border-b border-border bg-[var(--panel)]/50 hover:bg-[var(--panel)]/70 transition-colors text-left"
          >
            <CheckCircle2 className="h-3.5 w-3.5 text-[var(--profit)]" />
            <span className="text-label font-semibold text-foreground flex-1">
              Triggered History ({triggeredAlerts.length})
            </span>
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 text-muted-foreground transition-transform",
                !triggeredOpen && "-rotate-90"
              )}
              aria-hidden
            />
          </button>

          {triggeredOpen && (
            <div id="triggered-history-body">
              {/* Column headers — t-label for the caps/tracked eyebrow row
                  so column titles in both sections read the same. */}
              <div className="flex items-center gap-3 px-4 py-1.5 border-b border-border/50">
                <span className="w-4 shrink-0" />
                <span className="w-16 shrink-0 t-label">Symbol</span>
                <span className="w-32 shrink-0 t-label">Condition</span>
                <span className="w-24 shrink-0 t-label">Target</span>
                <span className="w-20 shrink-0 t-label">Status</span>
                <span className="flex-1 t-label">Date</span>
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
      )}
    </DashboardPageLayout>
  );
}
