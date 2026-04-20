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
  onSubmit: (order: StagedOrder) => void;
  defaults?: Partial<StagedOrder>;
  /** Review copy on the right. Defaults to "Review before submit · regime check · risk policy". */
  reviewCopy?: string;
  /** Parent flag — disables Stage + shows "Submitting…" while the API request is in flight. */
  submitting?: boolean;
  /**
   * Small subtitle rendered under the primary button. Defaults to
   * "Submits to paper account". Parent can swap in "Submits to LIVE account"
   * when the backend base URL indicates live trading.
   */
  submitDestination?: string;
  /** Primary button label. Defaults to "Place order". */
  submitLabel?: string;
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
  submitDestination = "Submits to paper account",
  submitLabel = "Place order",
  className,
}: OrderBarProps) {
  const noStrategies = strategies.length === 0;
  const [strategyId, setStrategyId] = React.useState<string>(
    defaults?.strategyId ?? strategies[0]?.id ?? ""
  );
  // When strategies resolve later (React Query), adopt the first one as
  // the sensible default so the select doesn't stay on an empty string.
  React.useEffect(() => {
    if (!strategyId && strategies[0]?.id) {
      setStrategyId(strategies[0].id);
    }
  }, [strategies, strategyId]);

  const [side, setSide] = React.useState<OrderSide>(defaults?.side ?? "buy");
  const [symbolValue, setSymbolValue] = React.useState<string>(symbol);
  React.useEffect(() => {
    setSymbolValue(symbol);
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

  const stage = () => {
    if (submitting) return;
    onSubmit({
      strategyId,
      symbol: (symbolValue || symbol).trim().toUpperCase(),
      side,
      quantity: Number(quantity) || 0,
      type,
      price: price ? Number(price) : undefined,
      stop: stop || undefined,
    });
  };

  const strategyPlaceholder = noStrategies ? "No strategies registered" : undefined;

  return (
    <div
      data-slot="order-bar"
      data-tour="order-bar"
      className={cn(
        // Mobile: 2-col grid, stacked. md+: horizontal flex row.
        "grid grid-cols-2 gap-3 items-end px-4 py-4 border-t border-border bg-ink-050",
        // Viewport audit r5 #7: 7 fields × 90px + gaps + review span + Stage
        // button overflows the center column at 1280-1380 (mid-laptop with
        // rail+right aside). Allow wrapping to 2 rows below xl; keep a single
        // non-wrapping row at xl+ where the desk center has enough room.
        "md:flex md:flex-row md:flex-wrap xl:flex-nowrap md:gap-5 md:px-7",
        className
      )}
    >
      <Field label="Strategy">
        <select
          aria-label="Strategy"
          value={strategyId}
          onChange={(e) => setStrategyId(e.target.value)}
          disabled={noStrategies}
          className={cn(
            "h-11 md:h-9 min-w-[90px] w-full px-3 rounded-sm border border-border bg-bg-elev-1",
            // iOS Safari auto-zooms on tap of any <input>/<select> with an
            // effective font-size < 16px. text-base (16px) on mobile keeps
            // the viewport stable; md+ keeps the dense 13px we use at desk
            // resolutions where tap-zoom isn't a concern.
            "font-mono text-base md:text-[13px] text-ink-1000 outline-none",
            // a11y audit r3 — WCAG 2.4.7: outline-none + 1px brand border
            // change was not a visible focus cue. Add a ring so keyboard
            // users can see which select is focused.
            "focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0",
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
        {/* persona-99 #2 — stack Buy/Sell on separate rows below md with a
            24px gap, and use solid destructive colour for Sell so the
            visual cue goes beyond the label. Single-tap Sell arms a
            confirmation state; second tap commits. Desktop (md+) keeps the
            inline row with the tinted variants. */}
        <div className="flex flex-col md:flex-row gap-6 md:gap-1.5 w-full col-span-2 md:col-span-1">
          <Button
            type="button"
            variant="buy-solid"
            data-active={side === "buy" || undefined}
            aria-pressed={side === "buy"}
            onClick={() => handleSideClick("buy")}
            className={cn(
              "min-h-11 min-w-11 md:min-h-9 md:min-w-0 w-full md:w-auto md:flex-initial",
              // Desktop falls back to the tinted variant look so we keep
              // the editorial workstation palette at the desk resolutions.
              "md:!bg-up-500/10 md:!text-up-500 md:!border-up-500/30",
              side !== "buy" && "opacity-70"
            )}
          >
            Buy
          </Button>
          <Button
            type="button"
            variant="sell-solid"
            data-active={side === "sell" || undefined}
            aria-pressed={side === "sell"}
            onClick={() => handleSideClick("sell")}
            className={cn(
              "min-h-11 min-w-11 md:min-h-9 md:min-w-0 w-full md:w-auto md:flex-initial",
              "md:!bg-down-500/10 md:!text-down-500 md:!border-down-500/30",
              side !== "sell" && !sellArming && "opacity-70"
            )}
          >
            {sellArming ? "Tap again to confirm" : "Sell"}
          </Button>
        </div>
      </Field>

      <Field label="Symbol">
        <Input
          aria-label="Symbol"
          name="symbol"
          data-testid="order-bar-symbol"
          value={symbolValue}
          onChange={(e) => setSymbolValue(e.target.value.toUpperCase())}
          inputMode="text"
          autoCapitalize="characters"
          spellCheck={false}
          className="min-w-[90px] w-full h-11 md:h-9"
        />
      </Field>

      <Field label="Qty">
        <Input
          aria-label="Quantity"
          name="qty"
          data-testid="order-bar-qty"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          onFocus={handleQtyFocus}
          inputMode="numeric"
          pattern="[0-9]*"
          className="min-w-[90px] w-full h-11 md:h-9"
        />
      </Field>

      <Field label="Type">
        <select
          aria-label="Order type"
          value={type}
          onChange={(e) => setType(e.target.value as OrderTypeOption)}
          className={cn(
            "h-11 md:h-9 min-w-[90px] w-full px-3 rounded-sm border border-border bg-bg-elev-1",
            // iOS autozoom guard — see Strategy select above.
            "font-mono text-base md:text-[13px] text-ink-1000 outline-none",
            // a11y audit r3 — WCAG 2.4.7: matching visible focus ring on the
            // Type select (same treatment as the Strategy select above).
            "focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
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
          aria-label="Price"
          value={priceRequired ? price : ""}
          onChange={(e) => setPrice(e.target.value)}
          inputMode="decimal"
          placeholder={priceRequired ? undefined : "—"}
          disabled={!priceRequired}
          className={cn(
            "min-w-[90px] w-full h-11 md:h-9",
            !priceRequired && "opacity-50 cursor-not-allowed"
          )}
        />
      </Field>

      <Field label="Stop">
        <Input
          aria-label="Stop"
          value={stopRequired ? stop : ""}
          onChange={(e) => setStop(e.target.value)}
          inputMode="decimal"
          placeholder={stopRequired ? undefined : "—"}
          disabled={!stopRequired}
          className={cn(
            "min-w-[90px] w-full h-11 md:h-9 text-down-500",
            !stopRequired && "opacity-50 cursor-not-allowed"
          )}
        />
      </Field>

      <span
        data-slot="order-review"
        className="col-span-2 font-display italic text-[12px] text-fg-muted self-center md:ml-0"
      >
        {reviewCopy}
      </span>

      <div className="col-span-2 md:ml-auto md:w-auto flex flex-col items-stretch md:items-end gap-0.5">
        <Button
          ref={submitButtonRef}
          type="button"
          variant="primary"
          className="w-full md:w-auto min-h-11"
          onClick={stage}
          disabled={submitting || noStrategies}
          data-testid="order-bar-submit"
        >
          {submitting ? "Submitting…" : submitLabel}
        </Button>
        <span
          data-slot="order-destination"
          className="font-mono text-[9.5px] text-fg-hint text-center md:text-right"
          style={{ letterSpacing: "0.05em" }}
        >
          {submitDestination}
        </span>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  // WCAG / persona 71-4 — render a real <label> wrapping both caption and
  // input so voice control ("select Strategy") and screen readers can bind
  // the visible caption to the associated form control. Previously the
  // caption rendered as a <span> and the input carried only an
  // `aria-label`, which some AT announced correctly but desktop voice-
  // control drivers did not associate with the field.
  return (
    <label className="flex flex-col gap-1 min-w-0">
      <span
        className="font-sans font-semibold text-[9.5px] uppercase text-fg-muted"
        style={{ letterSpacing: "0.14em" }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}
