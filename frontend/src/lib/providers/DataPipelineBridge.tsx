"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useDataPipeline } from "@/hooks/useDataPipeline";
import { useToast } from "@/hooks/useToast";

/**
 * K-4 (round-6): split out of `lib/providers.tsx` so the parent can
 * dynamic()-import this component. The bridge pulls in every Zustand
 * persist store + the full `useDataPipeline` chain (which re-exports
 * `getSnapshot`, `getPositions`, etc. from `@/lib/api`); none of that
 * needs to ship in the /login chunk.
 */
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

export function DataPipelineBridge({ children }: { children: ReactNode }) {
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
