"use client";

/**
 * WsStatusBanner — thin status strip rendered above the dashboard chrome
 * when the shared WebSocket is NOT in the happy "open" state.
 *
 * Closes edge-cases-audit-r3 P0 #6: prior behaviour was to silently keep
 * stale quotes on screen during reconnect/failure, which is dangerous in a
 * trading surface where users could place trades on cached prices. The
 * banner is mounted once at the dashboard root (see (dashboard)/layout.tsx)
 * so it covers every authenticated route.
 *
 * State -> treatment
 *   connecting  : muted bg + polite aria-live ("Connecting to live data…")
 *   reconnecting: amber bg + polite aria-live ("Reconnecting…")
 *   failed      : loss bg + assertive aria-live + "Reload" button
 *   open        : render null (happy path — no UI noise)
 *
 * Tokens referenced:
 *   - bg-bg-elev-1 / text-fg-muted: design-token surface for quiet states
 *   - bg-amber/10 / text-amber    : caution state for reconnecting
 *   - bg-loss/10 / text-loss      : error state for failed
 * These tokens are defined in globals.css / tailwind.config and are already
 * in active use across PnlCalendar, DashboardError, LoginForm, etc.
 */

import { useWs } from "@/lib/providers";

export function WsStatusBanner() {
  const { wsStatus } = useWs();

  if (wsStatus === "open") return null;

  if (wsStatus === "failed") {
    return (
      <div
        role="alert"
        aria-live="assertive"
        className="w-full bg-loss/10 text-loss border-b border-loss/20 px-4 py-1.5 text-xs flex items-center justify-center gap-3"
      >
        <span className="font-medium">
          Live data offline — quotes may be stale. Reload to retry.
        </span>
        <button
          type="button"
          onClick={() => {
            if (typeof window !== "undefined") window.location.reload();
          }}
          className="rounded border border-loss/40 px-2 py-0.5 text-[11px] font-medium hover:bg-loss/20 focus:outline-none focus:ring-2 focus:ring-loss/50"
        >
          Reload
        </button>
      </div>
    );
  }

  if (wsStatus === "reconnecting") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="w-full bg-amber/10 text-amber border-b border-amber/20 px-4 py-1.5 text-xs text-center"
      >
        Reconnecting to live data…
      </div>
    );
  }

  // connecting (initial handshake, no prior success) — muted so it doesn't
  // scream at users on the first paint; degrades to an invisible spacer
  // after a successful connect when wsStatus flips to "open".
  return (
    <div
      role="status"
      aria-live="polite"
      className="w-full bg-bg-elev-1 text-fg-muted border-b border-border px-4 py-1.5 text-xs text-center"
    >
      Connecting to live data…
    </div>
  );
}
