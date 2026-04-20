"use client";

/**
 * `/trade` — full-screen trade workspace.
 *
 * The earlier stub on this route redirected straight back to `/` which
 * created a nav loop whenever the TopBar / shortcuts / CommandPalette
 * pointed here. This implementation renders a focused trade workspace
 * composed entirely of existing Layer-2 composites so we're not inventing
 * new UI while the panel retirement pass is in-flight.
 *
 * Layout (single-column, scrolls): heading → chart → order bar →
 * recent orders.
 */
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import {
  OrderBar,
  PriceChartPanel,
  type ChartBar,
  type ChartRange,
  type StagedOrder,
} from "@/components/composites";
import { getBars, getOrders, placeOrder } from "@/lib/api";
import type { Order } from "@/types";
import { useMarketStore, useQuote } from "@/stores/market";
import { usePortfolioStore } from "@/stores/portfolio";
import { useStrategies } from "@/hooks/useQueries";
import { useToast } from "@/hooks/useToast";

import {
  toMarketSymbol,
  toMetaCells,
  toQuote,
  toRailItems,
  toStrategyOptions,
} from "../_desk/selectors";

function rangeToLimit(r: ChartRange): number {
  switch (r) {
    case "1D": return 2;
    case "5D": return 5;
    case "1M": return 22;
    case "3M": return 66;
    case "6M": return 132;
    case "YTD": return 260;
    case "1Y": return 260;
    case "ALL": return 1000;
  }
}

export default function TradePage() {
  const router = useRouter();
  const { toast } = useToast();
  const selectedSymbol = useMarketStore((s) => s.selectedSymbol);
  // Wave 14 perf-audit-r3 P0 #3: scoped to selected symbol only.
  const selectedQuote = useQuote(selectedSymbol);
  const { data: strategiesResp } = useStrategies();

  const rail = useMemo(() => toRailItems(strategiesResp), [strategiesResp]);
  const strategyOptions = useMemo(() => toStrategyOptions(rail), [rail]);

  const [range, setRange] = useState<ChartRange>("1M");
  const [series, setSeries] = useState<ChartBar[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const bars = await getBars(selectedSymbol, "D", rangeToLimit(range));
        if (!cancelled) setSeries(bars);
      } catch {
        if (!cancelled) setSeries([]);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedSymbol, range]);

  const quote = toQuote(selectedQuote ?? undefined);
  const meta = toMetaCells(selectedQuote ?? undefined);
  const symbol = toMarketSymbol(selectedSymbol);

  /* ─── Recent orders strip ──────────────────────────────── */
  const [recentOrders, setRecentOrders] = useState<Order[]>([]);
  useEffect(() => {
    let cancelled = false;
    async function fetchRecent() {
      try {
        const orders = await getOrders();
        if (!cancelled) setRecentOrders(orders.slice(0, 10));
      } catch {
        if (!cancelled) setRecentOrders([]);
      }
    }
    fetchRecent();
    const id = setInterval(fetchRecent, 20_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  /* ─── Submit handler ───────────────────────────────────── */
  const [submitting, setSubmitting] = useState(false);
  const [resetTick, setResetTick] = useState(0);

  async function handleSubmit(order: StagedOrder) {
    if (submitting) return;
    const sym = (order.symbol || "").trim().toUpperCase();
    const qty = Number(order.quantity);
    if (!sym || !/^[A-Z][A-Z0-9.\-]{0,9}$/.test(sym)) {
      toast({ type: "error", message: "Enter a valid symbol (1–10 letters/digits)" });
      return;
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      toast({ type: "error", message: "Quantity must be a positive number" });
      return;
    }
    if ((order.type === "limit" || order.type === "stop_limit") && (order.price == null || !Number.isFinite(order.price))) {
      toast({ type: "error", message: "Limit orders require a price" });
      return;
    }
    const stopNum = order.stop ? Number(order.stop) : undefined;
    if ((order.type === "stop" || order.type === "stop_limit") && (stopNum == null || !Number.isFinite(stopNum))) {
      toast({ type: "error", message: "Stop orders require a stop price" });
      return;
    }
    setSubmitting(true);
    try {
      const placed = await placeOrder({
        symbol: sym,
        side: order.side,
        type: order.type,
        quantity: qty,
        price: order.price,
        stop_price: stopNum,
      });
      usePortfolioStore.getState().addOrder(placed);
      toast({
        type: "success",
        message: `${order.side.toUpperCase()} ${qty} ${sym} staged — ${placed.status ?? "pending"}`,
      });
      setResetTick((t) => t + 1);
      // Refresh recent orders strip immediately.
      try {
        const orders = await getOrders();
        setRecentOrders(orders.slice(0, 10));
      } catch { /* no-op */ }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Order submission failed";
      toast({ type: "error", message });
    } finally {
      setSubmitting(false);
    }
  }

  // Viewport audit r5 #9: 100vh jumps on iOS Safari when the address bar
  // collapses — use dvh for the dynamic-viewport unit (Safari 15.4+).
  // Also the StatusStrip is 22px, not the previous 32px — matches
  // DeskLayout's grid-rows [48px_38px_1fr_22px].
  return (
    <div className="flex flex-col gap-4 p-4 md:p-6 min-h-[calc(100dvh-48px-22px)]">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Trade</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Full-screen order workspace · {symbol.ticker}
          </p>
        </div>
        <button
          type="button"
          onClick={() => router.push("/")}
          className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-4"
        >
          Back to desk
        </button>
      </header>

      <section className="rounded-lg border border-border bg-[var(--surface)] overflow-hidden min-h-[360px] flex flex-col">
        <PriceChartPanel
          symbol={symbol}
          quote={quote}
          meta={meta}
          series={series}
          activeRange={range}
          onRangeChange={setRange}
          className="flex-1 min-h-[360px]"
        />
      </section>

      <section className="rounded-lg border border-border bg-[var(--surface)] overflow-hidden">
        <OrderBar
          key={`trade-orderbar-${resetTick}`}
          symbol={selectedSymbol}
          strategies={strategyOptions}
          onSubmit={handleSubmit}
          submitting={submitting}
          defaults={{
            strategyId: rail[0]?.id ?? "",
            side: "buy",
            quantity: 100,
            type: "limit",
          }}
        />
      </section>

      <section className="rounded-lg border border-border bg-[var(--surface)] p-4">
        <h2 className="text-sm font-semibold text-foreground mb-3">Recent orders</h2>
        {recentOrders.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">
            No orders yet — submit one above to see it here.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              {/* Persona 71-5 — sr-only caption + scope="col" on every th
                  so AT can announce the table structure. The on-screen
                  "Recent orders" heading above supplies the visible
                  context; this caption duplicates it for screen readers
                  that only read the table landmark. */}
              <caption className="sr-only">Recent orders</caption>
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th scope="col" className="py-2 px-2 font-medium">Time</th>
                  <th scope="col" className="py-2 px-2 font-medium">Symbol</th>
                  <th scope="col" className="py-2 px-2 font-medium">Side</th>
                  <th scope="col" className="py-2 px-2 font-medium">Qty</th>
                  <th scope="col" className="py-2 px-2 font-medium">Type</th>
                  <th scope="col" className="py-2 px-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {recentOrders.map((o) => (
                  <tr key={o.id} className="border-b border-border/40">
                    <td className="py-2 px-2 text-muted-foreground tabular-nums">
                      {o.createdAt ? new Date(o.createdAt).toLocaleTimeString() : "—"}
                    </td>
                    <td className="py-2 px-2 font-mono text-foreground">{o.symbol}</td>
                    <td className={`py-2 px-2 uppercase tracking-wider font-medium ${
                      o.side === "buy" ? "text-[var(--profit)]" : "text-[var(--loss)]"
                    }`}>
                      {o.side}
                    </td>
                    <td className="py-2 px-2 tabular-nums text-foreground">{o.quantity}</td>
                    <td className="py-2 px-2 text-muted-foreground">{o.type}</td>
                    <td className="py-2 px-2 text-foreground">{o.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
