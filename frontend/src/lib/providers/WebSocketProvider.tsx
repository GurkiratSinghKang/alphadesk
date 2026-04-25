"use client";

import { useEffect, type ReactNode } from "react";
import { useWebSocket } from "@/hooks/useWebSocket";
import { ensureTokenRefreshScheduled } from "@/lib/api";
import { WebSocketContext } from "@/lib/providers";

/**
 * K-4 (round-6): split out of `lib/providers.tsx` so the parent can
 * dynamic()-import this component. That keeps the WebSocket runtime
 * (useWebSocket + token-refresh scheduler + the entire @/lib/api
 * surface it pulls in) out of the /login chunk, where the consumer
 * tree never mounts WebSocketProvider in the first place.
 *
 * The React context lives in `lib/providers.tsx` so static consumers
 * of `useWs()` keep working — only the *Provider* is dynamic. Both
 * trees reference the same module-level `WebSocketContext`, so the
 * dynamic boundary is invisible to the rest of the app.
 */
export function WebSocketProvider({ children }: { children: ReactNode }) {
  const ws = useWebSocket();
  // long-session-audit-r4 P0 #1: start the silent token-refresh scheduler
  // once when a logged-in session mounts the dashboard. The scheduler is
  // a no-op until `captureRefreshToken` is called (see api.ts), so we also
  // re-arm it on the login-success event in case the dashboard is first
  // mounted before the event fires (e.g. SSR hydration ordering).
  // Mounted here (and not on /login) because WebSocketProvider only wraps
  // authenticated surfaces — see <Providers> below.
  useEffect(() => {
    ensureTokenRefreshScheduled();
    const onLogin = () => ensureTokenRefreshScheduled();
    window.addEventListener("alphadesk:auth-login-success", onLogin);
    return () => window.removeEventListener("alphadesk:auth-login-success", onLogin);
  }, []);
  return (
    <WebSocketContext.Provider value={ws}>{children}</WebSocketContext.Provider>
  );
}
