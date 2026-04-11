"use client";

import { useContext, useCallback } from "react";
import { ToastContext, type ToastData } from "@/components/ui/toast";
import { useAlertsStore } from "@/stores/alerts";

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");

  const addAlert = useAlertsStore((s) => s.addAlert);

  const toast = useCallback(
    (data: ToastData) => {
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

  const dismiss = useCallback((id: string) => ctx.dismissToast(id), [ctx]);

  return { toast, dismiss };
}
