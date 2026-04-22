import "../setup-mocks";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import ClaudeThesisCard from "@/app/(dashboard)/strategies/earnings-options-play/_earnings/ClaudeThesisCard";
import type { ClaudeStructured, ClaudeFullResearch } from "@/types";

const structured: ClaudeStructured = {
  verdict: "neutral-bull",
  direction_magnitude: { bull_case_pct: 0.04, bear_case_pct: -0.05 },
  thesis: "IV rank is elevated but historical moves average ±5.2% — IV is over-pricing.",
  catalysts: ["Blackwell ramp", "data-center guide"],
  risks: ["CN export pivot", "guide miss"],
  suggested_play: "short strangle",
  suggested_play_reason: "IVR > 75 favors premium selling",
  confidence: 0.62,
  model: "claude-opus-4-7",
  generated_at: new Date().toISOString(),
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
      thesis_paragraph: "Full paragraph content.",
      comparable_setups: [
        { report_date: "2025-02-21", iv_rank: 76, setup: "short strangle", outcome: "+$120", similarity_score: 0.89 },
      ],
      post_earnings_drift_playbook: "Drift expectations…",
      sector_backdrop: "Semis weak…",
      analyst_consensus_delta: "PT hikes…",
      what_would_change_my_mind: "A guide miss…",
      confidence: 0.68,
      model: "claude-opus-4-7",
      generated_at: new Date().toISOString(),
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
});
