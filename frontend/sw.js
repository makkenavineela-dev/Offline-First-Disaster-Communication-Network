const CACHE_NAME = 'resq-offline-v10';
const TILE_CACHE_NAME = 'resq-map-tiles';

// Use absolute paths from the root to ensure reliability across subdirectories
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/store.js',
  '/i18n.js',
  '/dashboard/index.html',
  '/messaging/index.html',
  '/resources/index.html',
  '/settings/index.html',
  '/map/index.html',
  '/map/map-fallback.png',
  '/splash/index.html',
  '/sos/index.html',
  '/leaflet/leaflet.js',
  '/leaflet/leaflet.css',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('Precaching critical assets');
      // Using addAll so that if any critical asset fails, the SW install fails
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME && cacheName !== TILE_CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  
  // MAP TILES AGGRESSIVE CACHING (H-04)
  if (url.host.includes('tile.openstreetmap.org') || url.pathname.includes('/tiles/')) {
    event.respondWith(
      caches.open(TILE_CACHE_NAME).then(cache => {
        return cache.match(event.request).then(response => {
          return response || fetch(event.request).then(networkResponse => {
            if (networkResponse.status === 200) {
                cache.put(event.request, networkResponse.clone());
            }
            return networkResponse;
          });
        });
      })
    );
    return;
  }

  // Normalize directory requests to index.html
  let normalizedPath = url.pathname;
  if (normalizedPath.endsWith('/')) {
    normalizedPath += 'index.html';
  }
  const normalizedUrl = url.origin + normalizedPath;

  event.respondWith(
    // Try matching the original request first, then the normalized URL path
    caches.match(event.request).then(cachedResponse => {
      if (cachedResponse) return cachedResponse;
      return caches.match(normalizedUrl);
    }).then(cachedResponse => {
      if (cachedResponse) return cachedResponse;

      return fetch(event.request).then(networkResponse => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(normalizedUrl, responseToCache);
          });
        }
        return networkResponse;
      }).catch(() => {
        // FAILSAFE Fallback (L-05)
        if (event.request.mode === 'navigate') {
          return caches.match('/splash/index.html').then(r => r || caches.match('/index.html'));
        }
        // Graceful 503 for non-navigation assets that failed and aren't cached
        return new Response('Offline: Resource not available', {
          status: 503,
          statusText: 'Service Unavailable (Offline)'
        });
      });
    })
  );
});
