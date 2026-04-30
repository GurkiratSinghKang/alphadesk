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

  it("submit button invokes onSubmit with current state", () => {
    const fn = vi.fn();
    const { getByText } = render(
      <OrderBar
        symbol="SPY"
        strategies={[{ id: "ra", label: "Regime Adaptive" }]}
        onSubmit={fn}
        defaults={{ side: "buy", quantity: 100, type: "market" }}
      />,
    );
    // Wave 28: button was relabelled from "Stage order" to "Place order"
    // because the click is live (no review step). Match either label to
    // keep this test resilient to the copy change without forcing a
    // rename loop.
    fireEvent.click(getByText(/Place order|Stage order/i));
    expect(fn).toHaveBeenCalledTimes(1);
    const order = fn.mock.calls[0][0];
    expect(order.symbol).toBe("SPY");
    expect(order.strategyId).toBe("ra");
    expect(order.side).toBe("buy");
    expect(order.quantity).toBe(100);
  });

  it("supports controlled strategy selection for dashboard summaries", () => {
    const submit = vi.fn();
    const change = vi.fn();
    const { getByLabelText, getByText } = render(
      <OrderBar
        symbol="SPY"
        strategies={[
          { id: "ra", label: "Regime Adaptive" },
          { id: "mq", label: "Momentum & Quality" },
        ]}
        strategyId="mq"
        onStrategyChange={change}
        onSubmit={submit}
        defaults={{ side: "buy", quantity: 1, type: "market" }}
      />,
    );

    expect((getByLabelText("Strategy") as HTMLSelectElement).value).toBe("mq");
    fireEvent.change(getByLabelText("Strategy"), { target: { value: "ra" } });
    expect(change).toHaveBeenCalledWith("ra");
    fireEvent.click(getByText(/Place order|Stage order/i));
    expect(submit.mock.calls[0][0].strategyId).toBe("mq");
  });
});
