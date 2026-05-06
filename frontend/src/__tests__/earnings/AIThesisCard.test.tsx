import "../setup-mocks";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import AIThesisCard from "@/app/(dashboard)/strategies/earnings-options-play/_earnings/AIThesisCard";
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

describe("AIThesisCard", () => {
  it("renders verdict, confidence, thesis, catalysts, risks, suggested play", () => {
    const { container } = render(
      <AIThesisCard structured={structured} full={null} running={false} onRunFull={() => {}} />,
    );
    expect(container.textContent).toMatch(/NEUTRAL-BULL/i);
    expect(container.textContent).toMatch(/62/);
    expect(container.textContent).toContain("IV rank is elevated");
    expect(container.textContent).toContain("Blackwell ramp");
    expect(container.textContent).toContain("CN export pivot");
    expect(container.textContent).toMatch(/short strangle/i);
  });

  it("warns when cached structured analysis recommends a legacy undefined-risk play", () => {
    const { container } = render(
      <AIThesisCard structured={structured} full={null} running={false} onRunFull={() => {}} />,
    );
    const warning = container.querySelector('[data-slot="legacy-unsupported-play"]');
    expect(warning?.textContent).toMatch(/legacy undefined-risk play/i);
    expect(warning?.textContent).toMatch(/defined-risk trade buttons/i);
  });

  it("calls onRunFull when 'Run full research' clicked", () => {
    const onRunFull = vi.fn();
    const { getByRole } = render(
      <AIThesisCard structured={structured} full={null} running={false} onRunFull={onRunFull} />,
    );
    fireEvent.click(getByRole("button", { name: /run full research/i }));
    expect(onRunFull).toHaveBeenCalled();
  });

  it("shows spinner/disabled state when running", () => {
    const { getByRole } = render(
      <AIThesisCard structured={structured} full={null} running={true} onRunFull={() => {}} />,
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
      <AIThesisCard structured={structured} full={full} running={false} onRunFull={() => {}} />,
    );
    expect(container.textContent).toContain("Full paragraph content");
    expect(container.textContent).toContain("+$120");
    expect(container.textContent).toContain("Drift expectations");
  });

  it("renders null state when no structured analysis", () => {
    const { container } = render(
      <AIThesisCard structured={null} full={null} running={false} onRunFull={() => {}} />,
    );
    expect(container.textContent).toMatch(/analysis pending|not yet|unavailable/i);
  });

  it("allows full research when structured analysis is unavailable", () => {
    const onRunFull = vi.fn();
    const { container, getByRole } = render(
      <AIThesisCard
        structured={null}
        full={null}
        running={false}
        onRunFull={onRunFull}
        symbol="NVDA"
      />,
    );
    expect(container.textContent).toMatch(/structured thesis is unavailable/i);
    fireEvent.click(getByRole("button", { name: /run full research for NVDA/i }));
    expect(onRunFull).toHaveBeenCalledTimes(1);
  });

  // T7 P1 #1: explicit back-compat — EOP usage omits showRunControls so
  // it defaults to true and the trigger button still renders.
  it("defaults showRunControls=true so EOP keeps the run-full-research button (back-compat)", () => {
    const { getByRole } = render(
      <AIThesisCard structured={structured} full={null} running={false} onRunFull={() => {}} />,
    );
    expect(getByRole("button", { name: /run full research/i })).not.toBeNull();
  });

  // T7 P1 #1: when the host surface lacks a wired onRunFull (e.g. the
  // symbol page's OptionsThesisBand), passing showRunControls={false}
  // suppresses the trigger so we don't ship a dead-click CTA.
  it("hides the FullResearchTrigger button when showRunControls={false}", () => {
    const { queryByRole } = render(
      <AIThesisCard
        structured={structured}
        full={null}
        running={false}
        onRunFull={() => {}}
        showRunControls={false}
      />,
    );
    expect(queryByRole("button", { name: /run full research/i })).toBeNull();
  });

  // T7 P1 #1: also covers the no-structured-analysis branch — both
  // FullResearchTrigger mounts must respect showRunControls.
  it("hides FullResearchTrigger in the structured=null branch when showRunControls={false}", () => {
    const { queryByRole } = render(
      <AIThesisCard
        structured={null}
        full={null}
        running={false}
        onRunFull={() => {}}
        showRunControls={false}
      />,
    );
    expect(queryByRole("button", { name: /run full research/i })).toBeNull();
  });

  it("renders full research when the structured thesis is missing", () => {
    const full: ClaudeFullResearch = {
      thesisParagraph: "Fallback full research content.",
      comparableSetups: [],
      postEarningsDriftPlaybook: "Watch the post-report opening range.",
      sectorBackdrop: "Semis are mixed.",
      analystConsensusDelta: "Estimates are stable.",
      whatWouldChangeMyMind: "A material guide miss.",
      confidence: 0.58,
      model: "claude-opus-4-7",
      generatedAt: new Date().toISOString(),
    };
    const { container, queryByRole } = render(
      <AIThesisCard structured={null} full={full} running={false} onRunFull={() => {}} />,
    );
    expect(container.textContent).toContain("Fallback full research content");
    expect(container.textContent).toContain("Watch the post-report opening range");
    expect(queryByRole("button", { name: /run full research/i })).toBeNull();
  });

  // ── Round-4 additions ─────────────────────────────────────

  it("renders a live countdown when error is a RateLimitError (CLUSTER D/11)", () => {
    vi.useFakeTimers();
    try {
      const err = new RateLimitError("/api/v1/earnings/NVDA/full-research", 5);
      const { container, getByRole } = render(
        <AIThesisCard
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
      <AIThesisCard
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

  // ── Round-5 (NEW-Y5 / E-8): countdown restart on duplicate retryAfter ──
  it("test_rate_limit_countdown_restarts_on_repeat_429: same retryAfter restarts the visible timer", () => {
    vi.useFakeTimers();
    try {
      const first = new RateLimitError(
        "/api/v1/earnings/NVDA/full-research",
        30,
      );
      const { container, rerender } = render(
        <AIThesisCard
          structured={structured}
          full={null}
          running={false}
          error={first}
          onRunFull={() => {}}
        />,
      );
      let alert = container.querySelector('[role="alert"]');
      expect(alert?.textContent).toMatch(/try again in 30s/i);

      // Tick 10s of the first countdown.
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      alert = container.querySelector('[role="alert"]');
      expect(alert?.textContent).toMatch(/try again in 20s/i);

      // User mashes the button — backend returns 429 with the same
      // retry-after value (30s). A NEW RateLimitError instance arrives.
      // Round-5 (NEW-Y5): dep `[error, initialRetry]` triggers a fresh
      // countdown even though `initialRetry` is unchanged.
      const second = new RateLimitError(
        "/api/v1/earnings/NVDA/full-research",
        30,
      );
      rerender(
        <AIThesisCard
          structured={structured}
          full={null}
          running={false}
          error={second}
          onRunFull={() => {}}
        />,
      );
      alert = container.querySelector('[role="alert"]');
      // Without the [error, initialRetry] dep fix, this would still show
      // "try again in 20s" because the effect didn't re-run.
      expect(alert?.textContent).toMatch(/try again in 30s/i);
    } finally {
      vi.useRealTimers();
    }
  });
});
