// Universal Service Worker Kill-Switch & Cache Clearer
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(names => {
      for (let name of names) caches.delete(name);
    }).then(() => self.registration.unregister())
      .then(() => self.clients.matchAll().then(clients => {
        clients.forEach(client => client.navigate(client.url));
      }))
  );
});
