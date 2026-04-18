"use client";

import DashboardErrorPage from "@/components/error/DashboardError";

export default function AlertsError({
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
      route="alerts"
      headline="Alerts failed to load"
      fallbackMessage="We couldn't load your alerts right now. Try again, or head back to the dashboard."
    />
  );
}
