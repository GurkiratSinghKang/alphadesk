import { create } from "zustand";
import type { Position, Order, PortfolioSummary, PortfolioGreeks } from "@/types";

const PORTFOLIO_SNAPSHOT_CHANNEL = "alphadesk:portfolio-snapshot";

type PortfolioSnapshotSource = "rest" | "ws" | "manual";
type PortfolioSnapshotPayload = Partial<{
  positions: Position[];
  orders: Order[];
  summary: PortfolioSummary;
  greeks: PortfolioGreeks;
}>;

interface PortfolioState {
  positions: Position[];
  orders: Order[];
  summary: PortfolioSummary;
  greeks: PortfolioGreeks;
  /**
   * Canonical portfolio snapshot watermark. Any page rendering open-position
   * P&L should consume this store snapshot instead of issuing its own
   * positions/summary fetch, so all surfaces show the same values from the
   * same tick.
   */
  snapshotAt: number | null;
  snapshotSource: PortfolioSnapshotSource | null;
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
  setSnapshot: (
    snapshot: PortfolioSnapshotPayload,
    meta?: { source?: PortfolioState["snapshotSource"]; timestamp?: number },
  ) => void;
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

function broadcastPortfolioSnapshot(
  snapshot: PortfolioSnapshotPayload,
  meta: { source: PortfolioSnapshotSource; timestamp: number },
) {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return;
  try {
    const channel = new BroadcastChannel(PORTFOLIO_SNAPSHOT_CHANNEL);
    channel.postMessage({ snapshot, meta });
    channel.close();
  } catch {
    // Broadcast is an optimization for same-browser tab consistency.
  }
}

export const usePortfolioStore = create<PortfolioState>((set) => ({
  positions: [],
  orders: [],
  summary: defaultSummary,
  greeks: defaultGreeks,
  snapshotAt: null,
  snapshotSource: null,
  brokerDegraded: false,
  brokerDegradedEndpoint: null,
  brokerDegradedAt: null,

  setPositions: (positions) => set({ positions, snapshotAt: Date.now(), snapshotSource: "manual" }),
  setOrders: (orders) => set({ orders, snapshotAt: Date.now(), snapshotSource: "manual" }),

  addOrder: (order) =>
    set((state) => ({ orders: [order, ...state.orders].slice(0, 200) })),

  updateOrderStatus: (id, status) =>
    set((state) => ({
      orders: state.orders.map((o) => (o.id === id ? { ...o, status } : o)),
    })),

  setSummary: (summary) => set({ summary, snapshotAt: Date.now(), snapshotSource: "manual" }),
  setGreeks: (greeks) => set({ greeks, snapshotAt: Date.now(), snapshotSource: "manual" }),
  setSnapshot: (snapshot, meta) => {
    const timestamp = meta?.timestamp ?? Date.now();
    const source = meta?.source ?? "manual";
    set((state) => ({
      positions: snapshot.positions ?? state.positions,
      orders: snapshot.orders ?? state.orders,
      summary: snapshot.summary ?? state.summary,
      greeks: snapshot.greeks ?? state.greeks,
      snapshotAt: timestamp,
      snapshotSource: source,
    }));
    broadcastPortfolioSnapshot(snapshot, { source, timestamp });
  },
  setBrokerDegraded: (degraded, meta) =>
    set({
      brokerDegraded: degraded,
      brokerDegradedEndpoint: degraded ? meta?.endpoint ?? null : null,
      brokerDegradedAt: degraded ? meta?.timestamp ?? Date.now() : null,
    }),
}));

if (typeof window !== "undefined" && typeof BroadcastChannel !== "undefined") {
  try {
    const channel = new BroadcastChannel(PORTFOLIO_SNAPSHOT_CHANNEL);
    channel.onmessage = (event: MessageEvent) => {
      const data = event.data as {
        snapshot?: PortfolioSnapshotPayload;
        meta?: { source?: PortfolioSnapshotSource; timestamp?: number };
      };
      const snapshot = data?.snapshot;
      const timestamp = data?.meta?.timestamp;
      if (!snapshot || !Number.isFinite(timestamp)) return;
      usePortfolioStore.setState((state) => ({
        positions: Array.isArray(snapshot.positions) ? snapshot.positions : state.positions,
        orders: Array.isArray(snapshot.orders) ? snapshot.orders : state.orders,
        summary: snapshot.summary ?? state.summary,
        greeks: snapshot.greeks ?? state.greeks,
        snapshotAt: timestamp!,
        snapshotSource: data.meta?.source ?? "rest",
      }));
    };
  } catch {
    // Older browsers/tests without BroadcastChannel keep per-tab state.
  }
}
