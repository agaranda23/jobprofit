const CACHE_NAME = 'jobprofit-v66';  // bumped from v65: fix JSX comment-in-props syntax error in AddJobModal, rebase onto icon-system PRs
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
//   4. Everything else (app shell, JS chunks, CSS, icons) — stale-while-
//      revalidate: serve cache immediately, update in background.

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

  // ── 4. App shell & assets — stale-while-revalidate ───────────────────────
  event.respondWith(
    caches.match(request).then(cached => {
      const fetched = fetch(request).then(response => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        return response;
      }).catch(() => cached);
      return cached || fetched;
    })
  );
});
