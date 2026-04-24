import "../setup-mocks";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import DetailHeader from "@/app/(dashboard)/strategies/earnings-options-play/_earnings/DetailHeader";

describe("DetailHeader", () => {
  it("renders symbol, company, sector, report date/time, and price block", () => {
    const { container } = render(
      <DetailHeader
        symbol="NVDA" company="Nvidia" sector="Semiconductors"
        reportDate="2026-04-23" reportTime="AMC"
        quote={{ last: 201.7, change: -1.42, changePct: -0.007 }}
      />,
    );
    expect(container.textContent).toContain("Nvidia");
    expect(container.textContent).toContain("NVDA");
    expect(container.textContent).toContain("Semiconductors");
    expect(container.textContent).toContain("201.70");
    expect(container.textContent).toMatch(/AMC/);
    expect(container.textContent).toMatch(/-1\.42|\-0\.70%|-0.7%/);
  });

  it("shows em-dash for missing quote", () => {
    const { container } = render(
      <DetailHeader symbol="NVDA" company="Nvidia" sector="Semis" reportDate="2026-04-23" reportTime="AMC" quote={null} />
    );
    expect(container.textContent).toContain("—");
  });
});
