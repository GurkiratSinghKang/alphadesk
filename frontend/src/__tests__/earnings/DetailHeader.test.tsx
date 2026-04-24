import "../setup-mocks";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import DetailHeader from "@/app/(dashboard)/strategies/earnings-options-play/_earnings/DetailHeader";

describe("DetailHeader", () => {
  it("renders symbol, company, sector, report date/time, and price block", () => {
    const { container } = render(
      <DetailHeader
        symbol="NVDA" company="Nvidia" sector="Semiconductors"
        report_date="2026-04-23" report_time="AMC"
        quote={{ last: 201.7, change: -1.42, change_pct: -0.007 }}
      />,
    );
    expect(container.textContent).toContain("Nvidia");
    expect(container.textContent).toContain("NVDA");
    expect(container.textContent).toContain("Semiconductors");
    expect(container.textContent).toContain("201.70");
    expect(container.textContent).toMatch(/AMC/);
    // Post-i18n: price/change render via fmtCurrency + fmtPct. Accept either
    // the old raw form ("-1.42") or the currency-wrapped form ("-$1.42") and
    // either percent form ("-0.70%", "-0.7%") emitted by Intl.
    expect(container.textContent).toMatch(/-\$?1\.42|\-0\.70%|-0\.7%/);
  });

  it("shows em-dash for missing quote", () => {
    const { container } = render(
      <DetailHeader symbol="NVDA" company="Nvidia" sector="Semis" report_date="2026-04-23" report_time="AMC" quote={null} />,
    );
    expect(container.textContent).toContain("—");
  });
});
