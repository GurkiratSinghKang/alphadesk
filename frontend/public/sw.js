/**
 * AlphaDesk Service Worker — minimal network-first PWA shell.
 *
 * Round-22 / persona-B P0: prior to this commit the manifest advertised
 * a PWA (apple-mobile-web-app-capable + display:standalone) but no SW
 * was registered. Installing the PWA gave you a wrapper that broke
 * the moment the network blipped. This SW gives the installed app an
 * offline shell and a clean update flow.
 *
 * Caching strategy:
 *   - API calls (/api/v1/*, /ws): pass-through, never cached. Stale
 *     trade / portfolio data is worse than no data.
 *   - Next.js immutable assets (/_next/static/*): cache-first, long-
 *     lived. Filenames are content-hashed so a new build invalidates
 *     by URL.
 *   - HTML / page navigations: network-first with offline fallback —
 *     the user gets a fresh response when online and a static
 *     "you're offline" page otherwise.
 *   - Other GETs: network-first with cache fallback so an asset that
 *     loaded once stays available offline.
 *
 * Update flow:
 *   - SW_VERSION change triggers an "install" with a new cache name.
 *   - Old caches are purged on "activate".
 *   - Tabs send {type: 'SKIP_WAITING'} to upgrade without reload.
 */
const SW_VERSION = "v1";
const RUNTIME_CACHE = `alphadesk-runtime-${SW_VERSION}`;
const STATIC_CACHE = `alphadesk-static-${SW_VERSION}`;
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                key !== RUNTIME_CACHE && key !== STATIC_CACHE,
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Same-origin only — never proxy / cache cross-origin (third-party
  // analytics, social pixels). Avoids CORS tarpits and keeps the
  // cache scoped to assets we actually own.
  if (url.origin !== self.location.origin) return;

  // API calls: pass-through, never cache. Stale portfolio data is
  // worse than no data on a trading product.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/ws")) {
    return;
  }

  // QA r3 BUG-05: trade route deep-links carry critical query state
  // (?contract=, ?legs=, ?symbol=, &strategy=). The offline-shell
  // intercept dropped that state when the SW returned the static
  // fallback. Skip the intercept for /trade routes — let the browser
  // surface its own offline dialog if connectivity is truly gone, but
  // never lose trade state via SW.
  if (url.pathname === "/trade" || url.pathname.startsWith("/trade/")) {
    return; // do not call event.respondWith — browser handles the request
  }

  // Next.js immutable static assets: cache-first.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // Page navigations: network-first with offline fallback.
  if (request.mode === "navigate") {
    event.respondWith(navigationStrategy(request));
    return;
  }

  // Other same-origin GETs: network-first with cache fallback.
  event.respondWith(networkFirst(request, RUNTIME_CACHE));
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (_err) {
    // Static asset missed and offline — propagate the failure to the
    // browser so it shows a real broken-image, not a fake response.
    throw _err;
  }
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (_err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw _err;
  }
}

async function navigationStrategy(request) {
  try {
    const response = await fetch(request);
    return response;
  } catch (_err) {
    const cache = await caches.open(STATIC_CACHE);
    const cached = await cache.match(OFFLINE_URL);
    if (cached) {
      // QA r3 BUG-05: inject the original URL so the offline shell's
      // "Try again" button restores the user to where they were going
      // instead of always redirecting to "/".
      try {
        const reqUrl = new URL(request.url);
        // Defense-in-depth: with the /trade* skip above, the offline shell
        // should never be served on a trade route. If it is, surface a
        // telemetry breadcrumb to active clients so a regression is
        // detectable. SW context has no navigator.sendBeacon, so we
        // postMessage to clients which can beacon themselves.
        if (
          reqUrl.pathname === "/trade" ||
          reqUrl.pathname.startsWith("/trade/")
        ) {
          try {
            const all = await self.clients.matchAll({ type: "window" });
            for (const c of all) {
              c.postMessage({
                type: "offline_shell_trade_route",
                url: reqUrl.pathname,
              });
            }
          } catch (_beaconErr) {
            // best-effort, never block the navigation response
          }
        }
        let target = reqUrl.pathname + reqUrl.search;
        // P2-13: reject empty / protocol-relative paths to avoid
        // open-redirect via the offline-shell "Try again" link.
        if (!/^\/[^/\\]/.test(target)) target = "/dashboard";
        const text = await cached.text();
        const injected = text.replace(
          "<!--FROM_URL_PLACEHOLDER-->",
          `<script>window.__originalUrl = ${JSON.stringify(target)};<\/script>`,
        );
        return new Response(injected, {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      } catch (_injectErr) {
        // If text injection fails for any reason, fall back to the raw
        // cached response so the user at least sees the offline shell.
        const fallback = await cache.match(OFFLINE_URL);
        if (fallback) return fallback;
      }
    }
    return new Response(
      "<!doctype html><title>Offline</title><h1>AlphaDesk is offline</h1>" +
        "<p>Reconnect and refresh to continue.</p>",
      { headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }
}
