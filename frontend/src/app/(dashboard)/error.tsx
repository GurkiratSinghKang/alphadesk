"use client";

import { useEffect } from "react";
import DashboardErrorPage from "@/components/error/DashboardError";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[dashboard] route error", error);
  }, [error]);

  return (
    <DashboardErrorPage
      error={error}
      reset={reset}
      surface="Dashboard"
      headline="The dashboard hit a snag"
      fallbackMessage="A page-level error stopped the workspace from loading. Refresh, or jump to a different surface from the top nav."
    />
  );
}
