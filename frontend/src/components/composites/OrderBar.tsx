"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type {
  OrderSide,
  OrderTypeOption,
  StagedOrder,
  StrategyOption,
  TimeInForceOption,
} from "./types";

/**
 * OrderBar (composite)
 * ────────────────────
 * Bottom execution row for the trading desk.
 * Strategy select · Side (Buy/Sell) · Qty · Type · Price · Stop ·
 * italic-serif review copy · primary "Stage order →" button.
 *
 * Controlled-ish: each field has internal state seeded from `defaults`.
 * Parent owns submission via `onSubmit` — this composite does not mutate
 * stores or dispatch. Disabled state covered via the native disabled attr.
 *
 * Mobile: the 7-field flex row overflowed small viewports; below `md:`
 * we stack the inputs as a 2-column grid and the Stage button spans
 * full-width.
 */
export interface OrderBarProps {
  symbol: string;
  strategies: StrategyOption[];
  onSubmit: (order: StagedOrder) => void | boolean | Promise<void | boolean>;
  defaults?: Partial<StagedOrder>;
  /** Review copy on the right. Defaults to "Review before submit · regime check · risk policy". */
  reviewCopy?: string;
  /** Parent flag — disables Stage + shows "Submitting…" while the API request is in flight. */
  submitting?: boolean;
  /**
   * Inline error rendered under the Stage button. Parent supplies a
   * message when a placement fails (422, 4xx, etc.) so the error is
   * visible even if the toast was missed. Clears when parent retries.
   */
  errorMessage?: string | null;
  /**
   * Small subtitle rendered under the primary button. Defaults to
   * "Submits to paper account". Parent can swap in "Submits to LIVE account"
   * when the backend base URL indicates live trading.
   */
  submitDestination?: string;
  /** Primary button label. Defaults to "Place order". */
  submitLabel?: string;
  /** Parent-owned execution gate, used for quote/broker/session blockers. */
  submitDisabled?: boolean;
  /** Short human reason rendered beside the submit affordance when gated. */
  submitDisabledReason?: string | null;
  /** Lock ticket fields when another control owns the executable order legs. */
  ticketLocked?: boolean;
  /** Controlled strategy selection, used when parent chrome summarizes the ticket. */
  strategyId?: string;
  /** Fires when the Strategy select changes in controlled or uncontrolled mode. */
  onStrategyChange?: (strategyId: string) => void;
  /** Fires whenever the editable ticket draft changes so parent gates stay live. */
  onDraftChange?: (order: StagedOrder) => void;
  /**
   * R4-5 W-3 — when an OCC option contract was staged but the snapshot
   * endpoint 404'd, the ticket silently degrades to the underlying. Set
   * this to the affected OCC (or `true`) so the UI surfaces the
   * degradation with a retry affordance instead of disappearing.
   */
  optionsUnavailable?: { occ: string; underlying: string } | null;
  /** Retry handler invoked from the banner action button. */
  onRetryOptions?: () => void;
  /**
   * R6-5 (closes R5-B1, R5-M5) — multi-leg ticket extension of
   * `optionsUnavailable`. R4-W-3 closed the silent OCC-fallback for the
   * singular `activeContract` path; this list covers `activeLegs[]`. Each
   * record describes a leg whose OCC quote was missing from the snapshot
   * fan-out, so the OrderBar can surface a per-leg banner instead of the
   * trader staring at the underlying quote dressed as a combo spread.
   *
   * The DOM evidence:
   * `qa/runs/2026-05-04T20-31-40Z/trade/desktop-1440/multi-leg-prefill.dom.html`
   * captured zero `data-slot="order-bar-options-unavailable"` despite both
   * staged strangle legs returning 404 in `network.jsonl`.
   */
  legsUnavailable?: Array<{
    occ: string;
    symbol: string;
    reason: "404" | "timeout" | "generic";
  }>;
  /**
   * Retry handler for the multi-leg banner. Re-runs the snapshot fan-out
   * for all staged legs. Distinct from `onRetryOptions` (singular) so the
   * parent can choose to retry only the failing legs if it wants.
   */
  onRetryLegs?: () => void;
  className?: string;
}

const TYPES: OrderTypeOption[] = ["market", "limit", "stop", "stop_limit"];

function typeLabel(t: OrderTypeOption) {
  if (t === "stop_limit") return "Stop Limit";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export default function OrderBar({
  symbol,
  strategies,
  onSubmit,
  defaults,
  reviewCopy = "Review before submit · regime check · risk policy",
  submitting = false,
  errorMessage = null,
  submitDestination = "Submits to paper account",
  submitLabel = "Place order",
  submitDisabled = false,
  submitDisabledReason = null,
  ticketLocked = false,
  strategyId: controlledStrategyId,
  onStrategyChange,
  onDraftChange,
  optionsUnavailable = null,
  onRetryOptions,
  legsUnavailable = [],
  onRetryLegs,
  className,
}: OrderBarProps) {
  const noStrategies = strategies.length === 0;
  const [internalStrategyId, setInternalStrategyId] = React.useState<string>(
    defaults?.strategyId ?? strategies[0]?.id ?? ""
  );
  const strategyId = controlledStrategyId ?? internalStrategyId;
  const lastDefaultStrategyIdRef = React.useRef<string | undefined>(defaults?.strategyId);
  React.useEffect(() => {
    if (
      controlledStrategyId == null &&
      defaults?.strategyId &&
      defaults.strategyId !== lastDefaultStrategyIdRef.current
    ) {
      lastDefaultStrategyIdRef.current = defaults.strategyId;
      setInternalStrategyId(defaults.strategyId);
      onStrategyChange?.(defaults.strategyId);
    }
  }, [controlledStrategyId, defaults?.strategyId, onStrategyChange]);
  // When strategies resolve later (React Query), adopt the first one as
  // the sensible default so the select doesn't stay on an empty string.
  React.useEffect(() => {
    if (!strategyId && strategies[0]?.id) {
      setInternalStrategyId(strategies[0].id);
      onStrategyChange?.(strategies[0].id);
    }
  }, [onStrategyChange, strategies, strategyId]);

  const handleStrategyChange = React.useCallback(
    (next: string) => {
      if (controlledStrategyId == null) {
        setInternalStrategyId(next);
      }
      onStrategyChange?.(next);
    },
    [controlledStrategyId, onStrategyChange],
  );

  const [side, setSide] = React.useState<OrderSide>(defaults?.side ?? "buy");
  // Round-5 F-2 — when an earnings deep-link pre-stages an OCC option
  // contract, the parent passes `defaults.symbol = OCC` so the OrderBar
  // submits the *option*, not the equity ticker the desk is on. The
  // explicit override wins; if no override is supplied we fall back to
  // the parent's `symbol` prop (current desk selection).
  const [symbolValue, setSymbolValue] = React.useState<string>(
    defaults?.symbol ?? symbol
  );
  // Round-5 F-2 — adopt a late-arriving `defaults.symbol` (e.g. after
  // the trade page parses ?contract= in a useEffect on first mount).
  // The `lastDefaultSymbolRef` guards against re-running on every
  // unrelated parent re-render.
  const lastDefaultSymbolRef = React.useRef<string | undefined>(defaults?.symbol);
  React.useEffect(() => {
    if (defaults?.symbol && defaults.symbol !== lastDefaultSymbolRef.current) {
      lastDefaultSymbolRef.current = defaults.symbol;
      setSymbolValue(defaults.symbol);
    }
  }, [defaults?.symbol]);
  // NEW-BUG fix: the previous unconditional `setSymbolValue(symbol)` ran
  // on every parent `symbol` prop change — including the quote-tick driven
  // re-renders on the desk. A user who was mid-edit in the Symbol field
  // (e.g. typing "AAP…" to override the chart's selected "AVGO") had their
  // input clobbered every time a new quote arrived. Only sync when the
  // upstream symbol actually changed AND the user isn't in the field;
  // tracked via a ref so we don't trigger an extra render.
  const lastParentSymbolRef = React.useRef<string>(symbol);
  React.useEffect(() => {
    if (symbol === lastParentSymbolRef.current) return;
    lastParentSymbolRef.current = symbol;
    // If the field currently has focus, preserve the user's draft —
    // they'll submit or blur, at which point the draft wins. Otherwise
    // adopt the parent's new symbol.
    const active = typeof document !== "undefined" ? document.activeElement : null;
    const isEditingSymbol =
      active instanceof HTMLElement &&
      active.getAttribute("name") === "symbol" &&
      active.getAttribute("data-testid") === "order-bar-symbol";
    if (!isEditingSymbol) {
      setSymbolValue(symbol);
    }
  }, [symbol]);
  // Defaults after Wave 28:
  //   · qty = 1 (not 100 — a new user accidentally placing a 100-share
  //     order is far worse than having to type a bigger number)
  //   · type = market (not limit — "limit" required a price and the
  //     first click always errored with "Limit orders require a price")
  const [quantity, setQuantity] = React.useState<string>(
    String(defaults?.quantity ?? 1)
  );
  const [type, setType] = React.useState<OrderTypeOption>(defaults?.type ?? "market");
  const [price, setPrice] = React.useState<string>(
    defaults?.price != null ? String(defaults.price) : ""
  );
  const [stop, setStop] = React.useState<string>(defaults?.stop ?? "");
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const [timeInForce, setTimeInForce] = React.useState<TimeInForceOption>("day");
  const [bracketEnabled, setBracketEnabled] = React.useState(false);
  const [takeProfit, setTakeProfit] = React.useState("");
  const [bracketStop, setBracketStop] = React.useState("");
  const [extendedHours, setExtendedHours] = React.useState(false);
  const [trailingStop, setTrailingStop] = React.useState("");
  const [riskPct, setRiskPct] = React.useState("");
  const [routeVenue, setRouteVenue] = React.useState("smart");

  // Round-5 F-2 — adopt late-arriving deep-link defaults for side / qty
  // / type / price too. Each guard tracks the last applied value via a
  // ref so we don't fight the user's edits — once they manually change
  // a field, the next defaults change is the only thing that resyncs.
  const lastDefaultSideRef = React.useRef<OrderSide | undefined>(defaults?.side);
  React.useEffect(() => {
    if (defaults?.side && defaults.side !== lastDefaultSideRef.current) {
      lastDefaultSideRef.current = defaults.side;
      setSide(defaults.side);
    }
  }, [defaults?.side]);

  const lastDefaultQtyRef = React.useRef<number | undefined>(defaults?.quantity);
  React.useEffect(() => {
    if (defaults?.quantity != null && defaults.quantity !== lastDefaultQtyRef.current) {
      lastDefaultQtyRef.current = defaults.quantity;
      setQuantity(String(defaults.quantity));
    }
  }, [defaults?.quantity]);

  const lastDefaultTypeRef = React.useRef<OrderTypeOption | undefined>(defaults?.type);
  React.useEffect(() => {
    if (defaults?.type && defaults.type !== lastDefaultTypeRef.current) {
      lastDefaultTypeRef.current = defaults.type;
      setType(defaults.type);
    }
  }, [defaults?.type]);

  const lastDefaultPriceRef = React.useRef<number | undefined>(defaults?.price);
  React.useEffect(() => {
    if (defaults?.price != null && defaults.price !== lastDefaultPriceRef.current) {
      lastDefaultPriceRef.current = defaults.price;
      setPrice(String(defaults.price));
    }
  }, [defaults?.price]);

  const lastDefaultStopRef = React.useRef<string | undefined>(defaults?.stop);
  React.useEffect(() => {
    if (defaults?.stop != null && defaults.stop !== lastDefaultStopRef.current) {
      lastDefaultStopRef.current = defaults.stop;
      setStop(defaults.stop);
    }
  }, [defaults?.stop]);

  // persona-99 #2 — Sell confirmation on mobile. At 375px the Buy/Sell
  // buttons are shoulder-to-shoulder; a mis-tap on Sell is catastrophic.
  // Require a second tap within 3s to commit the side switch.
  const [sellArming, setSellArming] = React.useState(false);
  const sellArmTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => () => {
    if (sellArmTimer.current) clearTimeout(sellArmTimer.current);
  }, []);
  const handleSideClick = React.useCallback(
    (next: OrderSide) => {
      if (next === "buy") {
        setSide("buy");
        setSellArming(false);
        return;
      }
      // Sell path: confirm on the second tap.
      if (sellArming || side === "sell") {
        setSide("sell");
        setSellArming(false);
        return;
      }
      setSellArming(true);
      if (sellArmTimer.current) clearTimeout(sellArmTimer.current);
      sellArmTimer.current = setTimeout(() => setSellArming(false), 3000);
    },
    [sellArming, side]
  );

  // persona-99 #3 — scroll Submit into view when Qty gains focus so the iOS
  // keyboard doesn't hide the confirm affordance. 300ms matches the iOS
  // keyboard animation so the scroll happens after the viewport settles.
  const submitButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const handleQtyFocus = React.useCallback(() => {
    setTimeout(() => {
      submitButtonRef.current?.scrollIntoView({
        block: "center",
        behavior: "smooth",
      });
    }, 300);
  }, []);

  // Price / stop fields are meaningful only for certain order types.
  // Gate the inputs so market orders don't ask for a price, and stop
  // orders don't ask for a limit — matches the backend validator added
  // in Wave 28 (limit_price required for limit/stop_limit, stop_price
  // required for stop/stop_limit).
  const priceRequired = type === "limit" || type === "stop_limit";
  const stopRequired = type === "stop" || type === "stop_limit";

  // BUG-002 — local client-side validation. The Qty input gates integers
  // in [1, 999_999_999]; anything out of that range is rejected here so
  // we don't fire a 422 at the backend. The Stage button renders the
  // local error inline and disables itself when invalid.
  const qtyNum = Number(quantity);
  const qtyInvalid =
    quantity === "" ||
    !Number.isFinite(qtyNum) ||
    !Number.isInteger(qtyNum) ||
    qtyNum < 1 ||
    qtyNum > 999_999_999;
  const qtyLocalError = qtyInvalid && quantity !== ""
    ? "Quantity must be a whole number between 1 and 999,999,999"
    : null;

  // Round-28 / persona-B P0: pre-fix only ``qtyInvalid`` blocked submit.
  // ``Number("abc")`` yielded NaN, ``-50`` and ``0`` slipped through.
  // Now validate price + stop too, with appropriate gating per type.
  const priceNum = priceRequired && price !== "" ? Number(price) : undefined;
  const stopNum = stopRequired && stop !== "" ? Number(stop) : undefined;
  const priceInvalid =
    priceRequired &&
    (price === "" || priceNum === undefined || !Number.isFinite(priceNum) || priceNum <= 0);
  const stopInvalid =
    stopRequired &&
    (stop === "" || stopNum === undefined || !Number.isFinite(stopNum) || stopNum <= 0);
  const estimatedPrice =
    priceNum && Number.isFinite(priceNum) && priceNum > 0
      ? priceNum
      : defaults?.price && Number.isFinite(defaults.price) && defaults.price > 0
        ? defaults.price
        : undefined;
  const estimatedNotional =
    estimatedPrice && !qtyInvalid ? estimatedPrice * qtyNum : undefined;
  const slippageEstimate =
    estimatedNotional != null
      ? `$${Math.max(0.01, estimatedNotional * 0.0005).toFixed(2)} @ 5 bps`
      : "Needs quote or limit";
  const priceLocalError =
    priceRequired && price !== "" && priceInvalid
      ? "Price must be a positive number"
      : null;
  const stopLocalError =
    stopRequired && stop !== "" && stopInvalid
      ? "Stop must be a positive number"
      : null;
  const takeProfitNum = bracketEnabled && takeProfit !== "" ? Number(takeProfit) : undefined;
  const bracketStopNum = bracketEnabled && bracketStop !== "" ? Number(bracketStop) : undefined;
  const bracketInvalid =
    bracketEnabled &&
    (
      takeProfitNum === undefined ||
      bracketStopNum === undefined ||
      !Number.isFinite(takeProfitNum) ||
      !Number.isFinite(bracketStopNum) ||
      takeProfitNum <= 0 ||
      bracketStopNum <= 0
    );
  const bracketLocalError =
    bracketEnabled && bracketInvalid
      ? "Bracket orders require positive take-profit and stop-loss prices"
      : null;
  const symInvalid = !(symbolValue || symbol).trim();
  const isOptionSymbol = /^[A-Z0-9]{1,6}\d{6}[CP]\d{8}$/.test((symbolValue || symbol).trim().toUpperCase());
  const extendedHoursSupported = type === "limit" && timeInForce === "day" && !isOptionSymbol && !bracketEnabled;

  React.useEffect(() => {
    if (extendedHours && !extendedHoursSupported) setExtendedHours(false);
  }, [extendedHours, extendedHoursSupported]);

  const currentDraft = React.useMemo<StagedOrder>(() => ({
    strategyId,
    symbol: (symbolValue || symbol).trim().toUpperCase(),
    side,
    quantity: qtyNum,
    type,
    price: priceNum,
    stop: stopNum != null ? String(stopNum) : undefined,
    timeInForce,
    extendedHours: extendedHours && extendedHoursSupported,
    bracket: bracketEnabled && takeProfitNum != null && bracketStopNum != null
      ? { takeProfit: takeProfitNum, stopLoss: bracketStopNum }
      : undefined,
  }), [
    bracketEnabled,
    bracketStopNum,
    extendedHours,
    extendedHoursSupported,
    priceNum,
    qtyNum,
    side,
    stopNum,
    strategyId,
    symbol,
    symbolValue,
    takeProfitNum,
    timeInForce,
    type,
  ]);

  React.useEffect(() => {
    onDraftChange?.(currentDraft);
  }, [currentDraft, onDraftChange]);

  // Round-28 / persona-B P0: in-flight idempotency guard. Pre-fix the
  // ``disabled={submitting}`` relied on the parent flipping
  // ``submitting`` synchronously after onSubmit. Between the click and
  // the parent setState, a double-tap on touch (or a fast finger) would
  // re-enter ``stage()`` twice and submit two POSTs. Local ref blocks
  // re-entry until the parent's ``submitting`` prop comes back true.
  const submittingRef = React.useRef(false);
  React.useEffect(() => {
    // Parent has acknowledged the submission and is now showing the
    // submitting state — clear the local guard so subsequent legit
    // submissions (after this one resolves) can proceed.
    if (submitting) submittingRef.current = false;
  }, [submitting]);

  const stage = () => {
    if (submitting || submittingRef.current) return;
    if (submitDisabled) return;
    if (qtyInvalid || priceInvalid || stopInvalid || bracketInvalid || symInvalid) return;
    submittingRef.current = true;
    const result = onSubmit(currentDraft);
    Promise.resolve(result)
      .then((accepted) => {
        if (accepted === false) submittingRef.current = false;
      })
      .catch(() => {
        submittingRef.current = false;
      });
  };

  const strategyPlaceholder = noStrategies ? "No strategies registered" : undefined;

  return (
    <div
      data-slot="order-bar"
      data-tour="order-bar"
      // Slice-3 / CH-5A (chart audit 2026-04-26): on /trade the OrderBar
      // lives in a 5/12-col side panel ~600px wide, which is narrower
      // than the desktop ``md:flex-row`` breakpoint expected. Field
      // labels (STRATEGY, SIDE, SYMBOL, QTY…) collided into garble like
      // "STRATEG SIDE" / "BUY/SELL/SPY" overlap. Use a CSS container
      // query so the layout decides based on the OrderBar's actual
      // width, not the viewport. ``@container (min-width: 720px)``
      // gates the horizontal row; below that we stack via the 2-col
      // grid that already worked on mobile.
      style={{ containerType: "inline-size" }}
      className={cn(
        // Default: 2-col grid, stacked.
        "grid grid-cols-2 gap-3 items-end px-4 py-4 border-t border-border bg-ink-050",
        // ``@md`` here is the project's container-query alias (see
        // tailwind config) — applies the horizontal layout only when
        // the OrderBar's container is ≥720px wide, NOT when the
        // viewport is ≥768px. On /trade's 5/12 side panel that means
        // we stay stacked until the viewport is ~1500px+, which is
        // exactly when the OrderBar actually has room to breathe.
        "@[720px]:flex @[720px]:flex-row @[720px]:flex-wrap @[1100px]:flex-nowrap @[720px]:gap-5 @[720px]:px-7",
        className
      )}
    >
      {/* R4-5 W-3 — OCC option contracts that 404 on the snapshot
          endpoint previously degraded silently to the underlying with
          no UI surface. The parent now passes `optionsUnavailable` when
          the snapshot fan-out came back missing the staged OCC, and we
          surface a banner with a retry handler so the trader sees the
          downgrade instead of trusting blank telemetry. */}
      {optionsUnavailable ? (
        <div
          role="status"
          aria-live="polite"
          data-slot="order-bar-options-unavailable"
          className="col-span-2 flex flex-wrap items-center justify-between gap-2 rounded-sm border border-amber/40 bg-amber/10 px-3 py-2 text-body-sm text-amber @[720px]:basis-full"
        >
          <span className="min-w-0">
            Options data unavailable for{" "}
            <span className="font-mono">{optionsUnavailable.occ}</span> —
            trading underlying{" "}
            <span className="font-mono">{optionsUnavailable.underlying}</span>{" "}
            instead.
          </span>
          {onRetryOptions ? (
            <button
              type="button"
              onClick={onRetryOptions}
              className="inline-flex items-center gap-1 rounded-sm border border-amber/40 bg-bg-elev-1 px-2 py-1 text-label font-semibold text-amber transition-colors hover:bg-amber/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber"
            >
              Retry
            </button>
          ) : null}
        </div>
      ) : null}
      {/* R6-5 (closes R5-B1, R5-M5) — multi-leg extension of the
          R4-W-3 single-leg banner above. When `?legs=` deep-link prefills
          a combo whose OCC quotes 404'd, the trader was previously shown
          the underlying quote dressed as a leg spread. This banner
          surfaces every failing leg with a single Retry that re-runs the
          snapshot fan-out for the whole combo. The execution-readiness
          pill in the parent independently gates submit (see
          legQuoteReadiness.ts). */}
      {legsUnavailable.length > 0 ? (
        <div
          role="status"
          aria-live="polite"
          data-slot="order-bar-legs-unavailable"
          data-legs-unavailable-count={legsUnavailable.length}
          className="col-span-2 flex flex-col gap-2 rounded-sm border border-amber/40 bg-amber/10 px-3 py-2 text-body-sm text-amber @[720px]:basis-full"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold">
              Quote unavailable for {legsUnavailable.length} combo
              leg{legsUnavailable.length === 1 ? "" : "s"}
            </span>
            {onRetryLegs ? (
              <button
                type="button"
                onClick={onRetryLegs}
                className="inline-flex items-center gap-1 rounded-sm border border-amber/40 bg-bg-elev-1 px-2 py-1 text-label font-semibold text-amber transition-colors hover:bg-amber/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber"
              >
                Retry quotes
              </button>
            ) : null}
          </div>
          <ul className="grid gap-1 pl-1">
            {legsUnavailable.map((leg) => (
              <li
                key={leg.occ}
                data-slot="order-bar-leg-unavailable"
                data-leg-occ={leg.occ}
                data-leg-reason={leg.reason}
                className="flex flex-wrap items-baseline gap-2 text-label"
              >
                <span className="font-mono text-body-sm">{leg.occ}</span>
                <span className="text-fg-muted">
                  {leg.symbol} ·{" "}
                  {leg.reason === "404"
                    ? "contract not found"
                    : leg.reason === "timeout"
                      ? "request timed out"
                      : "snapshot fetch failed"}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-label text-fg-muted">
            The displayed two-sided quote is the underlying — not the
            combo. Refresh before submit.
          </p>
        </div>
      ) : null}
      <Field label="Strategy">
        <select
          value={strategyId}
          onChange={(e) => handleStrategyChange(e.target.value)}
          disabled={noStrategies}
          className={cn(
            "h-11 md:h-10 min-w-[90px] w-full px-3 rounded-sm border border-border bg-bg-elev-1",
            // iOS Safari auto-zooms on tap of any <input>/<select> with an
            // effective font-size < 16px. text-base (16px) on mobile keeps
            // the viewport stable; md+ keeps the dense 13px we use at desk
            // resolutions where tap-zoom isn't a concern.
            "font-mono text-base md:text-body-sm text-ink-1000 outline-none",
            // a11y audit r3 — WCAG 2.4.7: outline-none + 1px brand border
            // change was not a visible focus cue. Add a ring so keyboard
            // users can see which select is focused.
            "focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0",
            noStrategies && "opacity-60 cursor-not-allowed"
          )}
        >
          {noStrategies && (
            <option value="">{strategyPlaceholder}</option>
          )}
          {strategies.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Side">
        {/* r6b / BUG-03: replaced saturated filled Buy/Sell blocks with a
            segmented control using semantic dots (border + dot only, neutral
            background). The downstream "Place order" button is the
            unambiguous gold primary action — the segmented control just
            routes which side the order takes.

            BUG-036 — WCAG 4.1.2: radiogroup semantics preserved. */}
        <div
          role="radiogroup"
          aria-label="Order side"
          className="flex border border-border-hair rounded-sm overflow-hidden col-span-2 md:col-span-1"
        >
          <button
            type="button"
            role="radio"
            aria-checked={side === "buy"}
            data-active={side === "buy" || undefined}
            disabled={ticketLocked}
            onClick={() => handleSideClick("buy")}
            className={cn(
              "flex items-center gap-2 px-4 py-2 text-body-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:pointer-events-none disabled:opacity-55 transition-colors",
              side === "buy"
                ? "bg-bg-elev-2 border-r border-profit/40 text-fg"
                : "bg-transparent border-r border-border-hair text-fg-muted hover:text-fg"
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full shrink-0",
                side === "buy" ? "bg-profit" : "border border-fg-muted"
              )}
              aria-hidden
            />
            BUY
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={side === "sell"}
            data-active={side === "sell" || undefined}
            disabled={ticketLocked}
            onClick={() => handleSideClick("sell")}
            className={cn(
              "flex items-center gap-2 px-4 py-2 text-body-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:pointer-events-none disabled:opacity-55 transition-colors",
              side === "sell"
                ? "bg-bg-elev-2 border-l border-down-500/40 text-fg"
                : "bg-transparent border-l border-border-hair text-fg-muted hover:text-fg"
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full shrink-0",
                side === "sell" ? "bg-down-500" : "border border-fg-muted"
              )}
              aria-hidden
            />
            {sellArming ? "TAP AGAIN" : "SELL"}
          </button>
        </div>
      </Field>

      <Field label="Symbol">
        <Input
          name="symbol"
          data-testid="order-bar-symbol"
          value={symbolValue}
          onChange={(e) => setSymbolValue(e.target.value.toUpperCase())}
          disabled={ticketLocked}
          inputMode="text"
          autoCapitalize="characters"
          spellCheck={false}
          className="min-w-[90px] w-full h-11 md:h-10"
        />
      </Field>

      <Field label="Qty">
        <Input
          name="qty"
          data-testid="order-bar-qty"
          // BUG-002 — HTML-level guards: `type="number"` rejects
          // non-numeric keystrokes on desktop; `min`/`step` block native
          // spin controls from going negative or fractional; `max` keeps
          // the value within the backend's int32-safe band.
          type="number"
          min={1}
          max={999999999}
          step={1}
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          onFocus={handleQtyFocus}
          disabled={ticketLocked}
          inputMode="numeric"
          pattern="[0-9]*"
          aria-invalid={qtyInvalid || undefined}
          aria-describedby={qtyLocalError ? "order-bar-qty-error" : undefined}
          className="min-w-[90px] w-full h-11 md:h-10"
        />
      </Field>

      <Field label="Type">
        <select
          value={type}
          onChange={(e) => setType(e.target.value as OrderTypeOption)}
          disabled={ticketLocked}
          className={cn(
            "h-11 md:h-10 min-w-[90px] w-full px-3 rounded-sm border border-border bg-bg-elev-1",
            // iOS autozoom guard — see Strategy select above.
            "font-mono text-base md:text-body-sm text-ink-1000 outline-none",
            // a11y audit r3 — WCAG 2.4.7: matching visible focus ring on the
            // Type select (same treatment as the Strategy select above).
            "focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
          )}
        >
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {typeLabel(t)}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Price">
        <Input
          value={priceRequired ? price : ""}
          onChange={(e) => setPrice(e.target.value)}
          inputMode="decimal"
          placeholder={priceRequired ? undefined : "—"}
          disabled={ticketLocked || !priceRequired}
          className={cn(
            "min-w-[90px] w-full h-11 md:h-10",
            (ticketLocked || !priceRequired) && "opacity-50 cursor-not-allowed"
          )}
        />
      </Field>

      <Field label="Stop">
        <Input
          value={stopRequired ? stop : ""}
          onChange={(e) => setStop(e.target.value)}
          inputMode="decimal"
          placeholder={stopRequired ? undefined : "—"}
          disabled={ticketLocked || !stopRequired}
          className={cn(
            "min-w-[90px] w-full h-11 md:h-10 text-down-500",
            (ticketLocked || !stopRequired) && "opacity-50 cursor-not-allowed"
          )}
        />
      </Field>

      <div className="col-span-2 rounded-md border border-border-hair bg-bg-elev-1">
        <button
          type="button"
          onClick={() => setAdvancedOpen((open) => !open)}
          aria-expanded={advancedOpen}
          className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-bg-elev-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span>
            <span className="block t-label text-fg-hint">Advanced order</span>
            <span className="mt-1 block text-label leading-snug text-fg-muted">
              TIF, bracket/OCO planning, route, slippage, and risk sizing.
            </span>
          </span>
          <span className="shrink-0 font-mono text-label text-primary">
            {advancedOpen ? "Hide details" : "Show details"}
          </span>
        </button>
        {advancedOpen ? (
          <div className="grid gap-3 border-t border-border-hair p-3 md:grid-cols-2">
            <label className="grid gap-1.5">
              <span className="t-label text-fg-hint">Time in force</span>
              <select
                value={timeInForce}
                onChange={(e) => setTimeInForce(e.target.value as TimeInForceOption)}
                className="h-11 rounded-sm border border-border bg-bg px-3 font-mono text-base text-fg outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring md:h-10 md:text-body-sm"
              >
                <option value="day">DAY</option>
                <option value="gtc">GTC</option>
                <option value="ioc">IOC</option>
                <option value="fok">FOK</option>
                <option value="opg">OPG</option>
                <option value="cls">CLS</option>
              </select>
            </label>
            <label className="grid gap-1.5">
              <span className="t-label text-fg-hint">Route / venue</span>
              <select
                value={routeVenue}
                onChange={(e) => setRouteVenue(e.target.value)}
                className="h-11 rounded-sm border border-border bg-bg px-3 font-mono text-base text-fg outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring md:h-10 md:text-body-sm"
              >
                <option value="smart">SMART paper route</option>
                <option value="manual" disabled>Manual venue soon</option>
                <option value="dark" disabled>Dark/ATS not supported</option>
              </select>
            </label>
            <label className="grid gap-1.5">
              <span className="t-label text-fg-hint">Risk size</span>
              <Input
                value={riskPct}
                onChange={(e) => setRiskPct(e.target.value)}
                inputMode="decimal"
                placeholder="0.50% of equity"
                className="h-11 md:h-10"
              />
            </label>
            <div className="rounded-sm border border-border-hair bg-bg px-3 py-2">
              <p className="t-label text-fg-hint">Slippage estimate</p>
              <p className="mt-1 font-mono text-body-sm text-ink-1000">{slippageEstimate}</p>
              <p className="mt-1 text-label leading-snug text-fg-muted">Planning estimate only; broker execution decides the fill.</p>
            </div>
            <label className="flex min-h-11 items-center gap-2 rounded-sm border border-border-hair bg-bg px-3">
              <input
                type="checkbox"
                checked={bracketEnabled}
                onChange={(e) => setBracketEnabled(e.target.checked)}
                className="size-4 accent-brand"
              />
              <span>
                <span className="block text-body-sm font-semibold text-fg">Bracket / OCO</span>
                <span className="block text-label text-fg-muted">Plan attached target and stop before send.</span>
              </span>
            </label>
            <label className="flex min-h-11 items-center gap-2 rounded-sm border border-border-hair bg-bg px-3">
              <input
                type="checkbox"
                checked={extendedHours}
                disabled={!extendedHoursSupported}
                onChange={(e) => setExtendedHours(e.target.checked && extendedHoursSupported)}
                className="size-4 accent-brand"
              />
              <span>
                <span className="block text-body-sm font-semibold text-fg">Extended hours</span>
                <span className="block text-label text-fg-muted">
                  {extendedHoursSupported ? "Allow supported limit orders outside RTH." : "Requires a DAY equity limit order without brackets."}
                </span>
              </span>
            </label>
            <label className="grid gap-1.5">
              <span className="t-label text-fg-hint">Trailing stop</span>
              <Input
                value={trailingStop}
                onChange={(e) => setTrailingStop(e.target.value)}
                inputMode="decimal"
                placeholder="Amount or %"
                className="h-11 md:h-10"
              />
            </label>
            {bracketEnabled ? (
              <>
                <label className="grid gap-1.5">
                  <span className="t-label text-fg-hint">Take profit</span>
                  <Input
                    value={takeProfit}
                    onChange={(e) => setTakeProfit(e.target.value)}
                    inputMode="decimal"
                    placeholder="Limit target"
                    className="h-11 md:h-10"
                  />
                </label>
                <label className="grid gap-1.5">
                  <span className="t-label text-fg-hint">OCO stop</span>
                  <Input
                    value={bracketStop}
                    onChange={(e) => setBracketStop(e.target.value)}
                    inputMode="decimal"
                    placeholder="Protective stop"
                    className="h-11 md:h-10"
                  />
                </label>
              </>
            ) : null}
            <p className="md:col-span-2 text-label leading-relaxed text-fg-muted">
              TIF, extended-hours intent, and complete brackets are sent with the ticket. Route, risk size, and trailing stop remain planning notes.
            </p>
          </div>
        ) : null}
      </div>

      <span
        data-slot="order-review"
        className="col-span-2 font-display italic text-label text-fg-muted self-center md:ml-0"
      >
        {reviewCopy}
      </span>

      <div className="col-span-2 md:ml-auto md:w-auto flex flex-col items-stretch md:items-end gap-0.5">
        <Button
          ref={submitButtonRef}
          type="button"
          variant="primary"
          className={cn(
            "w-full md:w-auto min-h-11",
            submitDisabled && "!border-amber/50 !bg-bg-elev-2 !text-amber disabled:opacity-100",
          )}
          onClick={stage}
          // BUG-002 + Round-28 — disable during in-flight POST, empty
          // strategy, and when client-side qty / price / stop / symbol
          // validation fails. Backend 422 is the belt; this is suspenders.
          data-state={submitDisabled ? "stale" : undefined}
          disabled={submitting || submitDisabled || noStrategies || qtyInvalid || priceInvalid || stopInvalid || bracketInvalid || symInvalid}
          aria-busy={submitting || undefined}
          data-testid="order-bar-submit"
        >
          {submitting ? "Submitting…" : submitLabel}
        </Button>
        {submitDisabledReason ? (
          <span
            data-slot="order-submit-blocker"
            className="max-w-[320px] text-center font-sans text-body-sm leading-snug text-amber md:text-right"
          >
            {submitDisabledReason}
          </span>
        ) : null}
        <span
          data-slot="order-destination"
          className="font-mono text-body-sm text-fg-hint text-center md:text-right"
          style={{ letterSpacing: 0 }}
        >
          {submitDestination}
        </span>
        {/* BUG-002 — inline error below the button. Shows either the
            local validation message (e.g. negative qty) or the parent's
            `errorMessage` prop (e.g. the backend 422 detail). Rendered
            with role="alert" so screen readers announce on change. */}
        {(qtyLocalError || priceLocalError || stopLocalError || bracketLocalError || errorMessage) && (
          <p
            id={qtyLocalError ? "order-bar-qty-error" : undefined}
            role="alert"
            data-testid="order-bar-error"
            className="font-sans text-body-sm text-[var(--loss)] text-center md:text-right mt-1 max-w-[280px]"
          >
            {qtyLocalError ?? priceLocalError ?? stopLocalError ?? bracketLocalError ?? errorMessage}
          </p>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactElement;
}) {
  // WCAG 1.3.1 / 4.1.2 / persona 71-4 — emit an explicit ``<label
  // htmlFor>`` instead of an implicit wrapping <label>. The visible
  // caption is the accessible name; ``React.cloneElement`` injects a
  // ``React.useId``-generated id into the child input/select. Voice
  // control ("focus Strategy") and screen readers both bind on the
  // explicit ``htmlFor`` association — implicit wrapping was unreliable
  // on desktop voice-control drivers.
  const id = React.useId();
  // Only inject the id if the child doesn't already provide one. This
  // keeps the helper compatible with controls that already own their
  // id (e.g. the Symbol input, which also exposes ``name``/``data-testid``
  // for tests).
  const childWithId = React.isValidElement<{ id?: string }>(children) && !children.props.id
    ? React.cloneElement(children, { id })
    : children;
  const associatedId = React.isValidElement<{ id?: string }>(childWithId) ? childWithId.props.id ?? id : id;
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <label htmlFor={associatedId} className="t-label">
        {label}
      </label>
      {childWithId}
    </div>
  );
}
