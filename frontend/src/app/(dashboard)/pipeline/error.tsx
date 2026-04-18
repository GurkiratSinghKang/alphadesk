"use client";

import DashboardErrorPage from "@/components/error/DashboardError";

export default function PipelineError({
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
      route="pipeline"
      headline="Pipeline failed to load"
      fallbackMessage="The strategy pipeline couldn't be rendered. Try again, or head back to the dashboard."
    />
  );
}
