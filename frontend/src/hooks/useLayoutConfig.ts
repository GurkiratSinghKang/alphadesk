"use client";

import { useEffect, useState } from "react";
import { getLayoutConfig, type LayoutConfig, type LayoutSection } from "@/lib/api";

/**
 * Read the admin-configured dashboard layout. Cached in module-level
 * state so all <ConfigurableSection /> consumers on the same page
 * resolve from a single fetch without TanStack Query overhead.
 *
 * Cache invalidation: a custom event ``alphadesk:layout-config-updated``
 * dispatched by the admin Control Center triggers a re-fetch. Otherwise
 * the cached value is reused for the lifetime of the session — the
 * dashboard layout is not a hot-update surface.
 */

const cache: { config: LayoutConfig | null; loadedAt: number } = {
  config: null,
  loadedAt: 0,
};

const subscribers = new Set<() => void>();

function notify() {
  for (const fn of subscribers) fn();
}

async function load() {
  try {
    const config = await getLayoutConfig();
    cache.config = config;
    cache.loadedAt = Date.now();
  } catch {
    // Treat fetch failure as "use defaults" — every section visible.
    cache.config = null;
  }
  notify();
}

if (typeof window !== "undefined") {
  window.addEventListener("alphadesk:layout-config-updated", () => {
    void load();
  });
}

export function useLayoutConfig(): LayoutConfig | null {
  const [, force] = useState(0);
  useEffect(() => {
    if (!cache.config && cache.loadedAt === 0) {
      void load();
    }
    const sub = () => force((n) => n + 1);
    subscribers.add(sub);
    return () => {
      subscribers.delete(sub);
    };
  }, []);
  return cache.config;
}

/**
 * Returns the section spec for ``id`` from the cached layout config,
 * or ``null`` if the config hasn't loaded yet (treat as "default —
 * visible, declaration order"). Falls back to ``visible: true`` so
 * a backend outage doesn't blank the dashboard.
 */
export function useSectionConfig(id: string): LayoutSection | null {
  const config = useLayoutConfig();
  if (!config) return null;
  return config.dashboard_sections.find((s) => s.id === id) ?? null;
}
