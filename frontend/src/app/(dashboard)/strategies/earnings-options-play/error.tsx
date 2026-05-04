"use client";

import { useEffect } from "react";
import DashboardErrorPage from "@/components/error/DashboardError";

export default function EarningsOptionsPlayError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[earnings-options-play] route error", error);
  }, [error]);
  return (
    <DashboardErrorPage
      error={error}
      reset={reset}
      surface="Earnings options play"
    />
  );
}
