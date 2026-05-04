"use client";

/**
 * WsStatusBanner — thin status strip rendered above the dashboard chrome
 * when the shared WebSocket is NOT in the happy "open" state, OR when the
 * backend recently served demo-fallback data (broker/provider unavailable,
 * persona-r P43).
 *
 * Closes edge-cases-audit-r3 P0 #6: prior behaviour was to silently keep
 * stale quotes on screen during reconnect/failure, which is dangerous in a
 * trading surface where users could place trades on cached prices. The
 * banner is mounted once at the dashboard root (see (dashboard)/layout.tsx)
 * so it covers every authenticated route.
 *
 * State -> treatment (priority order: first match wins)
 *   failed         : amber bg + assertive aria-live + "Reload" button
 *   broker-degraded: amber bg + assertive aria-live ("LIMITED DATA — broker unavailable")
 *   reconnecting   : amber bg + polite aria-live ("Reconnecting to live data…")
 *   connecting     : muted bg + polite aria-live ("Market data link starting")
 *   open + live    : render null (happy path — no UI noise)
 *
 * The broker-degraded state is driven by `alphadesk:broker-degraded`
 * CustomEvents dispatched from `lib/api.ts` when it sees `is_demo: true` on
 * a portfolio/quote response. We window the signal to 60s — if no fresh
 * demo response arrives in that time we assume the broker recovered and
 * hide the chip. Callers that want the latest-known state can read it from
 * `usePortfolioStore().brokerDegraded`.
 *
 * Tokens referenced:
 *   - bg-bg-elev-1 / text-fg-muted: design-token surface for quiet states
 *   - bg-amber/10 / text-amber    : caution state for reconnecting
 *   - bg-loss/10 / text-loss      : legacy severe state token, avoided here unless execution is unsafe
 * These tokens are defined in globals.css / tailwind.config and are already
 * in active use across PnlCalendar, DashboardError, LoginForm, etc.
 */

import { useEffect, useRef, useState } from "react";
import { useWs } from "@/lib/providers";
import { usePortfolioStore } from "@/stores/portfolio";

/**
 * If we don't see a fresh `is_demo` signal for this many milliseconds we
 * assume the broker recovered. The backend tags every response (not just
 * the first degraded one) so a healthy account pings this event well
 * within the window.
 */
const BROKER_DEGRADED_TTL_MS = 60_000;

/**
 * BUG-027: a client-side nav (prefetch, route change) briefly flickers the
 * WS through `connecting` → `open` before the shared provider reconnects.
 * Users saw a severe offline flash for ~3s on every internal navigation. We
 * debounce the transition into the user-visible "failed" / loss-tone
 * banner so a short connect blip never promotes to a scary state.
 *
 * 4s is tuned to: (a) swallow the 1s "connecting" handshake on a warm
 * WebSocket, (b) swallow the ~2-3s reconnect that follows a `close` event
 * on fast nav, (c) still show the banner promptly when the user is
 * genuinely offline (disconnected laptop). Tune here, not at a call site.
 */
const FAILED_BANNER_GRACE_MS = 4_000;

export function WsStatusBanner() {
  const { wsStatus } = useWs();
  const brokerDegraded = usePortfolioStore((s) => s.brokerDegraded);
  const setBrokerDegraded = usePortfolioStore((s) => s.setBrokerDegraded);
  // BUG-027: gate the "failed" banner on a grace window so a transient
  // reconnect doesn't flash an offline banner on every internal navigation.
  const [failedArmed, setFailedArmed] = useState(false);
  const failedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    // Always clear any pending arm when the status changes — if the WS
    // recovers we don't want a late timer to flip the banner on.
    if (failedTimerRef.current) {
      clearTimeout(failedTimerRef.current);
      failedTimerRef.current = null;
    }
    if (wsStatus === "failed") {
      failedTimerRef.current = setTimeout(() => {
        setFailedArmed(true);
      }, FAILED_BANNER_GRACE_MS);
    } else {
      failedTimerRef.current = setTimeout(() => {
        setFailedArmed(false);
      }, 0);
    }
    return () => {
      if (failedTimerRef.current) {
        clearTimeout(failedTimerRef.current);
        failedTimerRef.current = null;
      }
    };
  }, [wsStatus]);
  // Store a timer id so we clear it on unmount / on a newer event.
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Listen for degraded-mode events emitted by api.ts on demo-fallback
  // responses. We re-arm the TTL timer on every event so the banner stays
  // up as long as the backend keeps returning synthetic data.
  useEffect(() => {
    function onDegraded(e: Event) {
      const detail = (e as CustomEvent<{ endpoint?: string; timestamp?: number }>).detail ?? {};
      setBrokerDegraded(true, {
        endpoint: detail.endpoint,
        timestamp: detail.timestamp,
      });
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
      clearTimerRef.current = setTimeout(() => {
        setBrokerDegraded(false);
      }, BROKER_DEGRADED_TTL_MS);
    }
    window.addEventListener("alphadesk:broker-degraded", onDegraded as EventListener);
    return () => {
      window.removeEventListener("alphadesk:broker-degraded", onDegraded as EventListener);
      if (clearTimerRef.current) {
        clearTimeout(clearTimerRef.current);
        clearTimerRef.current = null;
      }
    };
  }, [setBrokerDegraded]);

  if (wsStatus === "open" && !brokerDegraded) return null;

  // BUG-027: swallow the WS blip on client-side navigation. During the
  // grace window we fall through to the quieter connecting branch
  // below so the user sees a calm status line instead of a severe offline
  // flash that self-heals 3s later.
  if (wsStatus === "failed" && failedArmed) {
    return (
      <div
        role="alert"
        aria-live="assertive"
        className="w-full bg-amber/10 text-amber border-b border-amber/20 px-4 py-1.5 text-label flex items-center justify-center gap-3"
      >
        <span className="font-medium">
          Data link offline. Execution remains locked until quotes recover.
        </span>
        <button
          type="button"
          onClick={() => {
            if (typeof window !== "undefined") window.location.reload();
          }}
          className="rounded border border-amber/40 px-2 py-0.5 text-label font-medium hover:bg-amber/20 focus:outline-none focus:ring-2 focus:ring-amber/50"
        >
          Reload
        </button>
      </div>
    );
  }

  // Broker unavailable — backend is serving synthetic fallback data
  // (persona-r P43). Treated as amber: visible enough to lock execution,
  // calmer than a hard app failure.
  if (brokerDegraded) {
    return (
      <div
        role="alert"
        aria-live="assertive"
        data-testid="broker-degraded-banner"
        className="w-full bg-amber/10 text-amber border-b border-amber/20 px-4 py-1.5 text-label flex items-center justify-center gap-2"
      >
        <span className="font-semibold uppercase tracking-wide">LIMITED DATA</span>
        <span className="font-medium">— broker unavailable, execution locked</span>
      </div>
    );
  }

  if (wsStatus === "reconnecting") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="w-full bg-amber/10 text-amber border-b border-amber/20 px-4 py-1.5 text-label text-center"
      >
        Reconnecting to live data…
      </div>
    );
  }

  // connecting (initial handshake, no prior success) — muted so it doesn't
  // scream at users on the first paint; it reads as readiness context, not
  // an app-wide failure.
  return (
    <div
      role="status"
      aria-live="polite"
      className="w-full bg-bg-elev-1 text-fg-muted border-b border-border px-4 py-1.5 text-label text-center"
    >
      Market data link starting
    </div>
  );
}
