"use client";

import DashboardErrorPage from "@/components/error/DashboardError";

export default function SettingsError({
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
      route="settings"
      headline="Settings failed to load"
      fallbackMessage="We couldn't open the settings panel. Try again, or head back to the dashboard."
    />
  );
}
