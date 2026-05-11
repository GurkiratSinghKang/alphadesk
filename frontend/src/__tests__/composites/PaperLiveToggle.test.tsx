import "../setup-mocks";

import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";

import PaperLiveToggle from "@/components/composites/PaperLiveToggle";
import { commitUserTradingMode, getUserTradingMode } from "@/lib/api";
import { useUIStore } from "@/stores/ui";

// NOTE on toast mocking: setup-mocks.ts already mocks @/hooks/useToast
// at the module level, returning a fresh vi.fn() per useToast() call.
// Asserting on the toast call would require deeper plumbing; instead
// we verify the LOAD-BEARING contract — the trading-mode state itself
// — via useUIStore. The "admin-gated" toast copy is enforced by
// inspection (and re-derived from CommandPalette which is exercised
// elsewhere).

describe("PaperLiveToggle", () => {
  beforeEach(() => {
    useUIStore.setState({ tradingMode: "paper" });
    vi.mocked(getUserTradingMode).mockResolvedValue({ mode: "paper" });
    vi.mocked(commitUserTradingMode).mockImplementation(async (body) => {
      if (body.mode === "live") {
        throw new Error("TOTP code required");
      }
      return { mode: "paper" };
    });
  });

  it("renders both segments", () => {
    const { getByLabelText } = render(<PaperLiveToggle />);
    expect(getByLabelText(/Paper trading/i)).not.toBeNull();
    expect(getByLabelText(/Live trading/i)).not.toBeNull();
  });

  it("flags the active segment via aria-pressed and data-mode", () => {
    const { container, getByLabelText } = render(<PaperLiveToggle />);
    const wrapper = container.querySelector("[data-slot='paper-live-toggle']");
    expect(wrapper?.getAttribute("data-mode")).toBe("paper");
    const paper = getByLabelText(/Paper trading/i);
    expect(paper.getAttribute("aria-pressed")).toBe("true");
    const live = getByLabelText(/Live trading/i);
    expect(live.getAttribute("aria-pressed")).toBe("false");
  });

  it("commits back to paper on the server when in live mode", async () => {
    useUIStore.setState({ tradingMode: "live" });
    vi.mocked(getUserTradingMode).mockResolvedValue({ mode: "live" });
    const { getByLabelText } = render(<PaperLiveToggle />);
    fireEvent.click(getByLabelText(/Paper trading/i));
    await waitFor(() => {
      expect(commitUserTradingMode).toHaveBeenCalledWith({ mode: "paper" });
      expect(useUIStore.getState().tradingMode).toBe("paper");
    });
  });

  it("does NOT flip to live client-side when server step-up rejects", async () => {
    const { getByLabelText, getByText } = render(<PaperLiveToggle />);
    fireEvent.click(getByLabelText(/Live trading/i));
    expect(commitUserTradingMode).not.toHaveBeenCalledWith({ mode: "live" });
    fireEvent.change(getByLabelText(/2FA code/i), { target: { value: "123456" } });
    fireEvent.click(getByText("Enable live"));
    // CRITICAL: tradingMode must STAY paper. Round-10 / W-2 fix
    // (preservation invariant: live posture requires server-side step-up,
    // not a client-side toggle). This is the load-bearing assertion.
    await waitFor(() => {
      expect(commitUserTradingMode).toHaveBeenCalledWith({ mode: "live", totp_code: "123456" });
      expect(useUIStore.getState().tradingMode).toBe("paper");
    });
  });

  it("is a no-op when clicking the already-active segment", () => {
    useUIStore.setState({ tradingMode: "paper" });
    const { getByLabelText } = render(<PaperLiveToggle />);
    fireEvent.click(getByLabelText(/Paper trading/i));
    expect(useUIStore.getState().tradingMode).toBe("paper");
  });

  it("renders compact variant with single-letter labels", () => {
    const { container } = render(<PaperLiveToggle variant="compact" />);
    expect(container.textContent).toContain("P");
    expect(container.textContent).toContain("L");
    expect(container.textContent).not.toContain("Paper");
  });
});
