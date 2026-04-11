"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useUIStore } from "@/stores/ui";

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
          window.dispatchEvent(new CustomEvent("alphadesk:shortcut", { detail: actionId }));
          break;
      }
    },
    [router, setCommandPaletteOpen]
  );

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) {
        return;
      }

      const bindings = bindingsRef.current;
      const now = Date.now();
      const keyStr = e.ctrlKey || e.metaKey ? `Ctrl+${e.key.toLowerCase()}` : e.key;

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

      lastKeyRef.current = { key: keyStr, time: now };
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [handleAction]);

  return { overlayOpen, setOverlayOpen };
}
