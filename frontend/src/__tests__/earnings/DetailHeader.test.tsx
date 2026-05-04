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
    // Post-i18n: price/change render via fmtCurrency + fmtPct. Accept either
    // the old raw form ("-1.42") or the currency-wrapped form ("-$1.42") and
    // either percent form ("-0.70%", "-0.7%") emitted by Intl.
    expect(container.textContent).toMatch(/-\$?1\.42|\-0\.70%|-0\.7%/);
  });

  it("shows em-dash for missing quote", () => {
    const { container } = render(
      <DetailHeader symbol="NVDA" company="Nvidia" sector="Semis" reportDate="2026-04-23" reportTime="AMC" quote={null} />
    );
    expect(container.textContent).toContain("—");
  });

  it("labels unconfirmed DMT timing explicitly", () => {
    const { container } = render(
      <DetailHeader
        symbol="NVDA"
        company="Nvidia"
        sector="Semis"
        reportDate="2026-04-23"
        reportTime="DMT"
        quote={null}
      />
    );
    expect(container.textContent).toContain("DMT (unconfirmed)");
    expect(container.querySelector('[title*="verify before placing"]')).not.toBeNull();
  });

  it("stacks the quote block on narrow viewports instead of clipping it", () => {
    const { container } = render(
      <DetailHeader
        symbol="AMGN"
        company="Amgen"
        sector="Healthcare"
        reportDate="2026-04-30"
        reportTime="DMT"
        quote={{ last: 335.11, change: -4.46, changePct: -1.31 }}
      />,
    );
    const header = container.querySelector('[data-slot="detail-header"]');
    expect(header?.className).toContain("flex-col");
    expect(header?.className).toContain("sm:flex-row");
    expect(container.querySelector(".t-num-hero")?.className).toContain("text-numeric-hero");
  });
});
