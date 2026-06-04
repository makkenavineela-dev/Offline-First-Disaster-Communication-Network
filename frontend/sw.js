const CACHE_NAME = 'resq-offline-v14';
const TILE_CACHE_NAME = 'resq-map-tiles';
const FONT_CACHE_NAME = 'resq-fonts';

// Use absolute paths from the root to ensure reliability across subdirectories
const ASSETS_TO_CACHE = [
  '/',
  '/manifest.json',
  '/store.js',
  '/i18n.js',
  '/mesh.js',
  '/location.js',
  '/splash',
  '/login',
  '/dashboard',
  '/messaging',
  '/resources',
  '/settings',
  '/map',
  '/sos',
  '/map/map-fallback.png',
  '/leaflet/leaflet.js',
  '/leaflet/leaflet.css',
  '/leaflet/images/marker-icon.png',
  '/leaflet/images/marker-icon-2x.png',
  '/leaflet/images/marker-shadow.png',
  '/leaflet/images/layers.png',
  '/leaflet/images/layers-2x.png',
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
          if (cacheName !== CACHE_NAME && cacheName !== TILE_CACHE_NAME && cacheName !== FONT_CACHE_NAME) {
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

  // GOOGLE FONTS CACHING — cache-first so fonts work fully offline after first load
  if (url.host === 'fonts.googleapis.com' || url.host === 'fonts.gstatic.com') {
    event.respondWith(
      caches.open(FONT_CACHE_NAME).then(cache => {
        return cache.match(event.request).then(cached => {
          if (cached) return cached;
          return fetch(event.request).then(response => {
            if (response.status === 200) {
              cache.put(event.request, response.clone());
            }
            return response;
          }).catch(() => new Response('', { status: 503 }));
        });
      })
    );
    return;
  }

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

  // Normalize to clean URL: strip /index.html suffix, .html extension, and trailing slash
  let normalizedPath = url.pathname
    .replace(/\/index\.html$/, '')
    .replace(/\.html$/, '')
    .replace(/\/$/, '') || '/';
  const normalizedUrl = url.origin + normalizedPath;

  // ── NETWORK-FIRST for HTML pages and JS/CSS ──────────────────────────────
  // In a Capacitor app the "network" is the bundled localhost assets, which are
  // always fresh after an APK update. Network-first ensures code changes apply
  // immediately while still falling back to cache when genuinely offline.
  const isPage   = event.request.mode === 'navigate';
  const isScript = url.pathname.endsWith('.js') || url.pathname.endsWith('.css');

  if (isPage || isScript) {
    event.respondWith(
      fetch(event.request).then(networkResponse => {
        if (networkResponse && networkResponse.status === 200) {
          const copy = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(normalizedUrl, copy));
        }
        return networkResponse;
      }).catch(() => {
        // Offline — serve from cache
        return caches.match(event.request)
          .then(r => r || caches.match(normalizedUrl))
          .then(r => r || (isPage ? caches.match('/splash/index.html') : null))
          .then(r => r || new Response('Offline', { status: 503 }));
      })
    );
    return;
  }

  // ── CACHE-FIRST for everything else (images, icons, static assets) ───────
  event.respondWith(
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
        return new Response('Offline: Resource not available', {
          status: 503,
          statusText: 'Service Unavailable (Offline)'
        });
      });
    })
  );
});
