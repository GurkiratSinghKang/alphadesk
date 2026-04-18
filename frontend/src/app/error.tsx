"use client";

import DashboardErrorPage from "@/components/error/DashboardError";

/**
 * /app/error.tsx — top-level error boundary.
 * ──────────────────────────────────────────
 * Catches errors bubbled up past route-segment boundaries. Renders the
 * same editorial DashboardError surface so the desk voice carries through
 * even when the user's request fails.
 *
 * Unlike `app/global-error.tsx`, this boundary sits inside the root layout
 * (so it inherits `<html>` / `<body>` / font CSS vars) — i.e. the regular
 * chrome is already provided.
 */
export default function AppError({
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
      route="app"
      headline="Something broke on the desk"
      fallbackMessage="An unexpected error occurred. Try again, or head back to the dashboard."
      fullScreen
    />
  );
}
