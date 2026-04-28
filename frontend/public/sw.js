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
    const offline = await cache.match(OFFLINE_URL);
    if (offline) return offline;
    return new Response(
      "<!doctype html><title>Offline</title><h1>AlphaDesk is offline</h1>" +
        "<p>Reconnect and refresh to continue.</p>",
      { headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }
}
