"use client";

/**
 * SessionExpiryBanner — warns the operator that the silent refresh loop
 * failed, so they have a chance to save unsaved state (order tickets,
 * strategy-editor drafts, chat threads) before the next API call hits a
 * 401 and kicks them to /login.
 *
 * Round 7 Fix 4 (P128). Prior behaviour: `frontend/src/lib/api.ts`
 * scheduled refresh at hour 7 of an 8-hour JWT. On failure the scheduler
 * shut itself down quietly and the user only found out when their next
 * mutation bounced to /login mid-edit. This banner listens for the
 * `alphadesk:session-refresh-failed` CustomEvent dispatched from
 * `api.ts::ensureTokenRefreshScheduled` and renders a prominent top-of-
 * page warning so the user can react.
 *
 * The actual session-ending happens server-side; we're just surfacing
 * it client-side. Manual-dismiss is allowed — some users may want to
 * hide the banner after acknowledging it.
 */

import { useEffect, useState } from "react";

interface BannerState {
  visible: boolean;
  minutesRemaining: number;
}

export function SessionExpiryBanner() {
  const [state, setState] = useState<BannerState>({
    visible: false,
    minutesRemaining: 5,
  });

  useEffect(() => {
    function onRefreshFailed(e: Event) {
      const detail =
        (e as CustomEvent<{ minutesRemainingHint?: number; timestamp?: number }>)
          .detail ?? {};
      const hint =
        typeof detail.minutesRemainingHint === "number" &&
        detail.minutesRemainingHint > 0
          ? Math.floor(detail.minutesRemainingHint)
          : 5;
      setState({ visible: true, minutesRemaining: hint });
    }
    window.addEventListener(
      "alphadesk:session-refresh-failed",
      onRefreshFailed as EventListener
    );
    return () =>
      window.removeEventListener(
        "alphadesk:session-refresh-failed",
        onRefreshFailed as EventListener
      );
  }, []);

  if (!state.visible) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      data-testid="session-expiry-banner"
      className="w-full bg-amber/10 text-amber border-b border-amber/30 px-4 py-2 text-xs flex items-center justify-center gap-3"
    >
      <span className="font-semibold uppercase tracking-wide">
        Session ending
      </span>
      <span className="font-medium">
        — your session will end in about {state.minutesRemaining} minute
        {state.minutesRemaining === 1 ? "" : "s"}. Please save your work
        and log in again.
      </span>
      <button
        type="button"
        onClick={() => setState((s) => ({ ...s, visible: false }))}
        aria-label="Dismiss session expiry banner"
        className="rounded border border-amber/40 px-2 py-0.5 text-label font-medium hover:bg-amber/20 focus:outline-none focus:ring-2 focus:ring-amber/50"
      >
        Dismiss
      </button>
    </div>
  );
}
