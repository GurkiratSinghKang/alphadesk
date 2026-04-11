# Global UX Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build 6 shared UX infrastructure pieces (typography, toasts, placeholders, keyboard shortcuts, TopBar redesign, empty-state hints) that improve every page of the AlphaDesk trading terminal.

**Architecture:** Foundation-first — build reusable primitives (CSS tokens, context providers, hooks) then wire them into existing pages. Each task is independently deployable and produces a working build.

**Tech Stack:** Next.js 16, React 19, Tailwind CSS 4, Zustand, Lucide icons. All frontend — no backend changes.

---

### Task 1: Typography Scale

Add CSS utility classes for the 4-level Bloomberg-style typography hierarchy.

**Files:**
- Modify: `frontend/src/app/globals.css`

- [ ] **Step 1: Add typography utility classes to globals.css**

Add the following inside the existing `@layer utilities { ... }` block in `frontend/src/app/globals.css`, right after the `.text-gradient` class (around line 240):

```css
  /* Typography scale — Bloomberg-style size + dimming hierarchy */
  .text-display {
    font-size: 36px;
    font-weight: 700;
    letter-spacing: -0.03em;
    color: var(--foreground);
    line-height: 1;
  }
  .text-title {
    font-size: 15px;
    font-weight: 500;
    color: var(--foreground);
    letter-spacing: -0.01em;
  }
  .text-body {
    font-size: 13px;
    font-weight: 400;
    color: var(--foreground);
  }
  .text-label {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #555;
  }
  .text-secondary {
    opacity: 0.65;
  }
  .text-hint {
    font-size: 11px;
    color: #555;
  }
```

- [ ] **Step 2: Verify build passes**

Run from `frontend/`:
```bash
npx next build 2>&1 | tail -5
```
Expected: Build succeeds with all routes listed.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/globals.css
git commit -m "feat(ux): add Bloomberg-style typography scale utilities"
```

---

### Task 2: Toast System — Provider and Components

Build the ToastProvider context, ToastContainer, and ToastItem components.

**Files:**
- Create: `frontend/src/components/ui/toast.tsx`
- Create: `frontend/src/hooks/useToast.ts`
- Modify: `frontend/src/lib/providers.tsx`

- [ ] **Step 1: Create toast components**

Create `frontend/src/components/ui/toast.tsx`:

```tsx
"use client";

import { createContext, useCallback, useState, type ReactNode } from "react";
import { CheckCircle, AlertCircle, Info, AlertTriangle, X } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────

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

// ─── Context ────────────────────────────────────────────────

export interface ToastContextValue {
  addToast: (data: ToastData) => string;
  dismissToast: (id: string) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

// ─── Icons & Colors ─────────────────────────────────────────

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

// ─── Toast Item ─────────────────────────────────────────────

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: ToastEntry;
  onDismiss: (id: string) => void;
}) {
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
            onClick={() => {
              toast.action!.onClick();
              onDismiss(toast.id);
            }}
            className="mt-1 text-xs font-medium text-[var(--primary)] hover:underline"
          >
            {toast.action.label}
          </button>
        )}
      </div>
      <button
        onClick={() => onDismiss(toast.id)}
        className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ─── Provider ───────────────────────────────────────────────

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    (data: ToastData) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const entry: ToastEntry = { ...data, id, createdAt: Date.now() };

      setToasts((prev) => {
        const next = [entry, ...prev];
        return next.slice(0, 3); // max 3 visible
      });

      // Auto-dismiss
      const duration = data.duration ?? 5000;
      setTimeout(() => dismissToast(id), duration);

      return id;
    },
    [dismissToast]
  );

  return (
    <ToastContext.Provider value={{ addToast, dismissToast }}>
      {children}
      {/* Toast container — fixed bottom-right */}
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
```

- [ ] **Step 2: Create useToast hook**

Create `frontend/src/hooks/useToast.ts`:

```ts
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

      // Persist to alerts store for history
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

  const dismiss = useCallback(
    (id: string) => ctx.dismissToast(id),
    [ctx]
  );

  return { toast, dismiss };
}
```

- [ ] **Step 3: Wire ToastProvider into the app**

In `frontend/src/lib/providers.tsx`, add the import at the top:

```tsx
import { ToastProvider } from "@/components/ui/toast";
```

Then wrap the return of `Providers` with `<ToastProvider>`. Change the return to:

```tsx
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
```

- [ ] **Step 4: Verify build passes**

```bash
cd frontend && npx next build 2>&1 | tail -5
```
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/toast.tsx frontend/src/hooks/useToast.ts frontend/src/lib/providers.tsx
git commit -m "feat(ux): add toast notification system with alerts persistence"
```

---

### Task 3: Placeholder Component

Build the content-aware progressive loading component.

**Files:**
- Create: `frontend/src/components/ui/placeholder.tsx`

- [ ] **Step 1: Create Placeholder component**

Create `frontend/src/components/ui/placeholder.tsx`:

```tsx
import { cn } from "@/lib/utils";

type PlaceholderFormat = "currency" | "percent" | "text" | "integer";

const PLACEHOLDER_TEXT: Record<PlaceholderFormat, string> = {
  currency: "$--.--",
  percent: "--.-%",
  text: "---",
  integer: "--",
};

const currencyFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const percentFmt = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  signDisplay: "always",
});

function formatValue(value: number | string, format: PlaceholderFormat): string {
  if (typeof value === "string") return value;
  switch (format) {
    case "currency":
      return currencyFmt.format(value);
    case "percent":
      return percentFmt.format(value / 100);
    case "integer":
      return String(Math.round(value));
    default:
      return String(value);
  }
}

interface PlaceholderProps {
  value: number | string | null | undefined;
  format: PlaceholderFormat;
  className?: string;
}

export function Placeholder({ value, format, className }: PlaceholderProps) {
  if (value == null || (typeof value === "number" && !Number.isFinite(value))) {
    return (
      <span className={cn("text-[#555] tabular-nums", className)}>
        {PLACEHOLDER_TEXT[format]}
      </span>
    );
  }

  return (
    <span className={cn("tabular-nums transition-opacity duration-200", className)}>
      {formatValue(value, format)}
    </span>
  );
}
```

- [ ] **Step 2: Verify build passes**

```bash
cd frontend && npx next build 2>&1 | tail -5
```
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ui/placeholder.tsx
git commit -m "feat(ux): add Placeholder component for progressive loading"
```

---

### Task 4: Keyboard Shortcuts Engine

Build the shortcut hook with chord support and the `?` overlay.

**Files:**
- Create: `frontend/src/hooks/useKeyboardShortcuts.ts`
- Create: `frontend/src/components/ui/shortcut-overlay.tsx`

- [ ] **Step 1: Create keyboard shortcuts hook**

Create `frontend/src/hooks/useKeyboardShortcuts.ts`:

```ts
"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useUIStore } from "@/stores/ui";
import { useMarketStore } from "@/stores/market";

// ─── Default Bindings ───────────────────────────────────────

export const DEFAULT_BINDINGS: Record<string, string> = {
  "?": "toggle:shortcuts",
  "/": "focus:search",
  "Escape": "dismiss",
  "g d": "navigate:dashboard",
  "g t": "navigate:trade",
  "g p": "navigate:pipeline",
  "1": "chart:timeframe:1m",
  "2": "chart:timeframe:5m",
  "3": "chart:timeframe:15m",
  "4": "chart:timeframe:1H",
  "5": "chart:timeframe:D",
  "6": "chart:timeframe:W",
  "j": "watchlist:next",
  "k": "watchlist:prev",
};

export const SHORTCUT_GROUPS: { name: string; items: { key: string; action: string; description: string }[] }[] = [
  {
    name: "Global",
    items: [
      { key: "?", action: "toggle:shortcuts", description: "Show keyboard shortcuts" },
      { key: "Ctrl+K", action: "toggle:command-palette", description: "Command palette" },
      { key: "/", action: "focus:search", description: "Focus symbol search" },
      { key: "Escape", action: "dismiss", description: "Close overlay / deselect" },
    ],
  },
  {
    name: "Navigation",
    items: [
      { key: "g d", action: "navigate:dashboard", description: "Go to Dashboard" },
      { key: "g t", action: "navigate:trade", description: "Go to Trade" },
      { key: "g p", action: "navigate:pipeline", description: "Go to Pipeline" },
    ],
  },
  {
    name: "Chart",
    items: [
      { key: "1", action: "chart:timeframe:1m", description: "1 minute" },
      { key: "2", action: "chart:timeframe:5m", description: "5 minutes" },
      { key: "3", action: "chart:timeframe:15m", description: "15 minutes" },
      { key: "4", action: "chart:timeframe:1H", description: "1 hour" },
      { key: "5", action: "chart:timeframe:D", description: "Daily" },
      { key: "6", action: "chart:timeframe:W", description: "Weekly" },
    ],
  },
  {
    name: "Watchlist",
    items: [
      { key: "j", action: "watchlist:next", description: "Next symbol" },
      { key: "k", action: "watchlist:prev", description: "Previous symbol" },
    ],
  },
];

const STORAGE_KEY = "alphadesk:keybindings";
const CHORD_TIMEOUT = 500;

function loadBindings(): Record<string, string> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return { ...DEFAULT_BINDINGS, ...JSON.parse(stored) };
  } catch {}
  return { ...DEFAULT_BINDINGS };
}

// ─── Hook ───────────────────────────────────────────────────

export function useKeyboardShortcuts() {
  const router = useRouter();
  const { setCommandPaletteOpen } = useUIStore();
  const [overlayOpen, setOverlayOpen] = useState(false);

  const bindingsRef = useRef(loadBindings());
  const lastKeyRef = useRef<{ key: string; time: number } | null>(null);

  const handleAction = useCallback(
    (actionId: string) => {
      switch (actionId) {
        case "toggle:shortcuts":
          setOverlayOpen((prev) => !prev);
          break;
        case "toggle:command-palette":
          setCommandPaletteOpen(true);
          break;
        case "focus:search":
          setCommandPaletteOpen(true);
          break;
        case "dismiss":
          setOverlayOpen(false);
          break;
        case "navigate:dashboard":
          router.push("/");
          break;
        case "navigate:trade":
          router.push("/trade");
          break;
        case "navigate:pipeline":
          router.push("/pipeline");
          break;
        default:
          // Chart timeframe and watchlist actions are handled by
          // stores listening to a custom event
          window.dispatchEvent(
            new CustomEvent("alphadesk:shortcut", { detail: actionId })
          );
          break;
      }
    },
    [router, setCommandPaletteOpen]
  );

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Skip when typing in inputs
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) {
        return;
      }

      const bindings = bindingsRef.current;
      const now = Date.now();
      const keyStr = e.ctrlKey || e.metaKey ? `Ctrl+${e.key.toLowerCase()}` : e.key;

      // Check for chord (two-key sequence)
      if (lastKeyRef.current && now - lastKeyRef.current.time < CHORD_TIMEOUT) {
        const chord = `${lastKeyRef.current.key} ${keyStr}`;
        if (bindings[chord]) {
          e.preventDefault();
          lastKeyRef.current = null;
          handleAction(bindings[chord]);
          return;
        }
      }

      // Check for single key match
      if (bindings[keyStr]) {
        // If this key is the first part of any chord, delay execution
        const isChordPrefix = Object.keys(bindings).some(
          (k) => k.startsWith(keyStr + " ") && k.length > keyStr.length + 1
        );

        if (isChordPrefix) {
          lastKeyRef.current = { key: keyStr, time: now };
          // Set a timeout to fire the single key if no chord follows
          setTimeout(() => {
            if (lastKeyRef.current?.key === keyStr && lastKeyRef.current?.time === now) {
              lastKeyRef.current = null;
              // Don't fire single key if it's only a chord prefix (like "g")
              if (!bindings[keyStr]?.startsWith("navigate:")) {
                handleAction(bindings[keyStr]);
              }
            }
          }, CHORD_TIMEOUT);
          return;
        }

        e.preventDefault();
        lastKeyRef.current = null;
        handleAction(bindings[keyStr]);
        return;
      }

      // Store for potential chord
      lastKeyRef.current = { key: keyStr, time: now };
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [handleAction]);

  return { overlayOpen, setOverlayOpen };
}
```

- [ ] **Step 2: Create ShortcutOverlay component**

Create `frontend/src/components/ui/shortcut-overlay.tsx`:

```tsx
"use client";

import { SHORTCUT_GROUPS } from "@/hooks/useKeyboardShortcuts";

function KBD({ children }: { children: string }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[24px] rounded bg-[var(--panel)] border border-border px-1.5 py-0.5 text-[11px] font-mono text-muted-foreground">
      {children}
    </kbd>
  );
}

export function ShortcutOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[600px] rounded-xl border border-border bg-[var(--surface)] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-foreground">Keyboard Shortcuts</h2>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            Press <KBD>Esc</KBD> to close
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.name}>
              <h3 className="text-label mb-3">{group.name}</h3>
              <div className="space-y-2">
                {group.items.map((item) => (
                  <div key={item.key} className="flex items-center justify-between gap-4">
                    <span className="text-sm text-muted-foreground">{item.description}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      {item.key.split(" ").map((k, i) => (
                        <span key={i} className="flex items-center gap-0.5">
                          {i > 0 && <span className="text-[10px] text-muted-foreground mx-0.5">then</span>}
                          <KBD>{k}</KBD>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <p className="mt-6 text-[11px] text-[#555]">
          Customize bindings in localStorage key &quot;alphadesk:keybindings&quot;
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire into dashboard layout**

Modify `frontend/src/app/(dashboard)/layout.tsx` to:

```tsx
"use client";

import { CommandPalette } from "@/components/layout/CommandPalette";
import { TopBar } from "@/components/layout/TopBar";
import { ShortcutOverlay } from "@/components/ui/shortcut-overlay";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import type { ReactNode } from "react";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const { overlayOpen, setOverlayOpen } = useKeyboardShortcuts();

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TopBar />
      <main className="flex-1 min-h-0">{children}</main>
      <CommandPalette />
      {overlayOpen && <ShortcutOverlay onClose={() => setOverlayOpen(false)} />}
    </div>
  );
}
```

- [ ] **Step 4: Verify build passes**

```bash
cd frontend && npx next build 2>&1 | tail -5
```
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useKeyboardShortcuts.ts frontend/src/components/ui/shortcut-overlay.tsx frontend/src/app/\(dashboard\)/layout.tsx
git commit -m "feat(ux): add keyboard shortcuts engine with ? overlay"
```

---

### Task 5: TopBar Redesign — NavBar + StatusStrip

Split the current TopBar into a navigation bar and a status strip.

**Files:**
- Create: `frontend/src/components/layout/StatusStrip.tsx`
- Create: `frontend/src/components/layout/ProfileMenu.tsx`
- Modify: `frontend/src/components/layout/TopBar.tsx` (refactor into NavBar)
- Modify: `frontend/src/app/(dashboard)/layout.tsx`

- [ ] **Step 1: Create StatusStrip component**

Create `frontend/src/components/layout/StatusStrip.tsx`:

```tsx
"use client";

import { usePortfolioStore } from "@/stores/portfolio";
import { useWs } from "@/lib/providers";
import { useUIStore } from "@/stores/ui";
import { formatCurrency, cn } from "@/lib/utils";

export function StatusStrip() {
  const summary = usePortfolioStore((s) => s.summary);
  const { isConnected } = useWs();
  const tradingMode = useUIStore((s) => s.tradingMode);

  const dayPnl = Number.isFinite(summary.dayPnl) ? summary.dayPnl : 0;
  const dayPnlPct = Number.isFinite(summary.dayPnlPct) ? summary.dayPnlPct : 0;
  const hasPnl = dayPnl !== 0;

  return (
    <div className="flex h-7 shrink-0 items-center gap-0 border-b border-border bg-[var(--background)] px-4 text-[11px]">
      {/* P&L */}
      <div className="flex items-center gap-1.5 pr-4 border-r border-border/50">
        <span className="text-[#555] font-medium">P&L</span>
        {hasPnl ? (
          <span className={cn("font-semibold tabular-nums", dayPnl >= 0 ? "text-[var(--profit)] glow-profit" : "text-[var(--loss)] glow-loss")}>
            {dayPnl >= 0 ? "+" : ""}{formatCurrency(dayPnl)}
            <span className="text-secondary ml-1">({dayPnlPct >= 0 ? "+" : ""}{dayPnlPct.toFixed(2)}%)</span>
          </span>
        ) : (
          <span className="text-[#555] tabular-nums">$--.--</span>
        )}
      </div>

      {/* Regime — placeholder, filled by dashboard data */}
      <div className="flex items-center gap-1.5 px-4 border-r border-border/50" id="status-regime">
        <span className="text-[#555]">Regime</span>
        <span className="text-foreground font-medium">---</span>
      </div>

      {/* VIX */}
      <div className="flex items-center gap-1.5 px-4 border-r border-border/50" id="status-vix">
        <span className="text-[#555]">VIX</span>
        <span className="text-foreground tabular-nums font-medium">--.-</span>
      </div>

      {/* Connection */}
      <div className="flex items-center gap-1.5 px-4 border-r border-border/50">
        {isConnected ? (
          <>
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--profit)] opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--profit)]" />
            </span>
            <span className="text-[var(--profit)] font-medium">LIVE</span>
          </>
        ) : (
          <>
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--loss)]" />
            <span className="text-[var(--loss)] font-medium">OFFLINE</span>
          </>
        )}
      </div>

      {/* Broker + Mode */}
      <div className="flex items-center gap-2 px-4">
        <span className="text-foreground font-medium">Alpaca (Paper)</span>
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider",
            tradingMode === "paper"
              ? "bg-[var(--profit)]/15 text-[var(--profit)]"
              : "bg-[var(--loss)]/15 text-[var(--loss)]"
          )}
        >
          {tradingMode}
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create ProfileMenu component**

Create `frontend/src/components/layout/ProfileMenu.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Settings, Keyboard, LogOut, Wifi, WifiOff } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useUIStore } from "@/stores/ui";
import { usePortfolioStore } from "@/stores/portfolio";
import { formatCurrency, cn } from "@/lib/utils";

export function ProfileMenu() {
  const { tradingMode, setTradingMode } = useUIStore();
  const summary = usePortfolioStore((s) => s.summary);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [modeConfirmOpen, setModeConfirmOpen] = useState(false);

  const handleModeToggle = () => {
    if (tradingMode === "paper") {
      setModeConfirmOpen(true);
    } else {
      setTradingMode("paper");
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary hover:bg-primary/25 transition-colors">
          A
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="end" className="w-56 bg-[var(--surface)] border-border">
          {/* Account info */}
          <div className="px-3 py-2 space-y-1">
            <p className="text-xs font-medium text-foreground">admin</p>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-[#555]">Equity</span>
              <span className="text-foreground tabular-nums">{formatCurrency(summary.equity > 0 ? summary.equity : 0)}</span>
            </div>
          </div>

          <DropdownMenuSeparator />

          {/* Trading mode */}
          <div className="px-3 py-1.5">
            <p className="text-[10px] uppercase tracking-wider text-[#555] mb-1.5">Trading Mode</p>
            <div className="flex gap-1.5">
              <button
                onClick={() => setTradingMode("paper")}
                className={cn("rounded px-2.5 py-1 text-[11px] font-medium transition-colors",
                  tradingMode === "paper"
                    ? "bg-[var(--profit)]/15 text-[var(--profit)] ring-1 ring-[var(--profit)]/30"
                    : "bg-[var(--panel)] text-muted-foreground"
                )}
              >
                Paper
              </button>
              <button
                onClick={handleModeToggle}
                className={cn("rounded px-2.5 py-1 text-[11px] font-medium transition-colors",
                  tradingMode === "live"
                    ? "bg-[var(--loss)]/15 text-[var(--loss)] ring-1 ring-[var(--loss)]/30"
                    : "bg-[var(--panel)] text-muted-foreground"
                )}
              >
                Live
              </button>
            </div>
          </div>

          <DropdownMenuSeparator />

          <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
            <Settings className="mr-2 h-3.5 w-3.5" />
            Settings
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "?" }))}>
            <Keyboard className="mr-2 h-3.5 w-3.5" />
            Keyboard Shortcuts
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            onClick={() => {
              fetch("/api/v1/auth/logout", { method: "POST", credentials: "include" }).catch(() => {});
              document.cookie = "access_token=; path=/; max-age=0";
              window.location.href = "/login";
            }}
          >
            <LogOut className="mr-2 h-3.5 w-3.5" />
            Logout
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Settings Sheet */}
      <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
        <SheetContent side="right" className="bg-[var(--surface)] border-border">
          <SheetHeader>
            <SheetTitle>Settings</SheetTitle>
            <SheetDescription>Configure your trading environment.</SheetDescription>
          </SheetHeader>
          <div className="space-y-6 p-4">
            <p className="text-xs text-muted-foreground">Settings panel — broker API keys, preferences, and configuration.</p>
          </div>
        </SheetContent>
      </Sheet>

      {/* Live mode confirmation */}
      <Dialog open={modeConfirmOpen} onOpenChange={setModeConfirmOpen}>
        <DialogContent className="bg-[var(--surface)] border-border">
          <DialogHeader>
            <DialogTitle>Switch to Live Trading?</DialogTitle>
            <DialogDescription>
              Real orders will be submitted to your broker. Make sure your API keys are configured.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModeConfirmOpen(false)} className="text-xs">Cancel</Button>
            <Button
              onClick={() => { setTradingMode("live"); setModeConfirmOpen(false); }}
              className="bg-[var(--loss)] hover:bg-[var(--loss)]/90 text-white text-xs"
            >
              Confirm Live Mode
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

- [ ] **Step 3: Refactor TopBar.tsx into NavBar**

Replace the entire content of `frontend/src/components/layout/TopBar.tsx` with:

```tsx
"use client";

import { usePathname, useRouter } from "next/navigation";
import { Zap, LayoutDashboard, BarChart3, Bot, Search, Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useUIStore } from "@/stores/ui";
import { useAlertsStore } from "@/stores/alerts";
import { formatTimestamp, cn } from "@/lib/utils";
import { ProfileMenu } from "./ProfileMenu";

export function TopBar() {
  const router = useRouter();
  const pathname = usePathname();
  const { setCommandPaletteOpen } = useUIStore();
  const alerts = useAlertsStore((s) => s.alerts);
  const unacknowledgedCount = useAlertsStore((s) =>
    s.alerts.filter((a) => !a.acknowledged).length
  );
  const acknowledgeAlert = useAlertsStore((s) => s.acknowledgeAlert);

  const isHome = pathname === "/";
  const isTrade = pathname === "/trade";
  const isPipeline = pathname === "/pipeline";

  return (
    <header className="flex h-11 shrink-0 items-center justify-between border-b border-border bg-[var(--surface)] px-4">
      {/* Left: Logo + Nav */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-primary" />
          <span className="text-base font-bold tracking-tight text-foreground">AlphaDesk</span>
        </div>

        <nav className="flex items-center gap-1 ml-2">
          {[
            { path: "/", label: "Dashboard", icon: LayoutDashboard, active: isHome },
            { path: "/trade", label: "Trade", icon: BarChart3, active: isTrade },
            { path: "/pipeline", label: "Pipeline", icon: Bot, active: isPipeline },
          ].map(({ path, label, icon: Icon, active }) => (
            <button
              key={path}
              onClick={() => router.push(path)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-2 text-[11px] font-medium transition-colors",
                active
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </nav>
      </div>

      {/* Center: Search */}
      <button
        onClick={() => setCommandPaletteOpen(true)}
        className="flex h-8 w-[480px] items-center gap-2 rounded-md border border-border bg-background px-3 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="flex-1 text-left">Search symbols, commands...</span>
        <kbd className="rounded bg-[var(--panel)] px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">Ctrl+K</kbd>
      </button>

      {/* Right: Alerts + Profile */}
      <div className="flex items-center gap-2">
        {/* Alerts */}
        <Popover>
          <PopoverTrigger
            render={
              <Button variant="ghost" size="icon" className="relative h-8 w-8">
                <Bell className="h-4 w-4 text-muted-foreground" />
                {unacknowledgedCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">
                    {unacknowledgedCount > 9 ? "9+" : unacknowledgedCount}
                  </span>
                )}
              </Button>
            }
          />
          <PopoverContent side="bottom" align="end" className="w-80 bg-[var(--surface)] border-border p-0">
            <div className="border-b border-border px-3 py-2">
              <span className="text-xs font-medium text-foreground">Alerts & Notifications</span>
            </div>
            <ScrollArea className="max-h-64">
              {alerts.length === 0 ? (
                <div className="px-3 py-6 text-center text-xs text-muted-foreground">No alerts yet</div>
              ) : (
                <div className="py-1">
                  {alerts.slice(0, 20).map((alert) => (
                    <button
                      key={alert.id}
                      onClick={() => acknowledgeAlert(alert.id)}
                      className={cn(
                        "flex w-full items-start gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-accent/50",
                        alert.acknowledged && "opacity-50"
                      )}
                    >
                      <span className={cn(
                        "mt-0.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full",
                        alert.type === "price" ? "bg-primary"
                          : alert.type === "order" ? "bg-[var(--profit)]"
                          : alert.type === "signal" ? "bg-[var(--chart-4)]"
                          : "bg-muted-foreground"
                      )} />
                      <div className="flex-1 min-w-0">
                        <p className="text-foreground leading-tight">{alert.message}</p>
                        <span className="text-[10px] text-muted-foreground">{formatTimestamp(alert.time)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
          </PopoverContent>
        </Popover>

        <ProfileMenu />
      </div>
    </header>
  );
}
```

- [ ] **Step 4: Update dashboard layout to include StatusStrip**

Update `frontend/src/app/(dashboard)/layout.tsx`:

```tsx
"use client";

import { TopBar } from "@/components/layout/TopBar";
import { StatusStrip } from "@/components/layout/StatusStrip";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { ShortcutOverlay } from "@/components/ui/shortcut-overlay";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import type { ReactNode } from "react";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const { overlayOpen, setOverlayOpen } = useKeyboardShortcuts();

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TopBar />
      <StatusStrip />
      <main className="flex-1 min-h-0">{children}</main>
      <CommandPalette />
      {overlayOpen && <ShortcutOverlay onClose={() => setOverlayOpen(false)} />}
    </div>
  );
}
```

- [ ] **Step 5: Remove the command bar P&L/regime/VIX from the dashboard page**

In `frontend/src/app/(dashboard)/page.tsx`, the command bar section (Section 1) currently shows Portfolio value, Day P&L, Regime, VIX, and Pipeline status. Since these now live in the StatusStrip, simplify the command bar to show only the portfolio value as a hero number. Remove the Regime badge, VIX section, Pipeline section, and the WebSocket LIVE indicator from the command bar. Keep the Portfolio value and Day P&L.

Specifically, find the "Section 1: Command Bar" div and replace it with a simpler version that only shows:
- Portfolio equity (large display text)
- Day P&L with glow

Remove the Separator elements and the Regime, VIX, Pipeline, and WebSocket sections from within that div. These are now in StatusStrip.

- [ ] **Step 6: Verify build passes**

```bash
cd frontend && npx next build 2>&1 | tail -5
```
Expected: Build succeeds.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/layout/StatusStrip.tsx frontend/src/components/layout/ProfileMenu.tsx frontend/src/components/layout/TopBar.tsx frontend/src/app/\(dashboard\)/layout.tsx frontend/src/app/\(dashboard\)/page.tsx
git commit -m "feat(ux): split TopBar into NavBar + StatusStrip with ProfileMenu"
```

---

### Task 6: Empty-State Hints

Update empty states across dashboard, pipeline, and strategy pages with contextual guidance.

**Files:**
- Modify: `frontend/src/app/(dashboard)/page.tsx`
- Modify: `frontend/src/app/(dashboard)/pipeline/page.tsx`
- Modify: `frontend/src/app/(dashboard)/strategies/[id]/page.tsx`

- [ ] **Step 1: Update dashboard empty states**

In `frontend/src/app/(dashboard)/page.tsx`:

**Activity Feed empty state** — find the block with `"No activity yet today"` and replace:

```tsx
<div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
  <Info className="h-6 w-6 mb-2 opacity-40" />
  <p className="text-sm">No activity yet today</p>
  <p className="text-xs mt-1">Events will appear as the pipeline runs</p>
</div>
```

with:

```tsx
<div className="flex flex-col items-center justify-center py-8">
  <Info className="h-6 w-6 mb-2 opacity-30 text-muted-foreground" />
  <p className="text-body">No activity yet today</p>
  <p className="text-hint mt-1">Events appear when the pipeline runs</p>
  <button
    onClick={() => router.push("/pipeline")}
    className="mt-2 text-[11px] text-[var(--primary)] hover:underline"
  >
    Run Pipeline &rarr;
  </button>
</div>
```

**Positions empty state** — in the `PositionsSummary` component, the current code returns `null` when there are no positions. Change the early return to show a hint instead:

```tsx
if (positions.length === 0) {
  return (
    <div className="rounded-xl border border-border bg-[var(--panel)] px-4 py-4">
      <div className="flex items-center gap-2 mb-2">
        <Briefcase className="h-4 w-4 text-muted-foreground opacity-30" />
        <span className="text-sm font-semibold text-foreground">Open Positions</span>
      </div>
      <p className="text-hint">No open positions — the pipeline opens trades during market hours</p>
    </div>
  );
}
```

- [ ] **Step 2: Update pipeline empty states**

In `frontend/src/app/(dashboard)/pipeline/page.tsx`:

**Today's Pipeline Run empty state** — find the empty state for when `todayRun` is null (look for text like "No pipeline run today" or the centered icon). Replace the large centered empty box with a compact inline message:

```tsx
<div className="flex items-center justify-between rounded-lg border border-border bg-[var(--surface)] px-4 py-3">
  <div>
    <p className="text-body">No run today</p>
    <p className="text-hint">Click Run Now to trigger manually</p>
  </div>
  <Button size="sm" onClick={handleRunNow} disabled={running} className="h-7 text-[11px] gap-1.5">
    {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
    Run Now
  </Button>
</div>
```

**Metric cards showing "N/A"** — in the MetricCard component on the strategy detail page (`strategies/[id]/page.tsx`), when value is "N/A", render the card grayed out:

Find the MetricCard component and update it:

```tsx
function MetricCard({ label, value, color }: { label: string; value: string; color?: string }) {
  const isEmpty = value === "N/A" || value === "—";
  return (
    <div className={cn("rounded-lg border border-border bg-[var(--panel)] px-4 py-3", isEmpty && "opacity-50")}>
      <p className="text-label mb-1">{label}</p>
      <p className={cn("text-lg font-semibold tabular-nums", isEmpty ? "text-[#555]" : color)}>
        {isEmpty ? <span className="text-sm font-normal">No data</span> : value}
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Update strategy detail empty state**

In `frontend/src/app/(dashboard)/strategies/[id]/page.tsx`:

**Trade History empty state** — find `"No trades recorded for this strategy yet."` and replace with:

```tsx
<div className="flex flex-col items-center justify-center py-8">
  <TrendingUp className="h-6 w-6 mb-2 opacity-30 text-muted-foreground" />
  <p className="text-body">No trades yet</p>
  <p className="text-hint mt-1">This strategy will enter positions when its signals trigger</p>
  <a href="/pipeline" className="mt-2 text-[11px] text-[var(--primary)] hover:underline">
    View Pipeline &rarr;
  </a>
</div>
```

- [ ] **Step 4: Verify build passes**

```bash
cd frontend && npx next build 2>&1 | tail -5
```
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/\(dashboard\)/page.tsx frontend/src/app/\(dashboard\)/pipeline/page.tsx frontend/src/app/\(dashboard\)/strategies/\[id\]/page.tsx
git commit -m "feat(ux): add contextual empty-state hints across all pages"
```

---

### Task 7: Deploy to Production

Deploy all changes to the Hetzner server.

**Files:**
- All modified frontend files

- [ ] **Step 1: Run final build verification**

```bash
cd frontend && npx next build 2>&1 | tail -15
```
Expected: Build succeeds with all routes.

- [ ] **Step 2: Deploy changed files to server**

```bash
cd /Users/GK/Downloads/alphadesk

# Upload all changed frontend files
scp -i ~/.ssh/alphadesk frontend/src/app/globals.css root@87.99.143.65:/opt/alphadesk/frontend/src/app/globals.css
scp -i ~/.ssh/alphadesk frontend/src/components/ui/toast.tsx root@87.99.143.65:/opt/alphadesk/frontend/src/components/ui/toast.tsx
scp -i ~/.ssh/alphadesk frontend/src/hooks/useToast.ts root@87.99.143.65:/opt/alphadesk/frontend/src/hooks/useToast.ts
scp -i ~/.ssh/alphadesk frontend/src/lib/providers.tsx root@87.99.143.65:/opt/alphadesk/frontend/src/lib/providers.tsx
scp -i ~/.ssh/alphadesk frontend/src/components/ui/placeholder.tsx root@87.99.143.65:/opt/alphadesk/frontend/src/components/ui/placeholder.tsx
scp -i ~/.ssh/alphadesk frontend/src/hooks/useKeyboardShortcuts.ts root@87.99.143.65:/opt/alphadesk/frontend/src/hooks/useKeyboardShortcuts.ts
scp -i ~/.ssh/alphadesk frontend/src/components/ui/shortcut-overlay.tsx root@87.99.143.65:/opt/alphadesk/frontend/src/components/ui/shortcut-overlay.tsx
scp -i ~/.ssh/alphadesk frontend/src/components/layout/StatusStrip.tsx root@87.99.143.65:/opt/alphadesk/frontend/src/components/layout/StatusStrip.tsx
scp -i ~/.ssh/alphadesk frontend/src/components/layout/ProfileMenu.tsx root@87.99.143.65:/opt/alphadesk/frontend/src/components/layout/ProfileMenu.tsx
scp -i ~/.ssh/alphadesk frontend/src/components/layout/TopBar.tsx root@87.99.143.65:/opt/alphadesk/frontend/src/components/layout/TopBar.tsx
scp -i ~/.ssh/alphadesk "frontend/src/app/(dashboard)/layout.tsx" "root@87.99.143.65:/opt/alphadesk/frontend/src/app/(dashboard)/layout.tsx"
scp -i ~/.ssh/alphadesk "frontend/src/app/(dashboard)/page.tsx" "root@87.99.143.65:/opt/alphadesk/frontend/src/app/(dashboard)/page.tsx"
scp -i ~/.ssh/alphadesk "frontend/src/app/(dashboard)/pipeline/page.tsx" "root@87.99.143.65:/opt/alphadesk/frontend/src/app/(dashboard)/pipeline/page.tsx"
scp -i ~/.ssh/alphadesk "frontend/src/app/(dashboard)/strategies/[id]/page.tsx" "root@87.99.143.65:/opt/alphadesk/frontend/src/app/(dashboard)/strategies/[id]/page.tsx"
```

- [ ] **Step 3: Rebuild frontend container**

```bash
ssh -i ~/.ssh/alphadesk root@87.99.143.65 "cd /opt/alphadesk && docker compose -f docker-compose.yml -f infrastructure/docker-compose.prod.yml up -d --build frontend 2>&1" | tail -5
```
Expected: Container rebuilt and started.

- [ ] **Step 4: Verify production is working**

Wait 15 seconds for the container to start, then run:
```bash
node qa-screenshots.mjs 2>&1 | grep -E "Captured|Done"
```
Expected: All pages captured successfully.

- [ ] **Step 5: Commit deployment verification**

No code changes — this is a deployment verification step only.
