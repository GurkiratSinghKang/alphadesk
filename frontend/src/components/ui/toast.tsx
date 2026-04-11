"use client";

import { createContext, useCallback, useState, type ReactNode } from "react";
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
  success: "border-l-[var(--profit)]",
  error: "border-l-[var(--loss)]",
  info: "border-l-[var(--primary)]",
  warning: "border-l-amber-500",
};

const TOAST_ICON_COLOR: Record<ToastType, string> = {
  success: "text-[var(--profit)]",
  error: "text-[var(--loss)]",
  info: "text-[var(--primary)]",
  warning: "text-amber-500",
};

function ToastItem({ toast, onDismiss }: { toast: ToastEntry; onDismiss: (id: string) => void }) {
  const Icon = TOAST_ICON[toast.type];
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border border-border border-l-[3px] bg-[var(--surface)] px-4 py-3 shadow-lg shadow-black/30",
        "animate-in slide-in-from-right-full fade-in duration-200",
        TOAST_ACCENT[toast.type]
      )}
      role="alert"
    >
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", TOAST_ICON_COLOR[toast.type])} />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground">{toast.message}</p>
        {toast.action && (
          <button
            onClick={() => { toast.action!.onClick(); onDismiss(toast.id); }}
            className="mt-1 text-xs font-medium text-[var(--primary)] hover:underline"
          >
            {toast.action.label}
          </button>
        )}
      </div>
      <button onClick={() => onDismiss(toast.id)} className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    (data: ToastData) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const entry: ToastEntry = { ...data, id, createdAt: Date.now() };
      setToasts((prev) => [entry, ...prev].slice(0, 3));
      const duration = data.duration ?? 5000;
      setTimeout(() => dismissToast(id), duration);
      return id;
    },
    [dismissToast]
  );

  return (
    <ToastContext.Provider value={{ addToast, dismissToast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col-reverse gap-2 w-[380px] pointer-events-none">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto">
            <ToastItem toast={t} onDismiss={dismissToast} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
