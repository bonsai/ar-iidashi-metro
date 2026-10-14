/* Deep Sea Hunter Service Worker.

   キャッシュ戦略:
   - 同一オリジン（アプリシェル）: network-first。ネットワークが応答しない / タイムアウトした
     場合はキャッシュへ、ナビゲーション要求でそれも無ければ index.html へフォールバックする。
     cache-first にすると sw.js を変えない push で game.js の更新が届かなくなるため使わない。
   - p5.js CDN: 据え置き。インストール時に取得し、取得時は cache-first（Issue #6 で扱う）。

   APP_SHELL の内容を変えたら CACHE_VERSION を上げる。activate が古い世代を破棄する。
*/
const CACHE_VERSION = 2;
const CACHE_NAME = `deep-sea-hunter-v${CACHE_VERSION}`;
const APP_SHELL = ['./', './index.html', './style.css', './game.js', './manifest.webmanifest', './icon.svg'];
const P5_URL = 'https://cdn.jsdelivr.net/npm/p5@1.11.3/lib/p5.min.js';
// 同一オリジンの応答待ちの上限。無応答な回線だと画面が固まったまま終らないので短めに取る。
const NETWORK_TIMEOUT_MS = 4000;

// network-first。cache: 'no-cache' で毎回オリジンに再検証させる。GitHub Pages は静的資産に
// max-age=600 を付けるため、これが無いと push 直後でも HTTP キャッシュから古い game.js が返る。
// 再検証は 304 で済むので帯域はほぼ増えない。
function fetchShell(request) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
  return fetch(request, { cache: 'no-cache', signal: controller.signal }).finally(() => clearTimeout(timer));
}

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
  const isP5 = event.request.url === P5_URL;
  if (url.origin !== self.location.origin && !isP5) return;

  if (isP5) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(P5_URL, { ignoreSearch: false });
      if (cached) return cached;
      const response = await fetch(event.request);
      if (response.ok) cache.put(P5_URL, response.clone());
      return response;
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetchShell(event.request);
      if (response.ok) cache.put(event.request, response.clone());
      return response;
    } catch (error) {
      const cached = await cache.match(event.request, { ignoreSearch: false });
      if (cached) return cached;
      if (event.request.mode === 'navigate') {
        const shell = await cache.match('./index.html');
        if (shell) return shell;
      }
      throw error;
    }
  })());
});