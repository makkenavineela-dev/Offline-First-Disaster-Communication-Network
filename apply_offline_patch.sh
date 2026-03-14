#!/bin/bash
# RESQ Offline Patch Script
# Run this from your project root: bash apply_offline_patch.sh

echo "🔧 Applying RESQ offline patch..."

FRONTEND="./frontend"

# 1. Copy sw.js to frontend root
cat > $FRONTEND/sw.js << 'EOF'
const CACHE_NAME = 'resq-v1';
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

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(CACHE_FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.url.includes('fonts.googleapis.com') || 
      e.request.url.includes('fonts.gstatic.com')) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(res => {
          caches.open(CACHE_NAME).then(c => c.put(e.request, res.clone()));
          return res;
        }).catch(() => new Response(''));
      })
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached => 
      cached || fetch(e.request).catch(() => caches.match('/dashboard/index.html'))
    )
  );
});
EOF

# 2. Copy manifest.json to frontend root  
cat > $FRONTEND/manifest.json << 'EOF'
{
  "name": "RESQ - Disaster Communication",
  "short_name": "RESQ",
  "start_url": "/splash/index.html",
  "display": "standalone",
  "background_color": "#0A0A0A",
  "theme_color": "#FF1F1F",
  "icons": [{
    "src": "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='20' fill='%23FF1F1F'/><path d='M50 10L20 30v20c0 20 14 38 30 44 16-6 30-24 30-44V30z' fill='white'/></svg>",
    "sizes": "any",
    "type": "image/svg+xml"
  }]
}
EOF

# 3. Patch all HTML files
SW_SNIPPET='  <link rel="manifest" href="../manifest.json">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="theme-color" content="#FF1F1F">
  <script>if("serviceWorker"in navigator)navigator.serviceWorker.register("../sw.js").then(()=>console.log("[RESQ] Offline ready"));</script>'

SPLASH_SNIPPET='  <link rel="manifest" href="./manifest.json">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="theme-color" content="#FF1F1F">
  <script>if("serviceWorker"in navigator)navigator.serviceWorker.register("./sw.js").then(()=>console.log("[RESQ] Offline ready"));</script>'

# Patch each HTML file
for dir in dashboard messaging map resources settings sos; do
  FILE="$FRONTEND/$dir/index.html"
  if [ -f "$FILE" ] && ! grep -q "serviceWorker" "$FILE"; then
    sed -i "s|</head>|$SW_SNIPPET\n</head>|" "$FILE"
    echo "  ✅ Patched: $dir/index.html"
  fi
done

# Patch splash separately (different relative path)
SPLASH="$FRONTEND/splash/index.html"
if [ -f "$SPLASH" ] && ! grep -q "serviceWorker" "$SPLASH"; then
  sed -i "s|</head>|$SPLASH_SNIPPET\n</head>|" "$SPLASH"
  echo "  ✅ Patched: splash/index.html"
fi

echo ""
echo "✅ Done! Your app is now offline-ready."
echo ""
echo "To test:"
echo "  cd frontend && npx serve ."
echo "  Open on phone → Chrome will show 'Add to Home Screen'"
echo "  After install → works with ZERO internet"
