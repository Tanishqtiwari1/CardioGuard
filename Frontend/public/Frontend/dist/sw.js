// Retires the old offline helper (service worker) that browsers registered at /Frontend/dist/
// while GitHub Pages served the repository folder. The site now lives at the root, with its
// own sw.js. When a browser checks this address for an update it gets this file, which
// unregisters itself and reloads open pages so they follow the redirect to the root.
// Caches are left alone: their names are shared with the current service worker.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await self.registration.unregister();
    const windows = await self.clients.matchAll({ type: 'window' });
    windows.forEach((client) => client.navigate(client.url));
  })());
});
