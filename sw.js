// Offline screen. Pages load from the network as usual; only when there is
// no connection does opening a page show offline.html instead of the
// browser's error. Nothing else is cached, so the site is never stale.
const CACHE = 'gita-offline-v1';
const FILES = ['/offline.html', '/assets/app/icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    // Start loading the page while the worker wakes up, so it adds no delay.
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // The offline page's own logo.
  if (url.origin === location.origin && FILES.includes(url.pathname) && e.request.mode !== 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match(url.pathname)));
    return;
  }
  if (e.request.mode !== 'navigate') return;
  e.respondWith((async () => {
    try {
      return (await e.preloadResponse) || await fetch(e.request);
    } catch {
      return (await caches.match('/offline.html')) || Response.error();
    }
  })());
});
