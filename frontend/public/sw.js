/* Offline service worker for the static PWA (C88).
 *
 * Strategy: NetworkFirst for everything. This is a freshness-critical tool — a
 * stale scan is dangerous — so online always wins and the newest snapshot is
 * fetched and cached. Offline (a train, a dead zone during the 6-8am JST
 * review) falls back to the last cached response so the app still OPENS and the
 * last data is readable; the app's own STALE banner then flags that the cached
 * snapshot is old. Same-origin GET only; errors/opaque responses are never
 * cached, so a bad response can never poison the cache.
 *
 * Update model: skipWaiting + clients.claim so a new deploy's SW activates
 * immediately and drops old caches. We do NOT force-reload open pages, so there
 * is no reload loop — fresh assets simply load on the next navigation.
 */
const VERSION = 'v2';
const CACHE = `screener-static-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Full precache (C89b): the build emits precache-manifest.json listing every
    // hashed asset, so the installed PWA works offline from the FIRST visit — not
    // just the second. Each entry is added individually (allSettled) so one
    // missing/404 asset can never fail the whole install; the shell is always
    // included so an offline navigation has an entry point. Any gap is still
    // covered by the runtime NetworkFirst handler below.
    const shell = [self.registration.scope, `${self.registration.scope}index.html`];
    let urls = shell;
    try {
      const res = await fetch(`${self.registration.scope}precache-manifest.json`, { cache: 'no-cache' });
      if (res.ok) urls = Array.from(new Set([...shell, ...(await res.json())]));
    } catch {
      /* no manifest (dev / older deploy) — shell precache + runtime caching */
    }
    await Promise.allSettled(urls.map((u) => cache.add(new Request(u, { cache: 'no-cache' }))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function networkFirst(request, isNavigate) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    // Only cache real, same-origin, successful responses.
    if (response && response.ok && response.type === 'basic') {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (isNavigate) {
      // Any cached navigation (the app shell) is a valid offline entry point.
      const shell = await cache.match(`${self.registration.scope}index.html`)
        || await cache.match(self.registration.scope);
      if (shell) return shell;
    }
    throw err;
  }
}

// Hashed build assets are content-addressed (the filename hash IS the version),
// so serve them CacheFirst: instant, and — crucially — no network attempt, which
// avoids the NetworkFirst-during-load race that fails a reload's early
// subresource requests when offline. Only navigations + freshness-critical data
// go through NetworkFirst (fresh online, cached fallback offline).
async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok && response.type === 'basic') {
    cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/assets/')) {
    event.respondWith(cacheFirst(request));
    return;
  }
  event.respondWith(networkFirst(request, request.mode === 'navigate'));
});
