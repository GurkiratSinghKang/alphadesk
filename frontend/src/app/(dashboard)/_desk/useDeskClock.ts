"use client";

import { useEffect, useState } from "react";

/**
 * useDeskClock
 * ────────────
 * 1s-interval ET clock formatter for the top-bar right side. Avoids
 * hydration churn by initialising to an empty string and mounting
 * client-side.
 */
export function useDeskClock(): string {
  const [label, setLabel] = useState<string>("");

  useEffect(() => {
    function tick() {
      const now = new Date();
      // Render in the user's locale but label it ET — matches the kit
      // and the broker is US-centric; full TZ formatter lands in F4.
      const time = now.toLocaleTimeString("en-US", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      const date = now.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
      setLabel(`${time} ET · ${date}`);
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return label;
}
