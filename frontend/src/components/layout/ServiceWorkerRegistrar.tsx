"use client";

import { useEffect } from "react";

/**
 * Round-22 / persona-B P0: register the PWA service worker exactly
 * once per page load.
 *
 * Pre-fix the manifest advertised an installable PWA but no SW was
 * registered, so installing the app to the home screen produced a
 * shell that broke the moment the network blipped. ``public/sw.js``
 * now provides a network-first cache + offline fallback page; this
 * component wires it up.
 *
 * Render-nothing pattern matches WebVitalsReporter — pure side-effect
 * host so the registration runs client-side without bundling SW
 * lifecycle code into the SSR pass.
 *
 * Update flow:
 *   - SW notices a new ``sw.js`` (different content) on next page load.
 *   - The new worker enters ``installing`` then ``waiting`` state.
 *   - We post ``SKIP_WAITING`` immediately so the new version takes
 *     control on the next navigation. (For safety-critical updates
 *     a future iteration could surface a "reload to update" toast
 *     instead of auto-applying.)
 */
export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    // Only register in production — dev SSR bundles change every reload
    // and a stale cached worker would mask real changes.
    if (process.env.NODE_ENV !== "production") return;

    const url = "/sw.js";
    let cancelled = false;

    navigator.serviceWorker
      .register(url, { scope: "/" })
      .then((reg) => {
        if (cancelled) return;
        // Trigger SKIP_WAITING when an update is found so the new worker
        // doesn't sit idle until every tab closes.
        reg.addEventListener("updatefound", () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (
              installing.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              installing.postMessage({ type: "SKIP_WAITING" });
            }
          });
        });
      })
      .catch(() => {
        // Failures here are best-effort: if the SW file is missing or
        // 404s the page should still work — just without offline.
      });

    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
