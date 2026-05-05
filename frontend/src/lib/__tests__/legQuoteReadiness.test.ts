import { describe, it, expect } from "vitest";

import { deriveLegReadiness } from "../legQuoteReadiness";

/**
 * R6-5 (closes R5-B1, R5-M5)
 * ──────────────────────────
 * The execution-readiness pill on `/trade` was lying when multi-leg combo
 * tickets had legs whose OCC quote endpoint returned 404. The DOM snapshot
 * `qa/runs/2026-05-04T20-31-40Z/trade/desktop-1440/multi-leg-prefill.dom.html`
 * shows the underlying NVDA quote dressed as a leg spread + "2 passed
 * checks" pill, despite both staged strangle legs returning 404 in
 * `network.jsonl`. A trader could submit a real-money order on bogus
 * pricing.
 *
 * `deriveLegReadiness` is the pure derivation that drives the new pill
 * state machine. It MUST distinguish three terminal states:
 *
 * - **green/ready** — every staged leg has a live quote.
 * - **amber/partial** — at least one leg failed; submit gated until refresh.
 * - **coral/blocked** — every staged leg failed; combo cannot be priced.
 *
 * The `0 staged legs` case returns `ready` so the singular `activeContract`
 * path / equity-only path can fall through to its own readiness logic.
 */
describe("deriveLegReadiness — multi-leg quote-availability pill state machine", () => {
  describe("0 staged legs (no combo)", () => {
    it("returns green ready (caller falls through to equity/single-contract path)", () => {
      const state = deriveLegReadiness({ totalLegs: 0, unavailable: [] });
      expect(state.status).toBe("ready");
      expect(state.tone).toBe("profit");
      expect(state.canSubmit).toBe(true);
      expect(state.blocker).toBeNull();
    });
  });

  describe("0 errors → green Ready", () => {
    it("returns green ready when all 2 legs have quotes", () => {
      const state = deriveLegReadiness({ totalLegs: 2, unavailable: [] });
      expect(state.status).toBe("ready");
      expect(state.tone).toBe("profit");
      expect(state.label).toBe("Ready");
      expect(state.canSubmit).toBe(true);
      expect(state.blocker).toBeNull();
      expect(state.detail).toContain("2 of 2");
    });

    it("returns green ready when all 4 legs have quotes (iron condor)", () => {
      const state = deriveLegReadiness({ totalLegs: 4, unavailable: [] });
      expect(state.status).toBe("ready");
      expect(state.tone).toBe("profit");
      expect(state.canSubmit).toBe(true);
      expect(state.detail).toContain("4 of 4");
    });
  });

  describe("1 error → amber Review", () => {
    it("returns amber partial when 1 of 2 legs failed (broken strangle)", () => {
      const state = deriveLegReadiness({
        totalLegs: 2,
        unavailable: [
          { occ: "NVDA260424P00200000", symbol: "NVDA", reason: "404" },
        ],
      });
      expect(state.status).toBe("partial");
      expect(state.tone).toBe("amber");
      expect(state.label).toBe("Review");
      expect(state.canSubmit).toBe(false);
      expect(state.headline).toContain("1 of 2");
      expect(state.blocker).toContain("1 of 2");
      expect(state.blocker).toContain("refresh before submit");
    });

    it("returns amber partial when 1 of 4 legs failed (iron condor with 1 missing leg)", () => {
      const state = deriveLegReadiness({
        totalLegs: 4,
        unavailable: [
          { occ: "NVDA260424P00200000", symbol: "NVDA", reason: "404" },
        ],
      });
      expect(state.status).toBe("partial");
      expect(state.tone).toBe("amber");
      expect(state.canSubmit).toBe(false);
      expect(state.headline).toContain("1 of 4");
    });

    it("returns amber partial when 3 of 4 legs failed (still partial, not all)", () => {
      const state = deriveLegReadiness({
        totalLegs: 4,
        unavailable: [
          { occ: "NVDA260424P00200000", symbol: "NVDA", reason: "404" },
          { occ: "NVDA260424P00190000", symbol: "NVDA", reason: "404" },
          { occ: "NVDA260424C00220000", symbol: "NVDA", reason: "404" },
        ],
      });
      expect(state.status).toBe("partial");
      expect(state.tone).toBe("amber");
      expect(state.canSubmit).toBe(false);
      expect(state.headline).toContain("3 of 4");
    });
  });

  describe("all errors → coral Blocked", () => {
    it("returns coral blocked when both legs of a 2-leg strangle failed (the R5-B1 case)", () => {
      const state = deriveLegReadiness({
        totalLegs: 2,
        unavailable: [
          { occ: "NVDA260424P00200000", symbol: "NVDA", reason: "404" },
          { occ: "NVDA260424C00220000", symbol: "NVDA", reason: "404" },
        ],
      });
      expect(state.status).toBe("blocked");
      expect(state.tone).toBe("loss");
      expect(state.label).toBe("Blocked");
      expect(state.canSubmit).toBe(false);
      expect(state.headline).toContain("Cannot submit");
      expect(state.headline).toContain("no leg quotes");
      expect(state.blocker).toContain("2 of 2");
      // Critical: the trader must see the displayed spread is the underlying.
      expect(state.detail).toContain("underlying");
    });

    it("returns coral blocked when all 4 legs of an iron condor failed", () => {
      const state = deriveLegReadiness({
        totalLegs: 4,
        unavailable: [
          { occ: "NVDA260424P00190000", symbol: "NVDA", reason: "404" },
          { occ: "NVDA260424P00200000", symbol: "NVDA", reason: "404" },
          { occ: "NVDA260424C00220000", symbol: "NVDA", reason: "404" },
          { occ: "NVDA260424C00230000", symbol: "NVDA", reason: "404" },
        ],
      });
      expect(state.status).toBe("blocked");
      expect(state.tone).toBe("loss");
      expect(state.canSubmit).toBe(false);
      expect(state.blocker).toContain("4 of 4");
    });
  });

  describe("submit gating", () => {
    it("partial state always blocks submit (not just visual amber)", () => {
      const state = deriveLegReadiness({
        totalLegs: 3,
        unavailable: [
          { occ: "NVDA260424C00220000", symbol: "NVDA", reason: "timeout" },
        ],
      });
      expect(state.canSubmit).toBe(false);
    });

    it("blocked state has hard-block blocker copy", () => {
      const state = deriveLegReadiness({
        totalLegs: 2,
        unavailable: [
          { occ: "NVDA260424P00200000", symbol: "NVDA", reason: "404" },
          { occ: "NVDA260424C00220000", symbol: "NVDA", reason: "404" },
        ],
      });
      expect(state.canSubmit).toBe(false);
      expect(state.blocker).toMatch(/cannot submit/i);
    });

    it("ready state allows submit and emits null blocker", () => {
      const state = deriveLegReadiness({ totalLegs: 2, unavailable: [] });
      expect(state.canSubmit).toBe(true);
      expect(state.blocker).toBeNull();
    });
  });
});
