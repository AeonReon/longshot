// Longshot service worker — network-first for code, cache-first only for icons.
// Bumping VERSION forces all clients to drop the old cache on next activate.
const VERSION = 'longshot-v3';
const ICONS = [
  '/images/icon-192.png',
  '/images/icon-512.png',
  '/images/apple-touch-icon.png',
  '/images/favicon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then(c => c.addAll(ICONS).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // Cache-first only for image icons inside /images/
  if (url.pathname.startsWith('/images/')) {
    e.respondWith(
      caches.match(e.request).then(hit => hit || fetch(e.request).then(resp => {
        if (resp.ok && resp.type === 'basic') {
          const copy = resp.clone();
          caches.open(VERSION).then(c => c.put(e.request, copy));
        }
        return resp;
      }).catch(() => hit))
    );
    return;
  }

  // Everything else (HTML, JS, manifest, /api/*) is network-first.
  // Fall back to cache only on offline failure for HTML so the app still loads.
  e.respondWith(
    fetch(e.request)
      .catch(() => caches.match(e.request))
  );
});
