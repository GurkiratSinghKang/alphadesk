import "./setup-mocks";
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { StrategyPanel } from "@/app/(dashboard)/page";

describe("Dashboard StrategyPanel", () => {
  it("renders a true empty state after strategy data loads empty", () => {
    const { container } = render(
      <StrategyPanel
        strategies={[]}
        activeStrategyCount={0}
        totalStrategyCount={0}
        loading={false}
        error={false}
        onStrategyClick={vi.fn()}
        onStrategies={vi.fn()}
      />,
    );

    expect(container.textContent).toMatch(/no strategy exceptions/i);
    expect(container.textContent).not.toMatch(/still loading/i);
  });

  it("renders an error state when the strategy query fails", () => {
    const { container } = render(
      <StrategyPanel
        strategies={[]}
        activeStrategyCount={0}
        totalStrategyCount={0}
        loading={false}
        error
        onStrategyClick={vi.fn()}
        onStrategies={vi.fn()}
      />,
    );

    expect(container.textContent).toMatch(/strategy data unavailable/i);
  });
});
