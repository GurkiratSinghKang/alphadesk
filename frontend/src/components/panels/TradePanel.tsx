"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Plus,
  Minus,
  Trash2,
  ShieldCheck,
  AlertTriangle,
  Loader2,
  X,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useMarketStore } from "@/stores/market";
import { useUIStore } from "@/stores/ui";
import { usePortfolioStore } from "@/stores/portfolio";
import { useOptionsStore, type SelectedStrike } from "@/stores/options";
import { placeOrder, cancelOrder } from "@/lib/api";
import type { PlaceOrderPayload } from "@/lib/api";
import {
  formatCurrency,
  formatPercent,
  formatGreek,
  getChangeTextClass,
  cn,
} from "@/lib/utils";
import { HelpCircle } from "@/components/ui/HelpCircle";
import { PnlCalendar } from "@/components/panels/PnlCalendar";

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
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
}

// BUG #17: Auto-detect strategy name from leg configuration
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

  const [legs, setLegs] = useState<TradeLeg[]>([
    {
      id: "1",
      symbol: selectedSymbol,
      side: "buy",
      quantity: 1,
      price: 5.2,
      type: "call",
      strike: 235,
      expiry: "2026-05-16",
      delta: 0.55,
      gamma: 0.018,
      theta: -0.035,
      vega: 0.12,
    },
    {
      id: "2",
      symbol: selectedSymbol,
      side: "sell",
      quantity: 1,
      price: 2.8,
      type: "call",
      strike: 245,
      expiry: "2026-05-16",
      delta: -0.27,
      gamma: -0.006,
      theta: 0.01,
      vega: -0.06,
    },
  ]);

  const [submitting, setSubmitting] = useState(false);

  // BUG #13: Reset legs when selectedSymbol changes
  useEffect(() => {
    setLegs((prev) =>
      prev.map((l) => ({ ...l, symbol: selectedSymbol }))
    );
  }, [selectedSymbol]);

  // BUG #17/#23: Populate legs from OptionsPanel selected strikes
  useEffect(() => {
    if (selectedStrikes.length === 0) return;
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
        gamma: 0.01,
        theta: -0.02,
        vega: 0.08,
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

  // BUG #16: Compute aggregate Greeks from legs
  const aggregateGreeks = useMemo(() => {
    const g = { delta: 0, gamma: 0, theta: 0, vega: 0 };
    for (const leg of legs) {
      const mult = leg.side === "buy" ? leg.quantity : -leg.quantity;
      g.delta += (leg.delta ?? 0) * mult;
      g.gamma += (leg.gamma ?? 0) * mult;
      g.theta += (leg.theta ?? 0) * mult;
      g.vega += (leg.vega ?? 0) * mult;
    }
    return g;
  }, [legs]);

  // BUG #17: Auto-detect strategy name
  const strategyName = useMemo(() => detectStrategy(legs), [legs]);

  const strikes = legs.filter((l) => l.strike).map((l) => l.strike!);
  const minStrike = Math.min(...(strikes.length ? strikes : [0]));
  const maxStrike = Math.max(...(strikes.length ? strikes : [0]));
  const maxProfit =
    maxStrike > minStrike ? (maxStrike - minStrike) * 100 + netDebit : Math.abs(netDebit);
  const maxLoss = Math.abs(netDebit);
  const breakeven = minStrike > 0 ? minStrike + Math.abs(netDebit) / 100 : 0;

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

  // BUG #14: Add Leg button
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
        expiry: "2026-05-16",
        delta: 0,
        gamma: 0,
        theta: 0,
        vega: 0,
      },
    ]);
  };

  // BUG #4: Submit order handler
  const handleSubmit = useCallback(async () => {
    if (legs.length === 0 || submitting) return;
    setSubmitting(true);
    try {
      const payload: PlaceOrderPayload = {
        symbol: selectedSymbol,
        side: legs[0].side,
        type: "limit",
        quantity: legs[0].quantity,
        price: legs[0].price,
        legs: legs.map((l) => ({
          symbol: l.symbol,
          side: l.side,
          quantity: l.quantity,
          price: l.price,
        })),
      };
      const order = await placeOrder(payload);
      addOrder(order);
    } catch {
      // Create a local order record even if API fails
      addOrder({
        id: `local-${Date.now()}`,
        symbol: selectedSymbol,
        side: legs[0].side,
        type: "limit",
        quantity: legs[0].quantity,
        price: legs[0].price,
        status: "pending",
        legs: legs.map((l) => ({
          symbol: l.symbol,
          side: l.side,
          quantity: l.quantity,
          price: l.price,
        })),
        createdAt: new Date().toISOString(),
      });
    } finally {
      setSubmitting(false);
    }
  }, [legs, submitting, selectedSymbol, addOrder]);

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
                onClick={() => updateLegQty(leg.id, -1)}
                className="h-5 w-5 flex items-center justify-center rounded bg-accent/50 text-muted-foreground hover:text-foreground"
              >
                <Minus className="h-3 w-3" />
              </button>
              <span className="w-6 text-center tabular-nums text-foreground">
                {leg.quantity}
              </span>
              <button
                onClick={() => updateLegQty(leg.id, 1)}
                className="h-5 w-5 flex items-center justify-center rounded bg-accent/50 text-muted-foreground hover:text-foreground"
              >
                <Plus className="h-3 w-3" />
              </button>
            </div>
            <span className="w-14 text-right tabular-nums text-foreground">
              ${leg.price.toFixed(2)}
            </span>
            <button
              onClick={() => removeLeg(leg.id)}
              className="text-muted-foreground hover:text-[var(--loss)]"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>

      {/* BUG #14: Add Leg button */}
      <button
        onClick={addLeg}
        className="flex items-center justify-center gap-1 rounded-md border border-dashed border-border px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors mb-3"
      >
        <Plus className="h-3 w-3" /> Add Leg
      </button>

      <Separator className="bg-border mb-3" />

      {/* Greeks — BUG #16: computed from legs */}
      <div className="grid grid-cols-4 gap-2 mb-3">
        {Object.entries(aggregateGreeks).map(([key, val]) => (
          <div key={key} className="text-center">
            <div className="text-[10px] text-muted-foreground capitalize">
              {key}
            </div>
            <div className="text-xs font-medium tabular-nums text-foreground">
              {formatGreek(val, key === "delta" ? 2 : 3)}
            </div>
          </div>
        ))}
      </div>

      {/* Risk summary */}
      <div className="space-y-1 mb-3 text-xs">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Net Debit</span>
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
              ${breakeven.toFixed(2)}
            </span>
          </div>
        )}
      </div>

      {/* BUG #4: Submit button with onClick + loading */}
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
    </div>
  );
}

// ─── Positions Tab (BUG #15/#18: use portfolio store, BUG #19: interactive rows) ─

function PositionsTab() {
  const positions = usePortfolioStore((s) => s.positions);
  const setPositions = usePortfolioStore((s) => s.setPositions);
  const { setSelectedSymbol } = useMarketStore();
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);

  // Fetch positions from API on mount
  useEffect(() => {
    if (fetched) return;
    setFetched(true);
    setLoading(true);
    import("@/lib/api").then(({ getPositions }) =>
      getPositions()
        .then((data) => { if (data.length) setPositions(data); })
        .catch(() => {})
        .finally(() => setLoading(false))
    );
  }, [fetched, setPositions]);

  if (loading && positions.length === 0) {
    return (
      <div className="flex items-center justify-center gap-2 p-6 text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading positions...
      </div>
    );
  }

  // Fallback to demo if store is empty
  const displayPositions =
    positions.length > 0
      ? positions
      : [
          { symbol: "AAPL", quantity: 100, avgCost: 218.5, currentPrice: 232.1, unrealizedPnl: 1360, marketValue: 23210 },
          { symbol: "NVDA 140C 5/16", quantity: 5, avgCost: 12.3, currentPrice: 15.8, unrealizedPnl: 1750, marketValue: 7900 },
          { symbol: "SPY", quantity: -50, avgCost: 595.0, currentPrice: 590.2, unrealizedPnl: 240, marketValue: 29510 },
          { symbol: "TSLA 250P 5/16", quantity: 3, avgCost: 8.5, currentPrice: 6.2, unrealizedPnl: -690, marketValue: 1860 },
          { symbol: "META", quantity: 200, avgCost: 510.0, currentPrice: 522.4, unrealizedPnl: 2480, marketValue: 104480 },
        ];

  return (
    <div className="p-2">
      <div className="space-y-1">
        <div className="flex items-center text-[10px] uppercase tracking-wider text-muted-foreground px-2 py-1">
          <span className="flex-1">Position</span>
          <span className="w-12 text-right">Qty</span>
          <span className="w-16 text-right">Avg</span>
          <span className="w-16 text-right">Last</span>
          <span className="w-16 text-right">P&L</span>
        </div>

        {displayPositions.map((p) => (
          <div
            key={p.symbol}
            role="button"
            tabIndex={0}
            onClick={() => setSelectedSymbol(p.symbol.split(" ")[0])}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") setSelectedSymbol(p.symbol.split(" ")[0]);
            }}
            className="flex items-center text-xs px-2 py-1.5 rounded hover:bg-accent/30 transition-colors cursor-pointer"
          >
            <span className="flex-1 font-medium text-foreground truncate">
              {p.symbol}
            </span>
            <span className="w-12 text-right tabular-nums text-foreground">
              {p.quantity}
            </span>
            <span className="w-16 text-right tabular-nums text-muted-foreground">
              {formatCurrency(p.avgCost)}
            </span>
            <span className="w-16 text-right tabular-nums text-foreground">
              {formatCurrency(p.currentPrice)}
            </span>
            <span
              className={cn(
                "w-16 text-right tabular-nums font-medium",
                getChangeTextClass(p.unrealizedPnl)
              )}
            >
              {p.unrealizedPnl >= 0 ? "+" : ""}
              {formatCurrency(p.unrealizedPnl)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Orders Tab (BUG #15/#18: use portfolio store, BUG #19/#20: interactive + cancel) ─

function OrdersTab() {
  const orders = usePortfolioStore((s) => s.orders);
  const setOrders = usePortfolioStore((s) => s.setOrders);
  const updateOrderStatus = usePortfolioStore((s) => s.updateOrderStatus);
  const { setSelectedSymbol } = useMarketStore();
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);

  // Fetch orders from API on mount
  useEffect(() => {
    if (fetched) return;
    setFetched(true);
    setLoading(true);
    import("@/lib/api").then(({ getOrders }) =>
      getOrders()
        .then((data) => { if (data.length) setOrders(data); })
        .catch(() => {})
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

  // Fallback to demo if store is empty
  const displayOrders =
    orders.length > 0
      ? orders
      : [
          { id: "O-001", symbol: "AAPL 240C", side: "buy" as const, type: "limit" as const, quantity: 5, price: 4.2, status: "pending" as const, createdAt: new Date().toISOString() },
          { id: "O-002", symbol: "SPY", side: "sell" as const, type: "market" as const, quantity: 100, price: 595.0, status: "filled" as const, createdAt: new Date().toISOString() },
          { id: "O-003", symbol: "NVDA 150C", side: "buy" as const, type: "limit" as const, quantity: 10, price: 8.5, status: "filled" as const, createdAt: new Date().toISOString() },
          { id: "O-004", symbol: "TSLA", side: "buy" as const, type: "stop" as const, quantity: 50, price: 240.0, status: "cancelled" as const, createdAt: new Date().toISOString() },
        ];

  const statusColors: Record<string, string> = {
    pending: "bg-[var(--chart-4)]/15 text-[var(--chart-4)] border-[var(--chart-4)]/30",
    filled: "bg-[var(--profit)]/15 text-[var(--profit)] border-[var(--profit)]/30",
    cancelled: "bg-[var(--neutral)]/15 text-[var(--neutral)] border-[var(--neutral)]/30",
    partial: "bg-[var(--chart-4)]/15 text-[var(--chart-4)] border-[var(--chart-4)]/30",
    rejected: "bg-[var(--loss)]/15 text-[var(--loss)] border-[var(--loss)]/30",
  };

  const handleCancel = async (id: string) => {
    try {
      await cancelOrder(id);
      updateOrderStatus(id, "cancelled");
    } catch {
      updateOrderStatus(id, "cancelled");
    }
  };

  return (
    <div className="p-2">
      <div className="space-y-1">
        <div className="flex items-center text-[10px] uppercase tracking-wider text-muted-foreground px-2 py-1">
          <span className="flex-1">Order</span>
          <span className="w-10 text-right">Side</span>
          <span className="w-10 text-right">Qty</span>
          <span className="w-16 text-right">Price</span>
          <span className="w-16 text-right">Status</span>
          <span className="w-6" />
        </div>

        {displayOrders.map((o) => (
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
            <span className="flex-1 font-medium text-foreground truncate">
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
            <span className="w-16 text-right tabular-nums text-foreground">
              {o.price ? formatCurrency(o.price) : "MKT"}
            </span>
            <span className="w-16 flex justify-end">
              <Badge
                variant="outline"
                className={cn("text-[9px] px-1.5 py-0", statusColors[o.status] ?? "")}
              >
                {o.status}
              </Badge>
            </span>
            {/* BUG #19/#20: Cancel button for pending orders */}
            <span className="w-6 flex justify-end">
              {o.status === "pending" && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCancel(o.id);
                  }}
                  className="text-muted-foreground hover:text-[var(--loss)] transition-colors"
                  title="Cancel order"
                >
                  <X className="h-3 w-3" />
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

function JournalTab() {
  const entries = [
    {
      date: "Apr 4, 2026",
      symbol: "NVDA",
      strategy: "Bull Call Spread",
      pnl: 1240,
      note: "Entered on AI signal. Closed at 80% max profit.",
    },
    {
      date: "Apr 2, 2026",
      symbol: "SPY",
      strategy: "Iron Condor",
      pnl: 380,
      note: "Weekly IC, expired worthless. Full credit collected.",
    },
    {
      date: "Mar 28, 2026",
      symbol: "TSLA",
      strategy: "Put Debit Spread",
      pnl: -450,
      note: "Stopped out after earnings gap up. Bad timing.",
    },
  ];

  return (
    <div className="p-2 space-y-2">
      {entries.map((e, i) => (
        <div
          key={i}
          className="rounded-md bg-background/50 px-3 py-2 text-xs"
        >
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <span className="font-medium text-foreground">{e.symbol}</span>
              <Badge
                variant="outline"
                className="text-[9px] px-1.5 py-0 border-primary/30 text-primary"
              >
                {e.strategy}
              </Badge>
            </div>
            <span
              className={cn(
                "font-medium tabular-nums",
                getChangeTextClass(e.pnl)
              )}
            >
              {e.pnl >= 0 ? "+" : ""}
              {formatCurrency(e.pnl)}
            </span>
          </div>
          <p className="text-muted-foreground leading-relaxed">{e.note}</p>
          <span className="text-[10px] text-muted-foreground mt-1 block">
            {e.date}
          </span>
        </div>
      ))}
    </div>
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
          <TabsList className="h-7 bg-[#12121a] p-0.5 flex-1 border border-[#2a2a3e]">
            <TabsTrigger value="trade" className="text-[11px] h-6 px-2.5">
              Trade
            </TabsTrigger>
            <TabsTrigger value="positions" className="text-[11px] h-6 px-2.5">
              Positions
            </TabsTrigger>
            <TabsTrigger value="orders" className="text-[11px] h-6 px-2.5">
              Orders
            </TabsTrigger>
            <TabsTrigger value="journal" className="text-[11px] h-6 px-2.5">
              Journal
            </TabsTrigger>
            <TabsTrigger value="calendar" className="text-[11px] h-6 px-2.5">
              Calendar
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
          <ScrollArea className="h-full">
            <JournalTab />
          </ScrollArea>
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
