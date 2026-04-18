"use client";

import DashboardErrorPage from "@/components/error/DashboardError";

export default function ReportsError({
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
      route="reports"
      headline="Reports failed to load"
      fallbackMessage="We couldn't build your report view. Try again, or head back to the dashboard."
    />
  );
}
