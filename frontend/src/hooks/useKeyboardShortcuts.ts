"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useUIStore } from "@/stores/ui";
import { useMarketStore } from "@/stores/market";

export const DEFAULT_BINDINGS: Record<string, string> = {
  "?": "toggle:shortcuts",
  "/": "focus:search",
  "Escape": "dismiss",
  "g d": "navigate:dashboard",
  "g t": "navigate:trade",
  "g p": "navigate:pipeline",
  "n": "navigate:next-tab",
  "p": "navigate:prev-tab",
  "f": "focus:search",
  "r": "refresh:page",
  "1": "chart:timeframe:1m",
  "2": "chart:timeframe:5m",
  "3": "chart:timeframe:15m",
  "4": "chart:timeframe:1H",
  "5": "chart:timeframe:4H",
  "6": "chart:timeframe:D",
  "7": "chart:timeframe:W",
  "8": "chart:timeframe:M",
  "Ctrl+j": "copilot:toggle",
  "j": "watchlist:next",
  "k": "watchlist:prev",
  "b": "chart:quick-buy",
  "s": "chart:quick-sell",
  "Shift+C": "positions:close-all",
  "Shift+F": "positions:flatten",
  "Shift+S": "positions:stop-loss",
};

/** Shortcuts added after 2026-04-01 are flagged as new */
export const NEW_SHORTCUTS = new Set(["n", "p", "f", "r", "Ctrl+j", "Shift+C", "Shift+F", "Shift+S"]);

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
      { key: "g p", action: "navigate:pipeline", description: "Go to Pipeline" },
      { key: "n", action: "navigate:next-tab", description: "Next tab", isNew: true },
      { key: "p", action: "navigate:prev-tab", description: "Previous tab", isNew: true },
    ],
  },
  {
    name: "Chart",
    icon: "chart",
    items: [
      { key: "1", action: "chart:timeframe:1m", description: "1 minute" },
      { key: "2", action: "chart:timeframe:5m", description: "5 minutes" },
      { key: "3", action: "chart:timeframe:15m", description: "15 minutes" },
      { key: "4", action: "chart:timeframe:1H", description: "1 hour" },
      { key: "5", action: "chart:timeframe:4H", description: "4 hours" },
      { key: "6", action: "chart:timeframe:D", description: "Daily" },
      { key: "7", action: "chart:timeframe:W", description: "Weekly" },
      { key: "8", action: "chart:timeframe:M", description: "Monthly" },
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
      { key: "b", action: "chart:quick-buy", description: "Quick buy at market" },
      { key: "s", action: "chart:quick-sell", description: "Quick sell at market" },
    ],
  },
  {
    name: "Positions",
    icon: "briefcase",
    items: [
      { key: "Shift+C", action: "positions:close-all", description: "Close all positions", isNew: true },
      { key: "Shift+F", action: "positions:flatten", description: "Flatten portfolio", isNew: true },
      { key: "Shift+S", action: "positions:stop-loss", description: "Set stop loss on selected", isNew: true },
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

const TAB_ORDER = ["/", "/trade", "/analytics", "/alerts", "/pipeline"];

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
      // If a page registered a handler for this action, defer to it.
      const pageHandler = shortcutHandlers.get(actionId);
      if (pageHandler) {
        pageHandler(actionId);
        return;
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
