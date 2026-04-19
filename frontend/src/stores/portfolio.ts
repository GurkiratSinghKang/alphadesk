import { create } from "zustand";
import type { Position, Order, PortfolioSummary, PortfolioGreeks } from "@/types";

interface PortfolioState {
  positions: Position[];
  orders: Order[];
  summary: PortfolioSummary;
  greeks: PortfolioGreeks;
  /**
   * True when the backend recently served a response tagged `is_demo: true`
   * (or `source: "demo"`) — i.e. the broker or market-data provider is
   * unavailable and the API is returning synthetic fallback data. The dashboard
   * chrome reads this to surface a visible "broker unavailable" chip so users
   * don't trade on phantom quotes (persona-r P43).
   *
   * Set by `lib/api.ts`'s `alphadesk:broker-degraded` event listener that
   * `WsStatusBanner` mounts. Cleared the next time a real live response
   * arrives (i.e. a portfolio/quote response without the flag).
   */
  brokerDegraded: boolean;
  /** Endpoint that most recently flipped us into degraded mode. */
  brokerDegradedEndpoint: string | null;
  /** Epoch-millis timestamp of the last degraded-mode signal. */
  brokerDegradedAt: number | null;

  setPositions: (positions: Position[]) => void;
  setOrders: (orders: Order[]) => void;
  addOrder: (order: Order) => void;
  updateOrderStatus: (id: string, status: Order["status"]) => void;
  setSummary: (summary: PortfolioSummary) => void;
  setGreeks: (greeks: PortfolioGreeks) => void;
  setBrokerDegraded: (
    degraded: boolean,
    meta?: { endpoint?: string; timestamp?: number },
  ) => void;
}

const defaultSummary: PortfolioSummary = {
  equity: 0,
  cash: 0,
  buyingPower: 0,
  totalMarketValue: 0,
  unrealizedPnl: 0,
  unrealizedPnlPct: 0,
  realizedPnlToday: 0,
  positionsCount: 0,
  dayPnl: 0,
  dayPnlPct: 0,
  // `is_demo` is intentionally omitted here so `undefined` reads as
  // "unknown until the API confirms." Consumers must check strictly for
  // `=== true` to render a DEMO badge — otherwise the first paint on a
  // live account flashes "DEMO" for a frame before the fetch resolves.
};

const defaultGreeks: PortfolioGreeks = {
  netDelta: 0,
  netGamma: 0,
  netTheta: 0,
  netVega: 0,
  betaWeightedDelta: 0,
};

export const usePortfolioStore = create<PortfolioState>((set) => ({
  positions: [],
  orders: [],
  summary: defaultSummary,
  greeks: defaultGreeks,
  brokerDegraded: false,
  brokerDegradedEndpoint: null,
  brokerDegradedAt: null,

  setPositions: (positions) => set({ positions }),
  setOrders: (orders) => set({ orders }),

  addOrder: (order) =>
    set((state) => ({ orders: [order, ...state.orders].slice(0, 200) })),

  updateOrderStatus: (id, status) =>
    set((state) => ({
      orders: state.orders.map((o) => (o.id === id ? { ...o, status } : o)),
    })),

  setSummary: (summary) => set({ summary }),
  setGreeks: (greeks) => set({ greeks }),
  setBrokerDegraded: (degraded, meta) =>
    set({
      brokerDegraded: degraded,
      brokerDegradedEndpoint: degraded ? meta?.endpoint ?? null : null,
      brokerDegradedAt: degraded ? meta?.timestamp ?? Date.now() : null,
    }),
}));
