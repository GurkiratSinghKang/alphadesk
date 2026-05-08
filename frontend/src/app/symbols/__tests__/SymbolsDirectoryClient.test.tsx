import "../../../__tests__/setup-mocks";
import { describe, expect, it, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { mockPush } from "../../../__tests__/setup-mocks";
import { SymbolsDirectoryClient } from "../_components/SymbolsDirectoryClient";

describe("SymbolsDirectoryClient", () => {
  beforeEach(() => {
    mockPush.mockReset();
  });

  it("shows top companies by default and links each ticker to its page", () => {
    render(<SymbolsDirectoryClient />);

    const row = screen.getByTestId("symbols-row-AAPL");
    expect(screen.getByText("Top companies")).toBeInTheDocument();
    expect(row).toHaveAttribute("href", "/symbols/AAPL");
  });

  it("routes typed tickers to the ticker page on submit", () => {
    render(<SymbolsDirectoryClient />);

    const input = screen.getByTestId("symbols-search-input");
    fireEvent.change(input, { target: { value: "nvda" } });
    fireEvent.submit(input.closest("form")!);

    expect(mockPush).toHaveBeenCalledWith("/symbols/NVDA");
  });

  it("exposes a direct admin control center path", () => {
    render(<SymbolsDirectoryClient />);

    expect(screen.getByTestId("symbols-admin-link")).toHaveAttribute(
      "href",
      "/admin/control-center",
    );
  });
});
