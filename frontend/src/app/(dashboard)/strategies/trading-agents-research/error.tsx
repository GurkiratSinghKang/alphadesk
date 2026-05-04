"use client";

import { useEffect } from "react";
import DashboardErrorPage from "@/components/error/DashboardError";

export default function TradingAgentsResearchError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[trading-agents-research] route error", error);
  }, [error]);
  return (
    <DashboardErrorPage
      error={error}
      reset={reset}
      surface="TradingAgents research"
    />
  );
}
