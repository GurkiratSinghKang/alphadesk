import "./setup-mocks";
import { describe, it, expect, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import StrategiesPage from "@/app/(dashboard)/strategies/page";
import * as api from "@/lib/api";

describe("/strategies kind grouping", () => {
  it("renders an Active section (autonomous) and a Research section", async () => {
    vi.mocked(api.getStrategies).mockResolvedValue([
      { id: "pead", name: "PEAD", status: "active", invested_amount: 0, total_return_pct: 0, win_rate: 0.5, active_positions_count: 0, sparkline: [] },
      { id: "earnings-options-play", name: "Earnings Options Play", status: "active", invested_amount: 0, total_return_pct: 0, win_rate: -1, active_positions_count: 0, sparkline: [] },
    ] as any);
    vi.mocked(api.getStrategyCatalog).mockResolvedValue([] as any);

    const { container } = render(<StrategiesPage />);
    await waitFor(() => {
      expect(container.textContent).toMatch(/Active/i);
      expect(container.textContent).toMatch(/Research/i);
      // Earnings Options Play must appear under Research
      const researchHeader = container.querySelector('[data-section="research"]');
      expect(researchHeader?.textContent).toContain("Earnings Options Play");
      // PEAD must appear under Active (card renders STRATEGY_META display name)
      const activeHeader = container.querySelector('[data-section="active"]');
      expect(activeHeader?.textContent).toContain("Post-Earnings Announcement Drift");
    });
  });
});
