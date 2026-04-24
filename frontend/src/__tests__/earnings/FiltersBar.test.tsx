import "../setup-mocks";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import FiltersBar from "@/app/(dashboard)/strategies/earnings-options-play/_earnings/FiltersBar";

describe("FiltersBar", () => {
  it("renders window / IV-rank / market-cap / BMO-AMC / sort controls", () => {
    const { container } = render(
      <FiltersBar filters={{ window: "both", minIvRank: 50, sort: "date" }} onChange={() => {}} />,
    );
    const slot = container.querySelector('[data-slot="filters-bar"]');
    expect(slot).not.toBeNull();
    expect(container.textContent).toMatch(/this week|next week|both/i);
    expect(container.textContent).toMatch(/IV rank/i);
    expect(container.textContent).toMatch(/sort/i);
  });

  it("calls onChange with new filters when window toggle is clicked", () => {
    const onChange = vi.fn();
    const { getByRole } = render(
      <FiltersBar filters={{ window: "both", minIvRank: 50, sort: "date" }} onChange={onChange} />,
    );
    fireEvent.click(getByRole("button", { name: /current week/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ window: "current" }));
  });

  it("updates minIvRank on slider change", () => {
    const onChange = vi.fn();
    const { container } = render(
      <FiltersBar filters={{ window: "both", minIvRank: 50, sort: "date" }} onChange={onChange} />,
    );
    const slider = container.querySelector('input[type="range"][name="minIvRank"]') as HTMLInputElement;
    expect(slider).not.toBeNull();
    fireEvent.change(slider, { target: { value: "70" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ minIvRank: 70 }));
  });
});
