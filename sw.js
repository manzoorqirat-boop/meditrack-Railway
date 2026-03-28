const CACHE = 'meditrack-v5';
const FILES = ['/', '/index.html', '/style.css', '/app.js', '/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
    self.clients.claim();
});

self.addEventListener('fetch', () => {}, { once: true }); // wake guard

self.addEventListener('fetch', e => {
  // API calls — always network first, never cache
  if (e.request.url.includes('/api/')) {
    e.respondWith(fetch(e.request));
    return;
  }
  // Static assets — cache first, fallback to network
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});