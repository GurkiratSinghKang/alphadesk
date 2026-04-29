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
 * pre-staged contract(s) → recent orders.
 *
 * Query-param pre-fill (Task 22/23, Round-5 F-1 / F-2 / F-3 / F-14):
 *   Single-leg:
 *     /trade?symbol=NVDA&contract=NVDA260425C00205000&side=sell&qty=1
 *           &limit=1.42&strategy=earnings-options-play
 *
 *   Multi-leg (canonical syntax — Round-5 F-3):
 *     /trade?symbol=NVDA&legs=OCC:side:qty[:limit][,OCC:side:qty[:limit]…]
 *           &strategy=earnings-options-play&combo_type=strangle
 *
 *   Backwards-compat: legs missing the `:limit` slot still parse — limit
 *   ends up undefined and the OrderBar shows blank in that field.
 *
 *   Examples:
 *     legs=NVDA260424P00200000:sell:1:1.45,NVDA260424C00220000:sell:1:1.32   (NEW — limits)
 *     legs=NVDA260424P00200000:sell:1,NVDA260424C00220000:sell:1             (OLD — still works)
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
import { ORDER_BAR_DEFAULTS, isValidOrderQty } from "@/lib/orderDefaults";
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

// ─── OCC symbol helpers ────────────────────────────────────────────────────────

/**
 * Parse an OCC option symbol into its constituent parts.
 *
 * Format: SSSSSS YYMMDD C|P NNNNNNNN  (strike is 8 digits, price × 1000)
 * Example: NVDA260425C00205000 → { symbol:"NVDA", expiry:"2026-04-25", side:"call", strike:205 }
 */
export function parseOccSymbol(occ: string): {
  symbol: string;
  expiry: string;
  side: "call" | "put";
  strike: number;
} | null {
  const m = /^([A-Z]+)(\d{6})([CP])(\d{8})$/.exec(occ);
  if (!m) return null;
  const [, sym, yymmdd, sideChar, strikeStr] = m;
  const expiry =
    "20" +
    yymmdd.slice(0, 2) +
    "-" +
    yymmdd.slice(2, 4) +
    "-" +
    yymmdd.slice(4, 6);
  return {
    symbol: sym,
    expiry,
    side: sideChar === "C" ? "call" : "put",
    strike: parseInt(strikeStr, 10) / 1000,
  };
}

function normalizeUnderlyingSymbol(raw: string | null): string | null {
  const sym = (raw ?? "").trim().toUpperCase();
  if (!sym) return null;
  return /^[A-Z][A-Z0-9.\-]{0,9}$/.test(sym) ? sym : null;
}

// ─── Pre-fill state types ──────────────────────────────────────────────────────

interface ActiveContract {
  occ: string;
  symbol: string;
  expiry: string;
  side: "call" | "put";
  strike: number;
  orderSide: "buy" | "sell";
  qty: number;
  /**
   * Round-5 F-3 — optional limit price parsed from `?limit=` (single-leg)
   * or the `:limit` slot in `?legs=` (multi-leg). Undefined when the URL
   * came from a context with no available mid (e.g. options chain
   * unavailable on the source page).
   */
  limitPrice?: number;
}

interface ActiveLeg {
  occ: string;
  symbol: string;
  expiry: string;
  side: "call" | "put";
  strike: number;
  orderSide: "buy" | "sell";
  qty: number;
  limitPrice?: number;
}

// ─────────────────────────────────────────────────────────────────────────────

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
  const setSelectedSymbol = useMarketStore((s) => s.setSelectedSymbol);
  const [urlUnderlyingSymbol, setUrlUnderlyingSymbol] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    return normalizeUnderlyingSymbol(params.get("symbol"));
  });
  const tradeContextSymbol = urlUnderlyingSymbol ?? selectedSymbol;
  // Wave 14 perf-audit-r3 P0 #3: scoped to selected symbol only.
  const selectedQuote = useQuote(tradeContextSymbol);
  const { data: strategiesResp } = useStrategies();

  const rail = useMemo(() => toRailItems(strategiesResp), [strategiesResp]);
  const strategyOptions = useMemo(() => toStrategyOptions(rail), [rail]);

  // ─── Query-param pre-fill (Task 22 / 23, Round-5 F-1 / F-2 / F-3) ──────────
  const [activeContract, setActiveContract] = useState<ActiveContract | null>(null);
  const [activeLegs, setActiveLegs] = useState<ActiveLeg[]>([]);
  // Strategy tag from URL — flows through to placeOrder so /reports
  // attributes the trade. Round-5 F-1.
  const [urlStrategy, setUrlStrategy] = useState<string | null>(null);
  // Combo classification — `strangle` | `iron_condor` | `vertical_spread`.
  // Set by the earnings deep-link; surfaced to the broker so the risk gate
  // recognises a defined-risk spread. Round-5 F-14.
  const [comboType, setComboType] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const contractOcc = params.get("contract");
    const legsParam = params.get("legs");
    const strategyParam = params.get("strategy");
    const comboParam = params.get("combo_type");
    const underlyingFromUrl = normalizeUnderlyingSymbol(params.get("symbol"));
    let firstParsedUnderlying: string | null = null;

    if (strategyParam) setUrlStrategy(strategyParam);
    if (comboParam) setComboType(comboParam);

    if (contractOcc) {
      // Single-leg deep-link.
      const parsed = parseOccSymbol(contractOcc);
      if (parsed) {
        firstParsedUnderlying = parsed.symbol;
        const rawSide = params.get("side") ?? "buy";
        const orderSide: "buy" | "sell" = rawSide === "sell" ? "sell" : "buy";
        const qty = parseInt(params.get("qty") ?? "1", 10) || 1;
        // Round-5 F-3 — `?limit=` populates the OrderBar's price field.
        const rawLimit = params.get("limit");
        const lim = rawLimit ? parseFloat(rawLimit) : NaN;
        const limitPrice = Number.isFinite(lim) && lim > 0 ? lim : undefined;
        setActiveContract({ occ: contractOcc, ...parsed, orderSide, qty, limitPrice });
      }
    } else if (legsParam) {
      // Multi-leg deep-link: comma-separated CONTRACT:side:qty[:limit] tuples.
      // Round-5 F-3: the optional `:limit` 4th field carries the per-leg
      // mid price so each pre-staged leg shows a sensible default. The
      // 3-field form (no `:limit`) keeps parsing for backwards-compat.
      const legs: ActiveLeg[] = [];
      for (const raw of legsParam.split(",")) {
        const parts = raw.split(":");
        if (parts.length < 1) continue;
        const [occ, rawSide, rawQty, rawLimit] = parts;
        const parsed = parseOccSymbol(occ);
        if (!parsed) continue;
        firstParsedUnderlying ??= parsed.symbol;
        const orderSide: "buy" | "sell" = rawSide === "sell" ? "sell" : "buy";
        const qty = parseInt(rawQty ?? "1", 10) || 1;
        const lim = rawLimit ? parseFloat(rawLimit) : NaN;
        const limitPrice = Number.isFinite(lim) && lim > 0 ? lim : undefined;
        legs.push({ occ, ...parsed, orderSide, qty, limitPrice });
      }
      if (legs.length > 0) setActiveLegs(legs);
    }
    const nextUnderlying = underlyingFromUrl ?? firstParsedUnderlying;
    if (nextUnderlying) {
      setUrlUnderlyingSymbol(nextUnderlying);
      setSelectedSymbol(nextUnderlying);
    }
  }, [setSelectedSymbol]);

  const [range, setRange] = useState<ChartRange>("1M");
  const [series, setSeries] = useState<ChartBar[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const bars = await getBars(tradeContextSymbol, "D", rangeToLimit(range));
        if (!cancelled) setSeries(bars);
      } catch {
        if (!cancelled) setSeries([]);
      }
    })();
    return () => { cancelled = true; };
  }, [tradeContextSymbol, range]);

  const quote = toQuote(selectedQuote ?? undefined);
  const meta = toMetaCells(selectedQuote ?? undefined);
  const symbol = toMarketSymbol(tradeContextSymbol);

  /* ─── Recent orders strip ──────────────────────────────── */
  const [recentOrders, setRecentOrders] = useState<Order[]>([]);
  useEffect(() => {
    let cancelled = false;
    async function fetchRecent() {
      try {
        const orders = await getOrders();
        if (!cancelled) setRecentOrders(orders.slice(0, 10));
      } catch {
        /* keep last-known orders on transient fetch failures */
      }
    }
    fetchRecent();
    const id = setInterval(fetchRecent, 20_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  /* ─── Submit handler ───────────────────────────────────── */
  const [submitting, setSubmitting] = useState(false);
  const [resetTick, setResetTick] = useState(0);
  // BUG-002 — inline-error mirror of the toast. See desk `page.tsx`.
  const [orderError, setOrderError] = useState<string | null>(null);

  async function handleSubmit(order: StagedOrder) {
    if (submitting) return;
    setOrderError(null);
    const sym = (order.symbol || "").trim().toUpperCase();
    const qty = Number(order.quantity);
    const fail = (msg: string) => {
      toast({ type: "error", message: msg });
      setOrderError(msg);
    };
    // Symbol can be a bare equity ticker OR a full OCC option contract
    // (1-6 letters + 6 digits + C/P + 8 digits). The previous regex
    // capped at 10 chars and rejected the 21-char OCC form, which broke
    // single-leg option deep-links from the earnings page.
    if (!sym || !(/^[A-Z][A-Z0-9.\-]{0,9}$/.test(sym) || /^[A-Z]{1,6}\d{6}[CP]\d{8}$/.test(sym))) {
      fail("Enter a valid symbol (1–10 letters/digits or full OCC contract)");
      return;
    }
    if (!isValidOrderQty(qty)) {
      fail("Quantity must be a whole number between 1 and 999,999,999");
      return;
    }
    if ((order.type === "limit" || order.type === "stop_limit") && (order.price == null || !Number.isFinite(order.price))) {
      fail("Limit orders require a price");
      return;
    }
    const stopNum = order.stop ? Number(order.stop) : undefined;
    if ((order.type === "stop" || order.type === "stop_limit") && (stopNum == null || !Number.isFinite(stopNum))) {
      fail("Stop orders require a stop price");
      return;
    }
    setSubmitting(true);
    try {
      // Round-5 F-14: when multi-leg legs are pre-staged from a deep-link,
      // submit them as one combo order with `legs[]` populated rather
      // than dropping them on the floor. The OrderBar's symbol/qty
      // become the first leg's by convention but the canonical legs
      // array is what reaches the broker.
      const hasLegs = activeLegs.length > 0;
      const placed = await placeOrder({
        symbol: sym,
        side: order.side,
        type: order.type,
        quantity: qty,
        price: order.price,
        stop_price: stopNum,
        // Round-5 F-1: thread the URL's strategy tag through to the
        // backend `CreateOrderRequest.strategy` field.
        strategy: urlStrategy ?? undefined,
        // Round-5 F-14: forward combo metadata when present.
        combo_type: comboType ?? undefined,
        ...(hasLegs
          ? {
              legs: activeLegs.map((leg) => ({
                symbol: leg.occ,
                side: leg.orderSide,
                quantity: leg.qty,
                price: leg.limitPrice,
              })),
            }
          : {}),
      });
      usePortfolioStore.getState().addOrder(placed);
      toast({
        type: "success",
        message: hasLegs
          ? `${activeLegs.length}-leg combo staged — ${placed.status ?? "pending"}`
          : `${order.side.toUpperCase()} ${qty} ${sym} staged — ${placed.status ?? "pending"}`,
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
      setOrderError(message);
    } finally {
      setSubmitting(false);
    }
  }

  // Round-5 F-2: when a single contract is pre-staged from a deep-link,
  // hand its OCC symbol + side + qty + limit through to the OrderBar as
  // defaults so clicking "Place order" actually places THAT contract,
  // not the equity ticker the desk happens to be on.
  // Multi-leg combos likewise pre-fill the OrderBar with the FIRST leg
  // and rely on `activeLegs` to carry the remaining legs through to the
  // submit path.
  const orderBarDefaults = useMemo(() => {
    if (activeContract) {
      return {
        ...ORDER_BAR_DEFAULTS,
        strategyId: rail[0]?.id ?? "",
        symbol: activeContract.occ,
        side: activeContract.orderSide,
        quantity: activeContract.qty,
        type:
          activeContract.limitPrice != null
            ? ("limit" as const)
            : ORDER_BAR_DEFAULTS.type,
        price: activeContract.limitPrice,
      };
    }
    if (activeLegs.length > 0) {
      const first = activeLegs[0];
      return {
        ...ORDER_BAR_DEFAULTS,
        strategyId: rail[0]?.id ?? "",
        symbol: first.occ,
        side: first.orderSide,
        quantity: first.qty,
        type:
          first.limitPrice != null
            ? ("limit" as const)
            : ORDER_BAR_DEFAULTS.type,
        price: first.limitPrice,
      };
    }
    return {
      ...ORDER_BAR_DEFAULTS,
      strategyId: rail[0]?.id ?? "",
    };
  }, [activeContract, activeLegs, rail]);

  // Viewport audit r5 #9: 100vh jumps on iOS Safari when the address bar
  // collapses — use dvh for the dynamic-viewport unit (Safari 15.4+).
  // Also the StatusStrip is 22px, not the previous 32px — matches
  // DeskLayout's grid-rows [48px_38px_1fr_22px].
  return (
    <div className="flex flex-col gap-4 p-4 md:p-6 min-h-[calc(100dvh-48px-22px)]">
      <header className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          {/* Dashboard-wave editorial header — t-label eyebrow + italic
              display title, matching DashboardPageLayout's rhythm. We
              don't swap in DashboardPageLayout wholesale because `/trade`
              runs full-bleed (chart + order bar need the extra pixels),
              but the typography should read the same as the other
              polished pages. */}
          <span className="t-label">§ TRADE</span>
          <h1 className="t-display-section">
            Trade <span className="not-italic text-fg-muted">· {symbol.ticker}</span>
          </h1>
          {urlStrategy && (
            // Round-5 F-1 — render the originating strategy as a small
            // chip so the user (and the test) can see the deep-link's
            // attribution before submission.
            <span
              data-slot="trade-strategy-tag"
              className="mt-1 inline-flex items-center gap-1 self-start rounded border border-[color:var(--border)] bg-[color:var(--bg-elev-1)] px-2 py-0.5 font-mono text-[11px] text-fg-muted"
            >
              strategy: <span className="text-fg">{urlStrategy}</span>
              {comboType && (
                <>
                  <span aria-hidden> · </span>
                  combo: <span className="text-fg">{comboType}</span>
                </>
              )}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => router.push("/")}
          className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-4 h-9 px-2"
        >
          Back to desk
        </button>
      </header>

      {/* Round-8 single-view C: chart + OrderBar are now column-paired
          at lg+ so the trader's eye doesn't have to dart up-and-down
          between the chart (decision context) and the ticket (action).
          Chart spans 7/12, OrderBar 5/12. Both stack on smaller widths.
          The OrderBar sits at ``lg:sticky top-4`` so it stays visible
          while the chart scrolls — single-page trade flow per the
          tastytrade pattern. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <section
          className="rounded-lg border border-border bg-[var(--surface)] overflow-hidden min-h-[360px] flex flex-col lg:col-span-7"
        >
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

        <section
          className="rounded-lg border border-border bg-[var(--surface)] overflow-hidden lg:col-span-5 lg:sticky lg:top-4 lg:self-start"
        >
          <OrderBar
            key={`trade-orderbar-${resetTick}`}
            symbol={tradeContextSymbol}
            strategies={strategyOptions}
            onSubmit={handleSubmit}
            submitting={submitting}
            errorMessage={orderError}
            // Round-5 F-2: when a deep-link pre-stages a contract or combo,
            // bind the OrderBar to the option's OCC symbol + side + qty +
            // limit so clicking Place actually places the option order. The
            // single-leg "Pre-staged contract" panel below is informational
            // only — the form is the source of truth.
            defaults={orderBarDefaults}
            submitLabel={
              activeLegs.length > 0
                ? `Place ${activeLegs.length}-leg combo`
                : "Place order"
            }
          />
        </section>
      </div>

      {/* ─── Pre-staged contract (single-leg deep-link) ──────────── */}
      {activeContract && (
        <section
          className="rounded-lg border border-border bg-[var(--surface)] p-4"
          aria-label="Pre-staged option contract"
        >
          <h2 className="t-display-section mb-3">Pre-staged contract</h2>
          <p className="text-xs text-muted-foreground mb-2">
            Review the contract below before placing. Nothing auto-submits.
          </p>
          {/* data-order-side is the test-observable attribute for the staged side */}
          <div
            data-order-side={activeContract.orderSide}
            data-slot="active-contract"
            className="flex flex-wrap items-center gap-3 rounded border border-border bg-[var(--bg-elev-1)] px-4 py-3 font-mono text-sm"
          >
            <span className="font-semibold text-foreground">{activeContract.occ}</span>
            <span className="text-muted-foreground">
              {activeContract.symbol} &nbsp;
              {activeContract.expiry} &nbsp;
              {activeContract.side.toUpperCase()} &nbsp;
              ${activeContract.strike}
            </span>
            <span
              className={`uppercase font-medium ${
                activeContract.orderSide === "sell"
                  ? "text-[var(--loss)]"
                  : "text-[var(--profit)]"
              }`}
            >
              {activeContract.orderSide} &times; {activeContract.qty}
            </span>
            {activeContract.limitPrice != null && (
              <span data-slot="active-contract-limit" className="text-fg-muted">
                @ ${activeContract.limitPrice.toFixed(2)}
              </span>
            )}
          </div>
        </section>
      )}

      {/* ─── Pre-staged legs (multi-leg / strangle deep-link) ────── */}
      {activeLegs.length > 0 && (
        <section
          className="rounded-lg border border-border bg-[var(--surface)] p-4"
          aria-label="Pre-staged multi-leg order"
        >
          <h2 className="t-display-section mb-3">
            Pre-staged combo order
            {comboType && (
              <span className="ml-2 not-italic font-mono text-[12px] text-fg-muted">
                · {comboType}
              </span>
            )}
          </h2>
          <p className="text-xs text-muted-foreground mb-2">
            All {activeLegs.length} legs are submitted as one combo order
            via the broker&rsquo;s combo lane. Click <em>Place</em> above to
            stage the entire combo at once.
          </p>
          <div data-slot="active-legs" className="flex flex-col gap-2">
            {activeLegs.map((leg, i) => (
              <div
                key={leg.occ}
                data-slot="active-leg"
                data-order-side={leg.orderSide}
                className="flex flex-wrap items-center gap-3 rounded border border-border bg-[var(--bg-elev-1)] px-4 py-3 font-mono text-sm"
              >
                <span className="text-xs text-muted-foreground">Leg {i + 1}</span>
                <span className="font-semibold text-foreground">{leg.occ}</span>
                <span className="text-muted-foreground">
                  {leg.symbol} &nbsp;
                  {leg.expiry} &nbsp;
                  {leg.side.toUpperCase()} &nbsp;
                  ${leg.strike}
                </span>
                <span
                  className={`uppercase font-medium ${
                    leg.orderSide === "sell"
                      ? "text-[var(--loss)]"
                      : "text-[var(--profit)]"
                  }`}
                >
                  {leg.orderSide} &times; {leg.qty}
                </span>
                {leg.limitPrice != null && (
                  <span data-slot="active-leg-limit" className="text-fg-muted">
                    @ ${leg.limitPrice.toFixed(2)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-lg border border-border bg-[var(--surface)] p-4">
        {/* Dashboard-wave typography: section header uses the display
            italic token so the `/trade` page aligns with the editorial
            voice the rest of the polished pages share. */}
        <h2 className="t-display-section mb-3">Recent orders</h2>
        {recentOrders.length === 0 ? (
          // Editorial empty-state — mirrors the alerts / analytics voice:
          // italic-serif headline sentence, sans sentence-case subtitle.
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <p className="font-display italic text-[15px] text-fg">
              No orders yet today.
            </p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              Stage one above and it&rsquo;ll appear here as soon as the broker acknowledges.
            </p>
          </div>
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
                {/* t-label token — matches dashboard-wave "eyebrow" style
                    (caps, tracked 0.12em, 12px sans) so column headers in
                    `/trade` read the same as every other polished page. */}
                <tr className="text-left border-b border-border">
                  {/* BUG-041: Date column added alongside Time so a
                      multi-day list (pre-market orders, pending orders
                      that fill tomorrow) is disambiguated at a glance. */}
                  <th scope="col" className="py-2 px-2 t-label">Date</th>
                  <th scope="col" className="py-2 px-2 t-label">Time</th>
                  <th scope="col" className="py-2 px-2 t-label">Symbol</th>
                  <th scope="col" className="py-2 px-2 t-label">Side</th>
                  <th scope="col" className="py-2 px-2 t-label">Qty</th>
                  <th scope="col" className="py-2 px-2 t-label">Type</th>
                  {/* Round-5 F-13 — Strategy column. Maps to
                      `order.strategy` (forwarded by the backend after
                      F-1 lands). Empty (em-dash) when null. */}
                  <th scope="col" className="py-2 px-2 t-label">Strategy</th>
                  <th scope="col" className="py-2 px-2 t-label">Status</th>
                </tr>
              </thead>
              <tbody>
                {recentOrders.map((o) => (
                  <tr key={o.id} className="border-b border-border/40">
                    <td className="py-2 px-2 t-meta">
                      {o.createdAt
                        ? new Date(o.createdAt).toLocaleDateString(undefined, {
                            year: "numeric",
                            month: "short",
                            day: "2-digit",
                          })
                        : "—"}
                    </td>
                    <td className="py-2 px-2 t-meta">
                      {o.createdAt ? new Date(o.createdAt).toLocaleTimeString() : "—"}
                    </td>
                    <td className="py-2 px-2 font-mono text-foreground">{o.symbol}</td>
                    <td className={`py-2 px-2 uppercase tracking-wider font-medium ${
                      o.side === "buy" ? "text-[var(--profit)]" : "text-[var(--loss)]"
                    }`}>
                      {o.side}
                    </td>
                    <td className="py-2 px-2 t-num-md text-foreground">{o.quantity}</td>
                    <td className="py-2 px-2 text-muted-foreground capitalize">
                      {o.type.replace("_", " ")}
                    </td>
                    <td className="py-2 px-2 font-mono text-[11px] text-foreground">
                      {o.strategy ?? "—"}
                    </td>
                    <td className="py-2 px-2">
                      {/* Status pill — legibility upgrade. Raw status
                          strings blended into body text; a colour-token
                          chip makes filled vs. rejected vs. working
                          glanceable without re-reading. Same token map
                          PositionsList uses (STATUS_CHIP) kept inline to
                          stay self-contained without importing a shared
                          composite the brief scoped away. */}
                      <span
                        className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
                          o.status === "filled"
                            ? "bg-[var(--profit)]/15 text-[var(--profit)]"
                            : o.status === "rejected"
                            ? "bg-[var(--loss)]/15 text-[var(--loss)]"
                            : o.status === "cancelled"
                            ? "bg-[var(--neutral)]/15 text-[var(--neutral)]"
                            : "bg-[var(--chart-4)]/15 text-[var(--chart-4)]"
                        }`}
                      >
                        {o.status}
                      </span>
                    </td>
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
