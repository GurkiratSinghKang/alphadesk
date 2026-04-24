import "../setup-mocks";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import FiltersBar from "@/app/(dashboard)/strategies/earnings-options-play/_earnings/FiltersBar";

describe("FiltersBar", () => {
  it("renders window / IV-rank / market-cap / BMO-AMC / sort controls", () => {
    const { container } = render(
      <FiltersBar filters={{ window: "both", min_iv_rank: 50, sort: "date" }} onChange={() => {}} />,
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
      <FiltersBar filters={{ window: "both", min_iv_rank: 50, sort: "date" }} onChange={onChange} />,
    );
    fireEvent.click(getByRole("button", { name: /current week/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ window: "current" }));
  });

  it("updates min_iv_rank on slider change", () => {
    const onChange = vi.fn();
    const { container } = render(
      <FiltersBar filters={{ window: "both", min_iv_rank: 50, sort: "date" }} onChange={onChange} />,
    );
    const slider = container.querySelector('input[type="range"][name="min_iv_rank"]') as HTMLInputElement;
    expect(slider).not.toBeNull();
    fireEvent.change(slider, { target: { value: "70" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ min_iv_rank: 70 }));
  });

  it("shows a sort-direction indicator next to the active sort (B-9)", () => {
    const { container, rerender } = render(
      <FiltersBar filters={{ window: "both", min_iv_rank: 50, sort: "date" }} onChange={() => {}} />,
    );
    const ind = container.querySelector('[data-slot="sort-direction-indicator"]');
    expect(ind).not.toBeNull();
    // date defaults to ascending
    expect(ind?.textContent).toBe("\u2191");

    rerender(
      <FiltersBar filters={{ window: "both", min_iv_rank: 50, sort: "iv_rank" }} onChange={() => {}} />,
    );
    const ind2 = container.querySelector('[data-slot="sort-direction-indicator"]');
    expect(ind2?.textContent).toBe("\u2193");
  });
});
