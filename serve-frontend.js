// Simple static server for the RESQ frontend — handles SW, MIME types, and SPA navigation
const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT    = 3000;
const ROOT    = path.join(__dirname, 'frontend');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
};

// No-op service worker — prevents SW from intercepting navigations in dev mode
const NOOP_SW = `
self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());
// pass all fetches straight to the network
`;

function serve(req, res) {
  let urlPath = req.url.split('?')[0];

  // Serve no-op SW so it never blocks navigation in the dev preview
  if (urlPath === '/sw.js') {
    res.writeHead(200, {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-store',
      'Service-Worker-Allowed': '/',
    });
    res.end(NOOP_SW);
    console.log('200 /sw.js (no-op dev SW)');
    return;
  }

  // Resolve to filesystem path
  let filePath = path.join(ROOT, urlPath);

  // Try exact file, then /index.html inside the directory
  const candidates = [
    filePath,
    filePath.endsWith('/') ? filePath + 'index.html' : filePath + '/index.html',
    filePath + '.html',
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      const ext  = path.extname(candidate).toLowerCase();
      const mime = MIME[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' });
      fs.createReadStream(candidate).pipe(res);
      console.log('200', req.url);
      return;
    }
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found: ' + urlPath);
  console.log('404', req.url);
}

http.createServer(serve).listen(PORT, '0.0.0.0', () => {
  console.log('RESQ frontend running at http://localhost:' + PORT);
  console.log('Login page: http://localhost:' + PORT + '/login/index.html');
});
