"use client";

import { useEffect } from "react";
import { registerWebVitals } from "@/lib/web-vitals";

/**
 * K-1 + K-14 — mounts the Core Web Vitals listeners exactly once per
 * page load. Replaces the inline `dangerouslySetInnerHTML` script that
 * previously lived in `app/layout.tsx`. Renders nothing (`null`) — the
 * component exists purely as a side-effect host so the listeners run
 * client-side without bundling web-vitals into the SSR pass.
 *
 * Mounted as a sibling of `<Providers>` so it's outside the React Query
 * / WebSocket trees but still picks up navigation events through the
 * web-vitals library's own internal listeners.
 */
export default function WebVitalsReporter() {
  useEffect(() => {
    registerWebVitals();
  }, []);
  return null;
}
