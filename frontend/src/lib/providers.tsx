"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, useEffect, createContext, useContext, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useDataPipeline } from "@/hooks/useDataPipeline";
import { useToast } from "@/hooks/useToast";
import { ensureTokenRefreshScheduled } from "@/lib/api";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ToastProvider } from "@/components/ui/toast";
import ThemeController from "@/components/layout/ThemeController";

// ─── React Query ─────────────────────────────────────────────

function makeQueryClient() {
  // long-session-audit-r4 P1 #5: explicit gcTime avoids the v5 default of
  // 5 min growing unbounded on heavy research sessions where the user
  // hovers many symbols / expirations (each unique key hangs in cache).
  // 10 min gc is a reasonable bound; per-query callsites can override with
  // a shorter gcTime (e.g. 60_000) for high-cardinality keys like
  // `useOptionsChain(symbol, expiration)` / `useIVData(symbol)`.
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 10 * 60_000, // 10 minutes — cap cache retention
        refetchOnWindowFocus: false,
        retry: 2,
      },
    },
  });
}

// ─── WebSocket Context ───────────────────────────────────────

type WsContextValue = ReturnType<typeof useWebSocket>;

const WebSocketContext = createContext<WsContextValue | null>(null);

export function useWs(): WsContextValue {
  const ctx = useContext(WebSocketContext);
  if (!ctx) throw new Error("useWs must be used within Providers");
  return ctx;
}

function WebSocketProvider({ children }: { children: ReactNode }) {
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

// ─── Price Alert Toast Bridge ────────────────────────────────

function PriceAlertToastBridge() {
  const { toast } = useToast();
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ message: string; symbol?: string }>).detail;
      if (detail?.message) {
        toast({ type: "info", message: detail.message, duration: 8000 });
      }
    };
    window.addEventListener("alphadesk:price-alert", handler);
    return () => window.removeEventListener("alphadesk:price-alert", handler);
  }, [toast]);
  return null;
}

// ─── Data Pipeline (routes WS + REST to stores) ─────────────

function DataPipelineBridge({ children }: { children: ReactNode }) {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // Rehydrate all Zustand persist stores after mount
    Promise.all([
      import("@/stores/market").then(m => m.useMarketStore.persist.rehydrate()),
      import("@/stores/preferences").then(m => m.usePreferencesStore.persist.rehydrate()),
      import("@/stores/ui").then(m => m.useUIStore.persist.rehydrate()),
      import("@/stores/notifications").then(m => m.useNotificationsStore.persist.rehydrate()),
    ]).then(() => setHydrated(true));
  }, []);

  // Always call the hook (React rules of hooks — no conditional calls)
  // but only activate data fetching after stores are hydrated
  useDataPipeline(hydrated);

  return (
    <>
      {hydrated && <PriceAlertToastBridge />}
      {children}
    </>
  );
}

// ─── Combined Provider ───────────────────────────────────────

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(makeQueryClient);
  const pathname = usePathname();
  const isLogin = pathname === "/login";

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeController />
      <ToastProvider>
        {isLogin ? (
          <TooltipProvider delay={200}>{children}</TooltipProvider>
        ) : (
          <WebSocketProvider>
            <DataPipelineBridge>
              <TooltipProvider delay={200}>{children}</TooltipProvider>
            </DataPipelineBridge>
          </WebSocketProvider>
        )}
      </ToastProvider>
    </QueryClientProvider>
  );
}
