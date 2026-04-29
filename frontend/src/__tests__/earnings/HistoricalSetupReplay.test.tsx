import "../setup-mocks";
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import HistoricalSetupReplay, {
  buildHistoricalReplayComparisonRequest,
  buildHistoricalReplayRequest,
} from "@/app/(dashboard)/strategies/earnings-options-play/_earnings/HistoricalSetupReplay";
import { postEarningsBacktest } from "@/lib/api";
import type { EarningsDetail } from "@/types";

const detail: EarningsDetail = {
  symbol: "NVDA",
  company: "Nvidia",
  sector: "Semis",
  reportDate: "2026-04-23",
  reportTime: "AMC",
  quote: { last: 201.7, change: -1.4, changePct: -0.007 },
  metrics: {
    ivRank: 78,
    ivPercentile: 82,
    currentIv: 0.79,
    hv20: 0.42,
    hv50: null,
    hv100: null,
    hvIvRatio: 0.71,
    expectedMovePct: 0.064,
    expectedMoveDollars: 12.8,
    histAvgAbsMovePct: 0.052,
    beatRate: 0.87,
    daysToEarnings: 1,
    daysToExpiry: 3,
  },
  strikeLadder: {
    expiry: "2026-04-24",
    underlyingPrice: 201.7,
    rows: [
      {
        strike: 200,
        side: "call",
        bucket: "ATM",
        delta: 0.52,
        bid: 6.2,
        ask: 6.6,
        mid: 6.4,
        iv: 0.8,
        yieldPct: 0.032,
        pop: 0.48,
        theta: -0.9,
        gamma: 0.03,
        vega: 0.12,
        oi: 1000,
        volume: 900,
      },
      {
        strike: 200,
        side: "put",
        bucket: "ATM",
        delta: -0.48,
        bid: 6.5,
        ask: 6.9,
        mid: 6.7,
        iv: 0.82,
        yieldPct: 0.034,
        pop: 0.52,
        theta: -0.92,
        gamma: 0.03,
        vega: 0.13,
        oi: 1100,
        volume: 950,
      },
    ],
  },
  claudeStructured: {
    verdict: "neutral",
    directionMagnitude: { bullCasePct: 0.07, bearCasePct: -0.06 },
    thesis: "Vol priced richly into earnings.",
    catalysts: ["AI demand"],
    risks: ["Guidance reset"],
    suggestedPlay: "iron condor",
    suggestedPlayReason: "Premium is rich versus recent moves.",
    confidence: 0.72,
    model: "claude-opus-4-7",
    generatedAt: "2026-04-22T12:00:00Z",
  },
  claudeFullResearch: null,
  historicalEarnings: {
    quarters: [
      { reportDate: "2026-01-30", surprisePct: 0.08, nextDayMovePct: 0.042, fiveDayMovePct: 0.053 },
      { reportDate: "2025-10-30", surprisePct: -0.02, nextDayMovePct: -0.081, fiveDayMovePct: -0.023 },
    ],
    stats: { avgAbsMovePct: 0.062, wins: 1, losses: 1, surpriseBeatRate: 0.5, ivVsHistVolPoints: null },
  },
  ivTermStructure: null,
  skew: null,
  news: [],
  partial: false,
  generatedAt: "2026-04-22T12:00:00Z",
};

beforeEach(() => {
  vi.mocked(postEarningsBacktest).mockReset();
});

describe("HistoricalSetupReplay", () => {
  it("builds replay events from current setup plus historical earnings moves", () => {
    const request = buildHistoricalReplayRequest(detail);

    expect(request?.events).toHaveLength(2);
    expect(request?.events[0]).toMatchObject({
      symbol: "NVDA",
      reportDate: "2026-01-30",
      topSetup: "iron condor",
      expectedMovePct: 0.064,
      realizedMovePct: 0.042,
      premiumYieldCallAtm: 0.032,
      premiumYieldPutAtm: 0.034,
    });
  });

  it("supports directional debit verticals from Claude's setup vocabulary", () => {
    const request = buildHistoricalReplayRequest({
      ...detail,
      claudeStructured: {
        ...detail.claudeStructured!,
        suggestedPlay: "bull call spread",
      },
    });

    expect(request?.events[0]).toMatchObject({
      topSetup: "bull call spread",
      premiumYieldCallAtm: 0.032,
    });
  });

  it("supports long calls and long puts from Claude's setup vocabulary", () => {
    const callRequest = buildHistoricalReplayRequest({
      ...detail,
      claudeStructured: {
        ...detail.claudeStructured!,
        suggestedPlay: "long call",
      },
    });
    const putRequest = buildHistoricalReplayRequest({
      ...detail,
      claudeStructured: {
        ...detail.claudeStructured!,
        suggestedPlay: "long put",
      },
    });

    expect(callRequest?.events[0]).toMatchObject({
      topSetup: "long call",
      premiumYieldCallAtm: 0.032,
    });
    expect(putRequest?.events[0]).toMatchObject({
      topSetup: "long put",
      premiumYieldPutAtm: 0.034,
    });
  });

  it("builds one comparison request across all ticketable earnings setups", () => {
    const request = buildHistoricalReplayComparisonRequest(detail);

    expect(request?.events).toHaveLength(16);
    expect(new Set(request?.events.map((event) => event.topSetup) ?? [])).toEqual(
      new Set([
        "long call",
        "long put",
        "bull put spread",
        "bear call spread",
        "bull call spread",
        "bear put spread",
        "iron condor",
        "long straddle",
      ]),
    );
    expect(request?.events[0]).toMatchObject({
      symbol: "NVDA",
      reportDate: "2026-01-30",
      expectedMovePct: 0.064,
      premiumYieldCallAtm: 0.032,
      premiumYieldPutAtm: 0.034,
    });
  });

  it("renders backend replay metrics and trade rows", async () => {
    vi.mocked(postEarningsBacktest).mockResolvedValueOnce({
      trades: [
        {
          symbol: "NVDA",
          reportDate: "2026-01-30",
          setup: "iron condor",
          returnPct: 0.45,
          win: true,
          edgeScore: null,
          reason: "realized move stayed inside expected move",
        },
        {
          symbol: "NVDA",
          reportDate: "2025-10-30",
          setup: "iron condor",
          returnPct: -0.2,
          win: false,
          edgeScore: null,
          reason: "realized move breached expected move",
        },
        {
          symbol: "NVDA",
          reportDate: "2026-01-30",
          setup: "long call",
          returnPct: 0.8,
          win: true,
          edgeScore: null,
          reason: "post-report rally cleared debit hurdle",
        },
        {
          symbol: "NVDA",
          reportDate: "2025-10-30",
          setup: "long call",
          returnPct: -1,
          win: false,
          edgeScore: null,
          reason: "post-report rally did not clear debit hurdle",
        },
      ],
      skipped: [],
      metrics: {
        events: 4,
        winRate: 0.5,
        avgTradeReturnPct: 0.0125,
        totalReturnPct: 0.0005,
        maxDrawdownPct: 0.01,
        profitFactor: 1.04,
      },
    });

    const { container } = render(<HistoricalSetupReplay detail={detail} />);

    await waitFor(() => expect(postEarningsBacktest).toHaveBeenCalledTimes(1));
    expect(vi.mocked(postEarningsBacktest).mock.calls[0][0].events).toHaveLength(16);
    await waitFor(() => {
      expect(container.querySelector('[data-slot="historical-setup-replay-trades"]')).not.toBeNull();
    });
    expect(container.textContent).toMatch(/Setup replay/);
    expect(container.textContent).toMatch(/Thin sample/);
    expect(container.textContent).toMatch(/Setup comparison/);
    expect(container.textContent).toMatch(/long call/);
    expect(container.textContent).toMatch(/not point-in-time historical option-chain fills/);
    expect(container.textContent).toMatch(/realized move stayed inside expected move/);
  });
});
