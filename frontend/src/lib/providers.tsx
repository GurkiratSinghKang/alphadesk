"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, createContext, useContext, type ReactNode } from "react";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useDataPipeline } from "@/hooks/useDataPipeline";
import { TooltipProvider } from "@/components/ui/tooltip";

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

// ─── Data Pipeline (routes WS + REST to stores) ─────────────

function DataPipelineBridge({ children }: { children: ReactNode }) {
  useDataPipeline();
  return <>{children}</>;
}

// ─── Combined Provider ───────────────────────────────────────

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(makeQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <WebSocketProvider>
        <DataPipelineBridge>
          <TooltipProvider delay={200}>{children}</TooltipProvider>
        </DataPipelineBridge>
      </WebSocketProvider>
    </QueryClientProvider>
  );
}
