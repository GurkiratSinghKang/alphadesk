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
  const [quantity, setQuantity] = React.useState<string>(
    String(defaults?.quantity ?? 100)
  );
  const [type, setType] = React.useState<OrderTypeOption>(defaults?.type ?? "limit");
  const [price, setPrice] = React.useState<string>(
    defaults?.price != null ? String(defaults.price) : ""
  );
  const [stop, setStop] = React.useState<string>(defaults?.stop ?? "");

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
        "md:flex md:flex-row md:gap-5 md:px-7",
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
            "font-mono text-[13px] text-ink-1000 outline-none",
            "focus-visible:border-brand",
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
        <div className="flex gap-1.5 w-full">
          <Button
            type="button"
            variant="buy"
            data-active={side === "buy" || undefined}
            aria-pressed={side === "buy"}
            onClick={() => setSide("buy")}
            className="min-h-11 min-w-11 md:min-h-9 md:min-w-0 flex-1 md:flex-initial"
          >
            Buy
          </Button>
          <Button
            type="button"
            variant="sell"
            data-active={side === "sell" || undefined}
            aria-pressed={side === "sell"}
            onClick={() => setSide("sell")}
            className="min-h-11 min-w-11 md:min-h-9 md:min-w-0 flex-1 md:flex-initial"
          >
            Sell
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
            "font-mono text-[13px] text-ink-1000 outline-none",
            "focus-visible:border-brand"
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
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          inputMode="decimal"
          className="min-w-[90px] w-full h-11 md:h-9"
        />
      </Field>

      <Field label="Stop">
        <Input
          aria-label="Stop"
          value={stop}
          onChange={(e) => setStop(e.target.value)}
          inputMode="decimal"
          className="min-w-[90px] w-full h-11 md:h-9 text-down-500"
        />
      </Field>

      <span
        data-slot="order-review"
        className="col-span-2 font-display italic text-[12px] text-fg-muted self-center md:ml-0"
      >
        {reviewCopy}
      </span>

      <Button
        type="button"
        variant="primary"
        className="col-span-2 w-full md:ml-auto md:w-auto min-h-11"
        onClick={stage}
        disabled={submitting || noStrategies}
      >
        {submitting ? "Submitting…" : "Stage order →"}
      </Button>
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
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <span
        className="font-sans font-semibold text-[9.5px] uppercase text-fg-muted"
        style={{ letterSpacing: "0.14em" }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}
