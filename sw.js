const CACHE_NAME = 'deep-sea-hunter-v1';
const APP_SHELL = ['./', './index.html', './style.css', './game.js', './manifest.webmanifest', './icon.svg'];
const P5_URL = 'https://cdn.jsdelivr.net/npm/p5@1.11.3/lib/p5.min.js';
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    try { const response = await fetch(P5_URL, { mode: 'cors' }); if (response.ok) await cache.put(P5_URL, response); } catch (_) {}
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key !== CACHE_NAME) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin === self.location.origin || event.request.url === P5_URL) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(event.request, { ignoreSearch: false });
      if (cached) return cached;
      try { const response = await fetch(event.request); if (response.ok && (url.origin === self.location.origin || event.request.url === P5_URL)) cache.put(event.request, response.clone()); return response; }
      catch (_) { if (event.request.mode === 'navigate') return cache.match('./index.html'); throw _; }
    })());
  }
});