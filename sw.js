// RESQ Service Worker - Full Offline Cache
const CACHE_NAME = 'resq-v1';

// All files to cache on install
const CACHE_FILES = [
  '/splash/index.html',
  '/dashboard/index.html',
  '/messaging/index.html',
  '/map/index.html',
  '/resources/index.html',
  '/sos/index.html',
  '/settings/index.html',
  '/i18n.js',
  '/store.js',
];

// On install: cache everything
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] Caching all app files');
      return cache.addAll(CACHE_FILES);
    })
  );
  self.skipWaiting();
});

// On activate: delete old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// On fetch: serve from cache, fallback to network
self.addEventListener('fetch', event => {
  // For Google Fonts - serve cached or skip (fonts degrade gracefully)
  if (event.request.url.includes('fonts.googleapis.com') || 
      event.request.url.includes('fonts.gstatic.com')) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          // Cache the font for future offline use
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        }).catch(() => new Response('', { status: 408 }));
      })
    );
    return;
  }

  // For all other requests: cache first
  event.respondWith(
    caches.match(event.request).then(cached => {
      return cached || fetch(event.request).catch(() => {
        // If offline and not cached, return offline page
        return caches.match('/dashboard/index.html');
      });
    })
  );
});
