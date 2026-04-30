"use client";

import { useEffect } from "react";

import { usePreferencesStore } from "@/stores/preferences";

let preferencesHydrationStarted = false;

/**
 * ThemeController
 * ────────────────
 * Bridges the persisted ``display.theme`` preference onto the ``<html>``
 * element's ``class`` attribute. One of:
 *
 *   - ``"dark"``   — force the ``.dark`` class.
 *   - ``"light"``  — force the ``.light`` class.
 *   - ``"system"`` — follow the OS via ``prefers-color-scheme``.
 *
 * Renders nothing; side-effect only. Must live inside <Providers> so the
 * preferences store is rehydrated by the time we run.
 */
export default function ThemeController() {
  const theme = usePreferencesStore((s) => s.display.theme);

  useEffect(() => {
    // Preferences use skipHydration because the trading data bridge hydrates
    // several stores together. Theme, however, is app-chrome level and should
    // work on lightweight routes like /login too, where the bridge is not
    // mounted. Start preferences hydration here once per tab; duplicate calls
    // from the bridge are harmless, but this prevents login/settings shells
    // from being stuck on the default dark theme.
    if (preferencesHydrationStarted) return;
    preferencesHydrationStarted = true;
    void usePreferencesStore.persist.rehydrate();
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;

    const apply = (mode: "dark" | "light") => {
      root.classList.toggle("dark", mode === "dark");
      root.classList.toggle("light", mode === "light");
      root.style.colorScheme = mode;
    };

    if (theme === "system") {
      const media = window.matchMedia?.("(prefers-color-scheme: light)");
      const syncSystem = () => apply(media?.matches ? "light" : "dark");
      syncSystem();
      media?.addEventListener?.("change", syncSystem);
      return () => media?.removeEventListener?.("change", syncSystem);
    }

    if (theme === "light") {
      apply("light");
      return;
    }

    apply("dark");
  }, [theme]);

  return null;
}
