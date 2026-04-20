"use client";

import { useEffect, useState } from "react";

import { formatDate, formatTime } from "@/lib/formatDate";

/**
 * useDeskClock
 * ────────────
 * 1s-interval ET clock formatter for the top-bar right side. Avoids
 * hydration churn by initialising to an empty string and mounting
 * client-side.
 *
 * BUG-012: now formats through the shared `formatDate` / `formatTime`
 * helpers (both pinned to `America/New_York`) so login, desk header, and
 * any other surface showing a date read the same wall clock.
 */
export function useDeskClock(): string {
  const [label, setLabel] = useState<string>("");

  useEffect(() => {
    function tick() {
      const now = new Date();
      setLabel(`${formatTime(now)} ET · ${formatDate(now, "long")}`);
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return label;
}
