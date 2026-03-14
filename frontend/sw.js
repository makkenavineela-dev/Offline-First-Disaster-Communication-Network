const CACHE_NAME = 'resq-offline-v7';

// We must cache the exact filenames used in links
const ASSETS_TO_CACHE = [
  './index.html',
  './manifest.json',
  './store.js',
  './i18n.js',
  './dashboard/index.html',
  './messaging/index.html',
  './resources/index.html',
  './settings/index.html',
  './map/index.html',
  './splash/index.html',
  './sos/index.html',
  './leaflet/leaflet.js',
  './leaflet/leaflet.css'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('Precaching all explicit assets');
      return Promise.allSettled(
        ASSETS_TO_CACHE.map(url => cache.add(url).catch(err => console.log('Failed to cache:', url, err)))
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

  const url = new URL(event.request.url);
  
  // Optimization: handle directory-style requests by appending index.html internally
  let requestUrl = event.request.url;
  if (url.pathname.endsWith('/')) {
      requestUrl += 'index.html';
  }

  event.respondWith(
    caches.match(requestUrl).then(cachedResponse => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request).then(networkResponse => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(() => {
        // FAILSAFE: If offline and something fails, return the main dashboard or splash
        if (event.request.mode === 'navigate') {
          return caches.match('./splash/index.html') || caches.match('./index.html');
        }
      });
    })
  );
});
