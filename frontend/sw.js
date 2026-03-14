const CACHE_NAME = 'resq-offline-v1';

const ASSETS_TO_CACHE = [
  '/',
  '/manifest.json',
  '/store.js',
  '/i18n.js',
  '/dashboard/index.html',
  '/messaging/index.html',
  '/resources/index.html',
  '/settings/index.html',
  '/map/index.html'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('Opened offline cache');
      // Silently cache files so missing ones don't fail the whole promise
      return Promise.allSettled(
        ASSETS_TO_CACHE.map(url => cache.add(url).catch(err => console.log('Skipped caching:', url)))
      );
    })
  );
});

self.addEventListener('activate', event => {
  const cacheAllowlist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheAllowlist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

self.addEventListener('fetch', event => {
  // Offline-first strategy with dynamic caching (crucial for map tiles)
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Return cached version if found
        if (response) {
          return response;
        }
        
        // Clone the request for the fetch call
        const fetchRequest = event.request.clone();

        return fetch(fetchRequest).then(
          networkResponse => {
            // Check if we received a valid response
            if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
              // If it's an opaque request like map tiles (CORS), it's fine to cache, just proceed
              if (networkResponse && networkResponse.type === 'opaque') {
                const responseToCache = networkResponse.clone();
                caches.open(CACHE_NAME)
                  .then(cache => {
                    cache.put(event.request, responseToCache);
                  });
              }
              return networkResponse;
            }

            // Valid basic response, clone and cache it
            const responseToCache = networkResponse.clone();

            caches.open(CACHE_NAME)
              .then(cache => {
                cache.put(event.request, responseToCache);
              });

            return networkResponse;
          }
        ).catch(() => {
          // Ultimate fallback when fully offline
          if (event.request.mode === 'navigate') {
            return caches.match('/dashboard/index.html');
          }
        });
      })
  );
});
