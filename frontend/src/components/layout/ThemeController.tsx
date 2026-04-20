"use client";

import { useEffect } from "react";

import { usePreferencesStore } from "@/stores/preferences";

/**
 * ThemeController
 * ────────────────
 * Bridges the persisted ``display.theme`` preference onto the ``<html>``
 * element's ``class`` attribute. One of:
 *
 *   - ``"dark"``   — always force the ``.dark`` class (legacy behaviour).
 *   - ``"light"``  — always force the ``.light`` class. Light tokens are
 *     still Phase-2 work; switching gives the user agency in the meantime.
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
      const mql = window.matchMedia("(prefers-color-scheme: light)");
      const sync = () => apply(mql.matches ? "light" : "dark");
      sync();
      // Subscribe to live OS changes so the app flips with the system theme
      // while the tab is open.
      mql.addEventListener("change", sync);
      return () => mql.removeEventListener("change", sync);
    }

    apply(theme);
  }, [theme]);

  return null;
}
