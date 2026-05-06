import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

// Per-file mock for next/navigation so we can pivot pathname per case
// without leaking through the shared setup-mocks default of "/".
let currentPath = "/";
const pushSpy = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushSpy, back: vi.fn() }),
  usePathname: () => currentPath,
}));

import { BottomTabBar } from "@/components/layout/BottomTabBar";

// Tests assert against tab labels, so this list mirrors TABS in the
// component. If the component's label set changes the assertions will
// fail and we'll revisit on purpose.
const EXPECTED_LABELS = ["Desk", "Trade", "Strategies", "Pipeline", "More"];

describe("BottomTabBar", () => {
  beforeEach(() => {
    currentPath = "/";
    pushSpy.mockClear();
    // Reset any visualViewport stub a prior test may have installed.
    delete (window as unknown as { visualViewport?: unknown }).visualViewport;
  });

  afterEach(() => {
    delete (window as unknown as { visualViewport?: unknown }).visualViewport;
  });

  it("renders all 5 primary tabs", () => {
    render(<BottomTabBar />);
    for (const label of EXPECTED_LABELS) {
      // getAllByLabelText covers both the aria-label on the button and
      // the visible <span> text — robust to tweaks of either.
      expect(screen.getByRole("button", { name: label })).toBeDefined();
    }
  });

  it("marks the Desk tab active when pathname is '/'", () => {
    currentPath = "/";
    render(<BottomTabBar />);
    const desk = screen.getByRole("button", { name: "Desk" });
    expect(desk.getAttribute("aria-current")).toBe("page");
    // Sibling tabs must NOT carry aria-current="page".
    const trade = screen.getByRole("button", { name: "Trade" });
    expect(trade.getAttribute("aria-current")).toBeNull();
  });

  it("marks the Strategies tab active on a nested /strategies/* route", () => {
    currentPath = "/strategies/earnings-options-play";
    render(<BottomTabBar />);
    const strategies = screen.getByRole("button", { name: "Strategies" });
    expect(strategies.getAttribute("aria-current")).toBe("page");
    // The Desk tab uses an exact-match check ("/" only) so a nested
    // strategies route must NOT also light up Desk.
    const desk = screen.getByRole("button", { name: "Desk" });
    expect(desk.getAttribute("aria-current")).toBeNull();
  });

  it("returns null on non-dashboard routes (e.g. /login)", () => {
    currentPath = "/login";
    const { container } = render(<BottomTabBar />);
    expect(container.firstChild).toBeNull();
  });

  it("returns null on /request-access", () => {
    currentPath = "/request-access";
    const { container } = render(<BottomTabBar />);
    expect(container.firstChild).toBeNull();
  });

  it("calls router.push with the tab href when a tab is clicked", () => {
    currentPath = "/";
    render(<BottomTabBar />);
    const trade = screen.getByRole("button", { name: "Trade" });
    trade.click();
    expect(pushSpy).toHaveBeenCalledWith("/trade");
  });

  it("hides itself when the visualViewport height shrinks (keyboard open)", () => {
    // Stub visualViewport BEFORE render so the baseline captured in
    // useEffect is the unshrunk height. We then dispatch resize with a
    // smaller height to simulate the iOS keyboard sliding up.
    const listeners: Record<string, () => void> = {};
    const vv = {
      height: 800,
      addEventListener: (evt: string, cb: () => void) => {
        listeners[evt] = cb;
      },
      removeEventListener: (evt: string) => {
        delete listeners[evt];
      },
    };
    (window as unknown as { visualViewport?: unknown }).visualViewport = vv;

    currentPath = "/";
    const { container } = render(<BottomTabBar />);
    // Sanity: bar is present before keyboard "opens".
    expect(container.querySelector('[data-slot="bottom-tab-bar"]')).not.toBeNull();

    act(() => {
      vv.height = 400; // < 85% of 800 = 680, so handler treats keyboard as open
      listeners.resize?.();
    });

    expect(container.querySelector('[data-slot="bottom-tab-bar"]')).toBeNull();
  });

  it("applies sm:hidden so the bar is removed from desktop layout", () => {
    currentPath = "/";
    const { container } = render(<BottomTabBar />);
    const nav = container.querySelector('[data-slot="bottom-tab-bar"]');
    expect(nav?.className).toContain("sm:hidden");
  });

  it("respects safe-area-inset-bottom (iOS home indicator)", () => {
    currentPath = "/";
    const { container } = render(<BottomTabBar />);
    const nav = container.querySelector('[data-slot="bottom-tab-bar"]');
    // The Tailwind arbitrary-value class is rendered verbatim on the
    // element; we just check the literal substring so the CSS pipeline
    // doesn't have to be involved.
    expect(nav?.className).toContain("pb-[env(safe-area-inset-bottom)]");
  });
});
