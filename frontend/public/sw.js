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
const VERSION = 'v1';
const CACHE = `screener-static-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    // Precache the shell so an offline navigation always has an entry point.
    // Hashed JS/CSS assets are cached at runtime on the first controlling load
    // (a daily user is always warm from the prior online visit).
    const cache = await caches.open(CACHE);
    try {
      await cache.addAll([self.registration.scope, `${self.registration.scope}index.html`]);
    } catch {
      /* offline at install or asset missing — runtime caching still covers it */
    }
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

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(networkFirst(request, request.mode === 'navigate'));
});
