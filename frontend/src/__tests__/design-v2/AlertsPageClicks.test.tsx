/**
 * Iter 21 (audit 2026-05-11) — AlertsPage dead-link wiring.
 *
 * Background: every row on /alerts rendered a non-clickable
 * `<a style={{cursor:"default"}}>Open →</a>`. The operator could read
 * the stream but every "Open →" was a no-op. This test pins the URL
 * builder + render contract so the dead link doesn't regress:
 *   - notification rows with a symbol → `/symbols/{TICKER}`
 *   - notification rows with an order_id (no symbol) → `/trade?order={id}`
 *   - notification rows with neither destination → no Open → rendered
 *   - news rows with a symbol → `/symbols/{TICKER}`
 *   - order rows with an order id → `/trade?order={id}`
 */
import "../setup-mocks";

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AlphaDeskDesignApp, alertRowOrderId, alertRowSymbol, buildAlertRowHref } from "@/components/design-v2/AlphaDeskDesign";
import { getMarketNews, getNotifications, getOrders } from "@/lib/api";
import { usePortfolioStore } from "@/stores/portfolio";

function installMatchMedia(matches = false) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function renderAlerts() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AlphaDeskDesignApp initialPage="alerts" initialSymbol="NVDA" />
    </QueryClientProvider>,
  );
}

describe("buildAlertRowHref unit", () => {
  it("news row with symbol → /symbols/{TICKER}", () => {
    expect(buildAlertRowHref({ kindGroup: "news", symbol: "nvda" })).toBe("/symbols/NVDA");
  });

  it("news row without symbol falls back to article URL", () => {
    expect(
      buildAlertRowHref({ kindGroup: "news", symbol: null, link: "https://example.com/foo" }),
    ).toBe("https://example.com/foo");
  });

  it("news row without symbol or url → null (no link)", () => {
    expect(buildAlertRowHref({ kindGroup: "news", symbol: null })).toBeNull();
  });

  it("order row with order id → /trade?order={id}", () => {
    expect(buildAlertRowHref({ kindGroup: "order", orderId: "ord-123" })).toBe(
      "/trade?order=ord-123",
    );
  });

  it("order row with symbol but no id → /trade?symbol={SYM}", () => {
    expect(buildAlertRowHref({ kindGroup: "order", symbol: "spy" })).toBe(
      "/trade?symbol=SPY",
    );
  });

  it("notification row with symbol → /symbols/{TICKER}", () => {
    expect(buildAlertRowHref({ kindGroup: "notification", symbol: "aapl" })).toBe(
      "/symbols/AAPL",
    );
  });

  it("notification row with order id (no symbol) → /trade?order={id}", () => {
    expect(
      buildAlertRowHref({ kindGroup: "notification", symbol: null, orderId: "ord-9" }),
    ).toBe("/trade?order=ord-9");
  });

  it("notification row with no destination → null", () => {
    expect(buildAlertRowHref({ kindGroup: "notification", symbol: null, orderId: null })).toBeNull();
  });

  it("notification row with backend in-app link → uses link", () => {
    expect(
      buildAlertRowHref({
        kindGroup: "notification",
        symbol: null,
        orderId: null,
        link: "/risk/exposure",
      }),
    ).toBe("/risk/exposure");
  });
});

describe("alertRowSymbol / alertRowOrderId extractors", () => {
  it("returns uppercase symbol when present", () => {
    expect(alertRowSymbol({ symbol: "tsla" })).toBe("TSLA");
    expect(alertRowSymbol({ ticker: "msft" })).toBe("MSFT");
    expect(alertRowSymbol({ symbols: ["nvda", "amd"] })).toBe("NVDA");
  });
  it("returns null for non-string or missing", () => {
    expect(alertRowSymbol(null)).toBeNull();
    expect(alertRowSymbol({})).toBeNull();
    expect(alertRowSymbol({ symbol: "" })).toBeNull();
  });
  it("extracts order id from order_id / orderId / numeric", () => {
    expect(alertRowOrderId({ order_id: "ord-x" })).toBe("ord-x");
    expect(alertRowOrderId({ orderId: "ord-y" })).toBe("ord-y");
    expect(alertRowOrderId({ order_id: 42 })).toBe("42");
    expect(alertRowOrderId({})).toBeNull();
  });
});

describe("AlertsPage render — Open → wiring", () => {
  beforeEach(() => {
    installMatchMedia(false);
    vi.mocked(getNotifications).mockReset();
    vi.mocked(getOrders).mockReset();
    vi.mocked(getMarketNews).mockReset();
    // AlertsPage reads orders off the canonical portfolio store
    // (`live.orders` is populated when `snapshotAt` is non-null); reset
    // the store between tests so order-row assertions are isolated.
    usePortfolioStore.setState({ orders: [], snapshotAt: null, snapshotSource: null });
  });

  afterEach(() => {
    cleanup();
    usePortfolioStore.setState({ orders: [], snapshotAt: null, snapshotSource: null });
  });

  it("notification with symbol renders link href=/symbols/{TICKER}", async () => {
    vi.mocked(getNotifications).mockResolvedValue([
      {
        id: 1,
        type: "fill",
        severity: "info",
        title: "NVDA filled",
        body: "Filled at 134.20",
        // Backend sometimes attaches the symbol on the wire even though
        // the official type is currently slim — the helper picks it up.
        symbol: "NVDA",
        link: null,
        created_at: new Date().toISOString(),
        read_at: null,
      } as unknown as never,
    ]);
    vi.mocked(getOrders).mockResolvedValue([]);
    vi.mocked(getMarketNews).mockResolvedValue([]);

    renderAlerts();

    const link = await screen.findByTestId("alerts-open-notification");
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/symbols/NVDA");
  });

  it("notification with no symbol AND no order_id does NOT render Open →", async () => {
    vi.mocked(getNotifications).mockResolvedValue([
      {
        id: 2,
        type: "system",
        severity: "info",
        title: "Maintenance window",
        body: "Backend deploy in progress.",
        link: null,
        created_at: new Date().toISOString(),
        read_at: null,
      } as unknown as never,
    ]);
    vi.mocked(getOrders).mockResolvedValue([]);
    vi.mocked(getMarketNews).mockResolvedValue([]);

    renderAlerts();

    // Wait for the row to actually render — without an Open → link.
    await screen.findByText(/Maintenance window/);
    expect(screen.queryByTestId("alerts-open-notification")).toBeNull();
    // The literal "Open →" string should not appear inside the alert
    // row when there is no destination — guard against future regressions
    // where someone re-adds a dead anchor.
    const row = screen.getByText(/Maintenance window/).closest("div");
    expect(row).not.toBeNull();
    if (row) {
      expect(within(row).queryByText(/Open →/)).toBeNull();
    }
  });

  it("news row with ticker renders link href=/symbols/{TICKER}", async () => {
    vi.mocked(getNotifications).mockResolvedValue([]);
    vi.mocked(getOrders).mockResolvedValue([]);
    vi.mocked(getMarketNews).mockResolvedValue([
      {
        title: "TSLA Q1 production beats",
        source: "press",
        published_at: new Date().toISOString(),
        url: "https://example.com/tsla",
        // News rows can ride with a symbol off the news provider.
        symbol: "TSLA",
      } as unknown as never,
    ]);

    renderAlerts();

    const link = await screen.findByTestId("alerts-open-news");
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/symbols/TSLA");
  });

  it("order row with id renders link href=/trade?order={id}", async () => {
    vi.mocked(getNotifications).mockResolvedValue([]);
    vi.mocked(getOrders).mockResolvedValue([]);
    vi.mocked(getMarketNews).mockResolvedValue([]);

    // AlertsPage consumes orders off the canonical store (LiveDataProvider
    // returns `canonicalOrders` once snapshotAt is non-null) instead of
    // calling `getOrders` directly. Seed the store so the row renders.
    usePortfolioStore.setState({
      orders: [
        {
          id: "ord-42",
          symbol: "SPY",
          side: "buy",
          type: "market",
          quantity: 10,
          status: "filled",
          createdAt: new Date().toISOString(),
          legs: [],
        } as unknown as never,
      ],
      snapshotAt: Date.now(),
      snapshotSource: "manual",
    });

    renderAlerts();

    await waitFor(() => {
      const link = screen.getByTestId("alerts-open-order");
      expect(link).toHaveAttribute("href", "/trade?order=ord-42");
    });
  });
});
