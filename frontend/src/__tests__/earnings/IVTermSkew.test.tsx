import "../setup-mocks";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import IVTermSkew from "@/app/(dashboard)/strategies/earnings-options-play/_earnings/IVTermSkew";

describe("IVTermSkew", () => {
  const term = [
    { expiry: "2026-04-25", dte: 3, atmIv: 0.79 },
    { expiry: "2026-05-02", dte: 10, atmIv: 0.58 },
    { expiry: "2026-05-16", dte: 24, atmIv: 0.48 },
  ];
  const skew = {
    putIv25d: 0.82, callIv25d: 0.77, skewPoints: 3.2,
    interpretation: "put-heavy skew" as const,
  };

  it("renders term structure plot points + labels", () => {
    const { container } = render(<IVTermSkew term={term} skew={skew} />);
    expect(container.textContent).toMatch(/IV term/i);
    expect(container.textContent).toMatch(/79|78|0\.79/);
    expect(container.textContent).toMatch(/skew/i);
    expect(container.textContent).toMatch(/put-heavy|put heavy/i);
  });

  it("renders empty state when both missing", () => {
    const { container } = render(<IVTermSkew term={null} skew={null} />);
    expect(container.textContent).toMatch(/unavailable|—/i);
  });
});
