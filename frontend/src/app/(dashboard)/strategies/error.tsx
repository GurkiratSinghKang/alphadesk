"use client";

import { useEffect } from "react";
import DashboardErrorPage from "@/components/error/DashboardError";

export default function StrategiesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("[strategies] route error", error);
  }, [error]);
  return (
    <DashboardErrorPage
      error={error}
      reset={reset}
      surface="Strategies catalogue"
    />
  );
}
