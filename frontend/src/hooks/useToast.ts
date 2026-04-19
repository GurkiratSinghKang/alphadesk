"use client";

import { useContext, useCallback } from "react";
import { ToastContext, type ToastData } from "@/components/ui/toast";
import { useAlertsStore } from "@/stores/alerts";

export function useToast() {
  // Call hooks UNCONDITIONALLY to satisfy the rules-of-hooks invariant.
  // The prior `if (!ctx) throw` between hook calls meant the hook count
  // varied across renders (1 on throw, 4 otherwise), producing React
  // error #310 ("Rendered more hooks than during the previous render")
  // when the toast provider was briefly absent during hydration.
  const ctx = useContext(ToastContext);
  const addAlert = useAlertsStore((s) => s.addAlert);

  const toast = useCallback(
    (data: ToastData) => {
      if (!ctx) {
        console.warn("useToast called outside ToastProvider; silent no-op");
        return "";
      }
      const id = ctx.addToast(data);
      addAlert({
        id,
        type: data.type === "success" ? "system" : data.type === "error" ? "system" : data.type === "warning" ? "signal" : "system",
        message: data.message,
        time: Date.now(),
        acknowledged: false,
      });
      return id;
    },
    [ctx, addAlert]
  );

  const dismiss = useCallback((id: string) => ctx?.dismissToast(id), [ctx]);

  return { toast, dismiss };
}
