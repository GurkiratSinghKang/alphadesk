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
    expect(container.textContent).toMatch(/edge score/i);
  });

  it("calls onChange with new filters when window toggle is clicked", () => {
    const onChange = vi.fn();
    // Round-4 (CLUSTER C/7): WINDOW buttons now use role=radio inside a
    // role=radiogroup so SR users hear single-select semantics. Tests
    // grab the button by its radio role rather than the implicit button.
    const { getByRole } = render(
      <FiltersBar filters={{ window: "both", minIvRank: 50, sort: "date" }} onChange={onChange} />,
    );
    fireEvent.click(getByRole("radio", { name: /current week/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ window: "current" }));
  });

  it("updates minIvRank on slider change (commits on release — K-7)", () => {
    // K-7 (round-6): the slider is now commit-on-release, so a raw
    // `change` event during a drag must NOT call `onChange` — that
    // would re-key the calendar query 21 times for a 0→100 sweep.
    // Asserting both:
    //   1. mid-drag (`change` only) doesn't propagate to the parent
    //   2. on release (`pointerUp`) the new value is committed
    const onChange = vi.fn();
    const { container } = render(
      <FiltersBar filters={{ window: "both", minIvRank: 50, sort: "date" }} onChange={onChange} />,
    );
    const slider = container.querySelector('input[type="range"][name="minIvRank"]') as HTMLInputElement;
    expect(slider).not.toBeNull();
    fireEvent.change(slider, { target: { value: "70" } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.pointerUp(slider);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ minIvRank: 70 }));
  });

  it("calls onSettleRef when IV-rank slider settles (B-56)", () => {
    const onSettleRef = vi.fn();
    const { container } = render(
      <FiltersBar
        filters={{ window: "both", minIvRank: 50, sort: "date" }}
        onChange={() => {}}
        onSettleRef={onSettleRef}
      />,
    );
    const slider = container.querySelector('input[type="range"][name="minIvRank"]') as HTMLInputElement;
    expect(slider).not.toBeNull();
    fireEvent.pointerUp(slider);
    expect(onSettleRef).toHaveBeenCalled();
    fireEvent.blur(slider);
    expect(onSettleRef.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("is a no-op when onSettleRef is absent (B-56 back-compat)", () => {
    const { container } = render(
      <FiltersBar filters={{ window: "both", minIvRank: 50, sort: "date" }} onChange={() => {}} />,
    );
    const slider = container.querySelector('input[type="range"][name="minIvRank"]') as HTMLInputElement;
    // Should not throw.
    expect(() => fireEvent.pointerUp(slider)).not.toThrow();
    expect(() => fireEvent.blur(slider)).not.toThrow();
  });

  it("shows a sort-direction indicator next to the active sort (B-9)", () => {
    // Round-4 (CLUSTER E/17): the unicode arrow was replaced with a
    // 14×14 SVG that uses currentColor + 1px outline so the marker
    // reads at the smallest supported viewport. We assert on the SVG
    // existence + aria-label, and on the rotation class for asc.
    const { container, rerender } = render(
      <FiltersBar filters={{ window: "both", minIvRank: 50, sort: "date" }} onChange={() => {}} />,
    );
    const ind = container.querySelector('[data-slot="sort-direction-indicator"]');
    expect(ind).not.toBeNull();
    expect(ind?.tagName.toLowerCase()).toBe("svg");
    // date defaults to ascending — aria-label should reflect that.
    expect(ind?.getAttribute("aria-label")).toMatch(/ascending/i);

    rerender(
      <FiltersBar filters={{ window: "both", minIvRank: 50, sort: "iv_rank" }} onChange={() => {}} />,
    );
    const ind2 = container.querySelector('[data-slot="sort-direction-indicator"]');
    expect(ind2?.getAttribute("aria-label")).toMatch(/descending/i);

    rerender(
      <FiltersBar filters={{ window: "both", minIvRank: 50, sort: "edge_score" }} onChange={() => {}} />,
    );
    const ind3 = container.querySelector('[data-slot="sort-direction-indicator"]');
    expect(ind3?.getAttribute("aria-label")).toMatch(/descending/i);
  });

  // ── Round-4 additions ────────────────────────────────────────

  it("WINDOW buttons are radiogroup with role=radio + aria-checked (CLUSTER C/7)", () => {
    const { container } = render(
      <FiltersBar filters={{ window: "both", minIvRank: 50, sort: "date" }} onChange={() => {}} />,
    );
    const groups = container.querySelectorAll('[role="radiogroup"]');
    // One radiogroup for WINDOW, one for TIME.
    expect(groups.length).toBeGreaterThanOrEqual(2);
    const winGroup = Array.from(groups).find(
      (g) => g.getAttribute("aria-label") === "Earnings calendar window",
    );
    expect(winGroup).toBeTruthy();
    const radios = winGroup?.querySelectorAll('[role="radio"]') ?? [];
    expect(radios.length).toBe(3);
    const checked = Array.from(radios).find((r) => r.getAttribute("aria-checked") === "true");
    expect(checked?.textContent).toMatch(/Both weeks/);
  });

  it("renames WINDOW 'Both' to 'Both weeks' and TIME 'Both' to 'All hours' (CLUSTER C/8)", () => {
    const { container } = render(
      <FiltersBar filters={{ window: "both", minIvRank: 50, sort: "date" }} onChange={() => {}} />,
    );
    expect(container.textContent).toContain("Both weeks");
    expect(container.textContent).toContain("All hours");
    // No radio reads as a sole "Both" label any more.
    const radios = container.querySelectorAll('[role="radio"]');
    const hasBareBoth = Array.from(radios).some((r) =>
      /^\s*[●○]\s*Both\s*$/.test(r.textContent ?? ""),
    );
    expect(hasBareBoth).toBe(false);
  });

  it("IV-rank slider thumb has WCAG-min thumb-size class applied (CLUSTER E/9)", () => {
    const { container } = render(
      <FiltersBar filters={{ window: "both", minIvRank: 50, sort: "date" }} onChange={() => {}} />,
    );
    const slider = container.querySelector('input[type="range"][name="minIvRank"]') as HTMLInputElement;
    expect(slider.className).toMatch(/webkit-slider-thumb\]:h-6/);
    expect(slider.className).toMatch(/moz-range-thumb\]:h-6/);
  });

  it("calls onSettleRef when sort dropdown changes (B-NEW-3)", () => {
    const onSettleRef = vi.fn();
    const { container } = render(
      <FiltersBar
        filters={{ window: "both", minIvRank: 50, sort: "date" }}
        onChange={() => {}}
        onSettleRef={onSettleRef}
      />,
    );
    const select = container.querySelector("select") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "iv_rank" } });
    expect(onSettleRef).toHaveBeenCalled();
  });
});
