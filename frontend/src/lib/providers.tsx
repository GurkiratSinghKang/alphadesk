"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, useEffect, createContext, useContext, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useDataPipeline } from "@/hooks/useDataPipeline";
import { useToast } from "@/hooks/useToast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ToastProvider } from "@/components/ui/toast";

// ─── React Query ─────────────────────────────────────────────

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
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
  useDataPipeline();
  return (
    <>
      <PriceAlertToastBridge />
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
