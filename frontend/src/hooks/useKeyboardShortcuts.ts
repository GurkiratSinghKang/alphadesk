"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useUIStore } from "@/stores/ui";
import { useMarketStore } from "@/stores/market";

// Shift+C/F/S removed in Wave 32 — position-flatten + stop-loss actions need a
// dedicated confirmation flow; re-add when that ships.
export const DEFAULT_BINDINGS: Record<string, string> = {
  "?": "toggle:shortcuts",
  "/": "focus:search",
  "Escape": "dismiss",
  "g d": "navigate:dashboard",
  "g t": "navigate:trade",
  "g p": "navigate:pipeline",
  "g s": "navigate:strategies",
  "g a": "navigate:analytics",
  "g l": "navigate:alerts",
  "g r": "navigate:reports",
  "n": "navigate:next-tab",
  "p": "navigate:prev-tab",
  "f": "focus:search",
  "r": "refresh:page",
  // Wave 32 persona-6 #1: bindings now match PriceChartPanel's ChartRange union
  // ("1D" | "5D" | "1M" | "3M" | "6M" | "YTD" | "1Y" | "ALL"). Intraday keys
  // (1m/5m/15m/1H/4H) were dispatching events nothing listened for.
  "1": "chart:set-range:1D",
  "2": "chart:set-range:5D",
  "3": "chart:set-range:1M",
  "4": "chart:set-range:3M",
  "5": "chart:set-range:6M",
  "6": "chart:set-range:YTD",
  "7": "chart:set-range:1Y",
  "8": "chart:set-range:ALL",
  "Ctrl+j": "copilot:toggle",
  "j": "watchlist:next",
  "k": "watchlist:prev",
  "b": "chart:quick-buy",
  "s": "chart:quick-sell",
};

/** Shortcuts added after 2026-04-01 are flagged as new */
export const NEW_SHORTCUTS = new Set([
  "n",
  "p",
  "f",
  "r",
  "Ctrl+j",
  "g s",
  "g a",
  "g l",
  "g r",
]);

export type ShortcutGroup = {
  name: string;
  icon: string;
  items: { key: string; action: string; description: string; isNew?: boolean }[];
};

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    name: "Global",
    icon: "globe",
    items: [
      { key: "?", action: "toggle:shortcuts", description: "Show keyboard shortcuts" },
      { key: "Ctrl+K", action: "toggle:command-palette", description: "Command palette" },
      { key: "/", action: "focus:search", description: "Focus symbol search" },
      { key: "f", action: "focus:search", description: "Focus search / command palette", isNew: true },
      { key: "Escape", action: "dismiss", description: "Close any modal / overlay" },
      { key: "r", action: "refresh:page", description: "Refresh current page data", isNew: true },
    ],
  },
  {
    name: "Navigation",
    icon: "compass",
    items: [
      { key: "g d", action: "navigate:dashboard", description: "Go to Dashboard" },
      { key: "g t", action: "navigate:trade", description: "Go to Trade" },
      { key: "g s", action: "navigate:strategies", description: "Go to Strategies", isNew: true },
      { key: "g a", action: "navigate:analytics", description: "Go to Analytics", isNew: true },
      { key: "g p", action: "navigate:pipeline", description: "Go to Pipeline" },
      { key: "g l", action: "navigate:alerts", description: "Go to Alerts", isNew: true },
      { key: "g r", action: "navigate:reports", description: "Go to Reports", isNew: true },
      { key: "n", action: "navigate:next-tab", description: "Next tab", isNew: true },
      { key: "p", action: "navigate:prev-tab", description: "Previous tab", isNew: true },
    ],
  },
  {
    name: "Chart",
    icon: "chart",
    items: [
      { key: "1", action: "chart:set-range:1D", description: "1 day" },
      { key: "2", action: "chart:set-range:5D", description: "5 days" },
      { key: "3", action: "chart:set-range:1M", description: "1 month" },
      { key: "4", action: "chart:set-range:3M", description: "3 months" },
      { key: "5", action: "chart:set-range:6M", description: "6 months" },
      { key: "6", action: "chart:set-range:YTD", description: "Year to date" },
      { key: "7", action: "chart:set-range:1Y", description: "1 year" },
      { key: "8", action: "chart:set-range:ALL", description: "All available history" },
    ],
  },
  {
    name: "Watchlist",
    icon: "list",
    items: [
      { key: "j", action: "watchlist:next", description: "Next symbol" },
      { key: "k", action: "watchlist:prev", description: "Previous symbol" },
    ],
  },
  {
    name: "Quick Order",
    icon: "zap",
    items: [
      { key: "b", action: "chart:quick-buy", description: "Focus Order Bar with Buy preset" },
      { key: "s", action: "chart:quick-sell", description: "Focus Order Bar with Sell preset" },
    ],
  },
  {
    name: "AI",
    icon: "brain",
    items: [
      { key: "Cmd+J", action: "copilot:toggle", description: "Toggle AI Copilot sidebar", isNew: true },
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

// Wave 32 persona-6 #7: full coverage of TopBar nav targets so n/p cycles
// every primary tab instead of skipping /strategies and /reports.
const TAB_ORDER = [
  "/",
  "/strategies",
  "/analytics",
  "/pipeline",
  "/reports",
  "/alerts",
  "/settings",
];

/* ─── Page-scoped handler registry ──────────────────────────
 * Pages that want to intercept a specific action (e.g. the desk page
 * wiring b/s to its OrderBar) register via `useShortcutHandler`. If a
 * handler is registered for a given action, the shortcut invokes it and
 * skips the default dispatch. Plain object keyed by action id so multiple
 * handlers don't clobber each other (last-registered wins — matches React
 * effect semantics).
 */
type ShortcutHandler = (action: string) => void;
const shortcutHandlers: Map<string, ShortcutHandler> = new Map();

/**
 * Register a handler for a specific shortcut action. The handler runs
 * only while the component is mounted; unmounting removes it.
 *
 * Example:
 *   useShortcutHandler("chart:quick-buy", () => openOrderBar({ side: "buy" }));
 */
export function useShortcutHandler(action: string, handler: ShortcutHandler) {
  useEffect(() => {
    shortcutHandlers.set(action, handler);
    return () => {
      // Only remove if still ours (avoid clearing a handler registered by a
      // later instance of the same component).
      if (shortcutHandlers.get(action) === handler) {
        shortcutHandlers.delete(action);
      }
    };
  }, [action, handler]);
}

export function useKeyboardShortcuts() {
  const router = useRouter();
  const pathname = usePathname();
  const { setCommandPaletteOpen } = useUIStore();
  const [overlayOpen, setOverlayOpen] = useState(false);

  const bindingsRef = useRef(loadBindings());
  const lastKeyRef = useRef<{ key: string; time: number } | null>(null);

  const handleAction = useCallback(
    (actionId: string) => {
      // If a page registered a handler for this exact action, defer to it.
      const pageHandler = shortcutHandlers.get(actionId);
      if (pageHandler) {
        pageHandler(actionId);
        return;
      }

      // Wave 32 persona-6 #1: namespaced fallback. `chart:set-range:1D` will
      // invoke a handler registered for the family `chart:set-range` so the
      // desk page can listen once and receive every range key.
      const colonIdx = actionId.indexOf(":", actionId.indexOf(":") + 1);
      if (colonIdx > 0) {
        const family = actionId.slice(0, colonIdx);
        const familyHandler = shortcutHandlers.get(family);
        if (familyHandler) {
          familyHandler(actionId);
          return;
        }
      }

      switch (actionId) {
        case "toggle:shortcuts":
          setOverlayOpen((prev) => !prev);
          break;
        case "toggle:command-palette":
        case "focus:search":
          setCommandPaletteOpen(true);
          break;
        case "dismiss":
          setOverlayOpen(false);
          // Also close command palette if open
          setCommandPaletteOpen(false);
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
        case "navigate:strategies":
          router.push("/strategies");
          break;
        case "navigate:analytics":
          router.push("/analytics");
          break;
        case "navigate:alerts":
          router.push("/alerts");
          break;
        case "navigate:reports":
          router.push("/reports");
          break;
        case "navigate:next-tab": {
          const currentIdx = TAB_ORDER.indexOf(pathname ?? "/");
          const nextIdx = (currentIdx + 1) % TAB_ORDER.length;
          router.push(TAB_ORDER[nextIdx]);
          break;
        }
        case "navigate:prev-tab": {
          const currentIdx = TAB_ORDER.indexOf(pathname ?? "/");
          const prevIdx = (currentIdx - 1 + TAB_ORDER.length) % TAB_ORDER.length;
          router.push(TAB_ORDER[prevIdx]);
          break;
        }
        case "refresh:page":
          window.dispatchEvent(new CustomEvent("alphadesk:refresh"));
          break;
        /* ─── Watchlist j/k — fallback to market store cycling ─── */
        case "watchlist:next":
        case "watchlist:prev": {
          const { watchlist, selectedSymbol, setSelectedSymbol } = useMarketStore.getState();
          if (watchlist.length === 0) break;
          const currentIdx = watchlist.indexOf(selectedSymbol);
          const nextIdx =
            actionId === "watchlist:next"
              ? (currentIdx + 1) % watchlist.length
              : (currentIdx - 1 + watchlist.length) % watchlist.length;
          setSelectedSymbol(watchlist[nextIdx] ?? watchlist[0]);
          break;
        }
        /* ─── Quick buy/sell — focus the OrderBar side chip if present ─── */
        case "chart:quick-buy":
        case "chart:quick-sell": {
          const root = document.querySelector<HTMLElement>("[data-slot='order-bar']");
          if (!root) {
            // No order bar on this page — dispatch the event for any listeners.
            window.dispatchEvent(new CustomEvent("alphadesk:shortcut", { detail: actionId }));
            break;
          }
          const targetLabel = actionId === "chart:quick-buy" ? "Buy" : "Sell";
          const btns = Array.from(root.querySelectorAll<HTMLButtonElement>("button"));
          const target = btns.find((b) => b.textContent?.trim() === targetLabel);
          target?.click();
          const qty = root.querySelector<HTMLInputElement>("[data-testid='order-bar-qty']");
          qty?.focus();
          qty?.select();
          break;
        }
        /* ─── Chart timeframe / positions / copilot — still event-driven ─── */
        default:
          window.dispatchEvent(new CustomEvent("alphadesk:shortcut", { detail: actionId }));
          break;
      }
    },
    [router, pathname, setCommandPaletteOpen]
  );

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) {
        return;
      }

      const bindings = bindingsRef.current;
      const now = Date.now();
      const keyStr = e.ctrlKey || e.metaKey
        ? `Ctrl+${e.key.toLowerCase()}`
        : e.shiftKey && e.key.length === 1
          ? `Shift+${e.key.toUpperCase()}`
          : e.key;

      if (lastKeyRef.current && now - lastKeyRef.current.time < CHORD_TIMEOUT) {
        const chord = `${lastKeyRef.current.key} ${keyStr}`;
        if (bindings[chord]) {
          e.preventDefault();
          lastKeyRef.current = null;
          handleAction(bindings[chord]);
          return;
        }
      }

      if (bindings[keyStr]) {
        const isChordPrefix = Object.keys(bindings).some(
          (k) => k.startsWith(keyStr + " ") && k.length > keyStr.length + 1
        );

        if (isChordPrefix) {
          lastKeyRef.current = { key: keyStr, time: now };
          return;
        }

        e.preventDefault();
        lastKeyRef.current = null;
        handleAction(bindings[keyStr]);
        return;
      }

      // Only track keys that are chord prefixes
      const isPotentialChordStart = Object.keys(bindings).some(
        (k) => k.startsWith(keyStr + " ")
      );
      lastKeyRef.current = isPotentialChordStart ? { key: keyStr, time: now } : null;
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [handleAction]);

  return { overlayOpen, setOverlayOpen };
}
