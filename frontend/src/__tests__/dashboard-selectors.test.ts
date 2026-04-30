import { describe, expect, it } from "vitest";

import { toStatusPills } from "@/app/(dashboard)/_desk/selectors";

const baseStatus = {
  marketOpen: false,
  claudeHealthy: true,
  pipelineRunning: 0,
  pipelineTotal: 12,
  tradingMode: "paper" as const,
};

describe("dashboard selectors", () => {
  it("does not claim the broker is connected while portfolio state is pending", () => {
    const pills = toStatusPills({
      ...baseStatus,
      brokerConnected: false,
      brokerStatus: "pending",
    });

    expect(pills[0]).toMatchObject({
      label: "Broker status pending",
      tone: "muted",
      href: undefined,
    });
  });

  it("keeps the settings remediation for confirmed unlinked broker state", () => {
    const pills = toStatusPills({
      ...baseStatus,
      brokerConnected: false,
      brokerStatus: "not_linked",
    });

    expect(pills[0]).toMatchObject({
      label: "Broker not linked",
      tone: "amber",
      href: "/settings",
    });
  });
});
