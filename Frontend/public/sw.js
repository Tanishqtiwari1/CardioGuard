// CardioGuard service worker: keeps the app shell available offline.
// Pages: network first, but never wait more than NAVIGATION_TIMEOUT_MS: on a slow or stalled
// connection the cached copy is shown at once (the SOS page must open in an emergency) while the
// network response still refreshes the cache. Built assets (hashed file names): cache first.
// API calls go to another origin and are never cached here; the app queues those itself.
const CACHE = 'cardioguard-v1';
const NAVIGATION_TIMEOUT_MS = 3000;
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    const network = fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put('./index.html', copy));
      }
      return response;
    });
    // Whichever comes first: the network, or the cached page after the timeout.
    // No cached page yet (first visit): keep waiting for the network.
    const cachedAfterTimeout = new Promise((resolve) => setTimeout(resolve, NAVIGATION_TIMEOUT_MS))
      .then(() => caches.match('./index.html'))
      .then((cached) => cached || network);
    event.respondWith(
      Promise.race([network, cachedAfterTimeout])
        .catch(() => caches.match('./index.html').then((cached) => cached || Response.error())),
    );
    // Let the network response finish updating the cache even if the cached page was shown.
    event.waitUntil(network.catch(() => {}));
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
      }
      return response;
    })),
  );
});
