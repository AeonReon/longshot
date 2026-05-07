// Longshot service worker — network-first for code, cache-first only for icons.
// Bumping VERSION forces all clients to drop the old cache on next activate.
const VERSION = 'longshot-v6';
const SHARE_CACHE = 'longshot-share';
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
      Promise.all(keys
        .filter(k => k !== VERSION && k !== SHARE_CACHE)
        .map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Share Target endpoint — receives photos POSTed from the iOS share sheet,
  // stashes them in a cache, redirects to the Stitch tab to pick them up.
  if (e.request.method === 'POST' && url.pathname === '/share') {
    e.respondWith(handleShare(e.request));
    return;
  }

  if (e.request.method !== 'GET') return;

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
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});

async function handleShare(request) {
  try {
    const formData = await request.formData();
    const photos = formData.getAll('photos').filter(p => p && typeof p !== 'string');
    const cache = await caches.open(SHARE_CACHE);

    // Wipe any previous share batch
    const keys = await cache.keys();
    for (const k of keys) await cache.delete(k);

    // Store new batch with metadata
    let count = 0;
    for (let i = 0; i < photos.length; i++) {
      const file = photos[i];
      const headers = {
        'Content-Type': file.type || 'application/octet-stream',
        'X-Filename': file.name || `photo-${i}.jpg`,
        'X-Index': String(i),
      };
      await cache.put(`/__share/${i}`, new Response(file, { headers }));
      count++;
    }

    // Manifest entry tells the page how many to expect
    await cache.put('/__share/manifest', new Response(JSON.stringify({ count, ts: Date.now() }), {
      headers: { 'Content-Type': 'application/json' }
    }));

    return Response.redirect('/?from-share=1#stitch', 303);
  } catch (err) {
    return new Response('Share failed: ' + err.message, { status: 500 });
  }
}
