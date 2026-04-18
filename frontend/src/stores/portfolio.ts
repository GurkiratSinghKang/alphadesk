import { create } from "zustand";
import type { Position, Order, PortfolioSummary, PortfolioGreeks } from "@/types";

interface PortfolioState {
  positions: Position[];
  orders: Order[];
  summary: PortfolioSummary;
  greeks: PortfolioGreeks;

  setPositions: (positions: Position[]) => void;
  setOrders: (orders: Order[]) => void;
  addOrder: (order: Order) => void;
  updateOrderStatus: (id: string, status: Order["status"]) => void;
  setSummary: (summary: PortfolioSummary) => void;
  setGreeks: (greeks: PortfolioGreeks) => void;
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
}));
