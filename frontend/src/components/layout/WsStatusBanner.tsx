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
 *   failed         : loss bg + assertive aria-live + "Reload" button
 *   broker-degraded: loss bg + assertive aria-live ("DEMO DATA — broker unavailable")
 *   reconnecting   : amber bg + polite aria-live ("Reconnecting…")
 *   connecting     : muted bg + polite aria-live ("Connecting to live data…")
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
 *   - bg-loss/10 / text-loss      : error state for failed / degraded
 * These tokens are defined in globals.css / tailwind.config and are already
 * in active use across PnlCalendar, DashboardError, LoginForm, etc.
 */

import { useEffect, useRef } from "react";
import { useWs } from "@/lib/providers";
import { usePortfolioStore } from "@/stores/portfolio";

/**
 * If we don't see a fresh `is_demo` signal for this many milliseconds we
 * assume the broker recovered. The backend tags every response (not just
 * the first degraded one) so a healthy account pings this event well
 * within the window.
 */
const BROKER_DEGRADED_TTL_MS = 60_000;

export function WsStatusBanner() {
  const { wsStatus } = useWs();
  const brokerDegraded = usePortfolioStore((s) => s.brokerDegraded);
  const setBrokerDegraded = usePortfolioStore((s) => s.setBrokerDegraded);
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

  // Broker unavailable — backend is serving synthetic fallback data
  // (persona-r P43). Treated with the same loss-tokened severity as the
  // failed WS branch because the user's P&L, positions and quotes are all
  // fake until the broker recovers.
  if (brokerDegraded) {
    return (
      <div
        role="alert"
        aria-live="assertive"
        data-testid="broker-degraded-banner"
        className="w-full bg-loss/10 text-loss border-b border-loss/20 px-4 py-1.5 text-xs flex items-center justify-center gap-2"
      >
        <span className="font-semibold uppercase tracking-wide">DEMO DATA</span>
        <span className="font-medium">— broker unavailable, trading is disabled</span>
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
