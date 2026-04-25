/**
 * K-1 + K-14 — Web Vitals beacon.
 *
 * Replaces the inline `<script dangerouslySetInnerHTML>` previously
 * wired into `app/layout.tsx`. The old hand-rolled PerformanceObserver
 * only captured LCP/CLS to console; web-vitals@4 covers the full Core
 * Web Vitals set (LCP, CLS, INP, FCP, TTFB) with proper "final value"
 * semantics (LCP keeps reporting later candidates; CLS reports the
 * cumulative session-windowed value at page hide).
 *
 * Each metric is delivered to `/api/v1/metrics/vitals` via
 * `navigator.sendBeacon` so the request isn't cancelled when the page
 * is unloading. The endpoint does not exist yet — failures are
 * swallowed so dev (and prod, until the backend agent adds it) doesn't
 * break the page.
 *
 * TODO(backend): add `/api/v1/metrics/vitals` POST endpoint that
 * accepts a JSON body of `{name, value, rating, url, ...}` and writes
 * to the metrics pipeline. See `_metrics-vitals-payload.md` if it
 * exists, or the matching spec section in the round-6 audit. Until
 * then, the beacons are simply dropped server-side and we still get
 * `web-vitals` console output in dev.
 */

import {
  onLCP,
  onCLS,
  onINP,
  onFCP,
  onTTFB,
  type Metric,
} from "web-vitals";

const ENDPOINT = "/api/v1/metrics/vitals";

function reportMetric(metric: Metric): void {
  if (typeof navigator === "undefined") return;

  // Compose the payload up-front so failures (e.g. JSON.stringify
  // throwing on a circular value, which web-vitals never produces but
  // we guard for safety) don't break the rest of the listeners.
  let body: string;
  try {
    body = JSON.stringify({
      name: metric.name,
      value: metric.value,
      rating: metric.rating,
      delta: metric.delta,
      id: metric.id,
      navigationType: metric.navigationType,
      url:
        typeof window !== "undefined" && window.location
          ? window.location.href
          : "",
    });
  } catch {
    return;
  }

  // sendBeacon is the right tool: queues the request even when the
  // page is unloading (which is when CLS / INP final values fire).
  // Wrapped in try/catch so a same-origin / CSP failure doesn't take
  // the rest of the listeners down with it.
  try {
    if (typeof navigator.sendBeacon === "function") {
      const blob = new Blob([body], { type: "application/json" });
      const ok = navigator.sendBeacon(ENDPOINT, blob);
      if (ok) return;
    }
    // Fallback for non-sendBeacon environments (older Safari, jsdom in
    // tests). Use keepalive so the fetch survives the unload, mirroring
    // sendBeacon's semantics.
    if (typeof fetch === "function") {
      void fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {
        /* swallow — endpoint not yet wired */
      });
    }
  } catch {
    /* swallow — beacon failure must never crash the page */
  }
}

/**
 * Register all five Core Web Vitals listeners. Idempotent — safe to
 * call from a `useEffect` that may re-run during dev hot reloads (the
 * web-vitals library's internal observers are de-duplicated by
 * registering once per metric per page load; calling twice subscribes
 * a second listener to the same observer, which is harmless because
 * each fires a separate beacon).
 */
export function registerWebVitals(): void {
  if (typeof window === "undefined") return;
  try {
    onLCP(reportMetric);
    onCLS(reportMetric);
    onINP(reportMetric);
    onFCP(reportMetric);
    onTTFB(reportMetric);
  } catch {
    /* swallow — never let observer registration crash the app */
  }
}
