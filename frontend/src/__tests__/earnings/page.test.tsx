import "../setup-mocks";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import EarningsOptionsPlayPage, {
  type SelectionSource,
} from "@/app/(dashboard)/strategies/earnings-options-play/page";
import { countVisibleCandidateDecisions } from "@/app/(dashboard)/strategies/earnings-options-play/_earnings/candidateDecisions";

describe("Earnings Options Play route", () => {
  it("renders the Claude v2 playbook design surface", () => {
    const { container } = render(<EarningsOptionsPlayPage />);

    expect(container.querySelector('[data-design-surface="playbook"]')).not.toBeNull();
    // 2026-05-10 sizing fix: DesignSurface now uses `h-full` instead of
    // `h-dvh` so it can size against the parent flex container (which
    // re-mounts the dashboard chrome around the design surface). Update
    // the selector to match.
    expect(container.querySelector(".h-full.w-full.bg-bg")).not.toBeNull();
    expect(container.textContent).not.toMatch(/earnings calendar/i);
  });

  it("keeps the old selection source type available for legacy child modules", () => {
    const source: SelectionSource = "keyboard";
    expect(source).toBe("keyboard");
  });

  it("counts saved and order-review decisions only for the visible calendar window", () => {
    expect(
      countVisibleCandidateDecisions(
        [
          { symbol: "NVDA", reportDate: "2026-04-23" },
          { symbol: "TSLA", reportDate: "2026-04-24" },
        ],
        {
          "NVDA@2026-04-23": "saved",
          "TSLA@2026-04-24": "order",
          "NVDA@2026-01-30": "discarded",
          "AAPL@2026-04-23": "order",
        },
      ),
    ).toEqual({ saved: 1, discarded: 0, order: 1, total: 2 });
  });
});
