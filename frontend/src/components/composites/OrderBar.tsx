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
 */
export interface OrderBarProps {
  symbol: string;
  strategies: StrategyOption[];
  onSubmit: (order: StagedOrder) => void;
  defaults?: Partial<StagedOrder>;
  /** Review copy on the right. Defaults to "Review before submit · regime check · risk policy". */
  reviewCopy?: string;
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
  className,
}: OrderBarProps) {
  const [strategyId, setStrategyId] = React.useState<string>(
    defaults?.strategyId ?? strategies[0]?.id ?? ""
  );
  const [side, setSide] = React.useState<OrderSide>(defaults?.side ?? "buy");
  const [quantity, setQuantity] = React.useState<string>(
    String(defaults?.quantity ?? 100)
  );
  const [type, setType] = React.useState<OrderTypeOption>(defaults?.type ?? "limit");
  const [price, setPrice] = React.useState<string>(
    defaults?.price != null ? String(defaults.price) : ""
  );
  const [stop, setStop] = React.useState<string>(defaults?.stop ?? "");

  const stage = () => {
    onSubmit({
      strategyId,
      symbol,
      side,
      quantity: Number(quantity) || 0,
      type,
      price: price ? Number(price) : undefined,
      stop: stop || undefined,
    });
  };

  return (
    <div
      data-slot="order-bar"
      className={cn(
        "flex gap-5 items-end px-7 py-4 border-t border-border bg-ink-050",
        className
      )}
    >
      <Field label="Strategy">
        <select
          aria-label="Strategy"
          value={strategyId}
          onChange={(e) => setStrategyId(e.target.value)}
          className={cn(
            "h-9 min-w-[90px] px-3 rounded-sm border border-border bg-bg-elev-1",
            "font-mono text-[13px] text-ink-1000 outline-none",
            "focus-visible:border-brand"
          )}
        >
          {strategies.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Side">
        <div className="flex gap-1.5">
          <Button
            type="button"
            variant="buy"
            data-active={side === "buy" || undefined}
            aria-pressed={side === "buy"}
            onClick={() => setSide("buy")}
          >
            Buy
          </Button>
          <Button
            type="button"
            variant="sell"
            data-active={side === "sell" || undefined}
            aria-pressed={side === "sell"}
            onClick={() => setSide("sell")}
          >
            Sell
          </Button>
        </div>
      </Field>

      <Field label="Qty">
        <Input
          aria-label="Quantity"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          className="min-w-[90px]"
        />
      </Field>

      <Field label="Type">
        <select
          aria-label="Order type"
          value={type}
          onChange={(e) => setType(e.target.value as OrderTypeOption)}
          className={cn(
            "h-9 min-w-[90px] px-3 rounded-sm border border-border bg-bg-elev-1",
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
          className="min-w-[90px]"
        />
      </Field>

      <Field label="Stop">
        <Input
          aria-label="Stop"
          value={stop}
          onChange={(e) => setStop(e.target.value)}
          className="min-w-[90px] text-down-500"
        />
      </Field>

      <span
        data-slot="order-review"
        className="font-display italic text-[12px] text-fg-muted self-center"
      >
        {reviewCopy}
      </span>

      <Button
        type="button"
        variant="primary"
        className="ml-auto"
        onClick={stage}
      >
        Stage order →
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
    <div className="flex flex-col gap-1">
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
