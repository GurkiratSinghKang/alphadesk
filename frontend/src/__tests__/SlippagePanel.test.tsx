/**
 * SlippagePanel render tests (M-O S-5).
 *
 * Covers the two cases the dashboard cares about:
 *
 *   1. Empty state — no trades have target_price → coaching copy + the
 *      "submit an order with patient mid-pricing" call to action.
 *   2. Populated — all four headline metrics render plus the per-strategy
 *      table and the patient-vs-immediate comparison block.
 *
 * Tests inject ``initialSummary`` directly so the network layer is
 * never reached. The shape mirrors ``services.slippage_analytics
 * .SlippageSummary`` byte-for-byte.
 */
import "./setup-mocks";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { SlippagePanel } from "@/components/dashboard/SlippagePanel";
import type { SlippageSummary } from "@/lib/api";

describe("SlippagePanel", () => {
  it("renders the empty state when total_trades is 0", () => {
    const empty: SlippageSummary = {
      total_trades: 0,
      avg_slippage_pct: null,
      median_slippage_pct: null,
      p90_slippage_pct: null,
      total_dollars_leaked: 0,
      by_strategy: {},
      by_structure_type: {},
      fill_mode_comparison: {},
      trades_without_target: 0,
    };
    render(<SlippagePanel initialSummary={empty} />);
    expect(screen.getByText("Execution Quality")).toBeDefined();
    // Empty-state copy verbatim from the panel.
    expect(
      screen.getByText(/No execution data yet/i),
    ).toBeDefined();
    expect(
      screen.getByText(/submit an order with patient mid-pricing/i),
    ).toBeDefined();
  });

  it("mentions the legacy-trade count when trades_without_target > 0", () => {
    const empty: SlippageSummary = {
      total_trades: 0,
      avg_slippage_pct: null,
      median_slippage_pct: null,
      p90_slippage_pct: null,
      total_dollars_leaked: 0,
      by_strategy: {},
      by_structure_type: {},
      fill_mode_comparison: {},
      trades_without_target: 3,
    };
    render(<SlippagePanel initialSummary={empty} />);
    // Singular-vs-plural is handled by the panel; here we expect plural.
    expect(
      screen.getByText(/3 legacy trades in this window pre-date execution telemetry/i),
    ).toBeDefined();
  });

  it("renders all 4 headline metrics when data is present", () => {
    const populated: SlippageSummary = {
      total_trades: 5,
      avg_slippage_pct: 0.027,
      median_slippage_pct: 0.0267,
      p90_slippage_pct: 0.0633,
      total_dollars_leaked: 59,
      by_strategy: {
        pead: {
          trades: 2,
          avg_slippage_pct: -0.004,
          median_slippage_pct: -0.004,
          p90_slippage_pct: 0.025,
          total_dollars_leaked: 27,
        },
        earnings: {
          trades: 2,
          avg_slippage_pct: 0.055,
          median_slippage_pct: 0.055,
          p90_slippage_pct: 0.0833,
          total_dollars_leaked: 22,
        },
        pmcc: {
          trades: 1,
          avg_slippage_pct: 0.0333,
          median_slippage_pct: 0.0333,
          p90_slippage_pct: 0.0333,
          total_dollars_leaked: 10,
        },
      },
      by_structure_type: {
        iron_condor: {
          trades: 3,
          avg_slippage_pct: 0.0089,
          median_slippage_pct: 0.0267,
          p90_slippage_pct: 0.0333,
          total_dollars_leaked: 44,
        },
        vertical_spread: {
          trades: 2,
          avg_slippage_pct: 0.054,
          median_slippage_pct: 0.054,
          p90_slippage_pct: 0.0833,
          total_dollars_leaked: 15,
        },
      },
      fill_mode_comparison: {
        patient: {
          trades: 3,
          avg_slippage_pct: 0.006,
          median_slippage_pct: 0.025,
          p90_slippage_pct: 0.0267,
          total_dollars_leaked: 39,
        },
        immediate: {
          trades: 2,
          avg_slippage_pct: 0.058,
          median_slippage_pct: 0.058,
          p90_slippage_pct: 0.0833,
          total_dollars_leaked: 20,
        },
      },
      trades_without_target: 1,
    };
    render(<SlippagePanel initialSummary={populated} />);

    // Title still present.
    expect(screen.getByText("Execution Quality")).toBeDefined();

    // The four headline-metric labels. ``$ leaked`` is also used as a
    // table column header, so use getAllByText and assert presence ≥ 1.
    expect(screen.getByText("Avg slippage")).toBeDefined();
    expect(screen.getByText("Median")).toBeDefined();
    expect(screen.getByText("p90")).toBeDefined();
    expect(screen.getAllByText("$ leaked").length).toBeGreaterThanOrEqual(1);

    // Per-strategy rows render — three strategies, sorted by leakage desc.
    expect(screen.getByText("pead")).toBeDefined();
    expect(screen.getByText("earnings")).toBeDefined();
    expect(screen.getByText("pmcc")).toBeDefined();

    // Patient + immediate comparison labels.
    expect(screen.getByText("patient")).toBeDefined();
    expect(screen.getByText("immediate")).toBeDefined();
  });

  it("does not render the patient-vs-immediate block when only one fill mode has data", () => {
    const onlyPatient: SlippageSummary = {
      total_trades: 2,
      avg_slippage_pct: 0.01,
      median_slippage_pct: 0.01,
      p90_slippage_pct: 0.01,
      total_dollars_leaked: 5,
      by_strategy: {
        x: {
          trades: 2,
          avg_slippage_pct: 0.01,
          median_slippage_pct: 0.01,
          p90_slippage_pct: 0.01,
          total_dollars_leaked: 5,
        },
      },
      by_structure_type: {},
      fill_mode_comparison: {
        patient: {
          trades: 2,
          avg_slippage_pct: 0.01,
          median_slippage_pct: 0.01,
          p90_slippage_pct: 0.01,
          total_dollars_leaked: 5,
        },
      },
      trades_without_target: 0,
    };
    render(<SlippagePanel initialSummary={onlyPatient} />);
    // Comparison header is omitted when fewer than 2 modes have data.
    expect(screen.queryByText("Patient vs immediate")).toBeNull();
  });
});
