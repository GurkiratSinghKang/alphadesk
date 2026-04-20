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
 *   - ``"system"`` — follow the OS via ``prefers-color-scheme``. Because
 *     we do not yet ship a tuned light palette, system-light clients are
 *     still rendered in dark; once the light tokens land we will start
 *     honouring the OS hint here without a code change elsewhere.
 *
 * Wave 6γ (persona-112 + Round 5 deferred): the picker no longer offers
 * "Light" — the ``.light {}`` token overrides were never completed, so
 * flipping to light produced no visible change. We keep the type union
 * permissive in case a previously-persisted preference is ``"light"``
 * (zustand persisted-store migration is a separate concern) and map
 * such a value to dark. Users then see the picker highlight System or
 * Dark on their next visit, matching the rendered state.
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

    // Wave 6γ: coerce stale ``"light"`` preferences to dark. Until light
    // tokens land, the rendered output is identical — this just avoids
    // the ``.light`` class being toggled onto <html> for no reason.
    if (theme === "light") {
      apply("dark");
      return;
    }

    if (theme === "system") {
      // We WILL honour ``prefers-color-scheme: light`` in the future when
      // the light palette is ready. Today, we render dark either way so
      // the app still looks intentional on a light-mode OS.
      apply("dark");
      return;
    }

    apply(theme);
  }, [theme]);

  return null;
}
