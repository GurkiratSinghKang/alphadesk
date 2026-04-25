import "../setup-mocks";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import ClaudeThesisCard from "@/app/(dashboard)/strategies/earnings-options-play/_earnings/ClaudeThesisCard";
import { RateLimitError } from "@/lib/api";
import type { ClaudeStructured, ClaudeFullResearch } from "@/types";

const structured: ClaudeStructured = {
  verdict: "neutral-bull",
  directionMagnitude: { bullCasePct: 0.04, bearCasePct: -0.05 },
  thesis: "IV rank is elevated but historical moves average ±5.2% — IV is over-pricing.",
  catalysts: ["Blackwell ramp", "data-center guide"],
  risks: ["CN export pivot", "guide miss"],
  suggestedPlay: "short strangle",
  suggestedPlayReason: "IVR > 75 favors premium selling",
  confidence: 0.62,
  model: "claude-opus-4-7",
  generatedAt: new Date().toISOString(),
};

describe("ClaudeThesisCard", () => {
  it("renders verdict, confidence, thesis, catalysts, risks, suggested play", () => {
    const { container } = render(
      <ClaudeThesisCard structured={structured} full={null} running={false} onRunFull={() => {}} />,
    );
    expect(container.textContent).toMatch(/NEUTRAL-BULL/i);
    expect(container.textContent).toMatch(/62/);
    expect(container.textContent).toContain("IV rank is elevated");
    expect(container.textContent).toContain("Blackwell ramp");
    expect(container.textContent).toContain("CN export pivot");
    expect(container.textContent).toMatch(/short strangle/i);
  });

  it("calls onRunFull when 'Run full research' clicked", () => {
    const onRunFull = vi.fn();
    const { getByRole } = render(
      <ClaudeThesisCard structured={structured} full={null} running={false} onRunFull={onRunFull} />,
    );
    fireEvent.click(getByRole("button", { name: /run full research/i }));
    expect(onRunFull).toHaveBeenCalled();
  });

  it("shows spinner/disabled state when running", () => {
    const { getByRole } = render(
      <ClaudeThesisCard structured={structured} full={null} running={true} onRunFull={() => {}} />,
    );
    const btn = getByRole("button", { name: /generating|running|loading/i });
    expect(btn).toHaveProperty("disabled", true);
  });

  it("renders full-research sections when available", () => {
    const full: ClaudeFullResearch = {
      thesisParagraph: "Full paragraph content.",
      comparableSetups: [
        { reportDate: "2025-02-21", ivRank: 76, setup: "short strangle", outcome: "+$120", similarityScore: 0.89 },
      ],
      postEarningsDriftPlaybook: "Drift expectations…",
      sectorBackdrop: "Semis weak…",
      analystConsensusDelta: "PT hikes…",
      whatWouldChangeMyMind: "A guide miss…",
      confidence: 0.68,
      model: "claude-opus-4-7",
      generatedAt: new Date().toISOString(),
    };
    const { container } = render(
      <ClaudeThesisCard structured={structured} full={full} running={false} onRunFull={() => {}} />,
    );
    expect(container.textContent).toContain("Full paragraph content");
    expect(container.textContent).toContain("+$120");
    expect(container.textContent).toContain("Drift expectations");
  });

  it("renders null state when no structured analysis", () => {
    const { container } = render(
      <ClaudeThesisCard structured={null} full={null} running={false} onRunFull={() => {}} />,
    );
    expect(container.textContent).toMatch(/analysis pending|not yet|unavailable/i);
  });

  // ── Round-4 additions ─────────────────────────────────────

  it("renders a live countdown when error is a RateLimitError (CLUSTER D/11)", () => {
    vi.useFakeTimers();
    try {
      const err = new RateLimitError("/api/v1/earnings/NVDA/full-research", 5);
      const { container, getByRole } = render(
        <ClaudeThesisCard
          structured={structured}
          full={null}
          running={false}
          error={err}
          onRunFull={() => {}}
        />,
      );
      const alert = container.querySelector('[role="alert"]');
      expect(alert).not.toBeNull();
      expect(alert?.textContent).toMatch(/try again in 5s/i);
      // Button is disabled while countdown > 0.
      const btn = getByRole("button", { name: /run full research/i }) as HTMLButtonElement;
      expect(btn.disabled).toBe(true);

      // Advance the countdown.
      act(() => { vi.advanceTimersByTime(2000); });
      expect(alert?.textContent).toMatch(/try again in 3s/i);

      // Run it down to 0.
      act(() => { vi.advanceTimersByTime(3500); });
      expect(alert?.textContent).toMatch(/rate limit cleared/i);
      expect(btn.disabled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders a generic alert for non-RateLimit errors (CLUSTER D/11)", () => {
    const err = new Error("network down");
    const { container } = render(
      <ClaudeThesisCard
        structured={structured}
        full={null}
        running={false}
        error={err}
        onRunFull={() => {}}
      />,
    );
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toMatch(/network down/i);
  });
});
