"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { useState, createContext, useContext, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import type { useWebSocket } from "@/hooks/useWebSocket";
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

// K-4 (round-6): the context lives here (not in providers/WebSocketProvider.tsx)
// so that static consumers of `useWs()` — which is most of the dashboard tree —
// share the same module-scoped context with the dynamically-loaded
// WebSocketProvider. Splitting the context across two modules would create
// two distinct symbols and `useWs()` would always throw.
export const WebSocketContext = createContext<WsContextValue | null>(null);

export function useWs(): WsContextValue {
  const ctx = useContext(WebSocketContext);
  if (!ctx) throw new Error("useWs must be used within Providers");
  return ctx;
}

// K-4 (round-6): dynamic-import both the WS provider and the data-pipeline
// bridge. SSR is disabled (ssr: false) because both depend on browser-only
// APIs (WebSocket, navigator) and on Zustand stores that hydrate from
// localStorage. Only authenticated dashboard routes mount these chunks; public
// marketing/legal/help routes must not hydrate protected API polling.
const WebSocketProvider = dynamic(
  () => import("./providers/WebSocketProvider").then((m) => m.WebSocketProvider),
  { ssr: false },
);

const DataPipelineBridge = dynamic(
  () => import("./providers/DataPipelineBridge").then((m) => m.DataPipelineBridge),
  { ssr: false },
);

// ─── Combined Provider ───────────────────────────────────────

const DASHBOARD_ROUTE_PREFIXES = [
  "/",
  "/agents",
  "/analytics",
  "/alerts",
  "/pipeline",
  "/reports",
  "/risk-dashboard",
  "/settings",
  "/strategies",
  "/trade",
  "/watchlists",
] as const;

function isDashboardRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  if (DASHBOARD_ROUTE_PREFIXES.includes(pathname as (typeof DASHBOARD_ROUTE_PREFIXES)[number])) return true;
  if (pathname === "/strategies/trading-agents-research") return true;
  if (pathname === "/strategies/earnings-options-play") return true;
  if (/^\/strategies\/[^/]+$/.test(pathname)) return true;
  if (/^\/symbols\/[^/]+$/.test(pathname)) return true;
  if (/^\/agents\/[^/]+$/.test(pathname)) return true;
  return false;
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(makeQueryClient);
  const pathname = usePathname();
  const authOnlyProviders = isDashboardRoute(pathname);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeController />
      <ToastProvider>
        {authOnlyProviders ? (
          <WebSocketProvider>
            <DataPipelineBridge>
              <TooltipProvider delay={200}>{children}</TooltipProvider>
            </DataPipelineBridge>
          </WebSocketProvider>
        ) : (
          <TooltipProvider delay={200}>{children}</TooltipProvider>
        )}
      </ToastProvider>
    </QueryClientProvider>
  );
}
