import "../setup-mocks";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import EarningsDetailPanel, {
  ERROR_CODE_COPY,
} from "@/app/(dashboard)/strategies/earnings-options-play/_earnings/EarningsDetailPanel";
import type { EarningsDetail } from "@/types";

const detail: EarningsDetail = {
  symbol: "NVDA", company: "Nvidia", sector: "Semis",
  reportDate: "2026-04-23", reportTime: "AMC",
  quote: { last: 201.7, change: -1.4, changePct: -0.007 },
  metrics: { ivRank: 78, ivPercentile: 82, currentIv: 0.79, hv20: 0.42, hv50: null, hv100: null, hvIvRatio: 0.71, expectedMovePct: 0.064, expectedMoveDollars: 12.8, histAvgAbsMovePct: 0.052, beatRate: 0.87, daysToEarnings: 1, daysToExpiry: 3 },
  strikeLadder: null, claudeStructured: null, claudeFullResearch: null,
  historicalEarnings: {
    quarters: [
      { reportDate: "2026-01-30", surprisePct: 0.08, nextDayMovePct: 0.042, fiveDayMovePct: 0.053 },
      { reportDate: "2025-10-30", surprisePct: -0.02, nextDayMovePct: -0.081, fiveDayMovePct: -0.023 },
    ],
    stats: { avgAbsMovePct: 0.062, wins: 1, losses: 1, surpriseBeatRate: 0.5, ivVsHistVolPoints: null },
  },
  ivTermStructure: null, skew: null,
  news: [], partial: false, generatedAt: new Date().toISOString(),
};

describe("EarningsDetailPanel", () => {
  it("renders header, metrics, and all sub-panels when detail present", () => {
    const { container } = render(
      <EarningsDetailPanel detail={detail} loading={false} error={null} runningFull={false} onRunFullResearch={() => {}} />,
    );
    expect(container.querySelector('[data-slot="detail-header"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="metrics-strip"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="claude-thesis"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="strike-ladder"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="historical-moves"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="news-feed"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="trade-button-row"]')).not.toBeNull();
  });

  it("renders empty state when detail is null and not loading", () => {
    const { container } = render(
      <EarningsDetailPanel detail={null} loading={false} error={null} runningFull={false} onRunFullResearch={() => {}} />,
    );
    expect(container.textContent).toMatch(/select|choose/i);
  });

  it("renders skeleton when loading", () => {
    const { container } = render(
      <EarningsDetailPanel detail={null} loading={true} error={null} runningFull={false} onRunFullResearch={() => {}} />,
    );
    expect(container.textContent).toMatch(/loading/i);
  });

  it("renders error message when error", () => {
    const { container } = render(
      <EarningsDetailPanel detail={null} loading={false} error="provider down" runningFull={false} onRunFullResearch={() => {}} />,
    );
    expect(container.textContent).toMatch(/provider down|error/i);
  });

  it("renders candidate decision actions and toggles the active choice", () => {
    const onCandidateDecision = vi.fn();
    const onNext = vi.fn();
    window.addEventListener("alphadesk:earnings-select-next", onNext);
    const { getByRole } = render(
      <EarningsDetailPanel
        detail={detail}
        loading={false}
        error={null}
        runningFull={false}
        onRunFullResearch={() => {}}
        candidateDecision="saved"
        onCandidateDecision={onCandidateDecision}
      />,
    );

    expect(getByRole("button", { name: /save/i })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(getByRole("button", { name: /discard/i }));
    fireEvent.click(getByRole("button", { name: /queue order/i }));
    fireEvent.click(getByRole("button", { name: /save/i }));

    expect(onCandidateDecision).toHaveBeenNthCalledWith(1, "discarded");
    expect(onCandidateDecision).toHaveBeenNthCalledWith(2, "order");
    expect(onCandidateDecision).toHaveBeenNthCalledWith(3, null);
    expect(onNext).toHaveBeenCalledTimes(2);
    window.removeEventListener("alphadesk:earnings-select-next", onNext);
  });

  it("maps mobile card swipes to discard, save, and queue actions", () => {
    const onCandidateDecision = vi.fn();
    const onNext = vi.fn();
    window.addEventListener("alphadesk:earnings-select-next", onNext);
    const { container } = render(
      <EarningsDetailPanel
        detail={detail}
        loading={false}
        error={null}
        runningFull={false}
        onRunFullResearch={() => {}}
        onCandidateDecision={onCandidateDecision}
      />,
    );
    const swipeCard = container.querySelector('[data-slot="candidate-swipe-card"]') as HTMLElement;
    expect(swipeCard).not.toBeNull();

    fireEvent.pointerDown(swipeCard, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 160,
      clientY: 100,
    });
    fireEvent.pointerUp(swipeCard, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 70,
      clientY: 104,
    });

    fireEvent.pointerDown(swipeCard, {
      pointerId: 2,
      pointerType: "touch",
      clientX: 70,
      clientY: 100,
    });
    fireEvent.pointerUp(swipeCard, {
      pointerId: 2,
      pointerType: "touch",
      clientX: 160,
      clientY: 101,
    });

    fireEvent.pointerDown(swipeCard, {
      pointerId: 3,
      pointerType: "touch",
      clientX: 100,
      clientY: 180,
    });
    fireEvent.pointerUp(swipeCard, {
      pointerId: 3,
      pointerType: "touch",
      clientX: 104,
      clientY: 90,
    });

    expect(onCandidateDecision).toHaveBeenNthCalledWith(1, "discarded");
    expect(onCandidateDecision).toHaveBeenNthCalledWith(2, "saved");
    expect(onCandidateDecision).toHaveBeenNthCalledWith(3, "order");
    expect(onNext).toHaveBeenCalledTimes(3);
    window.removeEventListener("alphadesk:earnings-select-next", onNext);
  });

  // ── Round-4 additions ─────────────────────────────────────

  it("surfaces a partial-data banner when partial=true and errorCodes has codes (CLUSTER D/12)", () => {
    const partialDetail: EarningsDetail = {
      ...detail,
      partial: true,
      errorCodes: ["chain_demo", "iv_unavailable"],
    };
    const { container } = render(
      <EarningsDetailPanel
        detail={partialDetail}
        loading={false}
        error={null}
        runningFull={false}
        onRunFullResearch={() => {}}
      />,
    );
    const banner = container.querySelector('[data-slot="partial-data-banner"]');
    expect(banner).not.toBeNull();
    // Round-12 / PD-1: copy made more concrete. Still mentions
    // "synthetic" + "IV rank" — exact wording flexible.
    expect(banner?.textContent).toMatch(/synthetic/i);
    expect(banner?.textContent).toMatch(/IV rank unavailable/i);
  });

  it("renders chain_demo banner copy referencing the synthetic options chain (CLUSTER D/12)", () => {
    const partialDetail: EarningsDetail = {
      ...detail,
      partial: true,
      errorCodes: ["chain_demo"],
    };
    const { container } = render(
      <EarningsDetailPanel
        detail={partialDetail}
        loading={false}
        error={null}
        runningFull={false}
        onRunFullResearch={() => {}}
      />,
    );
    const items = container.querySelectorAll('[data-slot="partial-data-banner-item"]');
    expect(items.length).toBe(1);
    // Round-12 / PD-1: copy now names the upstream provider explicitly.
    expect(items[0].textContent).toMatch(/Polygon options feed unavailable/i);
  });

  it("dims and sets aria-busy when refetching=true (CLUSTER D/10)", () => {
    const { container } = render(
      <EarningsDetailPanel
        detail={detail}
        loading={false}
        refetching
        error={null}
        runningFull={false}
        onRunFullResearch={() => {}}
      />,
    );
    const panel = container.querySelector('[data-slot="earnings-detail-panel"]');
    expect(panel?.getAttribute("aria-busy")).toBe("true");
    expect(panel?.className).toMatch(/opacity-70/);
  });

  // ── Round-12 / PD-1: actionable error copy. ─────────────────
  it("ERROR_CODE_COPY surfaces actionable details for claude_unavailable / news_error / iv_term_partial", () => {
    // Each string identifies the upstream provider + likely cause + retry hint.
    expect(ERROR_CODE_COPY.claude_unavailable).toMatch(/AI thesis unavailable/i);
    expect(ERROR_CODE_COPY.claude_unavailable).toMatch(/retry/i);
    expect(ERROR_CODE_COPY.news_error).toMatch(/newsdata/i);
    expect(ERROR_CODE_COPY.iv_term_partial).toMatch(/term structure/i);
  });

  it("renders the new error_codes copy in the partial-data banner (NEW-Y8)", () => {
    const partialDetail: EarningsDetail = {
      ...detail,
      partial: true,
      errorCodes: ["claude_unavailable", "iv_term_partial", "news_error"],
    };
    const { container } = render(
      <EarningsDetailPanel
        detail={partialDetail}
        loading={false}
        error={null}
        runningFull={false}
        onRunFullResearch={() => {}}
      />,
    );
    const banner = container.querySelector('[data-slot="partial-data-banner"]');
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain(ERROR_CODE_COPY.claude_unavailable);
    expect(banner?.textContent).toContain(ERROR_CODE_COPY.iv_term_partial);
    expect(banner?.textContent).toContain(ERROR_CODE_COPY.news_error);
  });
});
