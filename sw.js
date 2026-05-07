// Longshot service worker — minimal cache, network-first for HTML so deploys land fast.
const VERSION = 'longshot-v1';
const STATIC = [
  '/manifest.json',
  '/app.js',
  '/images/icon-192.png',
  '/images/icon-512.png',
  '/images/apple-touch-icon.png',
  '/images/favicon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(STATIC)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  // Always network for HTML and the build stamp — never serve stale shell
  if (e.request.mode === 'navigate'
      || url.pathname === '/'
      || url.pathname.endsWith('.html')
      || url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }

  // Cache-first for static assets
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(resp => {
      if (resp.ok && resp.type === 'basic') {
        const copy = resp.clone();
        caches.open(VERSION).then(c => c.put(e.request, copy));
      }
      return resp;
    }).catch(() => hit))
  );
});
