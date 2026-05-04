import { useCallback, useState } from "react";

export interface DestructiveActionState {
  title: string;
  description: string;
  consequences: string[];
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
}

export function useDestructiveAction() {
  const [pending, setPending] = useState<DestructiveActionState | null>(null);
  const [loading, setLoading] = useState(false);

  const fire = useCallback(async () => {
    if (!pending) return;
    setLoading(true);
    try {
      await pending.onConfirm();
      setPending(null); // auto-dismiss on success
    } catch (err) {
      // Consumer's onConfirm should handle/log errors themselves; we just
      // release the loading state and KEEP the modal open so they can retry.
      console.error("[destructive] action failed", err);
    } finally {
      setLoading(false);
    }
  }, [pending]);

  const dismiss = useCallback(() => {
    if (loading) return; // don't dismiss while in-flight
    setPending(null);
  }, [loading]);

  return { pending, loading, request: setPending, fire, dismiss };
}
