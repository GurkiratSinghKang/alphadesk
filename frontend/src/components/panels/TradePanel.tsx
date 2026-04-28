"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Plus,
  Minus,
  Trash2,
  ShieldCheck,
  AlertTriangle,
  Loader2,
  X,
  BookOpen,
  Briefcase,
  FileText,
} from "lucide-react";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useMarketStore, useQuote, useQuotes } from "@/stores/market";
import { useUIStore } from "@/stores/ui";
import { usePortfolioStore } from "@/stores/portfolio";
import { useOptionsStore, type SelectedStrike } from "@/stores/options";
import { placeOrder, cancelOrder } from "@/lib/api";
import { useToast } from "@/hooks/useToast";
import type { PlaceOrderPayload } from "@/lib/api";
import type { Position } from "@/types";
import {
  formatCurrency,
  formatGreek,
  getChangeTextClass,
  cn,
} from "@/lib/utils";
import { HelpCircle } from "@/components/ui/HelpCircle";
import { safeGetItem, safeSetItem } from "@/lib/storage";
import { PnlCalendar } from "@/components/panels/PnlCalendar";
import { PayoffDiagram, type OptionLeg } from "@/components/panels/PayoffDiagram";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

// ─── Trade Builder ───────────────────────────────────────────

interface TradeLeg {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  type: "call" | "put" | "stock";
  strike?: number;
  expiry?: string;
  delta?: number | null;
  /**
   * Greeks — `null` when the live chain did not expose the greek for this
   * contract. Renderers must show `—` for null rather than treating it as 0.
   */
  gamma?: number | null;
  theta?: number | null;
  vega?: number | null;
}

/**
 * Build an OCC-format option symbol from the leg metadata.
 *
 * Wave 4P Fix 4 (P98). Before this helper the submit path called
 * `l.symbol` for every leg, which was the underlying ticker — the
 * strike / expiry / call-or-put were dropped on the floor and the
 * backend saw an EQUITY order for an AAPL position when the user
 * picked an AAPL call.
 *
 * OCC format: ROOT(1-6) + YYMMDD + C|P + 8-digit strike × 1000.
 * Example: AAPL expiring 2026-04-20 call with $270 strike →
 *   `AAPL260420C00270000`
 *
 * Returns `null` for legs that aren't valid options (stock legs,
 * missing strike/expiry, unparseable date). Callers fall back to
 * the underlying symbol on null so at least one valid order reaches
 * the backend instead of a 422 for every leg.
 */
export function buildOccSymbol(leg: TradeLeg): string | null {
  if (leg.type !== "call" && leg.type !== "put") return null;
  if (leg.strike == null || leg.strike <= 0) return null;
  if (!leg.expiry) return null;

  // Accept either `YYYY-MM-DD` or `YYYYMMDD`; normalise to YYMMDD.
  let y: number;
  let m: number;
  let d: number;
  const iso = leg.expiry.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    y = parseInt(iso[1], 10);
    m = parseInt(iso[2], 10);
    d = parseInt(iso[3], 10);
  } else {
    const compact = leg.expiry.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (!compact) return null;
    y = parseInt(compact[1], 10);
    m = parseInt(compact[2], 10);
    d = parseInt(compact[3], 10);
  }
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    return null;
  }
  // OCC uses a two-digit year (21st-century assumed).
  const yy = String(y % 100).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  const dd = String(d).padStart(2, "0");

  const cp = leg.type === "call" ? "C" : "P";

  // Strike is stored as price × 1000 in 8 digits.  Round-half-up to
  // the nearest 1/1000 so fractional strikes round predictably rather
  // than truncating pennies silently.
  const strikeScaled = Math.round(leg.strike * 1000);
  if (strikeScaled <= 0 || strikeScaled > 99999999) return null;
  const strikeStr = String(strikeScaled).padStart(8, "0");

  // Underlying: uppercase, strip dots (OCC root is alnum only).
  const root = (leg.symbol || "").toUpperCase().replace(/[.\-]/g, "");
  if (!root || root.length > 6) return null;

  return `${root}${yy}${mm}${dd}${cp}${strikeStr}`;
}

function detectStrategy(legs: TradeLeg[]): string {
  if (legs.length === 0) return "No Legs";
  if (legs.length === 1) {
    const l = legs[0];
    if (l.type === "stock") return l.side === "buy" ? "Long Stock" : "Short Stock";
    return `${l.side === "buy" ? "Long" : "Short"} ${l.type === "call" ? "Call" : "Put"}`;
  }
  if (legs.length === 2) {
    const [a, b] = legs;
    if (a.type === "call" && b.type === "call" && a.side !== b.side) {
      if ((a.side === "buy" && (a.strike ?? 0) < (b.strike ?? 0)) ||
          (b.side === "buy" && (b.strike ?? 0) < (a.strike ?? 0))) {
        return "Bull Call Spread";
      }
      return "Bear Call Spread";
    }
    if (a.type === "put" && b.type === "put" && a.side !== b.side) {
      if ((a.side === "buy" && (a.strike ?? 0) > (b.strike ?? 0)) ||
          (b.side === "buy" && (b.strike ?? 0) > (a.strike ?? 0))) {
        return "Bear Put Spread";
      }
      return "Bull Put Spread";
    }
    if (a.type !== b.type && a.side === b.side) {
      return a.side === "buy" ? "Long Straddle/Strangle" : "Short Straddle/Strangle";
    }
    return "Custom Spread";
  }
  if (legs.length === 4) {
    const calls = legs.filter((l) => l.type === "call");
    const puts = legs.filter((l) => l.type === "put");
    if (calls.length === 2 && puts.length === 2) return "Iron Condor";
    if (calls.length === 3 || puts.length === 3) return "Butterfly";
    return "Custom 4-Leg";
  }
  return `Custom ${legs.length}-Leg`;
}

function TradeBuilderTab() {
  const { selectedSymbol } = useMarketStore();
  const { tradingMode } = useUIStore();
  const addOrder = usePortfolioStore((s) => s.addOrder);
  const selectedStrikes = useOptionsStore((s) => s.selectedStrikes);

  const [legs, setLegs] = useState<TradeLeg[]>([]);
  const { toast } = useToast();

  const [submitting, setSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingOrder, setPendingOrder] = useState<PlaceOrderPayload | null>(null);

  useEffect(() => {
    setLegs((prev) =>
      prev.map((l) => ({ ...l, symbol: selectedSymbol }))
    );
  }, [selectedSymbol]);

  useEffect(() => {
    if (selectedStrikes.length === 0) return;
    // Greeks come from the live chain or not at all. Audit P0-5 removed the
    // hardcoded `gamma: 0.01, theta: -0.02, vega: 0.08` constants — legs
    // now carry `null` for any greek the chain did not emit, and the leg
    // summary renders em-dashes for those rows.
    const newLegs: TradeLeg[] = selectedStrikes.map(
      (s: SelectedStrike, i: number) => ({
        id: `opt-${Date.now()}-${i}`,
        symbol: selectedSymbol,
        side: (i % 2 === 0 ? "buy" : "sell") as "buy" | "sell",
        quantity: 1,
        price: s.price,
        type: s.type,
        strike: s.strike,
        expiry: s.expiry,
        delta: s.type === "call" ? s.delta : -s.delta,
        gamma: s.gamma ?? null,
        theta: s.theta ?? null,
        vega: s.vega ?? null,
      })
    );
    setLegs(newLegs);
  }, [selectedStrikes, selectedSymbol]);

  const netDebit = legs.reduce((sum, l) => {
    const price = l.price ?? 0;
    const qty = l.quantity ?? 0;
    const cost = price * qty * 100;
    return sum + (l.side === "buy" ? -cost : cost);
  }, 0);

  /**
   * Aggregate greeks — only roll up greeks that every leg actually has.
   * When a leg carries `null` for a greek, the aggregate for that greek is
   * `null` (rendered as em-dash). Net delta is still computed because delta
   * is required on every leg derived from an option click.
   */
  const aggregateGreeks = useMemo(() => {
    const sum = (key: "delta" | "gamma" | "theta" | "vega"): number | null => {
      let acc = 0;
      for (const leg of legs) {
        const v = leg[key];
        if (v == null) return null; // missing greek — cannot roll up
        const mult = leg.side === "buy" ? leg.quantity : -leg.quantity;
        acc += v * mult;
      }
      return acc;
    };
    return {
      delta: sum("delta"),
      gamma: sum("gamma"),
      theta: sum("theta"),
      vega: sum("vega"),
    };
  }, [legs]);

  const strategyName = useMemo(() => detectStrategy(legs), [legs]);

  const strikes = legs.filter((l) => l.strike).map((l) => l.strike!);
  const minStrike = Math.min(...(strikes.length ? strikes : [0]));
  const maxStrike = Math.max(...(strikes.length ? strikes : [0]));
  const spreadWidth = maxStrike > minStrike ? (maxStrike - minStrike) * 100 : 0;
  let maxProfit: number;
  let maxLoss: number;
  if (netDebit >= 0) {
    // Credit spread: profit is credit received, loss is spread width minus credit
    maxProfit = netDebit;
    maxLoss = spreadWidth > 0 ? spreadWidth - netDebit : netDebit;
  } else {
    // Debit spread: loss is debit paid, profit is spread width minus debit
    maxLoss = Math.abs(netDebit);
    maxProfit = spreadWidth > 0 ? spreadWidth - Math.abs(netDebit) : Math.abs(netDebit);
  }
  const breakeven = minStrike > 0 ? minStrike + Math.abs(netDebit) / 100 : 0;

  // Build option legs for payoff diagram (only options, not stock legs)
  const payoffLegs = useMemo<OptionLeg[]>(() => {
    return legs
      .filter((l) => l.type === "call" || l.type === "put")
      .filter((l) => l.strike != null && l.strike > 0)
      .map((l) => ({
        strike: l.strike!,
        type: l.type as "call" | "put",
        side: l.side,
        premium: l.price,
        quantity: l.quantity,
      }));
  }, [legs]);

  // Wave 14 perf-audit-r3 P0 #3: scoped to the selected symbol so this form
  // panel doesn't rerender on every unrelated WS tick.
  const currentQuote = useQuote(selectedSymbol);

  const updateLegQty = (id: string, delta: number) => {
    setLegs((prev) =>
      prev.map((l) =>
        l.id === id ? { ...l, quantity: Math.max(1, l.quantity + delta) } : l
      )
    );
  };

  const removeLeg = (id: string) => {
    setLegs((prev) => prev.filter((l) => l.id !== id));
  };

  const addLeg = () => {
    setLegs((prev) => [
      ...prev,
      {
        id: String(Date.now()),
        symbol: selectedSymbol,
        side: "buy",
        quantity: 1,
        price: 0,
        type: "call",
        strike: undefined,
        expiry: undefined,
        delta: null,
        gamma: null,
        theta: null,
        vega: null,
      },
    ]);
  };

  const handleSubmit = useCallback(() => {
    if (legs.length === 0 || submitting) return;
    // Wave 4P Fix 4 (P98): build OCC-format option symbols for every
    // option leg so the backend sees the strike/expiry/call-put
    // encoded in the symbol. Stock legs keep the underlying ticker.
    // If OCC construction fails (missing expiry / bad strike) we
    // fall back to the underlying + surface a toast so the trader
    // sees it rather than a confusing 422 from the backend.
    let occBuildWarned = false;
    const payload: PlaceOrderPayload = {
      symbol: selectedSymbol,
      side: legs[0].side,
      type: "limit",
      quantity: legs[0].quantity,
      price: legs[0].price,
      legs: legs.map((l) => {
        if (l.type === "call" || l.type === "put") {
          const occ = buildOccSymbol(l);
          if (occ) {
            return {
              symbol: occ,
              side: l.side,
              quantity: l.quantity,
              price: l.price,
            };
          }
          if (!occBuildWarned) {
            occBuildWarned = true;
            toast({
              type: "error",
              message:
                "Option leg missing strike or expiry — submitting underlying only",
            });
          }
        }
        return {
          symbol: l.symbol,
          side: l.side,
          quantity: l.quantity,
          price: l.price,
        };
      }),
    };
    setPendingOrder(payload);
    setConfirmOpen(true);
  }, [legs, submitting, selectedSymbol, toast]);

  const confirmSubmit = useCallback(async () => {
    if (!pendingOrder || submitting) return;
    setSubmitting(true);
    setConfirmOpen(false);
    try {
      const order = await placeOrder(pendingOrder);
      addOrder(order);
      setPendingOrder(null);
    } catch (err: any) {
      toast({ type: "error", message: "Order failed: " + (err?.message || "Unknown error") });
    } finally {
      setSubmitting(false);
    }
  }, [pendingOrder, submitting, addOrder, toast]);

  return (
    <div className="flex h-full flex-col p-3">
      {/* Strategy name */}
      <div className="flex items-center justify-between mb-2">
        <Badge
          variant="outline"
          className="text-[10px] px-2 border-primary/30 text-primary"
        >
          {strategyName}
        </Badge>
        <span className="text-[10px] text-muted-foreground">
          {selectedSymbol}
        </span>
      </div>

      {/* Legs */}
      <div className="space-y-1 mb-2">
        {legs.length === 0 && (
          <div className="flex flex-col items-center justify-center py-4 text-center">
            <p className="text-xs text-muted-foreground mb-0.5">No legs added</p>
            <p className="text-[10px] text-muted-foreground/60">Click calls/puts in the options chain, or press &quot;Add Leg&quot; below</p>
          </div>
        )}
        {legs.map((leg) => (
          <div
            key={leg.id}
            className="flex items-center gap-2 rounded-md bg-background/50 px-2 py-1.5 text-xs"
          >
            <Badge
              variant="outline"
              className={cn(
                "text-[9px] px-1.5 py-0",
                leg.side === "buy"
                  ? "border-[var(--profit)]/40 text-[var(--profit)]"
                  : "border-[var(--loss)]/40 text-[var(--loss)]"
              )}
            >
              {leg.side.toUpperCase()}
            </Badge>
            <span className="flex-1 text-foreground">
              {leg.strike ? `${leg.strike} ${leg.type.charAt(0).toUpperCase()} ${leg.expiry?.slice(5)}` : leg.type}
            </span>
            <div className="flex items-center gap-1">
              <button
                aria-label="Decrease quantity"
                onClick={() => updateLegQty(leg.id, -1)}
                className="h-5 w-5 flex items-center justify-center rounded bg-accent/50 text-muted-foreground hover:text-foreground"
              >
                <Minus className="h-3 w-3" />
              </button>
              <span className="w-6 text-center tabular-nums text-foreground">
                {leg.quantity}
              </span>
              <button
                aria-label="Increase quantity"
                onClick={() => updateLegQty(leg.id, 1)}
                className="h-5 w-5 flex items-center justify-center rounded bg-accent/50 text-muted-foreground hover:text-foreground"
              >
                <Plus className="h-3 w-3" />
              </button>
            </div>
            <span className="w-14 text-right tabular-nums text-foreground">
              ${(leg.price ?? 0).toFixed(2)}
            </span>
            <button
              aria-label="Remove leg"
              onClick={() => removeLeg(leg.id)}
              className="text-muted-foreground hover:text-[var(--loss)]"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>

      <button
        onClick={addLeg}
        className="flex items-center justify-center gap-1 rounded-md border border-dashed border-border px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors mb-3"
      >
        <Plus className="h-3 w-3" /> Add Leg
      </button>

      <Separator className="bg-border mb-3" />

      {legs.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-3">Add a leg to begin building your trade</p>
      ) : (
        <>
          {/* Greeks — null values render as em-dash (audit P0-5). */}
          <div className="grid grid-cols-4 gap-2 mb-3">
            {Object.entries(aggregateGreeks).map(([key, val]) => (
              <div key={key} className="text-center">
                <div className="text-[10px] text-muted-foreground capitalize">
                  {key}
                </div>
                <div
                  className={cn(
                    "text-xs font-medium tabular-nums text-foreground",
                    val == null && "text-muted-foreground/50"
                  )}
                >
                  {val == null ? "\u2014" : formatGreek(val, key === "delta" ? 2 : 3)}
                </div>
              </div>
            ))}
          </div>

          {/* Risk summary */}
          <div className="space-y-1 mb-3 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{netDebit >= 0 ? "Net Credit" : "Net Debit"}</span>
              <span className={cn("tabular-nums", getChangeTextClass(netDebit))}>
                {formatCurrency(Math.abs(netDebit))}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Max Profit</span>
              <span className="text-[var(--profit)] tabular-nums">
                {formatCurrency(maxProfit)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Max Loss</span>
              <span className="text-[var(--loss)] tabular-nums">
                {formatCurrency(maxLoss)}
              </span>
            </div>
            {breakeven > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Breakeven</span>
                <span className="text-foreground tabular-nums">
                  ${(breakeven ?? 0).toFixed(2)}
                </span>
              </div>
            )}
          </div>

          {/* Payoff Diagram — shown when 2+ option legs (spread detected) */}
          {payoffLegs.length >= 2 && (
            <PayoffDiagram
              legs={payoffLegs}
              currentPrice={currentQuote?.last}
              className="mb-3"
            />
          )}
        </>
      )}

      <div className="mt-auto">
        <Button
          onClick={handleSubmit}
          disabled={submitting || legs.length === 0}
          className={cn(
            "w-full font-medium",
            tradingMode === "paper"
              ? "bg-[var(--profit)] hover:bg-[var(--profit)]/90 text-black"
              : "bg-[var(--loss)] hover:bg-[var(--loss)]/90 text-white"
          )}
        >
          {submitting ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : tradingMode === "paper" ? (
            <>
              <ShieldCheck className="mr-1.5 h-4 w-4" /> Paper Trade
            </>
          ) : (
            <>
              <AlertTriangle className="mr-1.5 h-4 w-4" /> Submit LIVE Order
            </>
          )}
        </Button>
      </div>

      {/* Order Confirmation Dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Order</DialogTitle>
            <DialogDescription>
              Review your order details before submitting.
            </DialogDescription>
          </DialogHeader>
          {pendingOrder && (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Order</span>
                <span className="font-medium text-foreground">
                  {pendingOrder.side === "buy" ? "Buy" : "Sell"} {pendingOrder.quantity} {pendingOrder.symbol} @ {pendingOrder.type === "market" ? "Market" : `$${pendingOrder.price?.toFixed(2)}`}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Estimated Cost</span>
                <span className="font-medium tabular-nums text-foreground">
                  {formatCurrency(Math.abs(netDebit))}
                </span>
              </div>
              {legs.length > 1 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Legs</span>
                  <span className="text-foreground">{legs.length}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Strategy</span>
                <span className="text-foreground">{strategyName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Net Delta</span>
                <span className="tabular-nums text-foreground">
                  {aggregateGreeks.delta == null ? "\u2014" : formatGreek(aggregateGreeks.delta, 2)}
                </span>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={confirmSubmit}
              disabled={submitting}
              className={cn(
                "font-medium",
                tradingMode === "paper"
                  ? "bg-[var(--profit)] hover:bg-[var(--profit)]/90 text-black"
                  : "bg-[var(--loss)] hover:bg-[var(--loss)]/90 text-white"
              )}
            >
              {submitting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              Confirm Order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Positions Tab ────────────────────────────────────────────

/** Single position row with real-time P&L from WebSocket quotes */
function PositionRow({ p, onSelect }: { p: Position; onSelect: (sym: string) => void }) {
  // Wave 14 perf-audit-r3 P0 #3: scoped selector — each row only subscribes
  // to its own symbol, so a tick in AAPL never rerenders the MSFT row.
  const liveQuote = useQuote(p.symbol.split(" ")[0]);

  // Compute live P&L: if we have a real-time quote, recalculate using the latest price
  const livePrice = liveQuote?.last ?? p.currentPrice;
  const livePnl = liveQuote
    ? p.side === "short"
      ? (p.avgCost - liveQuote.last) * p.quantity
      : (liveQuote.last - p.avgCost) * p.quantity
    : p.unrealizedPnl;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(p.symbol.split(" ")[0])}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onSelect(p.symbol.split(" ")[0]);
      }}
      className="flex items-center text-xs px-2 py-1.5 rounded hover:bg-accent/30 transition-colors cursor-pointer"
    >
      <span className="flex-1 min-w-[60px] font-medium text-foreground truncate" title={p.symbol}>
        {p.symbol}
      </span>
      <span className="w-10 text-right tabular-nums text-foreground truncate" title={String(p.quantity)}>
        {p.quantity}
      </span>
      <span className="w-14 text-right tabular-nums text-muted-foreground truncate" title={formatCurrency(p.avgCost)}>
        {formatCurrency(p.avgCost)}
      </span>
      <span className="w-14 text-right">
        <AnimatedNumber
          value={livePrice}
          format={(n) => formatCurrency(n)}
          className="tabular-nums text-foreground"
          duration={200}
        />
      </span>
      <span className="w-18 text-right">
        <AnimatedNumber
          value={livePnl}
          format={(n) => `${n >= 0 ? "+" : ""}${formatCurrency(n)}`}
          className={cn(
            "tabular-nums font-medium",
            getChangeTextClass(livePnl)
          )}
          duration={200}
        />
      </span>
    </div>
  );
}

function PositionsTab() {
  const positions = usePortfolioStore((s) => s.positions);
  const setPositions = usePortfolioStore((s) => s.setPositions);
  const { selectedSymbol, setSelectedSymbol } = useMarketStore();
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);
  const { toast } = useToast();
  const [stopLossOpen, setStopLossOpen] = useState(false);
  const [stopLossPrice, setStopLossPrice] = useState("");
  const [stopLossSymbol, setStopLossSymbol] = useState("");
  // Round-28 / persona-F P0: in-flight guard. Pre-fix the Set-Stop-Loss
  // button only checked stopLossPrice validity; double-tap between click
  // and toast submitted two stop orders.
  const [stopLossSubmitting, setStopLossSubmitting] = useState(false);

  // Position management keyboard shortcuts
  useEffect(() => {
    const handler = (e: Event) => {
      const action = (e as CustomEvent<string>).detail;
      if (action === "positions:close-all") {
        if (positions.length === 0) {
          toast({ type: "info", message: "No open positions to close." });
          return;
        }
        const confirmed = window.confirm(
          `Close ALL ${positions.length} position(s)? This will sell all holdings.`
        );
        if (confirmed) {
          // Place market sell orders for each position.
          // Persona 74-5/74-10 — each ``placeOrder`` is awaited by the
          // outer ``Promise.all`` but the old code swallowed its own
          // rejection with ``.catch(() => null)``, so the user saw the
          // optimistic "Closing …" success toast even when every
          // request failed. Surface individual failures via a toast.
          Promise.all(
            positions.map((p) =>
              placeOrder({
                symbol: p.symbol,
                side: p.side === "short" ? "buy" : "sell",
                type: "market",
                quantity: p.quantity,
              }).catch((e: unknown) => {
                const msg = e instanceof Error ? e.message : "Unknown error";
                toast({
                  type: "error",
                  message: `Action failed: ${p.symbol} — ${msg}`,
                });
                return null;
              })
            )
          ).then(() => {
            toast({ type: "success", message: `Closing ${positions.length} position(s)...` });
          });
        }
      } else if (action === "positions:flatten") {
        if (positions.length === 0) {
          toast({ type: "info", message: "No open positions to flatten." });
          return;
        }
        const confirmed = window.confirm(
          `Flatten portfolio? This will close all ${positions.length} position(s) at market price.`
        );
        if (confirmed) {
          // Persona 74-5/74-10 — same fix as "close-all" above: surface
          // per-position failures instead of swallowing them with
          // ``.catch(() => null)``.
          Promise.all(
            positions.map((p) =>
              placeOrder({
                symbol: p.symbol,
                side: p.side === "short" ? "buy" : "sell",
                type: "market",
                quantity: p.quantity,
              }).catch((e: unknown) => {
                const msg = e instanceof Error ? e.message : "Unknown error";
                toast({
                  type: "error",
                  message: `Action failed: ${p.symbol} — ${msg}`,
                });
                return null;
              })
            )
          ).then(() => {
            toast({ type: "success", message: "Portfolio flatten orders submitted." });
          });
        }
      } else if (action === "positions:stop-loss") {
        const pos = positions.find((p) => p.symbol.split(" ")[0] === selectedSymbol);
        if (!pos) {
          toast({ type: "info", message: `No position for ${selectedSymbol}.` });
          return;
        }
        setStopLossSymbol(pos.symbol);
        setStopLossPrice("");
        setStopLossOpen(true);
      }
    };
    window.addEventListener("alphadesk:shortcut", handler);
    return () => window.removeEventListener("alphadesk:shortcut", handler);
  }, [positions, selectedSymbol, toast]);

  // Fetch positions from API on mount
  useEffect(() => {
    if (fetched) return;
    setFetched(true);
    setLoading(true);
    import("@/lib/api").then(({ getPositions }) =>
      getPositions()
        .then((data) => { if (data.length) setPositions(data); })
        .catch((err) => { console.error("Failed to load positions:", err); })
        .finally(() => setLoading(false))
    );
  }, [fetched, setPositions]);

  // Compute total live P&L across all positions.
  // Wave 14 perf-audit-r3 P0 #3: `useQuotes` shallow-compares only the
  // symbols currently in `positions`, so unrelated ticks no longer
  // rerender this list.
  const positionSymbols = useMemo(
    () => positions.map((p) => p.symbol.split(" ")[0]),
    [positions],
  );
  const quotes = useQuotes(positionSymbols);
  const totalLivePnl = useMemo(() => {
    return positions.reduce((sum, p) => {
      const liveQuote = quotes[p.symbol.split(" ")[0]];
      const pnl = liveQuote
        ? p.side === "short"
          ? (p.avgCost - liveQuote.last) * p.quantity
          : (liveQuote.last - p.avgCost) * p.quantity
        : p.unrealizedPnl;
      return sum + pnl;
    }, 0);
  }, [positions, quotes]);

  if (loading && positions.length === 0) {
    return (
      <div className="flex items-center justify-center gap-2 p-6 text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading positions...
      </div>
    );
  }

  if (positions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8">
        <Briefcase className="h-6 w-6 mb-2 text-muted-foreground opacity-30" />
        <p className="text-sm text-foreground">No open positions</p>
        <p className="text-hint mt-1">Positions will appear when orders are filled</p>
      </div>
    );
  }

  return (
    <div className="p-2">
      {/* Portfolio total P&L bar */}
      {positions.length > 0 && (
        <div className="flex items-center justify-between rounded-md bg-background/50 px-2.5 py-1.5 mb-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Total P&L</span>
          <AnimatedNumber
            value={totalLivePnl}
            format={(n) => `${n >= 0 ? "+" : ""}${formatCurrency(n)}`}
            className={cn(
              "text-xs font-semibold tabular-nums",
              getChangeTextClass(totalLivePnl)
            )}
            duration={200}
          />
        </div>
      )}

      <div className="space-y-1">
        <div className="flex items-center text-[10px] uppercase tracking-wider text-muted-foreground px-2 py-1">
          <span className="flex-1 min-w-[60px]">SYM</span>
          <span className="w-10 text-right">QTY</span>
          <span className="w-14 text-right">AVG</span>
          <span className="w-14 text-right">LAST</span>
          <span className="w-18 text-right">P&L</span>
        </div>

        {positions.map((p) => (
          <PositionRow key={p.symbol} p={p} onSelect={setSelectedSymbol} />
        ))}
      </div>

      {/* Stop Loss Dialog */}
      <Dialog open={stopLossOpen} onOpenChange={setStopLossOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set Stop Loss</DialogTitle>
            <DialogDescription>
              Set a stop loss price for {stopLossSymbol}. A stop order will be placed to sell at market when price drops to this level.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Stop Price</label>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                <input
                  type="number"
                  step="0.01"
                  value={stopLossPrice}
                  onChange={(e) => setStopLossPrice(e.target.value)}
                  placeholder="0.00"
                  className="h-9 w-full rounded-md border border-border bg-background pl-6 pr-3 text-sm tabular-nums text-foreground"
                  autoFocus
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStopLossOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (stopLossSubmitting) return;
                const price = parseFloat(stopLossPrice);
                if (!price || price <= 0 || !Number.isFinite(price)) return;
                const pos = positions.find((p) => p.symbol === stopLossSymbol);
                if (!pos) return;
                setStopLossSubmitting(true);
                placeOrder({
                  symbol: pos.symbol,
                  side: pos.side === "short" ? "buy" : "sell",
                  type: "stop",
                  quantity: pos.quantity,
                  price,
                })
                  .then(() => {
                    toast({ type: "success", message: `Stop loss set at $${price.toFixed(2)} for ${stopLossSymbol}` });
                    setStopLossOpen(false);
                  })
                  .catch((err: unknown) => {
                    const msg = err instanceof Error ? err.message : "Unknown error";
                    toast({ type: "error", message: `Action failed: ${msg}` });
                  })
                  .finally(() => {
                    setStopLossSubmitting(false);
                  });
              }}
              disabled={
                stopLossSubmitting ||
                !stopLossPrice ||
                parseFloat(stopLossPrice) <= 0 ||
                !Number.isFinite(parseFloat(stopLossPrice))
              }
              className="bg-[var(--loss)] hover:bg-[var(--loss)]/90 text-white"
            >
              {stopLossSubmitting ? "Setting…" : "Set Stop Loss"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Orders Tab ──────────────────────────────────────────────

function OrdersTab() {
  const orders = usePortfolioStore((s) => s.orders);
  const setOrders = usePortfolioStore((s) => s.setOrders);
  const updateOrderStatus = usePortfolioStore((s) => s.updateOrderStatus);
  const { setSelectedSymbol } = useMarketStore();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);
  // Track which order IDs are currently mid-cancel so the row can show
  // "Cancelling…" feedback and the button stays disabled until the
  // backend confirms the 204.
  const [cancelling, setCancelling] = useState<Set<string>>(new Set());

  // Fetch orders from API on mount
  useEffect(() => {
    if (fetched) return;
    setFetched(true);
    setLoading(true);
    import("@/lib/api").then(({ getOrders }) =>
      getOrders()
        .then((data) => { if (data.length) setOrders(data); })
        .catch((err) => { console.error("Failed to load orders:", err); })
        .finally(() => setLoading(false))
    );
  }, [fetched, setOrders]);

  if (loading && orders.length === 0) {
    return (
      <div className="flex items-center justify-center gap-2 p-6 text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading orders...
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8">
        <FileText className="h-6 w-6 mb-2 text-muted-foreground opacity-30" />
        <p className="text-sm text-foreground">No recent orders</p>
        <p className="text-hint mt-1">Orders will appear after you place a trade</p>
      </div>
    );
  }

  const statusColors: Record<string, string> = {
    pending: "bg-[var(--chart-4)]/15 text-[var(--chart-4)] border-[var(--chart-4)]/30",
    filled: "bg-[var(--profit)]/15 text-[var(--profit)] border-[var(--profit)]/30",
    cancelled: "bg-[var(--neutral)]/15 text-[var(--neutral)] border-[var(--neutral)]/30",
    partial: "bg-[var(--chart-4)]/15 text-[var(--chart-4)] border-[var(--chart-4)]/30",
    rejected: "bg-[var(--loss)]/15 text-[var(--loss)] border-[var(--loss)]/30",
  };

  const handleCancel = async (id: string) => {
    // Don't re-enter while a cancel is already in flight for this order.
    if (cancelling.has(id)) return;
    setCancelling((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    try {
      // cancelOrder resolves to `undefined` on the backend's 204 response
      // (audit P0, now fixed in api.ts). We treat no-throw as success.
      await cancelOrder(id);
      updateOrderStatus(id, "cancelled");
      toast({ type: "success", message: "Order cancelled" });
    } catch (err: any) {
      toast({
        type: "error",
        message: "Cancel failed: " + (err?.message || "Unknown error"),
      });
    } finally {
      setCancelling((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  return (
    <div className="p-2">
      <div className="space-y-1">
        <div className="flex items-center text-[10px] uppercase tracking-wider text-muted-foreground px-2 py-1">
          <span className="flex-1 min-w-[60px]">SYM</span>
          <span className="w-10 text-right">SIDE</span>
          <span className="w-10 text-right">QTY</span>
          <span className="w-14 text-right">PRC</span>
          <span className="w-14 text-right">STATUS</span>
          <span className="w-6" />
        </div>

        {orders.map((o) => (
          <div
            key={o.id}
            role="button"
            tabIndex={0}
            onClick={() => setSelectedSymbol(o.symbol.split(" ")[0])}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") setSelectedSymbol(o.symbol.split(" ")[0]);
            }}
            className="flex items-center text-xs px-2 py-1.5 rounded hover:bg-accent/30 transition-colors cursor-pointer"
          >
            <span className="flex-1 min-w-[60px] font-medium text-foreground truncate" title={o.symbol}>
              {o.symbol}
            </span>
            <span
              className={cn(
                "w-10 text-right text-[10px] font-medium",
                o.side === "buy" ? "text-[var(--profit)]" : "text-[var(--loss)]"
              )}
            >
              {o.side.toUpperCase()}
            </span>
            <span className="w-10 text-right tabular-nums text-foreground">
              {o.quantity}
            </span>
            <span className="w-14 text-right tabular-nums text-foreground truncate" title={o.price ? formatCurrency(o.price) : "MKT"}>
              {o.price ? formatCurrency(o.price) : "MKT"}
            </span>
            <span className="w-14 flex justify-end">
              <Badge
                variant="outline"
                className={cn("text-[9px] px-1.5 py-0", statusColors[o.status] ?? "")}
              >
                {o.status}
              </Badge>
            </span>
            <span className="w-6 flex justify-end">
              {o.status === "pending" && (
                <button
                  aria-label={cancelling.has(o.id) ? "Cancelling order" : "Cancel order"}
                  disabled={cancelling.has(o.id)}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCancel(o.id);
                  }}
                  className="text-muted-foreground hover:text-[var(--loss)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title={cancelling.has(o.id) ? "Cancelling…" : "Cancel order"}
                >
                  {cancelling.has(o.id) ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <X className="h-3 w-3" />
                  )}
                </button>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Journal Tab ─────────────────────────────────────────────

const JOURNAL_TAGS = ["#winning", "#losing", "#lesson", "#setup", "#mistake"] as const;
type JournalTag = (typeof JOURNAL_TAGS)[number];

interface JournalEntry {
  id: string;
  date: string;
  rawDate: string; // ISO string for filtering
  type: string;
  symbol: string;
  detail: string;
  strategy?: string;
  rationale?: string;
  pnl?: number;
  tags: JournalTag[];
}

const JOURNAL_STORAGE_KEY = "alphadesk-journal";
const JOURNAL_NOTES_KEY = "journal-notes";
const JOURNAL_TAGS_KEY = "journal-tags";

function loadJournalTags(): Record<string, JournalTag[]> {
  // Round-21 / persona-B: bare localStorage.getItem throws SecurityError
  // in Safari Private Mode; the JSON.parse on undefined is also a hazard.
  // Use safeGetItem and treat any failure as "no tags".
  try {
    return JSON.parse(safeGetItem(JOURNAL_TAGS_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveJournalTags(tags: Record<string, JournalTag[]>) {
  safeSetItem(JOURNAL_TAGS_KEY, JSON.stringify(tags));
}

function JournalStats({ entries, tagMap }: { entries: JournalEntry[]; tagMap: Record<string, JournalTag[]> }) {
  const stats = useMemo(() => {
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    let thisWeek = 0;
    let thisMonth = 0;

    for (const e of entries) {
      const d = new Date(e.rawDate);
      if (!isNaN(d.getTime())) {
        if (d >= startOfWeek) thisWeek++;
        if (d >= startOfMonth) thisMonth++;
      }
    }

    // Tag counts
    const tagCounts: Record<string, number> = {};
    for (const tags of Object.values(tagMap)) {
      for (const t of tags) {
        tagCounts[t] = (tagCounts[t] || 0) + 1;
      }
    }
    const topTags = Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    // Frequency: entries per day for the last 7 days
    const dayBuckets: Record<string, number> = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toLocaleDateString("en-US", { weekday: "short" });
      dayBuckets[key] = 0;
    }
    for (const e of entries) {
      const d = new Date(e.rawDate);
      if (!isNaN(d.getTime())) {
        const diff = Math.floor((now.getTime() - d.getTime()) / 86400000);
        if (diff < 7 && diff >= 0) {
          const key = d.toLocaleDateString("en-US", { weekday: "short" });
          if (key in dayBuckets) dayBuckets[key]++;
        }
      }
    }

    const freqData = Object.entries(dayBuckets);
    const maxFreq = Math.max(1, ...freqData.map(([, v]) => v));

    return { total: entries.length, thisWeek, thisMonth, topTags, freqData, maxFreq };
  }, [entries, tagMap]);

  return (
    <div className="p-2 space-y-2">
      {/* Key stats */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-md bg-background/50 p-2 text-center">
          <div className="text-sm font-bold tabular-nums text-foreground">{stats.total}</div>
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Total</div>
        </div>
        <div className="rounded-md bg-background/50 p-2 text-center">
          <div className="text-sm font-bold tabular-nums text-foreground">{stats.thisWeek}</div>
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground">This Week</div>
        </div>
        <div className="rounded-md bg-background/50 p-2 text-center">
          <div className="text-sm font-bold tabular-nums text-foreground">{stats.thisMonth}</div>
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground">This Month</div>
        </div>
      </div>

      {/* Top tags */}
      {stats.topTags.length > 0 && (
        <div>
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground mb-1">Top Tags</div>
          <div className="flex flex-wrap gap-1">
            {stats.topTags.map(([tag, count]) => (
              <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
                {tag} ({count})
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Frequency chart */}
      <div>
        <div className="text-[9px] uppercase tracking-wider text-muted-foreground mb-1">7-Day Frequency</div>
        <div className="flex items-end gap-1 h-10">
          {stats.freqData.map(([day, count]) => (
            <div key={day} className="flex-1 flex flex-col items-center gap-0.5">
              <div
                className="w-full rounded-t bg-primary/40 transition-all"
                style={{ height: `${Math.max(2, (count / stats.maxFreq) * 28)}px` }}
              />
              <span className="text-[8px] text-muted-foreground">{day}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function JournalTab() {
  const positions = usePortfolioStore((s) => s.positions);
  const orders = usePortfolioStore((s) => s.orders);
  const [notes, setNotes] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem(JOURNAL_NOTES_KEY) || "{}"); } catch { return {}; }
  });
  const [tagMap, setTagMap] = useState<Record<string, JournalTag[]>>(loadJournalTags);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [filterTag, setFilterTag] = useState<JournalTag | null>(null);
  const [showStats, setShowStats] = useState(false);

  // Persist notes
  useEffect(() => {
    // Round-11 / BB-22 (P3): use safeSetItem so a Safari Private Mode
    // / iOS quota error doesn't crash the whole panel tree.
    safeSetItem(JOURNAL_NOTES_KEY, JSON.stringify(notes));
  }, [notes]);

  // Persist tags
  useEffect(() => {
    saveJournalTags(tagMap);
  }, [tagMap]);

  // Generate journal entries from orders and positions
  const entries: JournalEntry[] = useMemo(() => {
    const items: JournalEntry[] = [];

    // From orders — auto-generated trade entries
    for (const order of orders.slice(0, 20)) {
      const rawDate = order.createdAt || new Date().toISOString();
      const strategyHint = order.legs && order.legs.length > 1 ? "Multi-leg" : "Single";
      items.push({
        id: order.id,
        date: order.createdAt
          ? new Date(order.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
          : "--",
        rawDate,
        type: order.side === "buy" ? "BUY" : "SELL",
        symbol: order.symbol,
        detail: `${order.quantity} shares @ ${order.type === "market" ? "Market" : "$" + ((order.price ?? 0).toFixed(2) ?? "--")}`,
        strategy: strategyHint,
        rationale: order.status === "filled" ? "Order filled" : `Status: ${order.status}`,
        tags: tagMap[order.id] ?? [],
      });
    }

    // From positions (current holdings)
    for (const pos of positions) {
      const entryId = `pos-${pos.symbol}`;
      items.push({
        id: entryId,
        date: "Active",
        rawDate: new Date().toISOString(),
        type: "HOLD",
        symbol: pos.symbol,
        detail: `${pos.quantity} shares, avg $${(pos.avgCost ?? 0).toFixed(2)}`,
        strategy: pos.side === "long" ? "Long" : pos.side === "short" ? "Short" : "Position",
        pnl: pos.unrealizedPnl,
        tags: tagMap[entryId] ?? [],
      });
    }

    return items;
  }, [orders, positions, tagMap]);

  // Apply tag filter
  const filteredEntries = useMemo(() => {
    if (!filterTag) return entries;
    return entries.filter((e) => e.tags.includes(filterTag));
  }, [entries, filterTag]);

  const handleSaveNote = (entryId: string) => {
    setNotes((prev) => ({ ...prev, [entryId]: noteText }));
    setEditingId(null);
    setNoteText("");
  };

  const toggleTag = (entryId: string, tag: JournalTag) => {
    setTagMap((prev) => {
      const current = prev[entryId] ?? [];
      const next = current.includes(tag)
        ? current.filter((t) => t !== tag)
        : [...current, tag];
      return { ...prev, [entryId]: next };
    });
  };

  const handleExport = () => {
    const exportData = {
      exportDate: new Date().toISOString(),
      entries: entries.map((e) => ({
        ...e,
        note: notes[e.id] ?? "",
        tags: tagMap[e.id] ?? [],
      })),
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trade-journal-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Persist full journal to localStorage
  useEffect(() => {
    const data = entries.map((e) => ({
      ...e,
      note: notes[e.id] ?? "",
      tags: tagMap[e.id] ?? [],
    }));
    // Round-11 / BB-22: see safeSetItem rationale above.
    safeSetItem(JOURNAL_STORAGE_KEY, JSON.stringify(data));
  }, [entries, notes, tagMap]);

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <BookOpen className="h-8 w-8 mb-3 text-muted-foreground opacity-30" />
        <p className="text-sm text-foreground">Trading Journal</p>
        <p className="text-hint mt-1">Journal entries appear as you trade</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-2 space-y-2">
        {/* Toolbar: stats toggle, tag filter, export */}
        <div className="flex items-center gap-1 flex-wrap">
          <button
            onClick={() => setShowStats(!showStats)}
            className={cn(
              "text-[9px] px-2 py-1 rounded font-medium transition-colors",
              showStats ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-accent/30"
            )}
          >
            Stats
          </button>
          <div className="h-3 w-px bg-border mx-0.5" />
          {JOURNAL_TAGS.map((tag) => (
            <button
              key={tag}
              onClick={() => setFilterTag(filterTag === tag ? null : tag)}
              className={cn(
                "text-[8px] px-1.5 py-0.5 rounded border transition-colors",
                filterTag === tag
                  ? "bg-primary/15 text-primary border-primary/30"
                  : "text-muted-foreground border-transparent hover:text-foreground hover:border-border"
              )}
            >
              {tag}
            </button>
          ))}
          <div className="flex-1" />
          <button
            onClick={handleExport}
            className="text-[9px] px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-accent/30 transition-colors"
          >
            Export JSON
          </button>
        </div>

        {/* Stats panel */}
        {showStats && <JournalStats entries={entries} tagMap={tagMap} />}

        {/* Entries */}
        {filteredEntries.length === 0 && filterTag ? (
          <div className="flex flex-col items-center justify-center py-6">
            <p className="text-[11px] text-muted-foreground">No entries tagged {filterTag}</p>
            <button onClick={() => setFilterTag(null)} className="text-[10px] text-primary hover:underline mt-1">Clear filter</button>
          </div>
        ) : (
          <div className="space-y-1">
            {filteredEntries.map((entry) => (
              <div key={entry.id} className="rounded-lg border border-border bg-[var(--surface)] p-2.5">
                {/* Header row */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      "text-[9px] font-bold uppercase px-1.5 py-0.5 rounded",
                      entry.type === "BUY" ? "bg-[var(--profit)]/15 text-[var(--profit)]" :
                      entry.type === "SELL" ? "bg-[var(--loss)]/15 text-[var(--loss)]" :
                      "bg-primary/15 text-primary"
                    )}>
                      {entry.type}
                    </span>
                    <span className="text-xs font-semibold text-foreground">{entry.symbol}</span>
                    {entry.strategy && (
                      <span className="text-[9px] text-muted-foreground bg-accent/30 px-1 py-0.5 rounded">
                        {entry.strategy}
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground">{entry.date}</span>
                </div>

                {/* Detail */}
                <p className="text-[11px] text-muted-foreground mt-1">{entry.detail}</p>

                {/* Rationale */}
                {entry.rationale && (
                  <p className="text-[10px] text-muted-foreground/70 mt-0.5 italic">{entry.rationale}</p>
                )}

                {/* P&L */}
                {entry.pnl !== undefined && (
                  <p className={cn("text-[11px] font-semibold tabular-nums mt-0.5", entry.pnl >= 0 ? "text-[var(--profit)]" : "text-[var(--loss)]")}>
                    P&L: {entry.pnl >= 0 ? "+" : ""}${(entry.pnl ?? 0).toFixed(2)}
                  </p>
                )}

                {/* Tags */}
                <div className="flex flex-wrap gap-0.5 mt-1.5">
                  {JOURNAL_TAGS.map((tag) => {
                    const active = (tagMap[entry.id] ?? []).includes(tag);
                    return (
                      <button
                        key={tag}
                        onClick={() => toggleTag(entry.id, tag)}
                        className={cn(
                          "text-[8px] px-1 py-0.5 rounded border transition-colors",
                          active
                            ? tag === "#winning" ? "bg-[var(--profit)]/15 text-[var(--profit)] border-[var(--profit)]/30"
                            : tag === "#losing" ? "bg-[var(--loss)]/15 text-[var(--loss)] border-[var(--loss)]/30"
                            : tag === "#mistake" ? "bg-[var(--loss)]/15 text-[var(--loss)] border-[var(--loss)]/30"
                            : "bg-primary/15 text-primary border-primary/30"
                            : "text-muted-foreground/50 border-transparent hover:border-border hover:text-muted-foreground"
                        )}
                      >
                        {tag}
                      </button>
                    );
                  })}
                </div>

                {/* Notes */}
                {notes[entry.id] && editingId !== entry.id && (
                  <p className="text-[10px] text-muted-foreground mt-1.5 italic border-t border-border pt-1.5">
                    {notes[entry.id]}
                  </p>
                )}
                {editingId === entry.id ? (
                  <div className="mt-1.5 flex gap-1">
                    <input
                      value={noteText}
                      onChange={(e) => setNoteText(e.target.value)}
                      placeholder="Add a note..."
                      aria-label="Trade notes"
                      className="flex-1 h-6 rounded border border-border bg-background px-2 text-[10px] text-foreground"
                      autoFocus
                      onKeyDown={(e) => { if (e.key === "Enter") handleSaveNote(entry.id); }}
                    />
                    <button onClick={() => handleSaveNote(entry.id)} className="h-6 px-2 rounded bg-primary text-[9px] font-medium text-primary-foreground">Save</button>
                    <button onClick={() => { setEditingId(null); setNoteText(""); }} className="h-6 px-2 rounded border border-border text-[9px] text-muted-foreground">Cancel</button>
                  </div>
                ) : (
                  <button
                    onClick={() => { setEditingId(entry.id); setNoteText(notes[entry.id] ?? ""); }}
                    className="text-[9px] text-primary hover:underline mt-1"
                  >
                    {notes[entry.id] ? "Edit note" : "Add note"}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

// ─── Main Panel ──────────────────────────────────────────────

export function TradePanel() {
  const { activePanels, setActiveTab } = useUIStore();

  return (
    <div className="flex h-full flex-col bg-[var(--panel)] border-t border-l border-[#2a2a3e]">
      <Tabs
        value={activePanels.bottom}
        onValueChange={(v) => setActiveTab("bottom", v)}
        className="flex flex-col h-full"
      >
        <div className="flex items-center justify-between mx-2 mt-2 shrink-0">
          <TabsList className="h-7 bg-[#12121a] p-0.5 flex-1 min-w-0 border border-[#2a2a3e]">
            <TabsTrigger value="trade" className="text-[10px] h-6 px-1.5" title="Trade Builder">
              Trade
            </TabsTrigger>
            <TabsTrigger value="positions" className="text-[10px] h-6 px-1.5" title="Positions">
              Pos
            </TabsTrigger>
            <TabsTrigger value="orders" className="text-[10px] h-6 px-1.5" title="Orders">
              Ords
            </TabsTrigger>
            <TabsTrigger value="journal" className="text-[10px] h-6 px-1.5" title="Journal">
              Jrnl
            </TabsTrigger>
            <TabsTrigger value="calendar" className="text-[10px] h-6 px-1.5" title="P&L Calendar">
              Cal
            </TabsTrigger>
          </TabsList>
          <HelpCircle text="Build and submit option trades. View current positions, pending orders, and trade journal." />
        </div>

        <TabsContent value="trade" className="flex-1 mt-0 overflow-hidden">
          <TradeBuilderTab />
        </TabsContent>

        <TabsContent value="positions" className="flex-1 mt-0 overflow-hidden">
          <ScrollArea className="h-full">
            <PositionsTab />
          </ScrollArea>
        </TabsContent>

        <TabsContent value="orders" className="flex-1 mt-0 overflow-hidden">
          <ScrollArea className="h-full">
            <OrdersTab />
          </ScrollArea>
        </TabsContent>

        <TabsContent value="journal" className="flex-1 mt-0 overflow-hidden">
          <JournalTab />
        </TabsContent>

        <TabsContent value="calendar" className="flex-1 mt-0 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="p-2">
              <PnlCalendar compact />
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}
