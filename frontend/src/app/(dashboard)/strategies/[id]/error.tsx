"use client";

import DashboardErrorPage from "@/components/error/DashboardError";

export default function StrategyError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <DashboardErrorPage
      error={error}
      reset={reset}
      route="strategies"
      headline="Strategy failed to load"
      fallbackMessage="We couldn't render this strategy. Try again, or head back to the dashboard."
    />
  );
}
