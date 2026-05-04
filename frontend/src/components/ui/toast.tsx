"use client";

import { createContext, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { CheckCircle, AlertCircle, Info, AlertTriangle, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ToastType = "success" | "error" | "info" | "warning";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastData {
  type: ToastType;
  message: string;
  action?: ToastAction;
  duration?: number;
}

interface ToastEntry extends ToastData {
  id: string;
  createdAt: number;
}

export interface ToastContextValue {
  addToast: (data: ToastData) => string;
  dismissToast: (id: string) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

const TOAST_ICON: Record<ToastType, typeof Info> = {
  success: CheckCircle,
  error: AlertCircle,
  info: Info,
  warning: AlertTriangle,
};

const TOAST_ACCENT: Record<ToastType, string> = {
  success: "border-l-profit",
  error: "border-l-loss",
  info: "border-l-brand",
  warning: "border-l-amber",
};

const TOAST_ICON_COLOR: Record<ToastType, string> = {
  success: "text-profit",
  error: "text-loss",
  info: "text-brand",
  warning: "text-amber",
};

function ToastItem({ toast, onDismiss }: { toast: ToastEntry; onDismiss: (id: string) => void }) {
  const Icon = TOAST_ICON[toast.type];
  // a11y audit r3 — WCAG 4.1.3: error toasts need role="alert" + aria-live="assertive"
  // so AT interrupts; info/success/warning use role="status" + aria-live="polite".
  const isError = toast.type === "error";
  return (
    <div
      className={cn(
        "flex items-start gap-3 px-4 py-3",
        "rounded-md border border-border border-l-[3px] bg-bg-elev-2 text-fg",
        "shadow-lg shadow-black/30",
        "animate-in slide-in-from-right-full fade-in duration-200",
        TOAST_ACCENT[toast.type]
      )}
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
    >
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", TOAST_ICON_COLOR[toast.type])} />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-fg">{toast.message}</p>
        {toast.action && (
          <button
            onClick={() => { toast.action!.onClick(); onDismiss(toast.id); }}
            className="mt-1 text-label font-medium text-brand hover:underline"
          >
            {toast.action.label}
          </button>
        )}
      </div>
      <button
        onClick={() => onDismiss(toast.id)}
        className="-m-2.5 inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded-sm p-2.5 text-fg-muted hover:text-fg"
        aria-label="Dismiss notification"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismissToast = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) clearTimeout(timer);
    timersRef.current.delete(id);
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Round-11 / BB-14 (P1): track how many toasts were silently
  // dropped past the visible cap so the operator sees a "+N more"
  // pill rather than a vanishing-act stack. Reset whenever the
  // visible stack drains to empty (the burst is over and the
  // pill no longer carries useful info).
  const droppedRef = useRef<{ count: number }>({ count: 0 });
  const [droppedCount, setDroppedCount] = useState(0);

  const addToast = useCallback(
    (data: ToastData) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const entry: ToastEntry = { ...data, id, createdAt: Date.now() };
      setToasts((prev) => {
        const next = [entry, ...prev];
        if (next.length > 3) {
          // Round-11 / BB-14: count the overflow so the user sees it.
          droppedRef.current.count += next.length - 3;
          setDroppedCount(droppedRef.current.count);
        }
        return next.slice(0, 3);
      });
      const duration = data.duration ?? 5000;
      const timer = setTimeout(() => dismissToast(id), duration);
      timersRef.current.set(id, timer);
      return id;
    },
    [dismissToast, droppedRef]
  );

  // Reset the dropped counter when the stack drains to empty —
  // the burst is over and "+N more" no longer reflects current
  // reality.
  useEffect(() => {
    if (toasts.length === 0 && droppedRef.current.count > 0) {
      droppedRef.current.count = 0;
      const timer = window.setTimeout(() => setDroppedCount(0), 0);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [toasts.length]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ addToast, dismissToast }}>
      {children}
      {/* a11y audit r3 — WCAG 4.1.3: Toast container is a labeled live region
          so AT engines register announcements when toasts append. Individual
          toasts still carry their own role/aria-live (assertive for errors,
          polite for info/success/warning). */}
      <div
        role="region"
        aria-label="Notifications"
        aria-live="polite"
        aria-atomic="false"
        className="fixed bottom-4 right-4 z-[55] flex w-[calc(100vw-2rem)] max-w-[380px] flex-col-reverse gap-2 pointer-events-none sm:w-[380px]"
      >
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto">
            <ToastItem toast={t} onDismiss={dismissToast} />
          </div>
        ))}
        {/* Round-11 / BB-14 (P1): "+N more" pill so a burst that
            exceeds the 3-cap doesn't silently vanish. The pill is
            polite (aria-live="polite" via the parent region) and
            self-clears when the stack empties. */}
        {droppedCount > 0 && (
          <div
            data-slot="toast-overflow-pill"
            className="pointer-events-none self-end rounded-full border border-border bg-bg-elev-2/90 px-3 py-1 font-mono text-label text-fg-muted shadow-md"
          >
            + {droppedCount} more notification{droppedCount === 1 ? "" : "s"} (see bell)
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}
