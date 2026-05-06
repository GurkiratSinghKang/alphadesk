import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

import type { HistoricalBlock, IVTermPoint } from "@/types";

vi.mock("@/app/(dashboard)/strategies/earnings-options-play/_earnings/HistoricalMoves", () => ({
  __esModule: true,
  default: ({ historical }: { historical: HistoricalBlock | null }) => (
    <div data-testid="mock-historical-moves" data-quarters={historical?.quarters.length ?? 0} />
  ),
}));

import { EarningsPanel } from "../_sections/EarningsPanel";

function makeHistorical(): HistoricalBlock {
  return {
    quarters: [
      {
        reportDate: "2026-02-15",
        surprisePct: 9.1,
        nextDayMovePct: 0.04,
        fiveDayMovePct: 0.06,
      },
      {
        reportDate: "2025-11-15",
        surprisePct: 5.2,
        nextDayMovePct: -0.03,
        fiveDayMovePct: -0.05,
      },
    ],
    stats: {
      avgAbsMovePct: 0.035,
      wins: 1,
      losses: 1,
      surpriseBeatRate: 1.0,
      ivVsHistVolPoints: 2.5,
    },
  };
}

describe("EarningsPanel", () => {
  it("returns null when isETF=true (curated earnings universe excludes ETFs)", () => {
    const { container } = render(
      <EarningsPanel
        isETF={true}
        historicalEarnings={makeHistorical()}
        ivTermStructure={null}
        nextReportDate="2026-05-20"
        nextReportTime="AMC"
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the section anchor id='earnings' with scroll-mt-24", () => {
    const { getByTestId } = render(
      <EarningsPanel
        isETF={false}
        historicalEarnings={makeHistorical()}
        ivTermStructure={null}
        nextReportDate={null}
        nextReportTime={null}
      />,
    );
    const panel = getByTestId("earnings-panel");
    expect(panel.getAttribute("id")).toBe("earnings");
    expect(panel.className).toContain("scroll-mt-24");
  });

  it("forwards the historicalEarnings block to HistoricalMoves", () => {
    const { getByTestId } = render(
      <EarningsPanel
        isETF={false}
        historicalEarnings={makeHistorical()}
        ivTermStructure={null}
        nextReportDate={null}
        nextReportTime={null}
      />,
    );
    expect(getByTestId("mock-historical-moves").getAttribute("data-quarters")).toBe("2");
  });

  it("renders the next-report eyebrow with date + AMC/BMO when both present", () => {
    const { getByTestId } = render(
      <EarningsPanel
        isETF={false}
        historicalEarnings={null}
        ivTermStructure={null}
        nextReportDate="2026-05-20"
        nextReportTime="AMC"
      />,
    );
    expect(getByTestId("earnings-next").textContent).toContain("AMC");
  });

  it("hides the next-report eyebrow when reportDate is null (stub-detail symbol)", () => {
    const { queryByTestId } = render(
      <EarningsPanel
        isETF={false}
        historicalEarnings={null}
        ivTermStructure={null}
        nextReportDate={null}
        nextReportTime={null}
      />,
    );
    expect(queryByTestId("earnings-next")).toBeNull();
  });

  it("renders the IV term steepness chip when at least 2 finite term points exist", () => {
    const term: IVTermPoint[] = [
      { expiry: "2026-05-16", dte: 11, atmIv: 0.42 },
      { expiry: "2026-08-15", dte: 102, atmIv: 0.30 },
    ];
    const { getByTestId } = render(
      <EarningsPanel
        isETF={false}
        historicalEarnings={null}
        ivTermStructure={term}
        nextReportDate={null}
        nextReportTime={null}
      />,
    );
    const chip = getByTestId("earnings-iv-steepness");
    expect(chip.textContent).toContain("IV term steepness");
  });

  it("hides the IV term steepness chip when fewer than 2 finite term points exist", () => {
    const term: IVTermPoint[] = [{ expiry: "2026-05-16", dte: 11, atmIv: 0.42 }];
    const { queryByTestId } = render(
      <EarningsPanel
        isETF={false}
        historicalEarnings={null}
        ivTermStructure={term}
        nextReportDate={null}
        nextReportTime={null}
      />,
    );
    expect(queryByTestId("earnings-iv-steepness")).toBeNull();
  });
});
