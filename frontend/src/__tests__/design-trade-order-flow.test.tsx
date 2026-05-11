import "./setup-mocks";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AlphaDeskDesignApp } from "@/components/design-v2/AlphaDeskDesign";
import { getOrders, getPortfolioSummary, getPositions, placeOrder, previewOrder } from "@/lib/api";

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

describe("AlphaDeskDesign trade ticket", () => {
  beforeEach(() => {
    installMatchMedia(false);
    vi.mocked(previewOrder).mockReset();
    vi.mocked(placeOrder).mockReset();
    vi.mocked(previewOrder).mockResolvedValue({
      review_id: "review-live-ticket",
      can_submit: true,
      expires_at: new Date(Date.now() + 90_000).toISOString(),
      checks: [
        {
          code: "notional",
          label: "Notional estimate",
          passed: true,
          detail: "Estimated notional is $679.00.",
        },
      ],
    });
    vi.mocked(placeOrder).mockResolvedValue({
      id: "order-live-ticket",
      symbol: "SPY",
      side: "buy",
      type: "market",
      quantity: 1,
      status: "filled",
      createdAt: "",
    });
    vi.mocked(getPositions).mockClear();
    vi.mocked(getOrders).mockClear();
    vi.mocked(getPortfolioSummary).mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("previews the live stock ticket before confirmed submit", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <AlphaDeskDesignApp initialPage="trade" initialSymbol="SPY" />
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /^market$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /stage buy order/i }));

    await waitFor(() => expect(previewOrder).toHaveBeenCalledTimes(1));
    expect(getPositions).not.toHaveBeenCalled();
    expect(getOrders).not.toHaveBeenCalled();
    expect(getPortfolioSummary).not.toHaveBeenCalled();
    expect(vi.mocked(previewOrder).mock.calls[0][0]).toMatchObject({
      symbol: "SPY",
      side: "buy",
      type: "market",
      quantity: 1,
      route_intent: "broker_order_review",
    });
    expect(placeOrder).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole("button", { name: /confirm buy order/i }));

    await waitFor(() => expect(placeOrder).toHaveBeenCalledTimes(1));
    expect(vi.mocked(placeOrder).mock.calls[0][0]).toMatchObject({
      symbol: "SPY",
      side: "buy",
      type: "market",
      quantity: 1,
      review_id: "review-live-ticket",
    });
  });
});
