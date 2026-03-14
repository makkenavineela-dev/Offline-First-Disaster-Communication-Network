const CACHE_NAME = 'resq-offline-v6';

const ASSETS_TO_CACHE = [
  './',
  'index.html',
  'manifest.json',
  'store.js',
  'i18n.js',
  'dashboard/',
  'messaging/',
  'resources/',
  'settings/',
  'map/',
  'splash/',
  'sos/',
  'leaflet/leaflet.js',
  'leaflet/leaflet.css'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('Opened offline cache');
      return Promise.allSettled(
        ASSETS_TO_CACHE.map(url => cache.add(url).catch(err => console.log('Skipped caching:', url, err)))
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
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

  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then(response => {
      // Cache-first strategy
      if (response) {
        return response;
      }

      return fetch(event.request).then(networkResponse => {
        // Cache valid responses dynamically
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(() => {
        // Fallback for navigation when offline
        if (event.request.mode === 'navigate') {
          return caches.match('dashboard/') || caches.match('./');
        }
      });
    })
  );
});
