// __BUILD_ID__ is replaced at build time by the injectSwCacheId Vite plugin
// (vite.config.js). In `vite dev` the placeholder is used verbatim — a valid
// cache-name string, not a ReferenceError. In production Vite injects a short
// content-hash derived from dist/index.html so the cache busts iff built output
// changes. Do NOT hand-bump this value; the plugin handles it.
// See swCacheName.test.js for the CI guard that prevents a repeat of PR #404.
const CACHE_NAME = 'jobprofit-__BUILD_ID__';
const PRECACHE = [
  '/',
  '/index.html',
  '/icon-192.png',
  '/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Push notification handlers ─────────────────────────────────────────────────
// Fired when the server sends a push message (e.g. customer signed a quote).
// Works when the app is closed or backgrounded — that's the point.
//
// iOS note: requires Safari 16.4+ AND installed to Home Screen as a PWA.
// On unsupported devices this handler is simply never called.
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'JobProfit';
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: data.url || '/' },
    // Collapse duplicate push events under the same tag (e.g. two quick accepts)
    tag: data.tag || 'jobprofit',
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Fired when the user taps the push notification banner.
// Opens (or focuses) the app and navigates to the relevant job.
// For /?job=<id>#/work deep-links the app must be opened at the full URL so
// AppShell can parse ?job= on auth-ready — navigate() is called when the
// window already exists so we don't silently land on the wrong screen.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Navigate an existing window to the target URL, then focus it
      for (const client of clientList) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          if ('navigate' in client) {
            // navigate() reloads the app at the new URL so AppShell picks up ?job=
            return client.navigate(self.location.origin + url).then(c => c?.focus());
          }
          return client.focus();
        }
      }
      // Otherwise open a new window at the target URL
      return self.clients.openWindow(url);
    })
  );
});

// ── Fetch (caching) ───────────────────────────────────────────────────────────
//
// Routing logic (priority order):
//
//   1. Anthropic AI API — bypass SW entirely (keys stay off-device; no cache).
//
//   2. Supabase writes (POST / PATCH / PUT / DELETE) — bypass SW entirely.
//      These must reach the server or be queued by offlineQueue.js — never
//      served from cache. Caching a failed write response would be dangerous.
//
//   3. Supabase GET reads — network-first with cache fallback.
//      Fresh data when online; last-known rows when offline.
//      Cache key is the full URL so different queries cache independently.
//
//   4. Navigation requests (HTML document) — network-first with offline fallback.
//      Serving stale index.html at a deploy boundary causes a blank page: the old
//      shell references old content-hashed asset URLs that no longer exist in the
//      new cache. Network-first guarantees the shell always matches the live assets.
//
//   5. Static assets (JS/CSS/fonts/icons) — cache-first.
//      Content-hashed URLs are immutable per build; cache-first is safe and fast.

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = request.url;

  // ── 1. Anthropic bypass ───────────────────────────────────────────────────
  if (url.includes('api.anthropic.com')) {
    event.respondWith(fetch(request));
    return;
  }

  // ── 2. Supabase writes — bypass (never cache) ─────────────────────────────
  const isSupabase = url.includes('supabase.co');
  const isMutating = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method);
  if (isSupabase && isMutating) {
    event.respondWith(fetch(request));
    return;
  }

  // ── 3. Supabase GET reads — network-first, cache fallback ─────────────────
  if (isSupabase && request.method === 'GET') {
    event.respondWith(
      fetch(request)
        .then(response => {
          // Only cache successful, non-opaque responses
          if (response.ok && response.type !== 'opaque') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          }
          return response;
        })
        .catch(async () => {
          // Network failed — serve cached version if available
          const cached = await caches.match(request);
          if (cached) return cached;
          // No cached copy — return a minimal 503 so callers see a real error
          // rather than a hanging promise. offlineQueue.js handles the retry.
          return new Response(
            JSON.stringify({ error: 'offline', message: 'No cached data available' }),
            { status: 503, headers: { 'Content-Type': 'application/json' } }
          );
        })
    );
    return;
  }

  // ── 4. Navigation requests (HTML document) — network-first ───────────────
  //
  // MUST come before section 5 (assets). Navigation requests are for the HTML
  // document itself (browser bar URL changes, hard reloads, deep-links).
  //
  // Why network-first here, not stale-while-revalidate:
  //   On a deploy boundary the old cached index.html references old
  //   content-hashed asset URLs (/assets/index-OLD.js). When a new SW
  //   activates mid-load it deletes the old cache (see activate handler above),
  //   so those old asset URLs 404 → blank page until the next refresh.
  //   Serving the CURRENT index.html from the network guarantees the asset
  //   references match what is actually cached from the new precache.
  //
  // Offline fallback: if the network is unreachable we serve the cached shell.
  // ignoreSearch:true lets navigations carrying query strings (e.g. /?utm_source=card)
  // resolve to the cached shell so offline QR-code scans still open the app.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          // Cache a clone so the next offline cold-start has the latest shell
          const clone = fresh.clone();
          const cache = await caches.open(CACHE_NAME);
          // Key under '/' so the fallback below always finds it regardless of
          // the exact navigation URL (/?utm_source=x, /#today, etc.)
          cache.put('/', clone);
          return fresh;
        } catch {
          // Network failed — serve cached shell; ignoreSearch covers UTM params
          const cached =
            (await caches.match('/index.html', { ignoreSearch: true })) ||
            (await caches.match('/', { ignoreSearch: true }));
          if (cached) return cached;
          // Absolute last resort — visible error rather than a silent hang
          return new Response('<h1>JobProfit is offline</h1><p>Please reconnect and refresh.</p>', {
            status: 503,
            headers: { 'Content-Type': 'text/html' },
          });
        }
      })()
    );
    return;
  }

  // ── 5. Static assets (JS/CSS/fonts/icons) — cache-first ─────────────────
  //
  // These are Vite content-hashed: the URL changes every build so a cached
  // copy is always valid for its URL. Cache-first is faster than SWR and safe.
  //
  // Never-undefined guarantee: if both cache and network fail, return a real
  // error Response rather than resolving respondWith(undefined) which causes
  // a fetch error that silently breaks the load.
  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      try {
        const response = await fetch(request);
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        return response;
      } catch {
        return new Response('Asset unavailable offline', {
          status: 503,
          headers: { 'Content-Type': 'text/plain' },
        });
      }
    })()
  );
});
