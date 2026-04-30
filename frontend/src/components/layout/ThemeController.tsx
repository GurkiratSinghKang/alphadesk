"use client";

import { useEffect } from "react";

import { usePreferencesStore } from "@/stores/preferences";

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
