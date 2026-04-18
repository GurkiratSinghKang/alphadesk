import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import OrderBar from "@/components/composites/OrderBar";

describe("OrderBar", () => {
  it("renders all six labeled groups", () => {
    const { container } = render(
      <OrderBar
        symbol="NVDA"
        strategies={[{ id: "mq", label: "Momentum & Quality" }]}
        onSubmit={() => {}}
        defaults={{ side: "buy", quantity: 250, type: "limit", price: 134.8 }}
      />,
    );
    expect(container.querySelector('[data-slot="order-bar"]')).not.toBeNull();
    const text = container.textContent ?? "";
    for (const label of ["Strategy", "Side", "Qty", "Type", "Price", "Stop"]) {
      expect(text).toContain(label);
    }
  });

  it("stage button invokes onSubmit with current state", () => {
    const fn = vi.fn();
    const { getByText } = render(
      <OrderBar
        symbol="SPY"
        strategies={[{ id: "ra", label: "Regime Adaptive" }]}
        onSubmit={fn}
        defaults={{ side: "buy", quantity: 100, type: "market" }}
      />,
    );
    fireEvent.click(getByText(/Stage order/i));
    expect(fn).toHaveBeenCalledTimes(1);
    const order = fn.mock.calls[0][0];
    expect(order.symbol).toBe("SPY");
    expect(order.strategyId).toBe("ra");
    expect(order.side).toBe("buy");
    expect(order.quantity).toBe(100);
  });
});
