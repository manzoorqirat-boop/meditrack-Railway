const CACHE = 'meditrack-v8';

// Only cache truly static assets — never HTML or JS
const STATIC = ['/style.css', '/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(STATIC))
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

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // API — always network, never cache
  if (url.includes('/api/')) {
    e.respondWith(fetch(e.request));
    return;
  }

  // HTML and JS — always network first so updates deploy instantly
  if (url.endsWith('.html') || url.endsWith('.js') ||
      url.endsWith('/') || !url.includes('.')) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
    return;
  }

  // CSS, fonts, images — cache first
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
