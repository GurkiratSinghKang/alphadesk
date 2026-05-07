import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

import type { TradingAgentsRun } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  getTradingAgentsRuns: vi.fn(),
  getTradingAgentsRun: vi.fn(),
  startTradingAgentsRun: vi.fn(),
}));

import {
  getTradingAgentsRun,
  getTradingAgentsRuns,
  startTradingAgentsRun,
} from "@/lib/api";
import { AgentsDebateCard } from "../_sections/AgentsDebateCard";

const mockedList = vi.mocked(getTradingAgentsRuns);
const mockedGet = vi.mocked(getTradingAgentsRun);
const mockedStart = vi.mocked(startTradingAgentsRun);

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  }
  return Wrapper;
}

function makeRun(overrides: Partial<TradingAgentsRun> = {}): TradingAgentsRun {
  return {
    run_id: "run-1",
    symbol: "NVDA",
    trade_date: "2026-05-06",
    status: "succeeded",
    provider: "anthropic",
    deep_model: "claude-opus",
    quick_model: "claude-haiku",
    analysts: ["market", "news"],
    research_depth: 1,
    progress_message: null,
    timeout_s: 600,
    summary_lines: ["OVERWEIGHT", "Setup looks favorable into FY26 print."],
    decision_text:
      "RATING: OVERWEIGHT\n\nCurrent price reference $410. Preferred entry zone $390-$400. Risk stop $375. First target $445.",
    artifact_files: [],
    error: null,
    created_at: "2026-05-06T15:00:00Z",
    updated_at: "2026-05-06T15:00:30Z",
    started_at: "2026-05-06T15:00:00Z",
    completed_at: "2026-05-06T15:00:30Z",
    advisory_disclaimer: "Read-only.",
    ...overrides,
  };
}

beforeEach(() => {
  mockedList.mockReset();
  mockedGet.mockReset();
  mockedStart.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("AgentsDebateCard", () => {
  it("renders the empty state when no runs exist for this symbol", async () => {
    mockedList.mockResolvedValue([]);
    const Wrapper = makeWrapper();
    const { getByTestId, container } = render(
      createElement(Wrapper, null, <AgentsDebateCard symbol="NVDA" isETF={false} />),
    );
    await waitFor(() => {
      const empty = container.querySelector('[data-slot="empty"]');
      expect(empty).not.toBeNull();
    });
    expect(getByTestId("agents-debate-card").getAttribute("id")).toBe("agents");
    const empty = container.querySelector('[data-slot="empty"]') as HTMLElement;
    expect(empty.textContent).toContain("No debate run for NVDA yet");
    expect(empty.textContent).toContain("Anthropic credits");
  });

  it("renders the run display when a cached succeeded run exists", async () => {
    mockedList.mockResolvedValue([makeRun()]);
    const Wrapper = makeWrapper();
    const { container } = render(
      createElement(Wrapper, null, <AgentsDebateCard symbol="NVDA" isETF={false} />),
    );
    await waitFor(() => {
      const display = container.querySelector('[data-slot="run-display"]');
      expect(display).not.toBeNull();
    });
    const verdict = container.querySelector('[data-slot="verdict-pill"]');
    expect(verdict?.textContent).toContain("OVERWEIGHT");
    // Levels grid should pick up dollar amounts from decision text.
    const levels = container.querySelectorAll('[data-slot="level-cell"]');
    expect(levels.length).toBeGreaterThan(0);
  });

  it("returns null for ETF symbols (no card rendered)", () => {
    const Wrapper = makeWrapper();
    const { container } = render(
      createElement(Wrapper, null, <AgentsDebateCard symbol="SPY" isETF />),
    );
    expect(container.querySelector('[data-testid="agents-debate-card"]')).toBeNull();
    // The list endpoint should never even be hit for ETFs.
    expect(mockedList).not.toHaveBeenCalled();
  });

  it("fires the mutation when the Run debate button is clicked", async () => {
    mockedList.mockResolvedValue([]);
    mockedStart.mockResolvedValue(makeRun({ run_id: "run-2", status: "succeeded" }));
    const Wrapper = makeWrapper();
    const { getByTestId } = render(
      createElement(Wrapper, null, <AgentsDebateCard symbol="NVDA" isETF={false} />),
    );
    await waitFor(() => {
      expect(getByTestId("agents-debate-run-button")).not.toBeNull();
    });
    const btn = getByTestId("agents-debate-run-button");
    expect(btn.textContent?.trim()).toBe("Run debate");
    fireEvent.click(btn);
    await waitFor(() => {
      expect(mockedStart).toHaveBeenCalledTimes(1);
    });
    expect(mockedStart).toHaveBeenCalledWith({ symbol: "NVDA" });
  });

  it("disables the button and shows a Starting label while the mutation is pending", async () => {
    mockedList.mockResolvedValue([]);
    // Start mutation that never resolves so we can observe the pending UI.
    mockedStart.mockImplementation(() => new Promise(() => {}));
    const Wrapper = makeWrapper();
    const { getByTestId } = render(
      createElement(Wrapper, null, <AgentsDebateCard symbol="NVDA" isETF={false} />),
    );
    await waitFor(() => {
      expect(getByTestId("agents-debate-run-button")).not.toBeNull();
    });
    const btn = getByTestId("agents-debate-run-button") as HTMLButtonElement;
    fireEvent.click(btn);
    await waitFor(() => {
      expect(btn.disabled).toBe(true);
    });
    expect(btn.textContent).toContain("Starting");
  });
});
